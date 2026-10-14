import asyncio
import os
from pathlib import Path
import sys
import tempfile
import unittest

from pets_image_ssh_proxy import Proxy, Settings, load_settings

FAKE = r'''
import fcntl,json,os,sys,time
from pathlib import Path
root=Path(sys.argv[1]);mode=sys.argv[2]
def event(kind):
 with (root/'events').open('a') as f:
  fcntl.flock(f,fcntl.LOCK_EX);f.write(json.dumps({'event':kind,'pid':os.getpid()})+'\n');f.flush()
event('start')
if mode=='exit':sys.exit(7)
if mode=='stubborn':
 import signal
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 time.sleep(10);sys.exit(0)
if mode=='hang':time.sleep(10);sys.exit(0)
time.sleep(.08)
event('ready')
if mode=='eof':
 body=sys.stdin.buffer.read();sys.stdout.buffer.write(b'ACK:'+body);sys.stdout.buffer.flush()
else:
 print(os.getpid(),flush=True)
 while True:
  b=os.read(0,65536)
  if not b:break
  os.write(1,b)
'''

class ProxyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.fake=self.root/'fake.py';self.fake.write_text(FAKE)
        self.logs=[];self.proxies=[]
    async def asyncTearDown(self):
        for p in self.proxies:await asyncio.wait_for(p.close(),3)
        for pid in self.pids():
            with self.assertRaises(ProcessLookupError):os.kill(pid,0)
        self.tmp.cleanup()
    def events(self):
        import json
        p=self.root/'events'
        return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []
    def pids(self):return {e['pid'] for e in self.events()}
    async def start(self,mode='echo',**kwargs):
        config=Settings(ssh_command=[sys.executable,str(self.fake),str(self.root),mode],listen_host='127.0.0.1',listen_port=0,**kwargs)
        p=Proxy(config,self.logs.append);await p.start();self.proxies.append(p);return p
    async def connect(self,p,request=b'CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n'):
        r,w=await asyncio.open_connection('127.0.0.1',p.port);w.write(request);await w.drain()
        header=await asyncio.wait_for(r.readuntil(b'\r\n\r\n'),2);return r,w,header
    async def exchange(self,p,payload=b'opaque TLS bytes'):
        r,w,h=await self.connect(p);self.assertIn(b'200',h)
        pid=int(await r.readline());w.write(payload);await w.drain()
        self.assertEqual(await r.readexactly(len(payload)),payload)
        w.close();await w.wait_closed();return pid
    async def test_each_connection_has_its_own_child_and_child_is_reaped(self):
        p=await self.start();ids=await asyncio.gather(*(self.exchange(p) for _ in range(4)))
        self.assertEqual(len(set(ids)),4);await p.close();self.assertEqual(len(self.pids()),4)
    async def test_only_fixed_connect_destination_is_accepted_before_spawn(self):
        p=await self.start()
        for request in [b'CONNECT example.com:443 HTTP/1.1\r\n\r\n',b'CONNECT api.openai.com:80 HTTP/1.1\r\n\r\n',b'GET http://api.openai.com/ HTTP/1.1\r\n\r\n']:
            r,w,h=await self.connect(p,request);self.assertIn(b'403',h);w.close();await w.wait_closed()
        self.assertFalse(self.pids())
    async def test_large_header_is_rejected_without_child(self):
        p=await self.start();r,w,h=await self.connect(p,b'CONNECT api.openai.com:443 HTTP/1.1\r\nX: '+b'x'*5000+b'\r\n\r\n')
        self.assertIn(b'431',h);w.close();await w.wait_closed();self.assertFalse(self.pids())
    async def test_handshake_slots_bound_actual_child_startup(self):
        p=await self.start(max_handshakes=2);await asyncio.gather(*(self.exchange(p) for _ in range(6)));await p.close()
        active=peak=0
        for e in self.events():
            active+=1 if e['event']=='start' else -1;peak=max(peak,active)
        self.assertLessEqual(peak,2);self.assertEqual(len(self.pids()),6)
    async def test_failed_child_is_not_retried_and_slot_is_released(self):
        p=await self.start(mode='exit',max_handshakes=1)
        for _ in range(2):
            r,w,h=await self.connect(p);self.assertIn(b'200',h);self.assertEqual(await asyncio.wait_for(r.read(),2),b'');w.close();await w.wait_closed()
        await p.close();self.assertEqual(len(self.pids()),2)
    async def test_handshake_timeout_reaps_child_without_replay(self):
        p=await self.start(mode='hang',handshake_timeout=.1)
        r,w,h=await self.connect(p);self.assertIn(b'200',h);self.assertEqual(await asyncio.wait_for(r.read(),2),b'');w.close();await w.wait_closed();await p.close()
        self.assertEqual(len(self.pids()),1)
    async def test_failed_handshake_keeps_slot_until_child_exits(self):
        p=await self.start(mode='stubborn',max_handshakes=1,handshake_timeout=.1)
        live=[];peaks=[]
        def log(event):
            self.logs.append(event)
            if event['event']=='ssh_started':
                live.append(event['pid']);count=0
                for pid in live:
                    try:os.kill(pid,0);count+=1
                    except ProcessLookupError:pass
                peaks.append(count)
        p.log=log
        async def call(required):
            r,w=await asyncio.open_connection('127.0.0.1',p.port)
            try:
                w.write(b'CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n');await w.drain()
                try:header=await asyncio.wait_for(r.readuntil(b'\r\n\r\n'),2)
                except asyncio.IncompleteReadError:
                    self.assertFalse(required);return
                self.assertIn(b'200',header);await asyncio.wait_for(r.read(),6)
            finally:w.close();await w.wait_closed()
        first=asyncio.create_task(call(True));await asyncio.sleep(.25)
        await asyncio.gather(first,call(False));await p.close()
        self.assertEqual(max(peaks),1)
    async def test_client_half_close_delivers_server_reply(self):
        p=await self.start(mode='eof');r,w,h=await self.connect(p);self.assertIn(b'200',h)
        w.write(b'complete upload');await w.drain();w.write_eof()
        self.assertEqual(await asyncio.wait_for(r.read(),2),b'ACK:complete upload');w.close();await w.wait_closed()
    async def test_shutdown_reaps_active_children_and_closes_connections(self):
        p=await self.start();r,w,h=await self.connect(p);self.assertIn(b'200',h);await r.readline();await asyncio.wait_for(p.close(),3)
        self.assertEqual(await asyncio.wait_for(r.read(),2),b'');w.close();await w.wait_closed()
    async def test_shutdown_during_failed_handshake_still_reaps_child(self):
        p=await self.start(mode='stubborn',handshake_timeout=.1)
        r,w,h=await self.connect(p);self.assertIn(b'200',h)
        await asyncio.sleep(.25);await asyncio.wait_for(p.close(),3)
        self.assertEqual(await asyncio.wait_for(r.read(),1),b'')
        w.close();await w.wait_closed()
    async def test_connection_cap_rejects_excess_without_spawn(self):
        p=await self.start(max_connections=1);r,w,h=await self.connect(p);self.assertIn(b'200',h);await r.readline()
        r2,w2,h2=await self.connect(p);self.assertIn(b'503',h2);w2.close();await w2.wait_closed();w.close();await w.wait_closed();await p.close();self.assertEqual(len(self.pids()),1)
    async def test_large_bidirectional_payload_is_not_truncated(self):
        p=await self.start();r,w,h=await self.connect(p);self.assertIn(b'200',h);await r.readline()
        payload=bytes(range(256))*8192
        received=asyncio.create_task(r.readexactly(len(payload)))
        w.write(payload);await w.drain()
        self.assertEqual(await asyncio.wait_for(received,3),payload)
        w.close();await w.wait_closed()
    async def test_connection_deadline_closes_idle_child_after_handshake(self):
        p=await self.start(connection_timeout=.2);r,w,h=await self.connect(p);self.assertIn(b'200',h);await r.readline()
        self.assertEqual(await asyncio.wait_for(r.read(),2),b'');w.close();await w.wait_closed();await p.close()
        self.assertEqual(self.logs[-1]['outcome'],'timeout')
    def test_config_refuses_public_listener_and_shared_ssh_master(self):
        import json
        command=['/usr/bin/ssh','-W','api.openai.com:443','-o','StrictHostKeyChecking=yes','-o','BatchMode=yes','-o','ControlMaster=no','-o','ControlPath=none','restricted@example.invalid']
        path=self.root/'config.json';path.write_text(json.dumps({'ssh_command':command}))
        self.assertEqual(load_settings(path).listen_port,18090)
        for changes in [{'listen_host':'0.0.0.0'},{'max_connections':0},{'max_connections':True},{'max_handshakes':100},{'ssh_command':command+['-L','127.0.0.1:2000:example.invalid:22']},{'ssh_command':[s for s in command if s!='ControlMaster=no']}]:
            path.write_text(json.dumps({'ssh_command':command,**changes}))
            with self.assertRaises(ValueError):load_settings(path)
    async def test_private_bytes_never_enter_structured_logs(self):
        p=await self.start();await self.exchange(p,b'private-token-and-prompt');await p.close()
        self.assertNotIn('private-token',str(self.logs));self.assertTrue(self.logs)

if __name__=='__main__':unittest.main()
