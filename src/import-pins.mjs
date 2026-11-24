import { randomUUID } from 'node:crypto';
import { access, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { one, openDatabase } from './db.mjs';

// The deploying agent translates the installed client's pin metadata into this local format.
export async function importPin(path, pin) {
  if (pin?.pinned !== true || !['codex', 'claude', 'agy'].includes(pin.agent)
    || typeof pin.nativeId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(pin.nativeId)
    || typeof pin.cwd !== 'string' || !isAbsolute(pin.cwd) || typeof pin.title !== 'string' || !pin.title.trim()) {
    throw Error('Expected a pinned native session with agent, nativeId, cwd and title.');
  }
  const messages = pin.messages ?? [];
  if (!Array.isArray(messages) || messages.some(m => !m || !['user', 'agent'].includes(m.role) || typeof m.text !== 'string')) {
    throw Error('Expected messages in order with role user or agent and visible text.');
  }
  const directory = await realpath(pin.cwd);
  if (!(await stat(directory)).isDirectory()) throw Error('The session working directory is unavailable.');
  await access(path); // Import only after this host has initialized its database.
  const db = openDatabase(path);
  try {
    return await db.transaction(async client => {
      const existing = await one(client, 'SELECT id,archived FROM sessions WHERE agent=$1 AND native_id=$2 AND codex_imported=0',
        [pin.agent, pin.nativeId]);
      if (existing) {
        if (existing.archived) return 'Skipped archived Ferry session.';
        await client.query('UPDATE sessions SET pinned=1 WHERE id=$1', [existing.id]);
        return 'Pinned existing Ferry session.';
      }
      await client.query('INSERT INTO projects(id,directory,name) VALUES ($1,$2,$3) ON CONFLICT(directory) DO NOTHING',
        [randomUUID(), directory, basename(directory) || directory]);
      const project = await one(client, 'SELECT id,archived FROM projects WHERE directory=$1', [directory]);
      if (project.archived) return 'Skipped archived Ferry project.';
      const id = randomUUID();
      await client.query(`INSERT INTO sessions(id,project,agent,native_id,title,state,updated,pinned,custom_title)
        VALUES ($1,$2,$3,$4,$5,'idle',$6,1,1)`, [id, project.id, pin.agent, pin.nativeId, pin.title.trim(), Date.now()]);
      for (const message of messages) {
        await client.query('INSERT INTO messages(session,id,role,text) VALUES ($1,$2,$3,$4)',
          [id, randomUUID(), message.role, message.text]);
      }
      return 'Imported pinned session.';
    });
  } finally {
    await db.end();
  }
}
