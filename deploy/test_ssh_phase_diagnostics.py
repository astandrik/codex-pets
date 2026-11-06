import asyncio
import json
import os
import signal
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import test_pets_image_ssh_proxy as proxy_tests

from pets_image_ssh_proxy import Proxy, Settings, SshDiagnostics, load_settings, open_diagnostic_pipe


class PhaseDiagnosticsTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_pipe_setup_closes_both_descriptors(self):
        loop = asyncio.get_running_loop()
        descriptors = os.pipe()
        with patch('pets_image_ssh_proxy.os.pipe', return_value=descriptors), \
                patch.object(loop, 'connect_read_pipe', side_effect=OSError('synthetic pipe failure')):
            with self.assertRaises(OSError):
                await open_diagnostic_pipe()
        for fd in descriptors:
            with self.assertRaises(OSError):os.fstat(fd)

    async def test_cancelled_pipe_setup_waits_for_transport_and_closes_it(self):
        loop = asyncio.get_running_loop()
        original = loop.connect_read_pipe
        entered, release = asyncio.Event(), asyncio.Event()
        descriptors = os.pipe()
        async def delayed(*args):
            entered.set()
            await release.wait()
            return await original(*args)
        with patch('pets_image_ssh_proxy.os.pipe', return_value=descriptors), \
                patch.object(loop, 'connect_read_pipe', side_effect=delayed):
            opening = asyncio.create_task(open_diagnostic_pipe())
            await asyncio.wait_for(entered.wait(), 2)
            opening.cancel(); release.set()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(opening, 2)
            await asyncio.sleep(0)
        for fd in descriptors:
            with self.assertRaises(OSError):os.fstat(fd)

    async def test_failed_ssh_spawn_closes_diagnostic_pipe_and_releases_slot(self):
        descriptors = []
        async def record_pipe():
            result = await open_diagnostic_pipe()
            descriptors.extend([result[1].get_extra_info('pipe').fileno(), result[2]])
            return result
        logs = []
        proxy = Proxy(Settings(ssh_command=['/nonexistent-test-ssh'], listen_host='127.0.0.1', listen_port=0,
                               phase_diagnostics=True, max_handshakes=1), logs.append)
        await proxy.start()
        reader, writer = await asyncio.open_connection('127.0.0.1', proxy.port)
        try:
            with patch('pets_image_ssh_proxy.open_diagnostic_pipe', side_effect=record_pipe):
                writer.write(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n'); await writer.drain()
                self.assertEqual(await asyncio.wait_for(reader.read(), 2), b'')
            await asyncio.sleep(0)
            self.assertFalse(proxy.handshakes.locked())
            self.assertEqual(logs[-1]['outcome'], 'connection_error')
            self.assertEqual(logs[-1]['lastPhase'], 'unknown')
            self.assertIsNone(logs[-1]['pid'])
            self.assertEqual(len(descriptors), 2)
            for fd in descriptors:
                with self.assertRaises(OSError):os.fstat(fd)
        finally:
            await proxy.close(); writer.close(); await writer.wait_closed()

    async def retained_stderr(self, shutdown):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); fake = root / 'ssh'; pidfile = root / 'descendant'; counter = root / 'started'
            fake.write_text('#!' + sys.executable + '\n' + f'''
import os,signal,sys,time
from pathlib import Path
counter=Path({str(counter)!r})
if counter.exists():
 os.write(1,b'ready');sys.stdin.buffer.read();sys.exit(0)
counter.touch()
child=os.fork()
if child==0:
 os.close(0);os.close(1);signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30);os._exit(0)
with open({str(pidfile)!r},'w') as output:output.write(str(child))
signal.signal(signal.SIGTERM,signal.SIG_IGN)
os.write(2,b'debug1: Connection established.\\n')
time.sleep(30)
''')
            fake.chmod(0o700); logs = []
            proxy = Proxy(Settings(ssh_command=[str(fake)], listen_host='127.0.0.1', listen_port=0,
                                   phase_diagnostics=True, max_handshakes=1, handshake_timeout=15 if shutdown else 3), logs.append)
            await proxy.start(); descendant = None; pending = None
            reader, writer = await asyncio.open_connection('127.0.0.1', proxy.port)
            try:
                writer.write(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n'); await writer.drain()
                await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 2)
                for _ in range(300):
                    if pidfile.exists():break
                    await asyncio.sleep(.01)
                descendant = int(pidfile.read_text())
                pending = asyncio.create_task(proxy.close() if shutdown else reader.read())
                # A separate watchdog is not evidence of product cleanup. Assert before killing the fixture descendant.
                await asyncio.wait_for(asyncio.shield(pending), 5 if shutdown else 8)
                self.assertFalse(proxy.handshakes.locked())
                closed = [row for row in logs if row['event']=='connection_closed']
                self.assertEqual(len(closed), 1)
                self.assertEqual(closed[0]['outcome'], 'shutdown' if shutdown else 'timeout')
                self.assertEqual(closed[0]['sshExitCode'], -signal.SIGKILL)
                with self.assertRaises(ProcessLookupError):os.kill(closed[0]['pid'], 0)
                os.kill(descendant, 0)  # Cleanup must not depend on inherited stderr reaching EOF.
                self.assertEqual(sum(row['event']=='ssh_started' for row in logs), 1)
                if not shutdown:
                    next_reader, next_writer = await asyncio.open_connection('127.0.0.1', proxy.port)
                    try:
                        next_writer.write(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n'); await next_writer.drain()
                        await asyncio.wait_for(next_reader.readuntil(b'\r\n\r\n'), 2)
                        self.assertEqual(await asyncio.wait_for(next_reader.readexactly(5), 2), b'ready')
                        self.assertEqual(sum(row['event']=='ssh_started' for row in logs), 2)
                    finally:
                        next_writer.close(); await next_writer.wait_closed()
            finally:
                if descendant:
                    try:os.kill(descendant, signal.SIGKILL)
                    except ProcessLookupError:pass
                if pending:await asyncio.wait_for(pending, 3)
                await proxy.close(); writer.close(); await writer.wait_closed()

    async def test_shutdown_reaps_ssh_without_waiting_for_inherited_stderr(self):
        await self.retained_stderr(shutdown=True)

    async def test_timeout_releases_slot_before_inherited_stderr_reaches_eof(self):
        await self.retained_stderr(shutdown=False)

    async def test_phase_events_are_bounded_and_contain_only_safe_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'ssh'
            script.write_text('#!' + sys.executable + '\n' + r'''
import os,sys,time
assert sys.argv[1]=='-oLogLevel=DEBUG2'
for line in [b'debug1: Connection established.',b'debug1: Remote protocol version 2.0, remote software version private-banner',b'Authenticated to private-host using private-key.',b'debug2: channel 0: open confirm rwindow 0 rmax 0']:
 for part in [line[:7],line[7:]+b'\n']:
  os.write(2,part);time.sleep(.01)
os.write(2,b'private-secret\n'+b'x'*200000+b'Authenticated to private-host\n')
os.write(2,b'Authenticated to duplicate-private-host\n')
os.write(1,b'ready')
while os.read(0,4096):pass
''')
            script.chmod(0o700)
            logs = []
            proxy = Proxy(Settings(ssh_command=[str(script)], listen_host='127.0.0.1', listen_port=0, phase_diagnostics=True), logs.append)
            await proxy.start()
            reader, writer = await asyncio.open_connection('127.0.0.1', proxy.port)
            try:
                writer.write(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n'); await writer.drain()
                await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 2)
                self.assertEqual(await asyncio.wait_for(reader.readexactly(5), 3), b'ready')
            finally:
                writer.close(); await writer.wait_closed(); await proxy.close()
            phases = [row for row in logs if row['event']=='ssh_phase']
            self.assertEqual([row['phase'] for row in phases], ['tcp_connected','ssh_banner','ssh_authenticated','upstream_connected','first_inbound_bytes'])
            self.assertEqual(len({row['runId'] for row in logs}), 1)
            self.assertTrue(all(row['connection']==1 and row['pid']>0 for row in phases))
            times = [row['elapsedMs'] for row in phases]
            self.assertEqual(times, sorted(times))
            self.assertNotIn('private-', json.dumps(logs))
            self.assertNotIn('xxx', json.dumps(logs))
            self.assertEqual(logs[-1]['lastPhase'], 'first_inbound_bytes')
            self.assertLess(len(json.dumps(logs)), 2500)

    async def test_timeout_keeps_only_last_observed_phase_and_reaps_process(self):
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'ssh'
            script.write_text('#!' + sys.executable + '\nimport os,time\nos.write(2,b"debug1: Connection established.\\n")\ntime.sleep(30)\n')
            script.chmod(0o700); logs=[]
            proxy=Proxy(Settings(ssh_command=[str(script)],listen_host='127.0.0.1',listen_port=0,phase_diagnostics=True,handshake_timeout=1),logs.append)
            await proxy.start()
            reader,writer=await asyncio.open_connection('127.0.0.1',proxy.port)
            try:
                writer.write(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n');await writer.drain()
                await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'),2)
                self.assertEqual(await asyncio.wait_for(reader.read(),3),b'')
            finally:
                writer.close();await writer.wait_closed();await proxy.close()
            self.assertEqual(logs[-1]['outcome'],'timeout')
            self.assertEqual(logs[-1]['lastPhase'],'tcp_connected')
            import os
            with self.assertRaises(ProcessLookupError):os.kill(logs[-1]['pid'],0)

    def test_parser_discards_long_unknown_partial_and_duplicate_lines(self):
        phases=[];diagnostics=SshDiagnostics(phases.append)
        for _ in range(100):diagnostics.feed(b'x'*4096)
        self.assertLessEqual(len(diagnostics.buffer),diagnostics.MAX_LINE)
        diagnostics.feed(b'Authenticated to hidden\n')
        diagnostics.feed(b'unknown debug message\n\xff\xfe\n')
        self.assertEqual(phases,[])
        diagnostics.feed(b'debug1: Connection estab')
        self.assertEqual(phases,[])
        diagnostics.feed(b'lished.\r\nAuthenticated to hidden\nAuthenticated to duplicate\n')
        self.assertEqual(phases,['tcp_connected','ssh_authenticated'])
        self.assertEqual(diagnostics.last_phase,'ssh_authenticated')
        diagnostics.feed(b'debug1: Remote protocol version delayed\n')
        self.assertEqual(diagnostics.last_phase,'ssh_authenticated')

    def test_setting_is_opt_in_and_strictly_boolean(self):
        with tempfile.TemporaryDirectory() as folder:
            command=['/usr/bin/ssh','-W','api.openai.com:443','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ControlMaster=no','-o','ControlPath=none','restricted@example.invalid']
            path=Path(folder)/'config.json'
            path.write_text(json.dumps({'ssh_command':command}))
            self.assertFalse(load_settings(path).phase_diagnostics)
            for value in [None,0,1,'true',[]]:
                path.write_text(json.dumps({'ssh_command':command,'phase_diagnostics':value}))
                with self.assertRaises(ValueError):load_settings(path)
            path.write_text(json.dumps({'ssh_command':command,'phase_diagnostics':True}))
            self.assertTrue(load_settings(path).phase_diagnostics)

    def test_sigterm_closes_active_tunnel_and_reaps_stderr_writer(self):
        with tempfile.TemporaryDirectory() as folder:
            fake = Path(folder) / 'ssh'
            fake.write_text('#!' + sys.executable + '\nimport os,signal,time\n'
                            'signal.signal(signal.SIGTERM,signal.SIG_IGN)\n'
                            'os.write(2,b"debug1: Connection established.\\n")\n'
                            'while True:\n os.write(2,b"private-noise"*500);time.sleep(.01)\n')
            fake.chmod(0o700)
            harness = ('import asyncio,sys\n'
                       f'sys.path.insert(0,{str(Path(__file__).parent)!r})\n'
                       'import pets_image_ssh_proxy as proxy\n'
                       f'proxy.load_settings=lambda _:proxy.Settings(ssh_command=[{str(fake)!r}],listen_host="127.0.0.1",listen_port=0,phase_diagnostics=True)\n'
                       'asyncio.run(proxy.main("test-only"))\n')
            process = subprocess.Popen([sys.executable, '-c', harness], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            child = None
            try:
                ready = json.loads(process.stdout.readline())
                self.assertEqual(ready['event'], 'ready')
                with socket.create_connection(('127.0.0.1', ready['port']), timeout=3) as client:
                    client.sendall(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n')
                    self.assertIn(b'200', client.recv(4096))
                    started = json.loads(process.stdout.readline()); child = started['pid']
                    process.terminate()
                    out, err = process.communicate(timeout=5)
                    self.assertEqual(process.returncode, 0)
                    self.assertEqual(client.recv(4096), b'')
                self.assertIn('"outcome": "shutdown"', out)
                self.assertNotIn('private-noise', out + err)
                with self.assertRaises(ProcessLookupError):os.kill(child, 0)
            finally:
                if process.poll() is None:
                    process.kill();process.communicate()
                if child:
                    try:os.kill(child, 9)
                    except ProcessLookupError:pass


class DiagnosticsLifecycleTests(proxy_tests.ProxyTests):
    async def start(self, mode='echo', **kwargs):
        wrapper = self.root / 'diagnostic-ssh'
        wrapper.write_text('#!' + sys.executable + '\nimport sys\n'
                           'assert sys.argv.pop(1)=="-oLogLevel=DEBUG2"\n' + proxy_tests.FAKE)
        wrapper.chmod(0o700)
        # Leave room for native interpreter startup when the full suite is busy.
        if 'handshake_timeout' in kwargs:
            kwargs['handshake_timeout'] = max(.4, kwargs['handshake_timeout'])
        if 'connection_timeout' in kwargs:
            kwargs['connection_timeout'] = max(.6, kwargs['connection_timeout'])
        config = Settings(ssh_command=[str(wrapper), str(self.root), mode],
                          listen_host='127.0.0.1', listen_port=0, phase_diagnostics=True, **kwargs)
        proxy = Proxy(config, self.logs.append)
        await proxy.start(); self.proxies.append(proxy)
        return proxy


if __name__=='__main__':unittest.main()
