// Simulate only the external ACP server. Ferry uses its normal upload and history paths.
const assert = require('node:assert/strict');
const { createInterface } = require('node:readline');
let sessionId;
let loaded = false;
let model;
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  let result = {};
  const send = value => console.log(JSON.stringify({ jsonrpc: '2.0', ...value }));
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
    assert.ok(images.length);
    for (const image of images) {
      assert.equal(image.mimeType, 'image/png');
      assert.equal(Buffer.from(image.data, 'base64').subarray(1, 4).toString(), 'PNG');
    }
    const text = params.prompt.find(block => block.type === 'text')?.text ?? '';
    update([loaded ? 'resumed' : 'new', model || 'default', text, ...images.map(i => i.data.length)].join('|'));
    result.stopReason = 'end_turn';
  } else throw new Error('Unexpected method: ' + method);
  send({ id, result });
});
