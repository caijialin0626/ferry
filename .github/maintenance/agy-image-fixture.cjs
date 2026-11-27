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
let formPrompt;
const side = process.argv.includes('ferry-reader');
createInterface({ input: process.stdin }).on('line', async line => {
  const msg = JSON.parse(line);
  const { id, method, params } = msg;
  let result = {};
  const send = value => console.log(JSON.stringify({ jsonrpc: '2.0', ...value }));
  const tool = (i, cmd, summary) => send({ method: 'session/update', params: { sessionId, update: {
    sessionUpdate: 'tool_call', toolCallId: 'tool-' + i, title: cmd, rawInput: { CommandLine: cmd, toolSummary: summary },
  } } });
  const update = content => send({ method: 'session/update', params: { sessionId, update: {
    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: content },
  } } });
  if (id === 'native-form' && !method) {
    assert.deepEqual(msg.result, { action: 'accept', content: { color: '2', fruits: ['a', 'b'], fruits_other: 'Fig' } });
    update('Form received.');
    return send({ id: formPrompt, result: { stopReason: 'end_turn' } });
  }
  if (method === 'initialize') result.agentCapabilities = { promptCapabilities: { image: true, embeddedContext: true }, loadSession: true };
  else if (method === 'session/new') result.sessionId = sessionId = side ? 'agy-native-side' : 'agy-native-fixture';
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
    if (text === 'ask-fixture') {
      formPrompt = id;
      return send({ id: 'native-form', method: 'elicitation/create', params: { sessionId, mode: 'form', requestedSchema: {
        type: 'object', properties: {
          color: { type: 'string', title: 'Color?', oneOf: [{ const: '1', title: 'Red' }, { const: '2', title: 'Blue' }] },
          fruits: { type: 'array', title: 'Fruits?', items: { anyOf: [{ const: 'a', title: 'Apple' }, { const: 'b', title: 'Pear' }] } },
          fruits_other: { type: 'string', title: 'Other' },
        },
      } } });
    }
    const clipPath = /(?:^|\n)Attached video: (".*")$/.exec(text);
    const filePaths = [...text.matchAll(/^Attached file: (".*")$/gm)].map(match => JSON.parse(match[1]));
    if (filePaths.length) {
      update('File bytes: ' + filePaths.map(path => fs.readFileSync(path).length).join(', '));
    } else if (clipPath) {
      const clip = fs.readFileSync(JSON.parse(clipPath[1]));
      assert.equal(clip.toString('ascii', 4, 8), 'ftyp');
      update('Read MP4: ' + clip.length + ' bytes, ' + images.length + ' images.');
    } else if (side) {
      assert.ok(!process.argv.includes('--dangerously-skip-permissions'));
      assert.ok(fs.existsSync('.agents/agents/ferry-reader.md'));
      const snapshot = params.prompt.find(block => block.type === 'resource');
      if (loaded) assert.equal(snapshot, undefined);
      else assert.ok(JSON.parse(snapshot.resource.text).messages.some(row => row.text === 'ask-fixture'));
      update(loaded ? 'Side continued.' : 'Side started.');
    } else if (!images.length && process.env.FIXTURE_BRAIN) {
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
