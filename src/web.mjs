import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError, body, failure, json, sameSecret, secret, sendLimit } from './common.mjs';
import { pairingCode, pairingId, pairingToken, writeOnce } from './pairing.mjs';

const bind = process.env.FERRY_WEB_BIND || '127.0.0.1';
const port = Number(process.env.FERRY_WEB_PORT || 8787);
const address = new URL(process.env.FERRY_WEB_ORIGIN || 'http://' + bind + ':' + port);
const origin = address.origin;
const tailnetLogin = process.env.FERRY_TAILSCALE_LOGIN?.trim();
const login = tailnetLogin ? undefined : secret('FERRY_WEB_LOGIN_TOKEN');
if (tailnetLogin && (bind !== '127.0.0.1' || address.protocol !== 'https:')) {
  throw new Error('Tailscale identity mode requires loopback binding and an HTTPS origin.');
}
// The primary execution machine is optional. Without it, the Web service only uses paired machines.
const primaryMachine = 'local';
const hosts = new Map();
if (process.env.FERRY_HOST_TOKEN) {
  hosts.set(primaryMachine, { url: new URL(process.env.FERRY_HOST_URL || 'http://127.0.0.1:8788'),
    token: secret('FERRY_HOST_TOKEN') });
}
for (const entry of JSON.parse(process.env.FERRY_EXTRA_HOSTS || '[]')) {
  const url = new URL(entry.url);
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(entry.id) || hosts.has(entry.id)
    || !['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || typeof entry.token !== 'string' || entry.token.length < 24) {
    throw new Error('Invalid execution machine configuration.');
  }
  hosts.set(entry.id, { url, token: entry.token });
}
const pairedHosts = join(process.env.FERRY_WEB_DATA || join(homedir(), '.local', 'share', 'ferry', 'web'), 'machines');
await mkdir(pairedHosts, { recursive: true, mode: 0o700 });
for (const filename of await readdir(pairedHosts)) {
  if (!filename.endsWith('.json')) continue;
  const id = filename.slice(0, -5);
  if (!pairingId.test(id) || hosts.has(id)) throw new Error('Conflicting paired execution machine configuration.');
  const { url, token, name } = JSON.parse(await readFile(join(pairedHosts, filename), 'utf8'));
  if (typeof token !== 'string' || !pairingToken.test(token)) throw new Error('Invalid paired execution machine credential.');
  hosts.set(id, { url: pairingAddress(url), token, lastKnownName: name });
}
const pendingPairings = new Set();
const deadline = 8 * 60 * 60;
const attempts = new Map();
const cleanup = setInterval(() => {
  for (const [ip, record] of attempts) if (record.until < Date.now()) attempts.delete(ip);
}, 60_000);
cleanup.unref();
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/select-menu.js', ['select-menu.js', 'text/javascript; charset=utf-8']],
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/notifications.js', ['notifications.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/vendor/markdown-it.min.js', ['vendor/markdown-it.min.js', 'text/javascript; charset=utf-8']],
].map(([path, [name, type]]) => [path, { url: new URL('../public/' + name, import.meta.url), type }]));

function signature(value) {
  return createHmac('sha256', login).update('browser:' + value).digest('base64url');
}
function authorized(req) {
  if (tailnetLogin) {
    return req.socket.remoteAddress === '127.0.0.1' && sameSecret(req.headers['tailscale-user-login'], tailnetLogin);
  }
  const match = /(?:^|; )ra_session=(\d+)\.([\w-]+)(?:;|$)/.exec(req.headers.cookie || '');
  return match && Number(match[1]) > Date.now() && sameSecret(match[2], signature(match[1]));
}
function cookie(value, age) {
  return 'ra_session=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + age +
    (origin.startsWith('https:') ? '; Secure' : '');
}
function pairingAddress(value) {
  let url;
  if (typeof value === 'string' && value.length <= 512 && /^https?:\/\/[^\s/?#\\]+\/?$/i.test(value)) {
    try { url = new URL(value); } catch {}
  }
  if (!url || url.username || url.password || url.pathname !== '/' || /^169\.254\./.test(url.hostname)
    || /^\[(?:fe[89ab]|::ffff:a9fe:)/i.test(url.hostname)) {
    throw new HttpError(400, 'Enter the HTTP or HTTPS address of the machine.');
  }
  return url;
}
async function addMachine(req) {
  const { address, code } = await body(req, 2048);
  const url = pairingAddress(address);
  if (typeof code !== 'string' || !pairingCode.test(code)) throw new HttpError(400, 'Enter the 8-digit code.');
  if ([...hosts.values()].some(host => host.url.origin === url.origin)) {
    throw new HttpError(409, 'This machine is already listed.');
  }
  if (pendingPairings.has(url.origin)) throw new HttpError(409, 'This machine is already pairing.');
  pendingPairings.add(url.origin);
  try {
    let result;
    try {
      const response = await fetch(new URL('/api/pair/redeem', url), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
        redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (response.status === 403 || response.status === 429) {
        await response.body?.cancel();
        if (response.status === 429) throw new HttpError(429, 'Too many attempts. Try again later.');
        throw new HttpError(403, 'The code is wrong, already used, or expired.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(502, 'The machine did not accept pairing. Check that it runs a version that supports pairing.');
      }
      result = await response.json();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Pairing failed. Check the machine address and the network.');
    }
    if (typeof result?.id !== 'string' || !pairingId.test(result.id)
      || typeof result.token !== 'string' || !pairingToken.test(result.token)
      || typeof result.name !== 'string' || !result.name || result.name.length > 255) {
      throw new HttpError(502, 'The machine returned an invalid pairing result.');
    }
    const { id, token, name } = result;
    const duplicate = () => new HttpError(409, 'This machine is already listed.');
    if (hosts.has(id)) throw duplicate();
    try {
      await writeOnce(join(pairedHosts, id + '.json'), JSON.stringify({ url: url.origin, token, name }));
    } catch (error) {
      if (error.code === 'EEXIST') throw duplicate();
      console.error('Could not persist execution machine pairing:', error.code || error.name);
      throw new HttpError(500, 'The pairing was not saved. Generate a new code on the machine.');
    }
    hosts.set(id, { url, token, lastKnownName: name });
    return { id, name };
  } finally {
    pendingPairings.delete(url.origin);
  }
}
async function listMachines(refresh) {
  return Promise.all([...hosts].map(async ([id, machine]) => {
    try {
      const response = await fetch(new URL('/api/machine' + (refresh ? '?refresh=1' : ''), machine.url), {
        headers: { authorization: 'Bearer ' + machine.token }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Execution machine unavailable');
      const info = await response.json();
      if (typeof info.name === 'string' && info.name) machine.lastKnownName = info.name;
      return { id, name: machine.lastKnownName || machine.url.hostname, platform: info.platform, agents: info.agents, quota: info.quota === true, online: true };
    } catch {
      return { id, name: machine.lastKnownName || machine.url.hostname, agents: [], online: false };
    }
  }));
}
const server = createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  const csp = "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: https:; media-src 'self' blob:; frame-src 'self'; form-action 'self'; base-uri 'none'; ";
  res.setHeader('content-security-policy', csp + "frame-ancestors 'none'");
  try {
    if (req.headers.host !== address.host) throw new HttpError(400, 'Use the configured Web address.');
    const url = new URL(req.url, origin);
    if (url.origin !== origin) throw new HttpError(400, 'Invalid request address.');
    const path = url.pathname;
    if (path === '/' && url.searchParams.get('panel') === 'side') {
      res.setHeader('content-security-policy', csp + "frame-ancestors 'self'");
    }
    const file = files.get(path);
    if (req.method === 'GET' && file) {
      res.writeHead(200, { 'content-type': file.type, 'content-length': statSync(file.url).size,
        'cache-control': 'no-cache' });
      await pipeline(createReadStream(file.url), res);
      return;
    }
    if (req.method === 'POST' && req.headers.origin !== origin) throw new HttpError(403, 'Invalid request origin. Refresh the page.');
    if (req.method === 'GET' && path === '/api/auth') {
      return json(res, 200, { signedIn: Boolean(authorized(req)), mode: tailnetLogin ? 'tailnet' : 'code' });
    }
    if (req.method === 'POST' && path === '/api/login') {
      if (tailnetLogin) throw new HttpError(404, 'This workspace uses Tailscale identity.');
      const ip = req.socket.remoteAddress;
      const record = attempts.get(ip);
      if (record?.until > Date.now() && record.count >= 8) throw new HttpError(429, 'Too many attempts. Try again later.');
      const { code } = await body(req);
      if (!sameSecret(code, login)) {
        attempts.set(ip, record?.until > Date.now() ? { ...record, count: record.count + 1 } : { count: 1, until: Date.now() + 60_000 });
        throw new HttpError(401, 'Wrong access code.');
      }
      attempts.delete(ip);
      const until = Date.now() + deadline * 1000;
      res.setHeader('set-cookie', cookie(until + '.' + signature(String(until)), deadline));
      return json(res, 200, { signedIn: true });
    }
    if (req.method === 'POST' && path === '/api/logout') {
      if (tailnetLogin) throw new HttpError(404, 'This workspace uses Tailscale identity.');
      res.setHeader('set-cookie', cookie('', 0));
      return json(res, 200, { signedIn: false });
    }
    if (!path.startsWith('/api/')) throw new HttpError(404, 'Page not found.');
    if (!authorized(req)) throw new HttpError(401, tailnetLogin ? 'Open it with an authorized Tailscale account.' : 'Sign in first.');
    if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'Operation not supported.');
    if (req.method === 'GET' && path === '/api/machines') {
      return json(res, 200, { machines: await listMachines(url.searchParams.get('refresh') === '1') });
    }
    if (path === '/api/machines/pair' && req.method === 'POST') {
      return json(res, 201, await addMachine(req));
    }
    if (path === '/api/pair' || path.startsWith('/api/pair/')) throw new HttpError(404, 'Action not found.');
    const machine = url.searchParams.get('machine') ?? primaryMachine;
    const target = hosts.get(machine);
    if (!target) throw new HttpError(404, 'Machine not found.');
    url.searchParams.delete('machine');

    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    let timer;
    let upstream;
    try {
      const send = /^\/api\/sessions\/[^/]+\/send$/.test(path);
      const input = req.method === 'POST' ? await body(req, send ? sendLimit : undefined) : undefined;
      const payload = input && JSON.stringify(input);
      timer = setTimeout(abort, send && input?.video ? 300000 : 15000);
      upstream = await fetch(new URL(path + url.search, target.url), {
        method: req.method,
        headers: {
          authorization: 'Bearer ' + target.token,
          ...(payload && { 'content-type': 'application/json' }),
          ...(req.headers['last-event-id'] && { 'last-event-id': req.headers['last-event-id'] }),
          ...(req.headers.range && { range: req.headers.range }),
        },
        body: payload, redirect: 'error', signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, (target.lastKnownName || target.url.hostname) + ' is unreachable right now.');
    } finally {
      clearTimeout(timer);
    }
    const type = upstream.headers.get('content-type') || 'application/json';
    const headers = { 'content-type': type, 'cache-control': 'no-store', 'x-accel-buffering': 'no' };
    for (const name of ['content-range', 'accept-ranges', 'content-length']) {
      if (upstream.headers.has(name)) headers[name] = upstream.headers.get(name);
    }
    res.writeHead(upstream.status, headers);
    res.flushHeaders();
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
    else res.end();
  } catch (error) {
    if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' || res.destroyed) return;
    failure(res, error);
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, bind, () => {
  console.log('Web listening on ' + origin);
  process.send?.('ready');
});
