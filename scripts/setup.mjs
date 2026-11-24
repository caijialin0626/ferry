// Creates host.env and web.env for a single machine that runs both services.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const secret = () => randomBytes(32).toString('base64url');
const hostToken = secret();
const accessCode = secret();

function write(name, lines) {
  const path = root + name;
  if (existsSync(path)) {
    console.log(name + ' already exists, left unchanged.');
    return false;
  }
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Created ' + name);
  return true;
}

const hostCreated = write('host.env', [
  '# Execution host. See docs/deployment.md for configuration.',
  'FERRY_HOST_TOKEN=' + hostToken,
  'FERRY_HOST_BIND=127.0.0.1',
  'FERRY_HOST_PORT=8788',
]);
const webCreated = write('web.env', [
  '# Web service. See docs/deployment.md for configuration.',
  'FERRY_WEB_LOGIN_TOKEN=' + accessCode,
  'FERRY_WEB_BIND=127.0.0.1',
  'FERRY_WEB_PORT=8787',
  '# The execution host on this machine. Remove both lines to use paired machines only.',
  'FERRY_HOST_URL=http://127.0.0.1:8788',
  'FERRY_HOST_TOKEN=' + hostToken,
]);
if (hostCreated !== webCreated) {
  console.log('\nOnly one file was created. Make sure FERRY_HOST_TOKEN matches in host.env and web.env.');
}
if (webCreated) {
  console.log('\nAccess code: ' + accessCode);
  console.log('Start both services with `npm run host` and `npm run web`, then open http://127.0.0.1:8787');
}
