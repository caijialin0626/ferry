// Simulate only the external ACP server. Ferry uses its normal upload and history paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createInterface } = require('node:readline');
let sessionId;
let loaded = false;
let model;
let activeBrowserPrompt;
createInterface({ input: process.stdin }).on('line', async line => {
  const { id, method, params } = JSON.parse(line);
  let result = {};
  const send = value => console.log(JSON.stringify({ jsonrpc: '2.0', ...value }));
  const tool = (i, cmd, summary) => send({ method: 'session/update', params: { sessionId, update: {
    sessionUpdate: 'tool_call', toolCallId: 'tool-' + i, title: cmd, rawInput: { CommandLine: cmd, toolSummary: summary },
  } } });
  const update = content => send({ method: 'session/update', params: { sessionId, update: {
    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: content },
  } } });
  if (method === 'initialize') result.agentCapabilities = { promptCapabilities: { image: true }, loadSession: true };
  else if (method === 'session/new') result.sessionId = sessionId = 'agy-native-fixture';
  else if (method === 'session/load') {
    sessionId = params.sessionId;
    loaded = true;
    update('Historical replay must stay out of the new reply');
  } else if (method === 'session/set_model') model = params.modelId;
  else if (method === 'session/prompt') {
    assert.equal(params.sessionId, sessionId);
    const images = params.prompt.filter(block => block.type === 'image');

    for (const image of images) {
      assert.equal(image.mimeType, 'image/png');
      assert.equal(Buffer.from(image.data, 'base64').subarray(1, 4).toString(), 'PNG');
    }
    const text = params.prompt.find(block => block.type === 'text')?.text ?? '';
    if (!images.length && process.env.FIXTURE_BRAIN) {
      if (activeBrowserPrompt) {
        send({ id: activeBrowserPrompt, result: { stopReason: 'end_turn' } });
        activeBrowserPrompt = id;
        return;
      }
      activeBrowserPrompt = id;
      fs.mkdirSync(process.env.FIXTURE_BRAIN, { recursive: true });
      for (let i = 1; i <= 105; i++) tool(i, 'example ' + i, 'Inspect sample ' + i);
      while (!fs.existsSync(join(process.env.FIXTURE_BRAIN, 'finish'))) await delay(50);
      update('Browser reply: ');
      await delay(150);
      update(text + '\n\n- Inspect [sample.go](file:///demo/sample.go#L12-L19) and [guide](https://example.org/guide).');
      send({ id: activeBrowserPrompt, result: { stopReason: 'end_turn' } });
      activeBrowserPrompt = undefined;
      return;
    } else if (!images.length) {
      tool(1, 'pwd');
      update((loaded ? 'resume:' : 'start:') + text);
    } else update([loaded ? 'resumed' : 'new', model || 'default', text, ...images.map(i => i.data.length)].join('|'));
    result.stopReason = 'end_turn';
  } else throw new Error('Unexpected method: ' + method);
  send({ id, result });
});
