import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

export async function readHistory(db, id, before, initial, independentDirectory) {
  const page = await db.transaction(async client => {
    const session = await one(client, 'SELECT * FROM sessions WHERE id=$1', [id]);
    if (!session) return;
    const { rows: messages } = await client.query(historyBounds + `
      SELECT m.position,m.id,m.role,m.text,m.reply_offset,m.created_at,m.updated_at
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
  if (initial && page?.session.agent === 'claude' && page.session.native_id && page.messages.some(isLegacyClaudeTool)) {
    const { session } = page;
    const cwd = session.project === independentProject ? independentDirectory
      : (await one(db, 'SELECT directory FROM projects WHERE id=$1', [session.project]))?.directory;
    page.messages = await restoreClaudeHistory(page.messages, session.native_id, cwd, ['running', 'stopping'].includes(session.state));
  }
  return page;
}

const toolFields = new Map([
  ['Bash', 'command'], ['PowerShell', 'command'], ['Monitor', 'command'],
  ['Read', 'file_path'], ['Edit', 'file_path'], ['Write', 'file_path'], ['NotebookEdit', 'notebook_path'],
  ['Glob', 'pattern'], ['Grep', 'pattern'], ['Skill', 'skill'],
]);
export function claudeToolText({ name, input }) {
  const value = input?.[toolFields.get(name)];
  return typeof value === 'string' && value.trim() ? name + ' · ' + value.trim() : name;
}

function isLegacyClaudeTool(message) {
  return message.role === 'tool' && toolFields.has(message.text);
}

function restoreTurn([prompt, ...messages], candidates) {
  const reply = messages.find(message => message.role === 'agent');
  if (!reply?.text.trim() || !candidates?.length) return;
  const guides = messages.filter(message => message.role === 'steer');
  let restored;
  for (const blocks of candidates) {
    let rawOffset = 0;
    let rendered = '';
    let guideIndex = 0;
    const actions = [];
    for (const block of blocks) {
      if (block.type === 'text') {
        if (!reply.text.startsWith(block.text, rawOffset)) break;
        rawOffset += block.text.length;
        const breaks = (rendered.match(/\n*$/)?.[0].length ?? 0) + (block.text.match(/^\n*/)?.[0].length ?? 0);
        rendered += (rendered && block.text && breaks < 2 ? '\n'.repeat(2 - breaks) : '') + block.text;
      } else if (block.type === 'tool_use') {
        const tool = claudeToolText(block);
        actions.push({ id: `${reply.id}-native-tool-${actions.length}`, role: 'tool',
          text: tool.length > 8192 ? tool.slice(0, 8192) + '…' : tool, reply_offset: rendered.length });
      } else if (block.type === 'user') {
        const guide = guides[guideIndex];
        if (!guide || guide.text !== block.text || guide.reply_offset !== rawOffset) break;
        guideIndex++;
        actions.push({ ...guide, reply_offset: rendered.length });
      }
    }
    if (rawOffset !== reply.text.length || guideIndex !== guides.length) continue;
    if (restored) return; // Repeated prompts with the same result are ambiguous.
    restored = [prompt, { ...reply, text: rendered }, ...actions,
      ...messages.filter(message => !['agent', 'steer', 'tool'].includes(message.role))];
  }
  return restored;
}

function indexClaudeLog(log, prompts) {
  const matches = new Map();
  let blocks;
  for (const line of log.split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || row.isSidechain || row.parent_tool_use_id) continue;
    const content = row.message?.content;
    if (row.type === 'user') {
      if (row.origin?.kind === 'task-notification' || row.isMeta) continue;
      const text = typeof content === 'string' ? content : Array.isArray(content) &&
        content.filter(item => item?.type === 'text').map(item => item.text).join('');
      if (!text) continue;
      if (prompts.has(text)) {
        blocks = [];
        const records = matches.get(text) ?? [];
        records.push(blocks);
        matches.set(text, records);
      } else if (blocks) blocks.push({ type: 'user', text });
    } else if (row.type === 'assistant' && blocks && Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === 'text' && typeof item.text === 'string' && item.text) blocks.push(item);
        if (item?.type === 'tool_use' && typeof item.name === 'string') blocks.push(item);
      }
    }
  }
  return matches;
}

async function restoreClaudeHistory(messages, nativeId, cwd, running) {
  if (!/^[0-9a-f-]{36}$/i.test(nativeId ?? '') || !cwd) return messages;
  const turns = [[]];
  for (const message of messages) {
    if (message.role === 'user') turns.push([]);
    turns.at(-1).push(message);
  }
  const legacy = new Set(turns.filter((turn, index) => turn[0]?.role === 'user' &&
    (!running || index < turns.length - 1) && turn.filter(message => message.role === 'agent').length === 1 &&
    turn.some(isLegacyClaudeTool)));
  if (!legacy.size) return messages;
  const root = process.env.FERRY_CLAUDE_HISTORY_DIR || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  const directory = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
  let log;
  try {
    const source = await open(join(root, directory, nativeId + '.jsonl'));
    try {
      // The native transcript is optional. Keep history reads bounded.
      const size = (await source.stat()).size;
      if (size > 8 * 1024 * 1024) return messages;
      const data = Buffer.alloc(size);
      const { bytesRead } = await source.read(data, 0, size, 0);
      log = data.toString('utf8', 0, bytesRead);
    } finally { await source.close(); }
  } catch { return messages; }
  const matches = indexClaudeLog(log, new Set(turns.filter(turn => turn[0]?.role === 'user').map(turn => turn[0].text)));
  return turns.flatMap(turn => legacy.has(turn) ? restoreTurn(turn, matches.get(turn[0].text)) ?? turn : turn);
}
