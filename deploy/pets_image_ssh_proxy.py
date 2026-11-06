"""API-only CONNECT proxy: one SSH process per client, no reconnect or replay."""
import asyncio
from contextlib import suppress
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
import sys
import time
import uuid


@dataclass(frozen=True)
class Settings:
    ssh_command: list[str]
    listen_host: str = '172.17.0.1'
    listen_port: int = 18090
    max_connections: int = 16
    max_handshakes: int = 4
    handshake_timeout: float = 15
    connection_timeout: float = 240
    phase_diagnostics: bool = False


def load_settings(path):
    config = Settings(**json.loads(Path(path).read_text()))
    command = config.ssh_command
    if (config.listen_host not in ('172.17.0.1', '127.0.0.1')
            or type(config.listen_port) is not int or not 1024 <= config.listen_port <= 65535
            or type(config.max_connections) is not int or not 1 <= config.max_connections <= 32
            or type(config.max_handshakes) is not int or not 1 <= config.max_handshakes <= 4
            or type(config.handshake_timeout) not in (int, float) or not 1 <= config.handshake_timeout <= 30
            or type(config.connection_timeout) not in (int, float) or not 180 <= config.connection_timeout <= 300
            or type(config.phase_diagnostics) is not bool
            or not isinstance(command, list) or not command or command[0] != '/usr/bin/ssh'
            or not all(isinstance(arg, str) and arg and '\x00' not in arg for arg in command)
            or '-W' not in command or command[command.index('-W') + 1:command.index('-W') + 2] != ['api.openai.com:443']
            or any(flag in command for flag in ('-L', '-R', '-D'))
            or 'StrictHostKeyChecking=yes' not in command or 'BatchMode=yes' not in command
            or 'ControlMaster=no' not in command or 'ControlPath=none' not in command):
        raise ValueError('invalid_configuration')
    return config


class SshDiagnostics:
    """Best-effort phase markers only; never retain or emit raw SSH diagnostics."""
    MAX_LINE = 4096
    PHASES = ('ssh_started', 'tcp_connected', 'ssh_banner', 'ssh_authenticated',
              'upstream_connected', 'first_inbound_bytes')
    MARKERS = (
        (b'debug1: Connection established.', 'tcp_connected'),
        (b'debug1: Remote protocol version ', 'ssh_banner'),
        (b'Authenticated to ', 'ssh_authenticated'),
        (b'debug2: channel 0: open confirm ', 'upstream_connected'),
    )

    def __init__(self, emit):
        self.emit = emit
        self.last_phase = 'ssh_started'
        self.buffer = bytearray()
        self.discarding = False

    def observe(self, phase):
        if self.PHASES.index(phase) <= self.PHASES.index(self.last_phase):
            return
        self.last_phase = phase
        self.emit(phase)

    def feed(self, data):
        parts = data.split(b'\n')
        for index, part in enumerate(parts):
            if not self.discarding:
                if len(self.buffer) + len(part) > self.MAX_LINE:
                    self.buffer.clear()
                    self.discarding = True
                else:
                    self.buffer.extend(part)
            if index < len(parts) - 1:
                if not self.discarding:
                    for prefix, phase in self.MARKERS:
                        if self.buffer.startswith(prefix):
                            self.observe(phase)
                            break
                self.buffer.clear()
                self.discarding = False


async def open_diagnostic_pipe():
    # Own stderr separately: Process.wait() must not wait for EOF from an SSH descendant.
    read_fd, write_fd = os.pipe()
    try:
        read_pipe = os.fdopen(read_fd, 'rb', buffering=0)
    except BaseException:
        os.close(read_fd)
        os.close(write_fd)
        raise
    reader = asyncio.StreamReader()
    try:
        connecting = asyncio.create_task(asyncio.get_running_loop().connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(reader), read_pipe))
        try:
            transport, _ = await asyncio.shield(connecting)
        except asyncio.CancelledError:
            transport, _ = await connecting
            transport.close()
            raise
        return reader, transport, write_fd
    except BaseException:
        read_pipe.close()
        os.close(write_fd)
        raise


class Proxy:
    def __init__(self, config, log):
        self.config = config
        self.log = log
        self.server = None
        self.tasks = set()
        self.handshakes = asyncio.Semaphore(config.max_handshakes)
        self.closing = False
        self.sequence = 0
        self.run_id = uuid.uuid4().hex

    def emit(self, event):
        self.log({'runId': self.run_id, **event})

    @property
    def port(self):
        return self.server.sockets[0].getsockname()[1]

    async def start(self):
        self.server = await asyncio.start_server(
            self.accept, self.config.listen_host, self.config.listen_port,
            limit=65536, backlog=self.config.max_connections)

    def accept(self, reader, writer):
        if self.closing or len(self.tasks) >= self.config.max_connections:
            writer.write(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n')
            writer.close()
            return
        self.sequence += 1
        task = asyncio.create_task(self.handle(reader, writer, self.sequence))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def close(self):
        self.closing = True
        if self.server:
            self.server.close()
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.server:
            await self.server.wait_closed()

    async def handle(self, reader, writer, connection):
        started = time.monotonic()
        process = None
        pipes = []
        slot = False
        outcome = 'closed'
        sent = received = 0
        stderr_task = None
        stderr_pipe = None
        diagnostics = None

        async def read_diagnostics():
            while chunk := await stderr_pipe[0].read(4096):
                diagnostics.feed(chunk)

        def release_handshake():
            nonlocal slot
            if slot:
                self.handshakes.release()
                slot = False

        async def upload():
            nonlocal sent
            while chunk := await reader.read(65536):
                process.stdin.write(chunk)
                await process.stdin.drain()
                sent += len(chunk)
            process.stdin.close()

        async def download():
            nonlocal received
            # The first server TLS bytes prove that SSH authentication and
            # upstream connect finished. Failed handshakes keep their slot
            # until the old process is reaped, including a slow termination.
            chunk = await asyncio.wait_for(process.stdout.read(65536), self.config.handshake_timeout)
            if chunk:
                if diagnostics:
                    diagnostics.observe('first_inbound_bytes')
                self.emit({'event': 'ssh_ready', 'connection': connection, 'pid': process.pid})
                release_handshake()
            while chunk:
                writer.write(chunk)
                await writer.drain()
                received += len(chunk)
                chunk = await process.stdout.read(65536)

        async def relay():
            nonlocal process, slot, pipes, outcome, stderr_task, stderr_pipe, diagnostics
            try:
                header = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 5)
            except asyncio.LimitOverrunError:
                header = b'x' * 4097
            if len(header) > 4096:
                writer.write(b'HTTP/1.1 431 Request Header Fields Too Large\r\nContent-Length: 0\r\n\r\n')
                await writer.drain()
                outcome = 'header_too_large'
                return
            first = header.split(b'\r\n', 1)[0].split()
            if first not in ([b'CONNECT', b'api.openai.com:443', b'HTTP/1.0'],
                              [b'CONNECT', b'api.openai.com:443', b'HTTP/1.1']):
                writer.write(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
                await writer.drain()
                outcome = 'destination_rejected'
                return
            await asyncio.wait_for(self.handshakes.acquire(), self.config.handshake_timeout)
            slot = True
            command = self.config.ssh_command
            if self.config.phase_diagnostics:
                # OpenSSH uses the first command-line value for LogLevel.
                command = [command[0], '-oLogLevel=DEBUG2', *command[1:]]
                stderr_pipe = await open_diagnostic_pipe()
            try:
                spawn = asyncio.create_task(asyncio.create_subprocess_exec(
                    *command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=stderr_pipe[2] if stderr_pipe else asyncio.subprocess.DEVNULL,
                    env={'PATH': '/usr/bin:/bin', 'LANG': 'C'}))
                try:
                    process = await asyncio.shield(spawn)
                except asyncio.CancelledError:
                    process = await spawn
                    raise
            finally:
                if stderr_pipe:
                    os.close(stderr_pipe[2])
            self.emit({'event': 'ssh_started', 'connection': connection, 'pid': process.pid})
            if self.config.phase_diagnostics:
                diagnostics = SshDiagnostics(lambda phase: self.emit({
                    'event': 'ssh_phase', 'connection': connection, 'pid': process.pid,
                    'phase': phase, 'elapsedMs': round((time.monotonic() - started) * 1000),
                }))
                stderr_task = asyncio.create_task(read_diagnostics())
            writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            await writer.drain()
            pipes = [asyncio.create_task(upload()), asyncio.create_task(download())]
            done, _ = await asyncio.wait(pipes, return_when=asyncio.FIRST_COMPLETED)
            if pipes[1] in done:
                await pipes[1]
            else:
                await pipes[0]
                await pipes[1]
            outcome = 'remote_eof'

        try:
            await asyncio.wait_for(relay(), self.config.connection_timeout)
        except asyncio.TimeoutError:
            outcome = 'timeout'
        except asyncio.CancelledError:
            outcome = 'shutdown'
            raise
        except (OSError, asyncio.IncompleteReadError, ConnectionError):
            outcome = 'connection_error'
        finally:
            async def cleanup():
                for task in pipes:
                    task.cancel()
                await asyncio.gather(*pipes, return_exceptions=True)
                try:
                    if process:
                        if process.stdin:
                            process.stdin.close()
                        if process.returncode is None:
                            with suppress(ProcessLookupError):
                                process.terminate()
                            try:
                                await asyncio.wait_for(process.wait(), 2)
                            except asyncio.TimeoutError:
                                with suppress(ProcessLookupError):
                                    process.kill()
                                await process.wait()
                    if stderr_task:
                        with suppress(asyncio.TimeoutError, OSError):
                            await asyncio.wait_for(stderr_task, 1)
                finally:
                    if stderr_task and not stderr_task.done():
                        stderr_task.cancel()
                        await asyncio.gather(stderr_task, return_exceptions=True)
                    if stderr_pipe:
                        stderr_pipe[1].close()
                release_handshake()
                writer.close()
                try:
                    await asyncio.wait_for(writer.wait_closed(), 1)
                except (OSError, asyncio.TimeoutError):
                    writer.transport.abort()
                self.emit({'event': 'connection_closed', 'connection': connection,
                          'outcome': outcome, 'elapsedMs': round((time.monotonic() - started) * 1000),
                          'sentBytes': sent, 'receivedBytes': received,
                          'sshExitCode': process.returncode if process else None,
                          'pid': process.pid if process else None,
                          **({'lastPhase': diagnostics.last_phase if diagnostics else 'unknown'} if self.config.phase_diagnostics else {})})
            cleanup_task = asyncio.create_task(cleanup())
            try:
                await asyncio.shield(cleanup_task)
            except asyncio.CancelledError:
                await cleanup_task
                raise


async def main(path):
    config = load_settings(path)
    proxy = Proxy(config, lambda event: print(json.dumps(event), flush=True))
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await proxy.start()
    proxy.emit({'event': 'ready', 'port': proxy.port})
    try:
        await stop.wait()
    finally:
        await proxy.close()


if __name__ == '__main__':
    try:
        asyncio.run(main(sys.argv[1]))
    except (ValueError, TypeError, KeyError, IndexError, OSError):
        print(json.dumps({'event': 'startup_failed'}), flush=True)
        sys.exit(1)
