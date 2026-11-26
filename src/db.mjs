import { DatabaseSync } from 'node:sqlite';
import { scheduleTable } from './schedules.mjs';

export async function one(connection, sql, params = []) {
  return (await connection.query(sql, params)).rows[0];
}

export function withTransaction(db, callback) {
  return db.transaction(callback);
}

export function openDatabase(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT UNIQUE NOT NULL, directory TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      position INTEGER PRIMARY KEY AUTOINCREMENT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), agent TEXT NOT NULL,
      native_id TEXT, title TEXT NOT NULL, state TEXT NOT NULL, updated INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', codex_imported INTEGER NOT NULL DEFAULT 0,
      custom_title INTEGER NOT NULL DEFAULT 0, branch_parent TEXT, branch_kind TEXT
    );
    CREATE TABLE IF NOT EXISTS side_contexts (
      session TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, context TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS commands (
      session TEXT NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, text TEXT NOT NULL,
      request_key TEXT, PRIMARY KEY(session,id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      session TEXT NOT NULL REFERENCES sessions(id), id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
      position INTEGER, reply_offset INTEGER, attachment_session TEXT, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(session,id)
    );
    CREATE INDEX IF NOT EXISTS messages_session_position ON messages(session,position DESC);
    CREATE INDEX IF NOT EXISTS messages_agent_position ON messages(session,position DESC) WHERE role='agent';
    CREATE INDEX IF NOT EXISTS messages_position ON messages(position DESC);
    CREATE TRIGGER IF NOT EXISTS messages_assign_position AFTER INSERT ON messages WHEN NEW.position IS NULL
    BEGIN
      UPDATE messages SET position=(SELECT COALESCE(max(position),0)+1 FROM messages)
      WHERE session=NEW.session AND id=NEW.id;
    END;
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL REFERENCES sessions(id),
      type TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_session_seq ON events(session,seq);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, session TEXT NOT NULL, message TEXT NOT NULL, name TEXT NOT NULL,
      media_type TEXT NOT NULL, content BLOB NOT NULL, position INTEGER NOT NULL,
      FOREIGN KEY(session,message) REFERENCES messages(session,id)
    );
    CREATE INDEX IF NOT EXISTS attachments_message ON attachments(session,message);
    ${scheduleTable}
  `);
  database.exec('BEGIN IMMEDIATE');
  try {
    const columns = [
      ['sessions', 'custom_title', 'INTEGER NOT NULL DEFAULT 0'],
      ['sessions', 'branch_parent', 'TEXT'], ['sessions', 'branch_kind', 'TEXT'],
      ['messages', 'attachment_session', 'TEXT'],
      ['messages', 'created_at', 'INTEGER'], ['messages', 'updated_at', 'INTEGER'],
    ];
    for (const [table, column, type] of columns) {
      if (!database.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table, column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    }
    // Untitled chats used to store a localized placeholder. The browser now supplies it in the reader's language.
    database.exec("UPDATE sessions SET title='' WHERE title='新对话' AND custom_title=0");
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  const prepared = new Map();
  const client = {
    async query(sql, params = []) {
      let plan = prepared.get(sql);
      if (!plan) {
        plan = { statement: database.prepare(sql), names: [...new Set(sql.match(/\$\d+\b/g) || [])] };
        if (prepared.size >= 100) prepared.delete(prepared.keys().next().value);
        prepared.set(sql, plan);
      }
      const bindings = Object.fromEntries(plan.names.map(key => {
        const param = params[Number(key.slice(1)) - 1];
        if (typeof param === 'boolean') return [key, Number(param)];
        if (param && typeof param === 'object' && !ArrayBuffer.isView(param)) return [key, JSON.stringify(param)];
        return [key, param ?? null];
      }));
      const rows = plan.statement.all(bindings);
      for (const row of rows) {
        if (typeof row.payload === 'string') row.payload = JSON.parse(row.payload);
        if ('codex_imported' in row) row.codex_imported = Boolean(row.codex_imported);
        if (row.content instanceof Uint8Array) row.content = Buffer.from(row.content);
      }
      return { rows };
    },
  };

  let queue = Promise.resolve();
  function serialize(work) {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  return {
    query: (sql, params) => serialize(() => client.query(sql, params)),
    transaction(callback, readOnly = false) {
      return serialize(async () => {
        database.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
        try {
          const value = await callback(client);
          database.exec('COMMIT');
          return value;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      });
    },
    end: () => serialize(() => database.close()),
  };
}
