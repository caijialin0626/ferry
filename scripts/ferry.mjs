#!/usr/bin/env node
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeOnce } from '../src/pairing.mjs';

const state = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'ferry', 'local');
const log = join(state, 'startup.log');
const codeFile = join(state, 'access-code');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 20)) {
  console.error('Ferry requires Node.js 22.20 or later.');
  process.exit(1);
}

async function credential(file) {
  try {
    await writeOnce(file, randomBytes(32).toString('base64url') + '\n');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return (await readFile(file, 'utf8')).trim();
}

async function supervise() {
  const children = new Set();
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill('SIGTERM');
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

  // The quick start always binds to loopback. Custom network setups use
  // the standalone host and web commands and their own environment files.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FERRY_')));
  const hostToken = await credential(join(state, 'local-host-token'));
  const accessCode = await credential(codeFile);
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
    // Claim the web port first so repeating the command never starts a second local host.
    await start('web', { FERRY_WEB_DATA: join(state, 'web'), FERRY_HOST_TOKEN: hostToken, FERRY_WEB_LOGIN_TOKEN: accessCode });
    await start('host', { FERRY_HOST_DATA: join(state, 'host'), FERRY_HOST_TOKEN: hostToken });
    if (process.send) process.send('ready', () => process.disconnect());
    else console.log('Browser access code is in ' + codeFile);
  } catch (error) {
    stop(1);
    throw error;
  }
}

async function launch() {
  const output = await open(log, 'a', 0o600);
  let child;
  try {
    child = fork(fileURLToPath(import.meta.url), ['--foreground'], {
      detached: true, stdio: ['ignore', output.fd, output.fd, 'ipc'],
    });
  } finally {
    await output.close();
  }
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(Error('Ferry could not start. See ' + log)));
    child.once('message', resolve);
  });
  child.unref();
  console.log('Ferry is running at http://127.0.0.1:8787');
  console.log('Access code file: ' + codeFile);
  console.log('Stop Ferry: kill ' + child.pid);
}

try {
  await mkdir(state, { recursive: true, mode: 0o700 });
  if (process.argv.length === 2) await launch();
  else if (process.argv.length === 3 && process.argv[2] === '--foreground') await supervise();
  else throw Error('Usage: ferry [--foreground]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
