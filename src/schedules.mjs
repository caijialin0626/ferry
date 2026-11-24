import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from './common.mjs';
import { one } from './db.mjs';

export const scheduleTable = `
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id), prompt TEXT NOT NULL,
    every_min INTEGER NOT NULL, next_at BIGINT NOT NULL, until_at BIGINT,
    state TEXT NOT NULL, last_at BIGINT, retry_at BIGINT NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS scheduled_tasks_due ON scheduled_tasks(state,next_at);
  CREATE INDEX IF NOT EXISTS scheduled_tasks_session ON scheduled_tasks(session);
`;

function timestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 8.64e15) throw new HttpError(400, 'Choose a valid time.');
  return value;
}

export async function createSchedule(db, session, input) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt || prompt.length > 31900) throw new HttpError(400, 'Enter the task, up to 31900 characters.');
  const every = input.every ?? 0;
  if (!Number.isInteger(every) || every < 0 || every > 10080) throw new HttpError(400, 'The repeat interval must be 1 to 10080 minutes.');
  const next = timestamp(input.startAt);
  if (next <= Date.now()) throw new HttpError(400, 'The start time must be in the future.');
  const until = input.untilAt == null ? null : timestamp(input.untilAt);
  if (until !== null && (!every || until <= next)) throw new HttpError(400, 'The end time must be after the first run.');
  const id = input.id ?? randomUUID();
  if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) {
    throw new HttpError(400, 'Invalid scheduled task ID.');
  }
  const inserted = await one(db, `INSERT INTO scheduled_tasks(id,session,prompt,every_min,next_at,until_at,state)
    VALUES ($1,$2,$3,$4,$5,$6,'scheduled') ON CONFLICT (id) DO NOTHING RETURNING *`, [id, session, prompt, every, next, until]);
  if (inserted) return inserted;
  const existing = await one(db, 'SELECT * FROM scheduled_tasks WHERE id=$1 AND session=$2', [id, session]);
  if (!existing || existing.prompt !== prompt || existing.every_min !== every || existing.until_at !== until) {
    throw new HttpError(409, 'The same scheduled task cannot submit a different configuration.');
  }
  return existing;
}

export async function setScheduleEnabled(db, session, id, enabled) {
  if (typeof enabled !== 'boolean') throw new HttpError(400, 'Invalid schedule state.');
  const now = Date.now();
  const row = await one(db, `UPDATE scheduled_tasks SET state=$1,retry_at=0,last_error='',
    next_at=CASE WHEN $1='scheduled' AND next_at<$4 THEN $4 ELSE next_at END
    WHERE id=$2 AND session=$3 AND state<>'done' AND (until_at IS NULL OR until_at>$4) RETURNING *`,
  [enabled ? 'scheduled' : 'paused', id, session, now]);
  if (!row) throw new HttpError(404, 'No editable scheduled task found.');
  return row;
}

export function startScheduler(db, dispatch) {
  let running;
  async function tick() {
    const now = Date.now();
    const { rows } = await db.query(`
      SELECT t.*
      FROM scheduled_tasks t JOIN sessions s ON s.id=t.session JOIN projects p ON p.id=s.project
      WHERE t.state='scheduled' AND t.next_at<=$1 AND t.retry_at<=$1
        AND (t.until_at<=$1 OR (s.archived=0 AND p.archived=0 AND s.state NOT IN ('running','stopping')))
      ORDER BY t.next_at LIMIT 24`, [now]);
    for (const task of rows) {
      if (task.until_at && task.until_at <= now) {
        await db.query("UPDATE scheduled_tasks SET state='done' WHERE id=$1 AND state='scheduled' AND next_at=$2",
          [task.id, task.next_at]);
        continue;
      }
      const current = await one(db, 'SELECT state,next_at FROM scheduled_tasks WHERE id=$1', [task.id]);
      if (current?.state !== 'scheduled' || current.next_at !== task.next_at) continue;
      const key = createHash('sha256').update(task.id + ':' + task.next_at).digest('hex').slice(0,32);
      let submitted;
      try { submitted = await dispatch(task.session, key, task.prompt); }
      catch {
        await db.query(`UPDATE scheduled_tasks SET retry_at=$1,last_error=$2 WHERE id=$3 AND state='scheduled' AND next_at=$4`,
          [Date.now() + 30_000, 'Could not start; retrying soon', task.id, task.next_at]);
        continue;
      }
      if (!submitted) continue;
      const nowAfter = Date.now();
      const interval = task.every_min * 60_000;
      const next = interval ? task.next_at + interval * Math.max(1, Math.floor((nowAfter - task.next_at) / interval) + 1) : task.next_at;
      const state = interval && (!task.until_at || next < task.until_at) ? 'scheduled' : 'done';
      await db.query(`UPDATE scheduled_tasks SET state=$1,next_at=$2,last_at=$3,retry_at=0,last_error=''
        WHERE id=$4 AND state='scheduled' AND next_at=$5`, [state, next, nowAfter, task.id, task.next_at]);
    }
  }
  const timer = setInterval(() => {
    running ??= tick().catch(error => console.error('Scheduled tasks:', error.message)).finally(() => { running = undefined; });
  }, 2000).unref();
  return () => { clearInterval(timer); return running; };
}
