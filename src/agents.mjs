import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { on, once } from 'node:events';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import WebSocket from 'ws';
import { decodeReplyImage, readReplyImage } from './attachments.mjs';
import { agyCallForTool, agyToolText, agyTranscript, claudeToolText } from './history.mjs';
import { agyForm, userQuestions } from './questions.mjs';

const exec = promisify(execFile);
const codexClient = { name: 'ferry', version: '0.1.0' };

function desktopCodex() {
  if (process.platform !== 'darwin') return;
  for (const apps of ['/Applications', join(homedir(), 'Applications')]) {
    for (const app of ['ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
      'Codex.app/Contents/Resources/codex']) {
      const binary = join(apps, app);
      try { accessSync(binary, constants.X_OK); return binary; } catch { /* Try the next installation. */ }
    }
  }
}

function cliEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('FERRY_')));
}

function nativeProcess(file, args, cwd, signal, env = cliEnv()) {
  signal.throwIfAborted();
  const group = process.platform !== 'win32';
  const child = spawn(file, args, { cwd, env, detached: group, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  child.stdin.on('error', () => {});
  let killTimer;
  const kill = signal => {
    if (!child.pid) return;
    try {
      if (group) globalThis.process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  };
  const stop = () => {
    if (child.exitCode !== null || child.signalCode) return;
    kill('SIGTERM');
    killTimer ??= setTimeout(() => kill('SIGKILL'), 2000);
    killTimer.unref();
  };
  signal.addEventListener('abort', stop, { once: true });
  const closed = new Promise(resolve => {
    child.once('error', error => { stderr = error.message; });
    child.once('close', (code, cause) => {
      signal.removeEventListener('abort', stop);
      clearTimeout(killTimer);
      resolve({ code, cause, stderr });
    });
  });
  return { child, closed, stop, lines: createInterface({ input: child.stdout, crlfDelay: Infinity }) };
}

function parse(line) {
  try { return JSON.parse(line); } catch { return undefined; }
}

async function runClaude({ file, cwd, nativeId, forkSource, branchKind, prompt, model, effort, images = [], signal, emit, saveNative, setSteer, ask }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'bypassPermissions'];
  if (ask) args.push('--permission-prompt-tool', 'stdio');
  const sessionId = nativeId || randomUUID();
  if (forkSource && !nativeId) args.push('--resume', forkSource, '--fork-session', '--session-id', sessionId);
  else args.push(nativeId ? '--resume' : '--session-id', sessionId);
  if (branchKind === 'side') args.push('--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  const process = nativeProcess(file, args, cwd, signal);
  let atResult = false;
  let background = false;
  let backgroundStatus = '';
  let inputClose;
  const pendingPrompts = new Set();
  function reportBackground() {
    const status = atResult && background && !failed ? 'Claude replied; background tasks are still running' : '';
    if (status === backgroundStatus) return;
    backgroundStatus = status;
    emit('background', status);
  }
  function finishInput() {
    clearTimeout(inputClose);
    setSteer(undefined);
    if (!process.child.stdin.writableEnded) process.child.stdin.end();
  }
  function closeAfter(delayMs) {
    clearTimeout(inputClose);
    if (atResult && !background) inputClose = setTimeout(finishInput, delayMs);
  }
  function receiving() {
    atResult = false;
    clearTimeout(inputClose);
  }
  function send(text, attachments, priority) {
    signal.throwIfAborted();
    const content = [...(text ? [{ type: 'text', text }] : []), ...attachments.map(image => ({
      type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.content.toString('base64') },
    }))];
    const uuid = randomUUID();
    const line = JSON.stringify({ type: 'user', uuid, origin: { kind: 'human' }, message: { role: 'user', content }, parent_tool_use_id: null, priority });
    receiving();
    pendingPrompts.add(uuid);
    return new Promise((resolve, reject) => {
      process.child.stdin.write(line + '\n', error => {
        if (error) {
          pendingPrompts.delete(uuid);
          reject(error);
        } else resolve();
      });
    });
  }
  let result;
  let failed;
  let streamed = false;
  let nextParagraph = false;
  let tail = '';
  let messageId;
  let messageHadDelta = false;
  const streamedMessages = new Set();
  const completedMessages = new Set();
  const seenTools = new Set();
  const questions = new Map();
  function outputText(text) {
    if (typeof text !== 'string' || !text) return;
    if (nextParagraph && tail) {
      const newlines = (tail.match(/\n*$/)?.[0].length ?? 0) + (text.match(/^\n*/)?.[0].length ?? 0);
      if (newlines < 2) emit('delta', '\n'.repeat(2 - newlines));
    }
    nextParagraph = false;
    streamed = true;
    tail = (tail + text).slice(-2);
    emit('delta', text);
  }
  try {
    await send(prompt, images);
    for await (const line of process.lines) {
      const msg = parse(line);
      if (!msg) continue;
      if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
        const { input, tool_name: name } = msg.request;
        const respond = response => {
          signal.throwIfAborted();
          return new Promise((resolve, reject) => process.child.stdin.write(JSON.stringify({ type: 'control_response',
            response: { subtype: 'success', request_id: msg.request_id, response } }) + '\n', error => error ? reject(error) : resolve()));
        };
        const request = name === 'AskUserQuestion' && ask && userQuestions(input?.questions, true);
        if (request) {
          questions.set(msg.request_id, ask(request, answers => respond({ behavior: 'allow', updatedInput: {
            ...input, answers: Object.fromEntries(request.map(question => [question.question, answers[question.id].join(', ')])),
          } }), true));
        } else await respond({ behavior: 'deny', message: 'This client only presents user questions.' });
        continue;
      }
      if (msg.type === 'control_cancel_request') {
        questions.get(msg.request_id)?.();
        questions.delete(msg.request_id);
      }
      if (msg.type === 'system' && msg.subtype === 'init') {
        receiving();
        if (msg.permissionMode !== 'bypassPermissions') throw new Error('Claude Code did not enable bypassPermissions.');
        if (msg.session_id !== sessionId) throw new Error('Claude Code returned a different session ID.');
        if (!forkSource || nativeId) saveNative(sessionId);
        if (!process.child.stdin.writableEnded) setSteer(({ text, images }) => send(text, images, 'next'));
        reportBackground();
      }
      if (msg.type === 'system' && msg.subtype === 'background_tasks_changed' && Array.isArray(msg.tasks)) {
        background = msg.tasks.length > 0;
        // A task notification can start another native turn as the last task leaves the list.
        closeAfter(900);
        reportBackground();
      }
      const event = msg.type === 'stream_event' && msg.event;
      if (event?.type === 'message_start') {
        if (atResult) { receiving(); reportBackground(); }
        messageId = event.message?.id;
        messageHadDelta = false;
        nextParagraph = Boolean(tail);
      }
      if (event?.type === 'content_block_start' && event.content_block?.type === 'text' && messageHadDelta) nextParagraph = true;
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        messageHadDelta = true;
        if (messageId) streamedMessages.add(messageId);
        outputText(event.delta.text);
      }
      if (msg.type === 'assistant') {
        if (atResult) { receiving(); reportBackground(); }
        const id = msg.message?.id;
        const blocks = msg.message?.content ?? [];
        const alreadyStreamed = streamedMessages.has(id) || (messageHadDelta && (!id || !messageId || id === messageId));
        if (!alreadyStreamed && !completedMessages.has(id)) {
          const text = blocks.filter(block => block.type === 'text').map(block => block.text).filter(Boolean).join('\n\n');
          if (text) {
            nextParagraph = Boolean(tail);
            outputText(text);
            if (id) completedMessages.add(id);
          }
        }
        for (const item of blocks) {
          if (item.type !== 'tool_use' || (ask && item.name === 'AskUserQuestion') || (item.id && seenTools.has(item.id))) continue;
          if (item.id) seenTools.add(item.id);
          emit('tool', claudeToolText(item));
        }
      }
      if (msg.type === 'result') {
        result = msg;
        if (msg.is_error) failed ??= msg;
        if (!streamed && !msg.is_error) outputText(msg.result);
        if (forkSource && !nativeId && !msg.is_error && msg.session_id === sessionId) saveNative(sessionId);
        streamed = false;
        messageHadDelta = false;
        nextParagraph = Boolean(tail);
        messageId = undefined;
        streamedMessages.clear();
        completedMessages.clear();
        const answered = msg.user_message_uuids ?? (msg.user_message_uuid ? [msg.user_message_uuid] : []);
        if (answered.length || Number.isInteger(msg.queued_turn_count)) {
          for (const uuid of answered) pendingPrompts.delete(uuid);
        } else pendingPrompts.clear(); // Older CLIs do not identify the prompt in the result.
        atResult = !pendingPrompts.size && !msg.queued_turn_count;
        if (failed) finishInput();
        else closeAfter(150);
        reportBackground();
      }
    }
    const exit = await process.closed;
    signal.throwIfAborted();
    if (!result || failed || exit.code !== 0) {
      throw new Error(failed?.errors?.join(' ') || failed?.result || exit.stderr.trim() || 'Claude Code did not finish this turn.');
    }
  } finally {
    clearTimeout(inputClose);
    setSteer(undefined);
    process.stop();
    await process.closed;
  }
}

async function runAgyAcp({ file, cwd, nativeId, prompt, model, effort, images = [], signal, emit, saveNative, setSteer = () => {}, ask, side }) {
  const args = ['acp'];
  if (side) {
    const agents = join(side.directory, '.agents', 'agents');
    await mkdir(agents, { recursive: true, mode: 0o700 });
    await writeFile(join(agents, 'ferry-reader.md'), [
      '---', 'name: ferry-reader', 'description: Read-only side chat',
      'tools: [view_file, grep_search, list_dir]', 'commandExecutionPolicy: "off"', '---', '',
    ].join('\n'), { mode: 0o600 });
    args.push('--agent', 'ferry-reader', '--add-dir', cwd);
  } else args.push('--dangerously-skip-permissions');
  const process = nativeProcess(file, args, side?.directory || cwd, signal);
  const lines = process.lines[Symbol.asyncIterator]();
  let nextId = 0;
  let sessionId;
  const tools = new Map();
  const forms = new Map();

  function write(message) {
    return new Promise((resolve, reject) => process.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n', error => error ? reject(error) : resolve()));
  }

  async function read() {
    for (;;) {
      const line = await lines.next();
      signal.throwIfAborted();
      if (line.done) throw new Error((await process.closed).stderr || 'Antigravity closed the session.');
      const message = parse(line.value);
      if (!message) continue;
      if (message.method === '$/cancel_request') {
        const id = message.params?.requestId ?? message.params?.id;
        if (forms.has(id)) {
          forms.get(id).close();
          forms.delete(id);
          await write({ id, result: { action: 'cancel' } });
        }
        continue;
      }
      if (!message.method || message.id === undefined) return message;
      if (message.method === 'elicitation/create') {
        const params = message.params;
        const form = ask && prompts.size && sessionId === params?.sessionId && (params.mode ?? 'form') === 'form' && agyForm(params.requestedSchema);
        if (form) {
          const close = ask(form.items, async answers => {
            if (!forms.has(message.id)) throw new Error('This question has ended.');
            signal.throwIfAborted();
            await write({ id: message.id, result: { action: 'accept', content: form.content(answers) } });
            forms.delete(message.id);
          }, true);
          forms.set(message.id, { close, toolId: params.toolCallId });
        } else await write({ id: message.id, result: { action: 'cancel' } });
        continue;
      }
      if (message.method === 'session/request_permission') {
        await write({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
      } else await write({ id: message.id, error: { code: -32601, message: 'Unsupported client method' } });
    }
  }

  async function request(method, params) {
    const id = ++nextId;
    await write({ id, method, params });
    for (;;) {
      const message = await read();
      if (message.id !== id) continue; // Loading can replay historical updates.
      if (message.error) throw new Error(message.error.message || 'Antigravity rejected the request.');
      return message.result;
    }
  }

  const prompts = new Map();
  let imageInput;
  function sendPrompt(id, text, attachments, context) {
    signal.throwIfAborted();
    if (attachments.length && !imageInput) throw new Error('This Antigravity CLI does not support image prompts.');
    const blocks = attachments.map(image => ({ type: 'image', mimeType: image.mediaType, data: image.content.toString('base64') }));
    if (text) blocks.unshift({ type: 'text', text });
    if (context) blocks.unshift({ type: 'resource', resource: {
      uri: 'ferry:///parent-conversation.json', mimeType: 'application/json', text: context,
    } });
    return write({ id, method: 'session/prompt', params: { sessionId, prompt: blocks } });
  }

  async function guide({ text, images }) {
    if (!prompts.size) throw new Error('The original turn has ended. Your draft is kept.');
    const id = ++nextId;
    const accepted = Promise.withResolvers();
    prompts.set(id, accepted);
    try {
      await Promise.all([sendPrompt(id, text, images), accepted.promise]);
    } catch (error) {
      prompts.delete(id);
      throw error;
    }
  }

  function updateTool(update) {
    const { toolCallId, title } = update;
    if (!toolCallId) return;
    if (update.status === 'completed' || update.status === 'failed') {
      for (const [id, form] of forms) {
        if (form.toolId !== toolCallId) continue;
        form.close();
        forms.delete(id);
      }
    }
    const previous = tools.get(toolCallId);
    const args = update.rawInput || update.args || {};
    const detail = args.CommandLine ? 'Shell · ' + args.CommandLine : title || previous?.detail || update.name;
    if (!detail) return;
    const summary = args.toolSummary || previous?.summary;
    const text = agyToolText(detail, summary);
    if (previous?.text === text) return;
    const index = previous?.index ?? tools.size;
    tools.set(toolCallId, { text, detail, summary, index });
    emit(previous ? 'toolDetail' : 'tool', text, index);
  }

  try {
    const { agentCapabilities } = await request('initialize', { protocolVersion: 1, clientCapabilities: ask ? { elicitation: { form: {} } } : {} });
    imageInput = agentCapabilities?.promptCapabilities?.image;
    const params = { cwd: side?.directory || cwd, mcpServers: [] };
    if (side && !agentCapabilities?.promptCapabilities?.embeddedContext) throw new Error('Antigravity side chats require ACP embedded context.');
    if (nativeId) {
      sessionId = nativeId;
      const method = agentCapabilities.sessionCapabilities?.resume ? 'session/resume' : 'session/load';
      await request(method, { ...params, sessionId });
    } else {
      const session = await request('session/new', params);
      sessionId = session?.sessionId;
      if (!sessionId) throw new Error('Antigravity did not return a conversation ID.');
      if (!side) saveNative(sessionId);
    }
    if (model) await request('session/set_model', { sessionId, modelId: model });
    else if (effort) await request('session/set_config_option', { sessionId, configId: 'thought_level', value: effort });
    const firstId = ++nextId;
    prompts.set(firstId, null);
    await sendPrompt(firstId, prompt, images, !nativeId && side?.context);
    setSteer(guide);
    while (prompts.size) {
      const message = await read();
      if (message.method === 'session/update' && message.params?.sessionId === sessionId) {
        const update = message.params.update;
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') emit('delta', update.content.text);
        if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') updateTool(update);
      }
      if (!prompts.has(message.id)) continue;
      const receipt = prompts.get(message.id);
      prompts.delete(message.id);
      if (message.error || message.result?.stopReason !== 'end_turn') {
        const error = new Error(message.error?.message || 'Antigravity ended the turn: ' + (message.result?.stopReason || 'unknown reason'));
        if (!receipt || !prompts.size) {
          receipt?.reject(error);
          throw error;
        }
        receipt.reject(error);
        continue;
      }
      if (side && !nativeId && message.id === firstId) saveNative(sessionId);
      receipt?.resolve();
      // agy hands off a running turn by completing the previous prompt RPC.
      // The replacement RPC remains open and owns subsequent output.
      prompts.values().next().value?.resolve();
    }
  } finally {
    setSteer(undefined);
    for (const form of forms.values()) form.close();
    for (const receipt of prompts.values()) receipt?.reject(new Error('Antigravity closed the session.'));
    prompts.clear();
    process.stop();
    await process.closed;
  }
}

async function runAgy(options) {
  if (!options.side && !options.images?.length) {
    const { stdout } = await exec(options.file, ['--version'], { signal: options.signal, timeout: 3500, env: cliEnv() });
    if (/^v?(?:0\.|1\.[0-4]\.)/.test(stdout.trim())) return runAgyPrint(options);
  }
  return runAgyAcp(options);
}

async function runAgyPrint(options) {
  const { file, cwd, nativeId, prompt, model, effort, signal, emit, saveNative } = options;
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--dangerously-skip-permissions'];
  if (nativeId) args.push('--conversation', nativeId);
  if (model) args.push('--model', model);
  else if (effort) args.push('--effort', effort);
  const process = nativeProcess(file, args, cwd, signal);
  const seenTools = new Set();
  let id = nativeId;
  let streamed = false;
  let result;
  const pending = new Map();
  let transcript;
  let reading;
  function updateSummaries() {
    if (reading || !pending.size || !id) return reading;
    transcript ??= agyTranscript(id, new Set([prompt.trim()]));
    reading = transcript.refresh().then(() => {
      const turn = transcript.current;
      if (!turn) return;
      for (const [index, tool] of pending) {
        const call = agyCallForTool(turn, index, tool.detail);
        if (!call || call.name !== tool.name) continue;
        if (call.summary) emit('toolDetail', agyToolText(tool.detail, call.summary), index);
        pending.delete(index);
      }
    }).finally(() => { reading = undefined; });
    return reading;
  }
  const poll = setInterval(updateSummaries, 750);
  function native(value) {
    if (!value) return;
    if (id && value !== id) throw new Error('Antigravity returned a different session ID.');
    if (!id) { id = value; saveNative(id); }
  }
  try {
    process.child.stdin.end(JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n');
    for await (const line of process.lines) {
      const event = parse(line);
      if (event?.event === 'init') {
        if (event.init?.permission_mode !== 'always-proceed') throw new Error('Antigravity did not enable always-proceed mode.');
        native(event.conversation_id);
      }
      if (event?.event === 'step_update') {
        const step = event.step_update;
        if (step?.step_type === 'agent_response' && step.text_delta) {
          streamed = true;
          emit('delta', step.text_delta);
        }
        if (step?.step_type === 'tool') {
          const index = step.step_index;
          const name = step.tool_name || step.tool_info?.name;
          const params = step.tool_info?.parameters;
          const command = typeof params?.CommandLine === 'string' && params.CommandLine.trim();
          if (!seenTools.has(index) && (command || (name && step.state === 'DONE'))) {
            const detail = command ? 'Shell · ' + command : name;
            const text = agyToolText(detail, params?.toolSummary);
            seenTools.add(index);
            emit('tool', text, index);
            if (text === detail && Number.isSafeInteger(index)) pending.set(index, { name, detail });
          } else if (pending.has(index) && params?.toolSummary) {
            emit('toolDetail', agyToolText(pending.get(index).detail, params.toolSummary), index);
            pending.delete(index);
          }
        }
      }
      if (event?.event === 'result') {
        result = event.result;
        native(result?.conversation_id);
        if (!streamed && result?.status === 'SUCCESS' && result.response) emit('delta', result.response);
      }
    }
    const exit = await process.closed;
    signal.throwIfAborted();
    if (!result || result.status !== 'SUCCESS' || exit.code !== 0) {
      throw new Error(result?.error || exit.stderr.trim() || 'Antigravity did not finish this turn.');
    }
  } finally {
    clearInterval(poll);
    await reading;
    await updateSummaries();
    process.stop();
    await process.closed;
  }
}

class CodexSocketUnavailable extends Error {}

async function codexTransport(file, cwd, signal, socket, isolatedHome) {
  if (!socket) {
    const env = cliEnv();
    if (isolatedHome) {
      env.CODEX_HOME = isolatedHome;
      env.CODEX_SQLITE_HOME = isolatedHome;
    }
    const process = nativeProcess(file, ['app-server', '--listen', 'stdio://'], cwd, signal, env);
    return { ...process, write: value => process.child.stdin.write(JSON.stringify(value) + '\n') };
  }
  const client = new WebSocket('ws://localhost', {
    createConnection: () => createConnection({ path: socket }), handshakeTimeout: 2500, maxPayload: 128 * 1024 * 1024,
  });
  let stderr = '';
  client.on('error', error => { stderr = error.message; });
  const closed = new Promise(resolve => client.once('close', () => resolve({ stderr })));
  try { await once(client, 'open', { signal }); }
  catch (error) {
    client.terminate();
    throw new CodexSocketUnavailable('Cannot connect to the shared Codex App Server.', { cause: error });
  }
  async function* lines() {
    try {
      for await (const [frame] of on(client, 'message', { close: ['close'] })) yield frame.toString();
    } catch (error) { stderr = error.message; }
  }
  return { lines: lines(), closed, stop: () => client.terminate(), write: value => client.send(JSON.stringify(value)) };
}

function runCodex(options) {
  return onCodex(options, runCodexConnection);
}

async function onCodex(options, connect) {
  if (options.isolatedHome) return connect(options);
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const socket = process.env.FERRY_CODEX_APP_SERVER_SOCKET || join(codexHome, 'app-server-control', 'app-server-control.sock');
  if (process.platform !== 'win32') {
    try { accessSync(socket); }
    catch { return connect(options); }
    try {
      return await connect({ ...options, socket });
    } catch (error) {
      if (!(error instanceof CodexSocketUnavailable)) throw error;
    }
  }
  return connect(options);
}

async function runCodexConnection({ file, cwd, nativeId, prompt, model, effort, images = [], signal, emit, saveNative, setSteer,
  socket, isolatedHome, branchKind, ask }) {
  signal.throwIfAborted();
  const transport = await codexTransport(file, cwd, signal, socket, isolatedHome);
  let requestId = 0;
  const pending = new Map();
  let turnId;
  let completed = false;
  let startRequest;
  const initialEvents = [];
  let turnFinished;
  const streamedItems = new Set();
  const asyncItems = new Set();
  const completedMessages = new Set();
  const questions = new Map();
  let previousItem;
  let textTail = '';
  function agentText(item, text) {
    if (!text) return;
    if (previousItem && previousItem !== item && !/\s$/.test(textTail) && !/^\s/.test(text)
      && (/[。！？.!?]$/.test(textTail) || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~)/.test(text))) {
      emit('delta', '\n\n');
    }
    previousItem = item;
    textTail = (textTail + text).slice(-2);
    emit('delta', text);
  }
  const done = new Promise(resolve => { turnFinished = resolve; });
  const { write } = transport;
  let exitError;
  function request(method, params, timeoutMs = 25000) {
    if (exitError) return Promise.reject(exitError);
    const id = ++requestId;
    if (method === 'turn/start') startRequest = id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Codex request timed out: ' + method));
      }, timeoutMs);
      pending.set(id, (error, result) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(result);
      });
      write({ id, method, params });
    });
  }

  async function handleTurnEvent(msg) {
    const params = msg.params;
    const eventTurn = params?.turnId ?? params?.turn?.id;
    if (params?.threadId && params.threadId !== thread) return;
    if (!turnId) {
      if (startRequest && initialEvents.length < 256) initialEvents.push(msg);
      return;
    }
    if (eventTurn && eventTurn !== turnId) return;
    if (msg.method === 'serverRequest/resolved') {
      questions.get(params?.requestId)?.();
      questions.delete(params?.requestId);
    }
    if (msg.method === 'item/tool/requestUserInput' && msg.id !== undefined) {
      if (questions.has(msg.id)) return;
      const request = ask && userQuestions(params?.questions);
      if (request) {
        questions.set(msg.id, ask(request, answers => {
          signal.throwIfAborted();
          write({ id: msg.id, result: { answers: Object.fromEntries(request.map(question =>
            [question.id, { answers: answers[question.id] }])) } });
        }, params?.isBlocking !== false));
      } else write({ id: msg.id, error: { code: -32602, message: 'Invalid or unsupported questions.' } });
      return;
    }
    if (msg.method === 'item/agentMessage/delta' && params?.delta) {
      if (asyncItems.has(params.itemId) || completedMessages.has(params.itemId)) return;
      streamedItems.add(params.itemId);
      agentText(params.itemId, params.delta);
    }
    if (msg.method === 'item/started') {
      const item = params?.item;
      if (item?.type === 'agentMessage' && (item.delivery === 'async' || item.questions?.length)) asyncItems.add(item.id);
      if (item?.type === 'commandExecution') emit('tool', 'Shell · ' + (item.command || 'Run command'));
      if (item?.type === 'fileChange') emit('tool', 'Update project files');
      if (item?.type === 'mcpToolCall') emit('tool', item.tool || 'MCP tool');
    }
    if (msg.method === 'item/completed' && params?.item?.type === 'agentMessage') {
      const item = params.item;
      if (completedMessages.has(item.id)) return;
      completedMessages.add(item.id);
      asyncItems.delete(item.id);
      const questions = Array.isArray(item.questions) && userQuestions(item.questions.map((question, index) => ({
        id: String(index), question: question?.title, isOther: true,
        options: Array.isArray(question?.options) ? question.options.map(label => ({ label })) : [],
      })));
      if (questions) emit('asyncQuestion', questions);
      else if (!streamedItems.has(item.id)) agentText(item.id, item.text);
    }
    if (msg.method === 'item/completed' && params?.item?.type === 'imageGeneration' && !params.item.failure) {
      const { result, savedPath } = params.item;
      const saved = typeof savedPath === 'string' && isAbsolute(savedPath) ? await readReplyImage(savedPath).catch(() => null) : null;
      const image = saved || decodeReplyImage(result);
      if (image) {
        emit('image', image);
        previousItem = undefined;
        textTail = '';
      }
    }
    if (msg.method === 'turn/completed') {
      const turn = params?.turn;
      completed = true;
      setSteer(undefined);
      turnFinished(turn?.status === 'completed' ? null : new Error(turn?.error?.message || 'Codex did not finish this turn.'));
    }
  }

  const reader = (async () => {
    for await (const line of transport.lines) {
      const msg = parse(line);
      if (!msg) continue;
      if (msg.method && msg.id !== undefined) {
        if (msg.method === 'item/tool/requestUserInput') { await handleTurnEvent(msg); continue; }
        if (socket && (!turnId || msg.params?.turnId !== turnId || msg.params?.threadId !== thread)) continue;
        write({ id: msg.id, error: { code: -32601, message: 'This client runs without interactive tool approvals.' } });
        if (turnId) write({ id: ++requestId, method: 'turn/interrupt', params: { threadId: thread, turnId } });
        turnFinished(new Error('Codex asked for interactive approval or input. Check the effective policy on the machine.'));
        continue;
      }
      if (msg.id !== undefined) {
        if (msg.id === startRequest) {
          startRequest = undefined;
          turnId = msg.result?.turn?.id;
          if (turnId) for (const event of initialEvents) await handleTurnEvent(event);
          initialEvents.length = 0;
        }
        const error = msg.error && Object.assign(new Error(msg.error.message), { rpcCode: msg.error.code });
        pending.get(msg.id)?.(error, msg.result);
        pending.delete(msg.id);
        continue;
      }
      await handleTurnEvent(msg);
    }
    const exit = await transport.closed;
    exitError = new Error(exit.stderr.trim() || 'The Codex connection ended.');
    for (const settle of pending.values()) settle(exitError);
    pending.clear();
    turnFinished(exitError);
  })();
  let thread;
  let imageDirectory;
  let steering;
  let waiting = '';
  function setWaiting(reason) {
    if (waiting === reason) return;
    waiting = reason;
    emit('waiting', reason);
  }
  const abort = () => turnFinished(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  async function userInput(text, attachments) {
    const input = text ? [{ type: 'text', text }] : [];
    if (attachments.length) {
      imageDirectory ??= await mkdtemp(join(tmpdir(), 'ferry-image-'));
      for (const image of attachments) {
        const path = join(imageDirectory, randomUUID() + '.' + image.extension);
        await writeFile(path, image.content, { mode: 0o600 });
        input.push({ type: 'localImage', path });
      }
    }
    return input;
  }
  try {
    try { await request('initialize', { clientInfo: codexClient, ...(ask && { capabilities: { experimentalApi: true } }) }, socket ? 2500 : 25000); }
    catch (error) {
      if (socket) throw new CodexSocketUnavailable('Cannot connect to the shared Codex App Server.', { cause: error });
      throw error;
    }
    write({ method: 'initialized' });
    // Leave sandbox selection to Codex on the execution machine.
    const selectedModel = model;
    const policy = { cwd, approvalPolicy: 'never',
      ...(ask && { config: { 'features.default_mode_request_user_input': true } }),
      ...(branchKind === 'side' && { sandbox: 'read-only' }),
      ...(selectedModel && { model: selectedModel }) };
    let session;
    if (nativeId) {
      let wait = 1000;
      for (;;) {
        signal.throwIfAborted();
        try {
          session = await request('thread/resume', { threadId: nativeId, excludeTurns: true, ...policy });
          break;
        } catch (error) {
          if (error.rpcCode !== -32600 || !error.message.includes('already has an active writer')) throw error;
          setWaiting('Waiting for desktop Codex to release the thread; the message will send automatically');
          await delay(wait, undefined, { signal });
          wait = Math.min(wait * 2, 5000);
        }
      }
    } else session = await request('thread/start', policy);
    thread = session?.thread?.id;
    if (!thread || (nativeId && thread !== nativeId)) throw new Error('Codex did not return the expected native thread.');
    if (session.approvalPolicy !== 'never') {
      throw new Error('Codex did not enable the never-ask approval policy.');
    }
    saveNative(thread);
    const input = await userInput(prompt, images);
    if (socket) {
      let status = session.thread.status?.type;
      while (status === 'active') {
        setWaiting('Waiting for the current Codex turn to finish; the message will send automatically');
        await delay(1500, undefined, { signal });
        status = (await request('thread/read', { threadId: thread, includeTurns: false }))?.thread?.status?.type;
      }
    }
    signal.throwIfAborted();
    setWaiting('');
    await request('turn/start', { threadId: thread, input,
      ...(selectedModel && { model: selectedModel }), ...(effort && { effort }) });
    if (!turnId) throw new Error('Codex did not return the current turn.');
    if (turnId && !completed) setSteer(({ id, text, images }) => {
      steering = (async () => {
        const input = await userInput(text, images);
        signal.throwIfAborted();
        if (completed) throw new Error('The current turn has ended.');
        const result = await request('turn/steer', { threadId: thread, expectedTurnId: turnId, clientUserMessageId: id, input });
        if (result?.turnId !== turnId) throw new Error('Codex did not confirm the guidance for this turn.');
      })();
      return steering;
    });
    const error = await done;
    signal.throwIfAborted();
    if (error) throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    if (socket && signal.aborted && turnId && !completed) {
      await request('turn/interrupt', { threadId: thread, turnId }, 2500).catch(() => {});
    }
    completed = true;
    setSteer(undefined);
    transport.stop();
    await reader;
    await steering?.catch(() => {});
    if (imageDirectory) await rm(imageDirectory, { recursive: true, force: true });
  }
}

const bundledCodex = desktopCodex();
export const adapters = new Map([
  ['codex', { name: 'Codex', file: process.env.FERRY_CODEX_BIN || bundledCodex || 'codex', run: runCodex, branch: forkCodex }],
  ['claude', { name: 'Claude Code', file: process.env.FERRY_CLAUDE_BIN || 'claude', run: runClaude, branch: async () => null }],
  ['agy', { name: 'Antigravity', file: process.env.FERRY_AGY_BIN || 'agy', run: runAgy, sideOnly: true, branch: async () => null, videoInput: false }],
]);

const effortNames = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
const effortOptions = values => values.map(id => ({ id, name: effortNames[id] || id }));

const modelCatalogs = new Map();
async function withCodex(requests, timeout, { file = adapters.get('codex').file, cwd = homedir(), socket, isolatedHome, experimental } = {}) {
  if (!file) throw new Error('Codex App Server is not configured on this machine.');
  const signal = AbortSignal.timeout(timeout);
  const transport = await codexTransport(file, cwd, signal, socket, isolatedHome);
  signal.addEventListener('abort', transport.stop, { once: true });
  const lines = transport.lines[Symbol.asyncIterator]();
  const send = transport.write;
  let nextId = 0;
  async function request(method, params) {
    const id = ++nextId;
    send({ id, method, params });
    for (;;) {
      const { done, value } = await lines.next();
      if (done) {
        const exit = await transport.closed;
        signal.throwIfAborted();
        throw new Error(exit.stderr.trim() || 'Codex App Server exited.');
      }
      const msg = parse(value);
      if (msg?.id !== id || msg.method) continue;
      if (msg.error) throw new Error(msg.error.message);
      return msg.result;
    }
  }
  try {
    try { await request('initialize', { clientInfo: codexClient, ...(experimental && { capabilities: { experimentalApi: true } }) }); }
    catch (error) {
      if (socket) throw new CodexSocketUnavailable('Cannot connect to the shared Codex App Server.', { cause: error });
      throw error;
    }
    send({ method: 'initialized' });
    return await requests(request);
  } finally {
    signal.removeEventListener('abort', transport.stop);
    transport.stop();
    await transport.closed;
  }
}

export function readCodexQuota(directory) {
  return onCodex({ isolatedHome: directory, experimental: true }, connection => withCodex(async request => {
    const identity = await request('account/read', { refreshToken: false });
    const { account } = identity;
    const sessions = account?.type === 'chatgpt'
      ? await request('accountSession/list', { refreshWorkspaceMetadata: false }).catch(() => null) : null;
    const usage = account?.type === 'chatgpt'
      ? await request('account/rateLimits/read', { excludeResetCreditDetails: true }).catch(() => null) : null;
    return { account, sessions, usage };
  }, 8000, connection));
}

function forkCodex(options) {
  return onCodex(options, connection => withCodex(async request => {
    const { nativeId, cwd, model, kind } = options;
    const result = await request('thread/fork', { threadId: nativeId, cwd, excludeTurns: true,
      approvalPolicy: 'never', ...(model && { model }),
      ...(kind === 'side' && { threadSource: 'side_chat', sandbox: 'read-only' }),
    });
    if (!result?.thread?.id || result.thread.id === nativeId || result.thread.ephemeral) {
      throw new Error('Codex did not create a resumable thread.');
    }
    return result.thread.id;
  }, 12000, connection));
}

function listCodexModels() {
  return withCodex(async request => {
    const inventory = await request('model/list', { limit: 100, includeHidden: false });
    const { config } = await request('config/read', { includeLayers: false }).catch(() => ({}));
    const models = inventory.data.map(value => ({
      id: value.model || value.id, name: value.displayName || value.model || value.id,
      efforts: effortOptions((value.supportedReasoningEfforts || []).map(it => it.reasoningEffort)),
      defaultEffort: value.defaultReasoningEffort || '',
      imageInput: value.inputModalities?.includes('image') ?? true,
    }));
    const configuredModel = config?.model;
    const recommended = inventory.data.find(value => value.isDefault);
    const activeId = configuredModel || recommended?.model || recommended?.id;
    const options = models.find(model => model.id === activeId);
    const defaultEffort = config?.model_reasoning_effort || options?.defaultEffort || '';
    return { runtime: bundledCodex && adapters.get('codex').file === bundledCodex ? 'desktop' : 'app-server',
      models: [{ ...options, id: '', name: activeId ? 'Default · ' + (options?.name || activeId) : 'Default model', defaultEffort }, ...models],
      defaultEffort };
  }, 6500);
}

async function listClaudeModels() {
  const process = nativeProcess(adapters.get('claude').file,
    ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--no-session-persistence', '--strict-mcp-config', '--tools', ''], homedir(), AbortSignal.timeout(5500));
  const requestId = randomUUID();
  try {
    process.child.stdin.write(JSON.stringify({ type: 'control_request', request_id: requestId,
      request: { subtype: 'initialize' } }) + '\n');
    for await (const line of process.lines) {
      const message = parse(line);
      if (message?.type !== 'control_response' || message.response?.request_id !== requestId) continue;
      const catalog = message.response.response?.models;
      if (!Array.isArray(catalog) || !catalog.length) break;
      const models = new Map();
      for (const model of catalog) {
        if (typeof model.value !== 'string') continue;
        const isDefault = model.value === 'default';
        const id = isDefault ? '' : model.resolvedModel || model.value;
        const aliases = !isDefault && id !== model.value ? [model.value] : [];
        const existing = models.get(id);
        if (existing) { existing.aliases.push(...aliases); continue; }
        const versionedName = /^(?:Claude )?(?:Opus|Sonnet|Haiku|Fable)\s+\d+(?:\.\d+)?\b/.exec(model.description ?? '')?.[0];
        models.set(id, { id, aliases,
          name: isDefault ? 'Default · ' + (versionedName || model.resolvedModel || 'Claude Code')
            : versionedName || model.displayName || id,
          efforts: effortOptions(Array.isArray(model.supportedEffortLevels) ? model.supportedEffortLevels : []),
          defaultEffort: model.defaultEffort || '', imageInput: model.supportsImages ?? true });
      }
      return { models: [...models.values()], defaultEffort: models.get('')?.defaultEffort || '' };
    }
    throw new Error('Claude Code returned no model catalog.');
  } finally {
    process.stop();
    await process.closed;
  }
}

async function listAgyModels() {
  const { stdout } = await exec(adapters.get('agy').file, ['models'], { timeout: 10000, maxBuffer: 256 * 1024, env: cliEnv() });
  const models = stdout.split(/\r?\n/).flatMap(line => {
    const [id, name] = line.split('\t', 2);
    return /^[a-z0-9][a-z0-9_.:/\[\]-]{0,91}$/i.test(id) && name?.trim()
      ? [{ id, name: name.trim(), efforts: [], imageInput: true }] : [];
  });
  if (!models.length) throw new Error('Antigravity returned no model catalog.');
  return { models: [{ id: '', name: 'Default model', efforts: [], imageInput: true }, ...models], defaultEffort: '' };
}

function catalogFallback(agent) {
  if (agent !== 'claude') return { models: [{ id: '', name: 'Default model', efforts: [], imageInput: true }], defaultEffort: '', unavailable: true };
  const efforts = effortOptions(['low', 'medium', 'high', 'xhigh', 'max']);
  return { models: [{ id: '', name: 'Default model' }, { id: 'sonnet', name: 'Sonnet' },
    { id: 'opus', name: 'Opus' }, { id: 'haiku', name: 'Haiku' }]
    .map(model => ({ ...model, efforts, imageInput: true, defaultEffort: '' })), defaultEffort: '' };
}

export function agentOptions(agent, refresh = false) {
  const cached = modelCatalogs.get(agent) ?? { until: 0 };
  modelCatalogs.set(agent, cached);
  if (!refresh && cached.until > Date.now()) return Promise.resolve(cached.value);
  if (!cached.pending) {
    const catalog = (agent === 'claude' ? listClaudeModels : agent === 'agy' ? listAgyModels : listCodexModels)();
    cached.pending = catalog.then(value => {
      const catalogUpdatedAt = Date.now();
      cached.until = catalogUpdatedAt + 5 * 60_000;
      return cached.value = { ...value, catalogUpdatedAt };
    }).catch(() => {
      cached.until = Date.now() + 30_000;
      if (!cached.value?.catalogUpdatedAt || Date.now() - cached.value.catalogUpdatedAt > 24 * 60 * 60_000) {
        cached.value = { ...catalogFallback(agent), fallback: true };
      }
      return cached.value;
    }).finally(() => { cached.pending = undefined; });
  }
  return !refresh && cached.value?.catalogUpdatedAt && Date.now() - cached.value.catalogUpdatedAt < 24 * 60 * 60_000
    ? Promise.resolve(cached.value) : cached.pending;
}

export async function discoverAgents() {
  return Promise.all([...adapters].map(async ([id, adapter]) => {
    if (!adapter.file) return { id, name: adapter.name, available: false };
    try {
      const { stdout } = await exec(adapter.file, ['--version'], { timeout: 3500, maxBuffer: 8192, env: cliEnv() });
      return { id, name: adapter.name, version: stdout.trim(), available: true,
        ...(adapter.videoInput === false && { videoInput: false }) };
    } catch {
      return { id, name: adapter.name, available: false };
    }
  }));
}
