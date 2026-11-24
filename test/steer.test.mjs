import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { adapters } from '../src/agents.mjs';

const header = `#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
const lines = createInterface({ input: process.stdin });
const send = data => console.log(JSON.stringify(data));
`;

async function start(t, agent, code, { nativeId, socket, ask } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'ferry-steer-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const file = join(cwd, 'agent.mjs');
  await writeFile(file, header + code, { mode: 0o700 });
  if (agent === 'codex') {
    const previous = process.env.FERRY_CODEX_APP_SERVER_SOCKET;
    process.env.FERRY_CODEX_APP_SERVER_SOCKET = socket ?? join(cwd, 'control.sock');
    t.after(() => {
      if (previous === undefined) delete process.env.FERRY_CODEX_APP_SERVER_SOCKET;
      else process.env.FERRY_CODEX_APP_SERVER_SOCKET = previous;
    });
  }
  const controller = new AbortController();
  t.after(() => controller.abort());
  const emitted = [];
  const ready = Promise.withResolvers();
  let steer;
  const done = adapters.get(agent).run({
    file, cwd, nativeId, prompt: 'original', signal: controller.signal, ask,
    setSteer(handler) { steer = handler; if (handler) ready.resolve(handler); },
    emit: (type, value) => emitted.push([type, value]),
    saveNative() {},
  });
  void done.then(() => ready.reject(new Error('Native turn ended before steering was available')), ready.reject);
  return { done, ready: ready.promise, emitted, current: () => steer };
}

const images = [{ extension: 'png', mediaType: 'image/png', content: Buffer.from('image') }];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('Codex forks via App Server and uses a read-only side thread', { timeout: 5000 }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'ferry-fork-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const file = join(cwd, 'agent.mjs');
  await writeFile(file, header + `
for await (const line of lines) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: {} });
  else if (method === 'thread/fork') {
    assert.equal(params.threadId, 'source');
    assert.equal(params.excludeTurns, true);
    assert.equal(params.approvalPolicy, 'never');
    const side = params.threadSource === 'side_chat';
    assert.equal(params.sandbox, side ? 'read-only' : undefined);
    send({ id, result: { thread: { id: side ? 'side' : 'fork', ephemeral: false } } });
  }
}`, { mode: 0o700 });
  const branch = adapters.get('codex').branch;
  const settings = { file, cwd, isolatedHome: cwd, nativeId: 'source' };
  assert.equal(await branch({ ...settings, kind: 'fork' }), 'fork');
  assert.equal(await branch({ ...settings, kind: 'side' }), 'side');
});

test('Codex steers the same native turn and surfaces a refused request', { timeout: 5000 }, async t => {
  const { ready, done, emitted, current } = await start(t, 'codex', `
for await (const line of lines) {
  const { id, method, params } = JSON.parse(line);
  const reply = result => send({ id, result });
  if (method === 'initialize') reply({});
  else if (method === 'thread/start') {
    assert.equal(params.approvalPolicy, 'never');
    assert.equal(Object.hasOwn(params, 'sandbox'), false);
    reply({ thread: { id: 'native-thread' }, approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
  }
  else if (method === 'turn/start') {
    assert.equal(params.input[0].text, 'original');
    reply({ turn: { id: 'native-turn' } });
    send({ method: 'item/agentMessage/delta', params: { itemId: 'answer', delta: 'before ' } });
  } else if (method === 'turn/steer') {
    assert.equal(params.threadId, 'native-thread');
    assert.equal(params.expectedTurnId, 'native-turn');
    if (params.input[0].text === 'reject') {
      send({ id, error: { message: 'turn rejected' } });
      continue;
    }
    assert.equal(params.clientUserMessageId, 'accepted-id');
    assert.equal(params.input[0].text, 'change direction');
    assert.equal(readFileSync(params.input[1].path, 'utf8'), 'image');
    reply({ turnId: 'native-turn' });
    send({ method: 'item/agentMessage/delta', params: { itemId: 'answer', delta: 'after' } });
    send({ method: 'item/completed', params: { item: { type: 'imageGeneration', result: '${png}' } } });
    send({ method: 'turn/completed', params: { turn: { id: 'native-turn', status: 'completed' } } });
  }
}
`);
  const steer = await ready;
  await assert.rejects(steer({ id: 'reject-id', text: 'reject', images: [] }), /turn rejected/);
  await steer({ id: 'accepted-id', text: 'change direction', images });
  await done;
  assert.equal(current(), undefined);
  assert.deepEqual(emitted, [['delta', 'before '], ['delta', 'after'],
    ['image', { content: Buffer.from(png, 'base64'), mediaType: 'image/png' }]]);
});

test('Claude sends steering input through the existing process before the result', { timeout: 5000 }, async t => {
  const { ready, done, emitted, current } = await start(t, 'claude', `
const session_id = process.argv[process.argv.indexOf('--session-id') + 1];
assert.equal(process.argv[process.argv.indexOf('--input-format') + 1], 'stream-json');
let count = 0;
for await (const line of lines) {
  const { message, priority } = JSON.parse(line);
  if (++count === 1) {
    assert.equal(message.content[0].text, 'original');
    send({ type: 'system', subtype: 'init', permissionMode: 'bypassPermissions', session_id });
    continue;
  }
  assert.equal(count, 2);
  assert.equal(priority, 'next');
  assert.equal(message.content[0].text, 'change direction');
  assert.equal(Buffer.from(message.content[1].source.data, 'base64').toString(), 'image');
  send({ type: 'result', is_error: false, result: 'after' });
}
assert.equal(count, 2);
`);
  await (await ready)({ id: 'accepted-id', text: 'change direction', images });
  await done;
  assert.equal(current(), undefined);
  assert.deepEqual(emitted, [['delta', 'after']]);
});

test('Claude keeps accepting input across a resumed result and chained background tasks', { timeout: 5000 }, async t => {
  const { done, emitted, current } = await start(t, 'claude', `
const session_id = process.argv[process.argv.indexOf('--session-id') + 1];
const init = () => send({ type: 'system', subtype: 'init', permissionMode: 'bypassPermissions', session_id });
const tasks = names => send({ type: 'system', subtype: 'background_tasks_changed', tasks: names.map(task_id => ({ task_id })) });
const result = (queued_turn_count, user_message_uuid) => send({ type: 'result', is_error: false, queued_turn_count, user_message_uuid });
for await (const line of lines) {
  const { uuid, priority, origin } = JSON.parse(line);
  assert.equal(origin.kind, 'human');
  if (priority === 'next') {
    tasks([]);
    result(0, uuid);
    break;
  }
  init();
  result(1);
  await new Promise(resolve => setTimeout(resolve, 200));
  init();
  tasks(['initial-watch']);
  result(0, uuid);
  tasks([]);
  await new Promise(resolve => setTimeout(resolve, 60));
  init();
  tasks(['next-watch']);
  result(0);
}
`);
  let steer;
  for (let i = 0; i < 100; i++) {
    if (emitted.filter(([kind, value]) => kind === 'background' && value).length === 2) {
      steer = current();
      break;
    }
    await delay(20);
  }
  assert.equal(typeof steer, 'function');
  await steer({ id: 'follow-up', text: 'Is it running?', images: [] });
  await done;
});

test('Codex sends a selected answer back to the original App Server request', { timeout: 5000 }, async t => {
  const { done, emitted } = await start(t, 'codex', `
for await (const line of lines) {
  const msg = JSON.parse(line);
  const { id, method, params } = msg;
  if (method === 'initialize') {
    assert.equal(params.capabilities.experimentalApi, true);
    send({ id, result: {} });
  } else if (method === 'thread/start') {
    assert.equal(params.config['features.default_mode_request_user_input'], true);
    send({ id, result: { thread: { id: 'thread' }, approvalPolicy: 'never' } });
  } else if (method === 'turn/start') {
    send({ id: 'server-question', method: 'item/tool/requestUserInput', params: { threadId: 'thread', turnId: 'turn', isBlocking: false,
      questions:[{ id: 'color', question: 'Which color?', options:[{ label: 'Blue' }, { label: 'Red' }] }] } });
    send({ id, result: { turn: { id: 'turn' } } });
  } else if (id === 'server-question') {
    assert.deepEqual(msg.result, { answers: { color: { answers: ['Blue'] } } });
    send({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: id } });
    send({ method: 'item/agentMessage/delta', params: { threadId:'thread', turnId:'turn', itemId:'a', delta:'Blue selected' } });
    send({ method: 'turn/completed', params: { threadId:'thread', turn:{ id:'turn', status:'completed' } } });
  }
}
`, { ask(questions, answer, blocking) {
    assert.equal(questions[0].options[0].label, 'Blue');
    assert.equal(blocking, false);
    answer({ color: ['Blue'] });
    return () => {};
  } });
  await done;
  assert.deepEqual(emitted, [['delta', 'Blue selected']]);
});

test('Codex waits for a different writer and sends exactly once on the original thread', { timeout: 6000 }, async t => {
  const { done, emitted } = await start(t, 'codex', `
let attempts = 0;
let sent = false;
for await (const line of lines) {
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') send({ id, result: {} });
  else if (method === 'thread/resume') {
    assert.equal(params.threadId, 'existing-thread');
    if (++attempts === 1) send({ id, error: { code: -32600, message: 'thread existing-thread already has an active writer' } });
    else send({ id, result: { thread: { id: 'existing-thread' }, approvalPolicy: 'never' } });
  } else if (method === 'turn/start') {
    assert.equal(attempts, 2);
    assert.equal(sent, false);
    assert.equal(params.threadId, 'existing-thread');
    assert.equal(params.input[0].text, 'original');
    sent = true;
    send({ id, result: { turn: { id: 'new-turn' } } });
    send({ method: 'item/agentMessage/delta', params: { threadId: 'existing-thread', turnId: 'new-turn', delta: 'done' } });
    send({ method: 'turn/completed', params: { threadId: 'existing-thread', turn: { id: 'new-turn', status: 'completed' } } });
  }
}
`, { nativeId: 'existing-thread' });
  await done;
  assert.match(emitted[0][1], /Waiting for desktop Codex/);
  assert.deepEqual(emitted.slice(1), [['waiting', ''], ['delta', 'done']]);
});

test('Codex shared socket waits for the desktop turn and streams only its submitted turn',
  { timeout: 6000, skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'ra-socket-'));
  const socket = join(directory, 'control.sock');
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  t.after(async () => {
    for (const peer of server.clients) peer.terminate();
    server.close();
    await new Promise(resolve => http.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  let idle = false;
  const requests = [];
  server.on('connection', peer => peer.on('message', line => {
    const { id, method, params } = JSON.parse(line);
    const send = value => peer.send(JSON.stringify(value));
    requests.push({ method, params });
    if (method === 'initialize') send({ id, result: {} });
    else if (method === 'thread/resume') {
      send({ id, result: { thread: { id: 'shared-thread', status: { type: 'active' } }, approvalPolicy: 'never' } });
      send({ method: 'item/agentMessage/delta', params: { threadId: 'shared-thread', turnId: 'desktop-turn', delta: 'ignore' } });
    } else if (method === 'thread/read') {
      idle = true;
      send({ id, result: { thread: { status: { type: 'idle' } } } });
    } else if (method === 'turn/start' && idle) {
      send({ method: 'item/agentMessage/delta', params: { threadId: 'shared-thread', turnId: 'web-turn', delta: 'before ' } });
      send({ id, result: { turn: { id: 'web-turn' } } });
      send({ method: 'turn/completed', params: { threadId: 'another-thread', turn: { id: 'other-turn', status: 'completed' } } });
      send({ method: 'item/agentMessage/delta', params: { threadId: 'shared-thread', turnId: 'web-turn', delta: 'after' } });
      send({ method: 'turn/completed', params: { threadId: 'shared-thread', turn: { id: 'web-turn', status: 'completed' } } });
    }
  }));
  http.listen(socket);
  await once(http, 'listening');
  const { done, emitted } = await start(t, 'codex', `throw new Error('Unexpected stdio fallback');`, { nativeId: 'shared-thread', socket });
  await done;
  assert.equal(requests.find(request => request.method === 'turn/start')?.params.threadId, 'shared-thread');
  assert.match(emitted[0][1], /Waiting for the current Codex turn/);
  assert.deepEqual(emitted.slice(1), [['waiting', ''], ['delta', 'before '], ['delta', 'after']]);
});
