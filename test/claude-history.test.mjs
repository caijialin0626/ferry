import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { restoreClaudeHistory } from '../src/claude-history.mjs';

test('Claude history restores native text and commands in order after a legacy turn ends', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ra-claude-history-'));
  const previous = process.env.FERRY_CLAUDE_HISTORY_DIR;
  process.env.FERRY_CLAUDE_HISTORY_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.FERRY_CLAUDE_HISTORY_DIR;
    else process.env.FERRY_CLAUDE_HISTORY_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const cwd = '/tmp/repo';
  const nativeId = randomUUID();
  const folder = join(root, '-tmp-repo');
  await mkdir(folder);
  const assistant = (...content) => ({ type: 'assistant', message: { content } });
  const text = value => ({ type: 'text', text: value });
  const shell = command => ({ type: 'tool_use', name: 'Bash', input: { command } });
  const rows = [
    { type: 'user', message: { content: [text('检查进度')] } },
    assistant(text('先看这里：'), shell('pwd')),
    assistant(shell('ls')),
    { type: 'user', origin: { kind: 'task-notification' }, message: { content: 'Internal task event' } },
    assistant(text('目录存在。')),
  ];
  await writeFile(join(folder, nativeId + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
  const history = [
    { id: 'request', role: 'user', text: '检查进度' },
    { id: 'answer', role: 'agent', text: '先看这里：目录存在。' },
    { id: 'old-tool', role: 'tool', text: 'Bash', reply_offset: 5 },
  ];
  assert.deepEqual(await restoreClaudeHistory(history, nativeId, cwd, true), history);
  const restored = await restoreClaudeHistory(history, nativeId, cwd, false);
  assert.equal(restored[1].text, '先看这里：\n\n目录存在。');
  assert.deepEqual(restored.slice(2).map(row => [row.text, row.reply_offset]), [['Bash · pwd', 5], ['Bash · ls', 5]]);
  const unmatched = history.map(row => row.role === 'agent' ? { ...row, text: '结果不一致。' } : row);
  assert.deepEqual(await restoreClaudeHistory(unmatched, nativeId, cwd, false), unmatched);
});
