#!/usr/bin/env node
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { issuePairingCode, pairingLifetime, writeOnce } from '../src/pairing.mjs';

const state = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'ferry', 'local');
const log = join(state, 'startup.log');
const codeFile = join(state, 'access-code');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 20)) {
  console.error('Ferry requires Node.js 22.20 or later.');
  process.exit(1);
}

const usage = `Usage:
  ferry [all] [--web-port 8787] [--host-port 8788]
  ferry web [--port 8787]
  ferry host [--port 8788]
  ferry pair

--bind IP       Listen address (default 127.0.0.1). In all mode this sets the Web address.
--origin URL    Browser-facing Web origin, for example https://ferry.example.com.
--foreground    Keep services attached to this terminal.`;

function options() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string' }, 'web-port': { type: 'string' }, 'host-port': { type: 'string' },
      bind: { type: 'string' }, origin: { type: 'string' }, foreground: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) { console.log(usage); process.exit(0); }
  const mode = positionals[0] ?? 'all';
  if (positionals.length > 1 || !['all', 'web', 'host', 'pair'].includes(mode)) throw Error(usage);
  const allowed = {
    all: ['web-port', 'host-port', 'bind', 'origin', 'foreground'],
    web: ['port', 'bind', 'origin', 'foreground'], host: ['port', 'bind', 'foreground'], pair: [],
  };
  for (const key of Object.keys(values)) {
    if (!allowed[mode].includes(key)) throw Error('Unsupported option for ' + mode + ': --' + key + '\n' + usage);
  }
  function port(key, fallback) {
    const value = values[key] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
      throw Error('--' + key + ' must be an integer from 1 to 65535.');
    }
    return String(Number(value));
  }
  const webPort = port(mode === 'web' ? 'port' : 'web-port', 8787);
  const hostPort = port(mode === 'host' ? 'port' : 'host-port', 8788);
  if (mode === 'all' && webPort === hostPort) throw Error('Choose different Web and host ports.');
  const bind = values.bind ?? '127.0.0.1';
  if (!isIP(bind)) throw Error('--bind requires an IP address.');
  const address = isIP(bind) === 6 ? '[' + bind + ']' : bind;
  if (mode !== 'host' && ['0.0.0.0', '::'].includes(bind) && !values.origin) {
    throw Error('Set --origin to the URL browsers use when binding to all interfaces.');
  }
  const origin = new URL(values.origin ?? 'http://' + address + ':' + webPort);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) throw Error('--origin requires an HTTP(S) origin.');
  return { mode, bind, webPort, hostPort, hostUrl: 'http://' + address + ':' + hostPort,
    origin: origin.origin, foreground: values.foreground };
}

async function credential(file) {
  try {
    await writeOnce(file, randomBytes(32).toString('base64url') + '\n');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return (await readFile(file, 'utf8')).trim();
}

async function supervise(config) {
  const children = new Set();
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill('SIGTERM');
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FERRY_')));
  async function start(name, settings) {
    if (stopping) throw Error('Startup interrupted.');
    const child = fork(new URL('../src/' + name + '.mjs', import.meta.url), [], {
      env: { ...env, ...settings }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    children.add(child);
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => {
        children.delete(child);
        stop(1);
        reject(Error(name + ' exited during startup.'));
      });
      child.once('message', resolve);
    });
  }

  try {
    const { mode, bind, origin, hostPort, webPort } = config;
    const hostToken = mode === 'web' ? undefined : await credential(join(state, 'local-host-token'));
    if (mode !== 'host') {
      await start('web', {
        FERRY_WEB_DATA: join(state, 'web'), FERRY_WEB_LOGIN_TOKEN: await credential(codeFile),
        FERRY_WEB_BIND: bind, FERRY_WEB_PORT: webPort, FERRY_WEB_ORIGIN: origin,
        ...(mode === 'all' && { FERRY_HOST_TOKEN: hostToken, FERRY_HOST_URL: 'http://127.0.0.1:' + hostPort }),
      });
    }
    if (mode !== 'web') {
      await start('host', {
        FERRY_HOST_DATA: join(state, 'host'), FERRY_HOST_TOKEN: hostToken,
        FERRY_HOST_BIND: mode === 'all' ? '127.0.0.1' : bind, FERRY_HOST_PORT: hostPort,
      });
    }
    const pairingCode = mode === 'host' ? await issuePairingCode(join(state, 'host')) : undefined;
    if (process.send) process.send({ pairingCode }, () => process.disconnect());
    else printConnection(config, pairingCode);
  } catch (error) {
    stop(1);
    throw error;
  }
}

function printConnection(config, pairingCode) {
  if (config.mode === 'host') {
    console.log('Execution host listening at ' + config.hostUrl);
    console.log('Pairing code: ' + pairingCode + ' (single use, ' + pairingLifetime / 60000 + ' minutes)');
  } else {
    console.log('Ferry is running at ' + config.origin);
    console.log('Access code file: ' + codeFile);
  }
}

async function launch(config) {
  const output = await open(log, 'a', 0o600);
  let child;
  try {
    child = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), '--foreground'], {
      detached: true, stdio: ['ignore', output.fd, output.fd, 'ipc'],
    });
  } finally {
    await output.close();
  }
  const ready = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(Error('Ferry could not start. See ' + log)));
    child.once('message', resolve);
  });
  child.unref();
  printConnection(config, ready.pairingCode);
  console.log('Stop Ferry: kill ' + child.pid);
}

try {
  const config = options();
  await mkdir(state, { recursive: true, mode: 0o700 });
  if (config.mode === 'pair') console.log('Pairing code: ' + await issuePairingCode(join(state, 'host')));
  else if (config.foreground) await supervise(config);
  else await launch(config);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
