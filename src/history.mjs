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
    SELECT min(first) AS first FROM (
      SELECT first FROM normal_page UNION ALL SELECT first FROM reply_page
      UNION ALL SELECT max(position) FROM messages WHERE $3 AND session=$1 AND role='user' AND position<$2
    ) AS candidates
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
  if (page?.session.agent === 'agy') page.messages = await restoreAgyTools(page.messages, page.session.native_id);
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

// Antigravity omits toolSummary from some stream-json versions. Its compact
// transcript associates each planner call with the following native step index.
function agyArgument(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('"')) {
    try { const decoded = JSON.parse(value); if (typeof decoded === 'string') return decoded.trim(); } catch {}
  }
  return value.trim();
}

export function agyToolText(detail, summary) {
  const label = agyArgument(summary).replace(/\s+/g, ' ').slice(0, 512);
  return label ? label + '\n' + detail : detail;
}

export function agyCallForTool(turn, index, detail) {
  const call = turn.calls.get(index);
  if (call && (call.detail === detail || (detail.endsWith('…') && call.detail.startsWith(detail.slice(0, -1))))) return call;
  // Older rows have no native index; repeated identical commands may have
  // different summaries. An ambiguous match must keep the saved description.
  return turn.byDetail.get(detail);
}

export function agyTranscript(nativeId, prompts) {
  let current;
  const turns = [];
  let offset = 0;
  let inode;
  function recordPlannerStep(row) {
    if (row?.type === 'USER_INPUT' && typeof row.content === 'string') {
      const prompt = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(row.content)?.[1] ?? row.content;
      current = prompts.has(prompt.trim())
        ? { prompt: prompt.trim(), calls: new Map(), byDetail: new Map(), hasReply: false, toolsAfterReply: false }
        : undefined;
      if (current) turns.push(current);
    }
    const turn = current;
    if (!turn || row?.type !== 'PLANNER_RESPONSE' || !Number.isSafeInteger(row.step_index)) return;
    if (typeof row.content === 'string' && row.content.trim()) turn.hasReply = true;
    for (const [i, call] of (Array.isArray(row.tool_calls) ? row.tool_calls : []).entries()) {
      if (!call || typeof call.name !== 'string') continue;
      const command = agyArgument(call.args?.CommandLine);
      const detail = (command ? 'Shell · ' + command : call.name).slice(0, 8192);
      const summary = agyArgument(call.args?.toolSummary);
      const tool = { name: call.name, detail, summary };
      turn.calls.set(row.step_index + i + 1, tool);
      // agy 1.5 stream-json abbreviates long command parameters at 512 characters.
      const commandHead = [...command.slice(0, 1026)].slice(0, 512).join('');
      const preview = commandHead.length < command.length ? 'Shell · ' + commandHead + '…' : detail;
      tool.preview = preview;
      for (const key of new Set([detail, preview])) {
        if (!turn.byDetail.has(key)) turn.byDetail.set(key, tool);
        else if (turn.byDetail.get(key)?.summary !== summary) turn.byDetail.set(key, null);
      }
      if (turn.hasReply) turn.toolsAfterReply = true;
    }
  }

  async function refresh() {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(nativeId || '')) return;
    const root = process.env.FERRY_AGY_HISTORY_DIR || join(homedir(), '.gemini', 'antigravity-cli', 'brain');
    let file;
    try {
      file = await open(join(root, nativeId, '.system_generated', 'logs', 'transcript.jsonl'));
      const stat = await file.stat();
      if (!stat.isFile()) return;
      if (inode !== stat.ino || stat.size < offset) { turns.length = 0; current = undefined; offset = 0; inode = stat.ino; }
      if (stat.size === offset) return;
      let pending = Buffer.alloc(0);
      for await (const chunk of file.createReadStream({ start: offset, end: stat.size - 1, autoClose: false })) {
        const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let start = 0;
        for (let end; (end = bytes.indexOf(10, start)) >= 0; start = end + 1) {
          offset += end + 1 - start;
          let row;
          try { row = JSON.parse(bytes.toString('utf8', start, end)); } catch { continue; }
          recordPlannerStep(row);
        }
        pending = Buffer.from(bytes.subarray(start));
      }
    } catch { /* Native history is optional. Keep the stream-json fallback. */ }
    finally { await file?.close(); }
  }
  return { turns, refresh, get current() { return current; } };
}

async function restoreAgyTools(messages, nativeId) {
  const needsDetail = m => m.role === 'tool' && (/-tool-\d+$/.test(m.id)
    || (/-agy-step-\d+$/.test(m.id) && (!m.text.includes('\n') || m.text.startsWith('Shell · '))));
  if (!messages.some(needsDetail)) return messages;
  const prompts = new Set(messages.filter(m => m.role === 'user').map(m => m.text.trim()));
  if (!prompts.size) return messages;
  const native = agyTranscript(nativeId, prompts);
  await native.refresh();
  const turns = [[]];
  for (const message of messages) {
    if (message.role === 'user') turns.push([]);
    turns.at(-1).push(message);
  }
  return turns.flatMap(turn => {
    if (turn[0]?.role !== 'user') return turn;
    const matches = native.turns.filter(t => t.prompt === turn[0].text.trim());
    if (matches.length !== 1) return turn;
    const tools = turn.filter(m => m.role === 'tool');
    const calls = [...matches[0].calls.values()];
    // Only rebuild an entire legacy batch when the old cap was reached and
    // both sources place all actions before the first visible reply.
    if (tools.length === 100 && tools.every((m, i) => m.id.endsWith('-tool-' + (i + 1)) && m.reply_offset === 0)
        && calls.length > 100 && !matches[0].toolsAfterReply
        && turn.slice(1).every(m => ['tool', 'agent', 'notice'].includes(m.role))) {
      const restored = calls.map((c, i) => ({ id: tools[0].id.replace(/-tool-1$/, '-native-tool-' + i),
        role: 'tool', text: agyToolText(c.preview, c.summary), reply_offset: 0 }));
      return [turn[0], ...restored, ...turn.slice(1).filter(m => m.role !== 'tool')];
    }
    return turn.map(m => {
      if (!needsDetail(m)) return m;
      const step = /-agy-step-(\d+)$/.exec(m.id);
      const call = agyCallForTool(matches[0], step ? Number(step[1]) : undefined, m.text);
      return call?.summary ? { ...m, text: agyToolText(m.text, call.summary) } : m;
    });
  });
}
