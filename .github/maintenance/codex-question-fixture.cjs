#!/usr/bin/env node
const assert = require('node:assert/strict');
const { createInterface } = require('node:readline');

if (process.argv.includes('--version')) {
  console.log('codex-question-fixture');
  process.exit(0);
}
const threadId = 'fixture-thread';
const turnId = 'fixture-turn';
const send = message => console.log(JSON.stringify(message));
const notify = (method, params) => send({ method, params: { threadId, turnId, ...params } });
const finish = () => notify('turn/completed', { turn: { id: turnId, status: 'completed' } });
const questions = [{ title: 'Choose a color?', options: ['Red', 'Blue'] }, { title: 'Add a note?' }];

createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  const ok = result => send({ id, result });
  if (method === 'initialize') ok({});
  if (method === 'model/list') ok({ data: [] });
  if (method === 'config/read') ok({ config: {} });
  if (method === 'thread/start' || method === 'thread/resume') ok({ thread: { id: threadId }, approvalPolicy: 'never' });
  if (method !== 'turn/start' && method !== 'turn/steer') return;
  ok(method === 'turn/start' ? { turn: { id: turnId } } : { turnId });
  const prompt = params.input[0].text;
  if (prompt === 'compact') {
    const item = { type: 'contextCompaction', id: 'compact-item' };
    notify('item/completed', { item, turnId: 'unrelated' });
    notify('item/started', { item });
    const timer = setInterval(() => {
      if (!require('node:fs').existsSync(process.env.FIXTURE_COMPACTION_FINISH)) return;
      clearInterval(timer);
      notify('item/completed', { item });
      notify('thread/compacted', {});
      notify('item/completed', { item: { type: 'agentMessage', id: 'after', text: 'Continued after compaction.' } });
      finish();
    }, 50);
    return;
  }
  if (prompt === 'ask-live' || prompt === 'ask-idle') {
    const item = { id: 'q', type: 'agentMessage', delivery: 'async', questions, text: 'Choose a color?\n- Red\n- Blue' };
    notify('item/started', { item });
    notify('item/agentMessage/delta', { itemId: item.id, delta: item.text });
    notify('item/completed', { item });
    if (prompt === 'ask-idle') finish();
    return;
  }
  const match = /^<send_user_message_question_reply>\s*([\s\S]+?)\s*<\/send_user_message_question_reply>$/.exec(prompt);
  assert.deepEqual(JSON.parse(match[1]), [{ question: 'Choose a color?', answer: 'Blue' }, { question: 'Add a note?', answer: 'Sample' }]);
  notify('item/completed', { item: { type: 'agentMessage', id: 'reply', text: 'Received via ' + method } });
  finish();
});
