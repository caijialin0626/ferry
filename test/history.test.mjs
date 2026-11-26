import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/db.mjs';
import { independentProject, readHistory } from '../src/history.mjs';

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
  const db = openDatabase(':memory:');
  t.after(() => db.end());
  await db.query('INSERT INTO projects(id,directory,name) VALUES ($1,$2,$3)', ['project', cwd, 'Fixture']);
  await db.query('INSERT INTO sessions(id,project,agent,native_id,title,state,updated) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    ['chat', 'project', 'claude', nativeId, 'Fixture', 'running', 0]);
  for (const { id, role, text, reply_offset } of history) {
    await db.query('INSERT INTO messages(session,id,role,text,reply_offset) VALUES ($1,$2,$3,$4,$5)',
      ['chat', id, role, text, reply_offset]);
  }
  const messages = async (initial = true, independentDirectory) =>
    (await readHistory(db, 'chat', Number.MAX_SAFE_INTEGER, initial, independentDirectory)).messages;
  const original = await messages(false);
  assert.deepEqual(await messages(), original);
  await db.query("UPDATE sessions SET state='idle' WHERE id='chat'");
  const restored = await messages();
  assert.equal(restored[1].text, '先看这里：\n\n目录存在。');
  assert.deepEqual(restored.slice(2).map(row => [row.text, row.reply_offset]), [['Bash · pwd', 5], ['Bash · ls', 5]]);
  assert.deepEqual(await messages(false), original);
  await db.query('INSERT INTO projects(id,directory,name) VALUES ($1,$2,$3)', [independentProject, '@independent', 'Standalone']);
  await db.query("UPDATE sessions SET project=$1 WHERE id='chat'", [independentProject]);
  assert.deepEqual(await messages(true, cwd), restored);
  await db.query("UPDATE messages SET text='结果不一致。' WHERE session='chat' AND role='agent'");
  assert.deepEqual(await messages(true, cwd), await messages(false));
});

test('agy history restores a legacy capped batch only from a matching native turn', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ferry-agy-history-'));
  const previous = process.env.FERRY_AGY_HISTORY_DIR;
  process.env.FERRY_AGY_HISTORY_DIR = root;
  const db = openDatabase(':memory:');
  t.after(async () => {
    if (previous === undefined) delete process.env.FERRY_AGY_HISTORY_DIR;
    else process.env.FERRY_AGY_HISTORY_DIR = previous;
    await db.end();
    await rm(root, { recursive: true, force: true });
  });
  const nativeId = randomUUID();
  const folder = join(root, nativeId, '.system_generated', 'logs');
  await mkdir(folder, { recursive: true });
  const prompt = { type: 'USER_INPUT', step_index: 0, content: '<USER_REQUEST>sample</USER_REQUEST>' };
  const planner = { type: 'PLANNER_RESPONSE', step_index: 1, tool_calls: Array.from({ length: 113 }, (_, i) => ({
    name: 'run_command', args: { CommandLine: JSON.stringify('example ' + i), toolSummary: JSON.stringify('Inspect ' + i) },
  })) };
  const transcript = join(folder, 'transcript.jsonl');
  await db.query("INSERT INTO projects(id,directory,name) VALUES ('p','/tmp','sample')");
  await db.query("INSERT INTO sessions(id,project,agent,native_id,title,state,updated) VALUES ('s','p','agy',$1,'sample','idle',0)", [nativeId]);
  await db.query("INSERT INTO messages(session,id,role,text) VALUES ('s','request','user','sample')");
  for (let i = 0; i < 100; i++) {
    await db.query("INSERT INTO messages(session,id,role,text,reply_offset) VALUES ('s',$1,'tool',$2,0)", ['request-tool-' + (i+1), 'Shell · example ' + i]);
  }
  const read = async () => (await readHistory(db, 's', Number.MAX_SAFE_INTEGER, true)).messages;
  assert.equal((await read()).length, 101);
  await writeFile(transcript, [prompt, planner].map(row => JSON.stringify(row)).join('\n') + '\n');
  const rows = await read();
  assert.equal(rows.length, 114);
  assert.equal(rows.at(-1).text, 'Inspect 112\nShell · example 112');
  await writeFile(transcript, [prompt, planner, prompt, planner].map(row => JSON.stringify(row)).join('\n') + '\n');
  assert.equal((await read()).at(-1).text, 'Shell · example 99');
});
