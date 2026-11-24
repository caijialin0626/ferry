import { one } from './db.mjs';

export const independentProject = 'unfiled-sessions';

// Keep the first page contiguous, extending it past long runs of tool calls
// when needed to include the last three replies that contain visible text.
const historyBounds = `
  WITH recent AS MATERIALIZED (
    SELECT position,role FROM messages
    WHERE session=$1 AND position<$2 ORDER BY position DESC LIMIT 65
  ), normal_page AS (
    SELECT COALESCE((SELECT position FROM recent WHERE role='user'
      ORDER BY position DESC LIMIT 1 OFFSET 5),
      (SELECT position FROM recent ORDER BY position DESC LIMIT 1 OFFSET 31),
      (SELECT min(position) FROM recent)) AS first
  ), reply_page AS (
    SELECT min(position) AS first FROM (
      SELECT position FROM messages
      WHERE $3 AND session=$1 AND position<$2 AND role='agent' AND text<>''
        AND trim(text, ' \t\r\n')<>''
      ORDER BY position DESC LIMIT 3
    ) AS replies
  ), bounds AS (
    SELECT CASE WHEN r.first < n.first THEN r.first ELSE n.first END AS first
    FROM normal_page n CROSS JOIN reply_page r
  )`;

export function readHistory(db, id, before, initial) {
  return db.transaction(async client => {
    const session = await one(client, 'SELECT * FROM sessions WHERE id=$1', [id]);
    if (!session) return;
    const { rows: messages } = await client.query(historyBounds + `
      SELECT m.position,m.id,m.role,m.text,m.reply_offset,m.created_at
      FROM bounds b CROSS JOIN messages m
      WHERE m.session=$1 AND m.position>=b.first AND m.position<$2 ORDER BY m.position`, [id, before, initial]);
    const first = messages[0]?.position;
    const older = first != null && await one(client, 'SELECT 1 FROM messages WHERE session=$1 AND position<$2 LIMIT 1',
      [id, first]) ? first : null;
    if (messages.length) {
      const { rows: attachments } = await client.query(`
        SELECT a.id,a.message,a.name,a.media_type FROM messages m
        JOIN attachments a ON a.session=COALESCE(m.attachment_session,m.session) AND a.message=m.id
        WHERE m.session=$1 AND m.position>=$2 AND m.position<$3 ORDER BY a.position,a.id`, [id, first, before]);
      const byId = new Map(messages.map(message => [message.id, message]));
      for (const { id, message, name, media_type } of attachments) {
        (byId.get(message).images ??= []).push({ id, name, mediaType: media_type, url: '/api/attachments/' + id });
      }
    }
    const { cursor } = initial ? await one(client, 'SELECT COALESCE(max(seq),0) AS cursor FROM events WHERE session=$1', [id]) : {};
    return { session, messages, older, cursor };
  }, true);
}

