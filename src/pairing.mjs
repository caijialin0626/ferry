import { createHash, randomBytes, randomInt } from 'node:crypto';
import { link, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HttpError, body } from './common.mjs';

export const hostData = process.env.FERRY_HOST_DATA || join(homedir(), '.local', 'share', 'ferry', 'host');
export const pairingCode = /^[0-9]{8}$/;
export const pairingId = /^pair-[a-f0-9]{24}$/;
export const pairingToken = /^[A-Za-z0-9_-]{43}$/;
export const pairingLifetime = 10 * 60_000;

export async function writeOnce(path, contents) {
  const temporary = join(dirname(path), '.' + randomBytes(16).toString('hex'));
  await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
}

const digest = token => createHash('sha256').update(token).digest('hex');
const invalidCode = () => new HttpError(403, 'The code is wrong, already used, or expired.');
const invitations = data => join(data, 'pairing', 'invitations');

export async function issuePairingCode(data) {
  const directory = invitations(data);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of await readdir(directory)) {
    if (!pairingCode.test(name)) continue;
    const path = join(directory, name);
    try {
      if ((await stat(path)).mtimeMs + pairingLifetime <= Date.now()) await unlink(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  while (true) {
    const code = String(randomInt(100_000_000)).padStart(8, '0');
    try {
      await writeFile(join(directory, code), '', { flag: 'wx', mode: 0o600 });
      return code;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

export async function openPairing(data) {
  const credentials = join(data, 'pairing', 'credentials');
  await mkdir(credentials, { recursive: true, mode: 0o700 });
  const tokens = new Set((await readdir(credentials)).filter(name => /^[a-f0-9]{64}$/.test(name)));
  const identity = join(data, 'pairing', 'id');
  let attemptCount = 0;
  let attemptWindow = 0;

  return {
    authorized(header) {
      const token = header?.startsWith('Bearer ') && header.slice(7);
      return Boolean(token && pairingToken.test(token) && tokens.has(digest(token)));
    },
    async redeem(req) {
      const { code } = await body(req, 1024);
      const now = Date.now();
      if (now >= attemptWindow) {
        attemptWindow = now + 60_000;
        attemptCount = 0;
      }
      if (++attemptCount > 8) throw new HttpError(429, 'Too many attempts. Try again later.');
      if (typeof code !== 'string' || !pairingCode.test(code)) throw invalidCode();
      const invitation = join(invitations(data), code);
      try {
        if ((await stat(invitation)).mtimeMs + pairingLifetime <= now) throw invalidCode();
        await unlink(invitation);
      } catch (error) {
        if (error.code === 'ENOENT') throw invalidCode();
        throw error;
      }
      let id;
      try {
        id = await readFile(identity, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try {
          await writeOnce(identity, 'pair-' + randomBytes(12).toString('hex'));
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        id = await readFile(identity, 'utf8');
      }
      const token = randomBytes(32).toString('base64url');
      const hash = digest(token);
      await writeFile(join(credentials, hash), '', { flag: 'wx', mode: 0o600 });
      tokens.add(hash);
      return { id, token };
    },
  };
}
