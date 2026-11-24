import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { privateListenAddress } from '../src/listen-address.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function availablePort() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return String(port);
}

async function start(t, dir, port, ...args) {
  const { stdout } = await exec(process.execPath, ['scripts/ferry.mjs', ...args], {
    env: { ...process.env, XDG_DATA_HOME: dir }, timeout: 10000,
  });
  const pid = Number(stdout.match(/Stop Ferry: kill (\d+)/)[1]);
  const printedAddress = stdout.match(/(?:running at|listening at) (https?:\/\/\S+)/)[1];
  const hostname = new URL(printedAddress).hostname.replace(/^\[|\]$/g, '');
  t.after(async () => {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 100; i++) {
      const listening = await new Promise(resolve => {
        const socket = connect(Number(port), hostname);
        socket.once('error', () => resolve(false));
        socket.once('connect', () => { socket.destroy(); resolve(true); });
      });
      if (!listening) return;
      await delay(50);
    }
    assert.fail('Ferry did not stop');
  });
  return stdout;
}

for (const mode of ['all', 'split']) {
  test('launcher connects Web to the host on custom ports: ' + mode, async t => {
    const tmp = await mkdtemp(join(tmpdir(), 'ferry-launch-'));
    try {
      const hostPort = await availablePort();
      let webPort = await availablePort();
      while (webPort === hostPort) webPort = await availablePort();
      const webDir = join(tmp, 'web-machine');
      let url = 'http://127.0.0.1:' + webPort;
      let hostUrl;
      let invitation;
      if (mode === 'all') {
        await start(t, webDir, webPort, 'all', '--host-port', hostPort, '--web-port', webPort);
      } else {
        const host = await start(t, join(tmp, 'agent-machine'), hostPort, 'host', '--port', hostPort);
        invitation = host.match(/Pairing code: (\d{8})/)[1];
        hostUrl = host.match(/listening at (\S+)/)[1];
        const web = await start(t, webDir, webPort, 'web', '--port', webPort);
        url = web.match(/running at (\S+)/)[1];
      }

      const code = (await readFile(join(webDir, 'ferry/local/access-code'), 'utf8')).trim();
      const headers = { origin: url, 'content-type': 'application/json' };
      const login = await fetch(url + '/api/login', { method: 'POST', headers, body: JSON.stringify({ code }) });
      assert.equal(login.status, 200);
      headers.cookie = login.headers.get('set-cookie').split(';')[0];
      async function machines() {
        const response = await fetch(url + '/api/machines', { headers });
        assert.equal(response.status, 200);
        return (await response.json()).machines;
      }
      if (mode === 'split') {
        assert.deepEqual(await machines(), []);
        const pair = await fetch(url + '/api/machines/pair', {
          method: 'POST', headers, body: JSON.stringify({ address: hostUrl, code: invitation }),
        });
        assert.equal(pair.status, 201);
      }
      const hosts = await machines();
      assert.equal(hosts.length, 1);
      assert.equal(hosts[0].online, true);
    } finally {
      t.after(() => rm(tmp, { recursive: true, force: true }));
    }
  });
}

test('automatic bind chooses private addresses and falls back to loopback', () => {
  const entry = (address, family = 'IPv4') => ({ address, family, internal: false });
  const interfaces = {
    lo: [{ ...entry('127.0.0.1'), internal: true }], docker0: [entry('172.17.0.1')],
    eth0: [entry('203.0.113.10'), entry('fe80::2', 'IPv6')],
  };
  assert.equal(privateListenAddress(interfaces), '127.0.0.1');
  interfaces.wg = [entry('fd00::1', 'IPv6')];
  assert.equal(privateListenAddress(interfaces), 'fd00::1');
  interfaces.mesh = [entry('100.64.0.1')];
  assert.equal(privateListenAddress(interfaces), '100.64.0.1');
  interfaces.wifi = [entry('192.168.1.20')];
  assert.equal(privateListenAddress(interfaces), '192.168.1.20');
});
