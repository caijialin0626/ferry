import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
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
  t.after(async () => {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 100; i++) {
      const listening = await new Promise(resolve => {
        const socket = connect(Number(port), '127.0.0.1');
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
      const url = 'http://127.0.0.1:' + webPort;
      let invitation;
      if (mode === 'all') {
        await start(t, webDir, webPort, 'all', '--host-port', hostPort, '--web-port', webPort);
      } else {
        const host = await start(t, join(tmp, 'agent-machine'), hostPort, 'host', '--bind', '127.0.0.1', '--port', hostPort);
        invitation = host.match(/Pairing code: (\d{8})/)[1];
        await start(t, webDir, webPort, 'web', '--port', webPort, '--origin', url);
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
          method: 'POST', headers, body: JSON.stringify({ address: 'http://127.0.0.1:' + hostPort, code: invitation }),
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
