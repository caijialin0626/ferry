import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, mkdirSync } from 'node:fs';
import { open, realpath, stat, readdir, unlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { homedir, hostname } from 'node:os';
import { one, openDatabase, withTransaction } from './db.mjs';
import { adapters, agentOptions, discoverAgents } from './agents.mjs';
import { addAttachment, readImages, readLinkedReplyImage, readReplyImage, readVideo, videoExtensions } from './attachments.mjs';
import { userAnswers } from './questions.mjs';
import { HttpError, body, failure, json, maxImages, sameSecret, secret, sendLimit, sse } from './common.mjs';
import { hostData as data, openPairing } from './pairing.mjs';
import { independentProject as recentProject, readHistory } from './history.mjs';
import { createSchedule, setScheduleEnabled, startScheduler } from './schedules.mjs';
import { createQuotaReader } from './quota.mjs';

const token = secret('FERRY_HOST_TOKEN');
const bind = process.env.FERRY_HOST_BIND || '127.0.0.1';
const port = Number(process.env.FERRY_HOST_PORT || 8788);
const home = await realpath(homedir());
const recentWorkspace = join(data, 'independent');
const videoDirectory = resolve(data, 'video-attachments');
mkdirSync(data, { recursive: true, mode: 0o700 });
// Different listen ports can still point at the same chat history and scheduler.
const hostLock = new DatabaseSync(join(data, 'host-lock.sqlite'));
try {
  hostLock.exec('BEGIN EXCLUSIVE');
} catch (error) {
  if (error.errcode === 5) throw Error('A Ferry host is already using ' + data);
  throw error;
}
process.once('exit', () => hostLock.close());
mkdirSync(recentWorkspace, { mode: 0o700, recursive: true });
const pairing = await openPairing(data);
const db = openDatabase(join(data, 'sessions.sqlite'));
await db.query('INSERT INTO projects (id, directory, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
  [recentProject, '@independent', 'Standalone chats']);
const listeners = new Map();
const running = new Map();
const creatingBranches = new Map();
const readQuota = createQuotaReader(data);

function getProject(id, connection = db) {
  return one(connection, 'SELECT * FROM projects WHERE id=$1', [id]);
}
function getSession(id, connection = db) {
  return one(connection, 'SELECT * FROM sessions WHERE id=$1', [id]);
}
function publish(session) {
  for (const listener of listeners.get(session) ?? []) listener();
}
async function record(connection, session, type, payload) {
  await connection.query('INSERT INTO events(session,type,payload) VALUES ($1,$2,$3)', [session, type, payload]);
}
async function addMessage(connection, session, id, role, text, images = [], replyOffset = null, createdAt = Date.now()) {
  await connection.query('INSERT INTO messages (session,id,role,text,reply_offset,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [session, id, role, text, replyOffset, createdAt]);
  await record(connection, session, 'message', { id, role, text, created_at: createdAt, ...(images.length && { images }),
    ...(replyOffset !== null && { reply_offset: replyOffset }) });
}
async function changeState(connection, session, state) {
  await connection.query('UPDATE sessions SET state=$1, updated=$2 WHERE id=$3', [state, Date.now(), session]);
  await record(connection, session, 'state', { state });
}

async function recoverInterruptedTurns() {
  for (const { id } of (await db.query("SELECT id FROM sessions WHERE state IN ('running','stopping')")).rows) {
    await withTransaction(db, async client => {
      await addMessage(client, id, 'restart-' + randomUUID(), 'notice', 'The execution host restarted. Check the previous turn before sending the next message.');
      await changeState(client, id, 'interrupted');
    });
  }
}
let recovered;

function turnStatus(run) {
  const waitingForAnswer = run?.questions && Array.from(run.questions.values()).some(question => question.blocking);
  const waiting = run?.waiting || (waitingForAnswer ? 'Waiting for your answer' : '');
  return { text: waiting || run?.background || (run?.questions?.size ? 'A question is waiting for an answer' : ''),
    turn: run?.steer && !waiting && !run.controller.signal.aborted ? run.command : null };
}

function publicSession(session) {
  const run = session.state === 'running' ? running.get(session.id) : undefined;
  const { text, turn } = turnStatus(run);
  return { ...session, project: session.project === recentProject ? null : session.project,
    canBranch: Boolean(session.native_id && session.branch_kind !== 'side' && adapters.get(session.agent)?.branch),
    activeTurn: turn, waiting: text };
}

function folderError(error) {
  return ['EACCES', 'EPERM'].includes(error.code)
    ? new HttpError(403, 'The execution account cannot access this folder.')
    : new HttpError(404, 'Folder not found.');
}

async function directory(pathname) {
  if (!isAbsolute(pathname)) throw new HttpError(400, 'Enter an absolute path on the machine.');
  try {
    const path = await realpath(pathname);
    if (!(await stat(path)).isDirectory()) throw new Error();
    return path;
  } catch (error) {
    throw folderError(error);
  }
}

async function locations() {
  const root = parse(home).root;
  const items = [{ name: 'Home', path: home }, { name: 'Disk root', path: root }];
  if (process.platform === 'darwin') items.push({ name: 'Volumes', path: '/Volumes' });
  if (process.platform === 'win32') {
    const drives = await Promise.all(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', async letter => {
      const path = letter + ':\\';
      if (path.toLowerCase() === root.toLowerCase()) return null;
      try { return (await stat(path)).isDirectory() ? { name: path, path } : null; }
      catch { return null; }
    }));
    items.push(...drives.filter(Boolean));
  }
  return items;
}

function preference(input, key) {
  if (!Object.hasOwn(input, key)) return null;
  if (typeof input[key] !== 'boolean') throw new HttpError(400, 'Choose a valid state.');
  return input[key] ? Date.now() : 0;
}

let inventory;
let inventoryAt = 0;
async function inventoryFor(refresh = false) {
  if (!inventory || refresh || Date.now() - inventoryAt > 60_000) {
    inventoryAt = Date.now();
    inventory = discoverAgents();
  }
  return inventory;
}

function numeric(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 0) throw new HttpError(400, 'Invalid cursor.');
  return number;
}

function commandAt(connection, session, command) {
  return one(connection, 'SELECT text, request_key FROM commands WHERE session=$1 AND id=$2', [session, command]);
}

async function execute(session, run, input, cwd, options, images) {
  const { command, controller } = run;
  let buffer = '';
  let timer;
  let lastTool = '';
  let toolCount = 0;
  let outputLength = 0;
  let imageCount = 0;
  let outputWrites = 0;
  let lastOutputAt;
  const output = command + '-assistant';
  let openedOutput = false;
  let writeError;
  let writes = Promise.resolve();

  function queue(write, steering = false) {
    const task = writes.then(() => {
      if (writeError) throw writeError;
      return write();
    });
    writes = task.catch(error => {
      if (steering && error instanceof HttpError) return;
      writeError = error;
      controller.abort(new Error('The database connection failed while saving the chat.'));
    });
    return task;
  }
  function flush(force = false) {
    clearTimeout(timer);
    timer = undefined;
    if (!buffer || (outputWrites && !force)) return;
    const text = buffer;
    const updatedAt = lastOutputAt;
    buffer = '';
    outputWrites++;
    const persisted = queue(async () => {
      await withTransaction(db, async client => {
        await client.query('UPDATE messages SET text=text || $1,updated_at=$4 WHERE session=$2 AND id=$3', [text, session.id, output, updatedAt]);
        await record(client, session.id, 'delta', { id: output, text, updated_at: updatedAt });
      });
      publish(session.id);
    });
    const settled = () => {
      if (!--outputWrites && buffer && !timer) timer = setTimeout(flush, 35);
    };
    void persisted.then(settled, settled);
  }
  function message(id, role, text, replyOffset) {
    const createdAt = Date.now();
    queue(async () => {
      await withTransaction(db, async client => {
        await getSession(session.id, client);
        await addMessage(client, session.id, id, role, text, [], replyOffset, createdAt);
      });
      publish(session.id);
    });
  }
  function openOutput() {
    if (openedOutput) return;
    openedOutput = true;
    message(output, 'agent', '');
  }
  function appendOutput(value) {
    const text = value.slice(0, 512_000 - outputLength);
    if (!text) return;
    openOutput();
    outputLength += text.length;
    buffer += text;
    lastOutputAt = Date.now();
    if (buffer.length >= 4096) flush();
    else timer ??= setTimeout(flush, 35);
  }
  let state = 'idle';
  let note;
  function publishTurnStatus() {
    const status = turnStatus(run);
    queue(async () => {
      await record(db, session.id, 'waiting', status);
      publish(session.id);
    });
  }
  const questions = run.questions = new Map();
  function ask(items, deliver, blocking) {
    const id = 'question-' + randomUUID();
    questions.set(id, { items, deliver, blocking });
    flush(true);
    message(id, 'question', JSON.stringify(items), outputLength);
    publishTurnStatus();
    return () => {
      if (!questions.delete(id)) return;
      message(id + '-answer', 'answer', JSON.stringify({ id, closed: true }));
      publishTurnStatus();
    };
  }
  run.answer = (id, input) => queue(async () => {
    const question = questions.get(id);
    if (!question || controller.signal.aborted) {
      if (await answeredQuestion(session.id, id)) return;
      throw new HttpError(409, 'This question has ended.');
    }
    const answers = userAnswers(question.items, input);
    questions.delete(id);
    try { await question.deliver(answers); }
    catch {
      message(id + '-answer', 'answer', JSON.stringify({ id, closed: true }));
      publishTurnStatus();
      throw new HttpError(409, 'This question closed before the answer was delivered.');
    }
    const visible = Object.fromEntries(question.items.map(item => [item.id, item.secret ? ['••••'] : answers[item.id]]));
    await withTransaction(db, client => addMessage(client, session.id, id + '-answer', 'answer', JSON.stringify({ id, answers: visible })));
    publish(session.id);
    publishTurnStatus();
  }, true);
  run.guide = (input, save) => {
    flush(true);
    return queue(() => save(async () => {
      if (!turnStatus(run).turn) throw new HttpError(409, 'This turn cannot take guidance right now. Your draft is kept.');
      const offset = outputLength;
      const createdAt = Date.now();
      try { await run.steer(input); }
      catch (error) { throw new HttpError(409, String(error.message || error).slice(0, 500)); }
      return { offset, createdAt };
    }), true);
  };
  try {
    const adapter = adapters.get(session.agent);
    const source = !session.native_id && session.branch_parent && await getSession(session.branch_parent);
    await adapter.run({
      file: adapter.file, cwd, nativeId: session.native_id, prompt: input, signal: controller.signal, ...options, images,
      branchKind: session.branch_kind, forkSource: source?.native_id,
      ...(session.agent === 'codex' && session.codex_imported && { isolatedHome: join(data, 'codex-imports') }),
      ask,
      setSteer(steer) {
        const changed = Boolean(run.steer) !== Boolean(steer);
        run.steer = steer;
        if (changed) publishTurnStatus();
      },
      saveNative: id => queue(() => db.query('UPDATE sessions SET native_id=$1 WHERE id=$2', [id, session.id])),
      emit(type, value) {
        if (type === 'waiting' || type === 'background') {
          if ((run[type] || '') === value) return;
          run[type] = value;
          publishTurnStatus();
          return;
        }
        if (type === 'image') {
          const image = { ...value, id: randomUUID(), name: 'Generated image' };
          const markdown = '\n\n![Generated image](/api/attachments/' + image.id + ')\n\n';
          if (outputLength + markdown.length > 512_000) return;
          const position = imageCount++;
          openOutput();
          queue(() => addAttachment(db, session.id, output, image, position));
          appendOutput(markdown);
          return;
        }
        if (typeof value !== 'string' || !value) return;
        if (type === 'delta') appendOutput(value);
        else if (type === 'tool' && toolCount < 100 && (session.agent !== 'codex' || value !== lastTool)) {
          lastTool = value;
          flush(true);
          const limit = session.agent === 'codex' ? 500 : 8192;
          const description = value.length > limit ? value.slice(0, limit) + '…' : value;
          message(command + '-tool-' + ++toolCount, 'tool', description, outputLength);
        }
      },
    });
  } catch (error) {
    state = controller.signal.aborted ? 'interrupted' : 'failed';
    note = controller.signal.aborted ? controller.signal.reason.message : String(error.message || error).slice(0, 1600);
  } finally {
    questions.clear();
    run.steer = undefined;
    flush(true);
    await writes;
    if (writeError) {
      state = 'interrupted';
      note = 'The database connection failed. Check the saved part before continuing.';
    }
    try {
      await withTransaction(db, async client => {
        await getSession(session.id, client);
        if (note) await addMessage(client, session.id, command + '-notice', 'notice', note);
        await changeState(client, session.id, state);
      });
      publish(session.id);
    } finally {
      if (running.get(session.id) === run) running.delete(session.id);
    }
  }
}

async function answeredQuestion(session, id) {
  const answer = await one(db, 'SELECT text FROM messages WHERE session=$1 AND id=$2 AND role=$3', [session, id + '-answer', 'answer']);
  return Boolean(answer && JSON.parse(answer.text).answers);
}

function events(res, session, cursor) {
  sse(res);
  const connection = new AbortController();
  let dirty = false;
  let draining = false;
  function wake() {
    dirty = true;
    if (!draining) void drain();
  }
  async function drain() {
    draining = true;
    try {
      while (dirty && !res.destroyed && !res.writableEnded) {
        dirty = false;
        const { rows } = await db.query('SELECT seq, type, payload FROM events WHERE session=$1 AND seq>$2 ORDER BY seq LIMIT 501',
          [session, cursor]);
        if (res.destroyed) return;
        if (rows.length > 500) {
          res.end('event: reset\ndata: {}\n\n');
          return;
        }
        for (const event of rows) {
          cursor = event.seq;
          if (!res.write('id: ' + event.seq + '\ndata: ' + JSON.stringify(event) + '\n\n')) {
            await once(res, 'drain', { signal: connection.signal });
          }
        }
      }
    } catch {
      res.destroy();
    } finally {
      draining = false;
    }
  }
  const subscribers = listeners.get(session) || new Set();
  listeners.set(session, subscribers);
  subscribers.add(wake);
  const heartbeat = setInterval(() => {
    if (!res.writableNeedDrain) res.write(': heartbeat\n\n');
    wake();
  }, 15000);
  res.on('close', () => {
    connection.abort();
    clearInterval(heartbeat);
    subscribers.delete(wake);
    if (!subscribers.size) listeners.delete(session);
  });
  wake();
}

function imageMetadata(row) {
  return { id: row.id, name: row.name, mediaType: row.media_type, url: '/api/attachments/' + row.id };
}

async function serveVideo(req, res, id, mediaType) {
  const file = join(videoDirectory, id + '.' + videoExtensions.get(mediaType));
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, 'Video not found.');
  const size = info.size;
  const headers = { 'content-type': mediaType, 'cache-control': 'private, no-store', 'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range || (!range[1] && !range[2])) {
    res.writeHead(200, { ...headers, 'content-length': size });
    return pipeline(createReadStream(file), res);
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (!Number.isSafeInteger(start) || start > end || start >= size) {
    res.writeHead(416, { ...headers, 'content-range': 'bytes */' + size });
    return res.end();
  }
  res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  return pipeline(createReadStream(file, { start, end }), res);
}

async function projectImage(session, path) {
  if (!path || path.length > 4096 || !/\.(png|jpe?g|gif|webp)$/i.test(path)) {
    throw new HttpError(404, 'Image not found.');
  }
  const project = await getProject(session.project);
  const absolute = isAbsolute(path);
  const root = await directory(session.project === recentProject ? recentWorkspace : project.directory).catch(error => {
    if (!absolute) throw error;
  });
  const inside = candidate => {
    const child = relative(root, candidate);
    return child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
  };
  const requested = absolute ? resolve(path) : resolve(root, path);
  if (!root || !inside(requested)) {
    if (!absolute) throw new HttpError(404, 'Image not found.');
    return readLinkedReplyImage(db, session.id, path);
  }
  const file = await realpath(requested).catch(() => null);
  if (!file || !inside(file)) throw new HttpError(404, 'Image not found.');
  const image = await readReplyImage(file);
  if (!image) throw new HttpError(404, 'This image cannot be previewed.');
  return image;
}

function optionalChoice(value, pattern) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || (value !== '' && !pattern.test(value))) throw new HttpError(400, 'Invalid model or reasoning effort.');
  return value;
}

function machineIdentity() {
  return { name: hostname(), platform: process.platform, videoInput: true, scheduling: true, sessionRenaming: true,
    sessionBranches: true, quota: true, maxImages };
}

async function createBranch(source, id, kind) {
  const adapter = adapters.get(source.agent);
  const project = await getProject(source.project);
  if (!source.native_id || source.branch_kind === 'side' || !adapter?.file || !adapter.branch) {
    throw new HttpError(409, 'Run a turn in the source chat before forking or starting a side chat.');
  }
  if (source.archived || project.archived) throw new HttpError(409, 'Restore it from the archive first.');
  const cwd = await directory(source.project === recentProject ? recentWorkspace : project.directory);
  const cutoff = kind === 'fork' && (await one(db, 'SELECT COALESCE(max(position),0) AS position FROM messages WHERE session=$1', [source.id])).position;
  let nativeId;
  try {
    nativeId = await adapter.branch({ file: adapter.file, cwd, nativeId: source.native_id, model: source.model, kind,
      ...(source.codex_imported && { isolatedHome: join(data, 'codex-imports') }) });
  } catch (error) {
    throw new HttpError(409, String(error.message).slice(0, 800));
  }
  return withTransaction(db, async client => {
    const title = (kind === 'fork' ? 'Fork · ' : 'Side · ') + source.title.slice(0, 110);
    const session = await one(client, `
      INSERT INTO sessions(id,project,agent,native_id,title,state,updated,model,effort,codex_imported,branch_parent,branch_kind)
      VALUES ($1,$2,$3,$4,$5,'idle',$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, source.project, source.agent, nativeId, title, Date.now(), source.model, source.effort,
        Boolean(source.codex_imported), source.id, kind]);
    if (kind === 'fork') await client.query(`
      INSERT INTO messages(session,id,role,text,reply_offset,attachment_session,created_at,updated_at)
      SELECT $1,id,role,text,reply_offset,COALESCE(attachment_session,session),created_at,updated_at FROM messages
      WHERE session=$2 AND position<=$3 ORDER BY position`, [id, source.id, cutoff]);
    return session;
  });
}

const activeTasks = new Set();
const server = createServer(async (req, res) => {
  let temporaryVideo;
  try {
    await recovered;
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && pathname === '/api/pair/redeem') {
      return json(res, 200, { ...await pairing.redeem(req), ...machineIdentity() });
    }
    if (!sameSecret(req.headers.authorization, 'Bearer ' + token) && !pairing.authorized(req.headers.authorization)) {
      throw new HttpError(401, 'Execution host authorization failed.');
    }
    if (req.method === 'GET' && pathname === '/api/machine') {
      return json(res, 200, { ...machineIdentity(),
        agents: await inventoryFor(searchParams.get('refresh') === '1') });
    }
    if (req.method === 'GET' && pathname === '/api/quota') {
      const agent = searchParams.get('agent');
      if (!['codex', 'claude', 'agy'].includes(agent)) throw new HttpError(400, 'Choose an agent to query.');
      return json(res, 200, await readQuota(agent, searchParams.get('refresh') === '1'));
    }
    if (req.method === 'GET' && pathname === '/api/overview') {
      const [{ rows: projects }, { rows: sessions }, places, agents] = await Promise.all([
        db.query('SELECT id,directory,name,archived,pinned FROM projects WHERE id<>$1 ORDER BY position DESC', [recentProject]),
        db.query(`SELECT id,project,agent,native_id,title,state,updated,pinned,archived,model,effort,branch_parent,branch_kind
          FROM sessions ORDER BY updated DESC`),
        locations(), inventoryFor(searchParams.get('refresh') === '1'),
      ]);
      return json(res, 200, {
        machine: { ...machineIdentity(), root: home, locations: places },
        agents, projects, sessions: sessions.map(publicSession),
      });
    }
    const agentRoute = pathname.match(/^\/api\/agents\/([a-z]+)\/options$/);
    if (req.method === 'GET' && agentRoute && adapters.has(agentRoute[1])) {
      return json(res, 200, await agentOptions(agentRoute[1], searchParams.get('refresh') === '1'));
    }
    if (req.method === 'GET' && pathname === '/api/directories') {
      const path = await directory(searchParams.get('path') || home);
      const offset = numeric(searchParams.get('offset'));
      let candidates;
      try {
        candidates = (await readdir(path, { withFileTypes: true }))
          .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
          .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      } catch (error) {
        throw folderError(error);
      }
      const entries = await Promise.all(candidates.slice(offset, offset + 100).map(async entry => {
        const child = join(path, entry.name);
        if (entry.isSymbolicLink() && !(await stat(child).catch(() => null))?.isDirectory()) return null;
        return { name: entry.name, path: child };
      }));
      return json(res, 200, { path, parent: path === dirname(path) ? null : dirname(path), entries: entries.filter(Boolean),
        next: candidates.length > offset + 100 ? offset + 100 : null, locations: await locations() });
    }
    if (req.method === 'POST' && pathname === '/api/projects') {
      const input = await body(req);
      if (typeof input.path !== 'string' || !isAbsolute(input.path)) throw new HttpError(400, 'Choose a folder.');
      const path = await directory(input.path);
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : '';
      await db.query('INSERT INTO projects(id,directory,name) VALUES ($1,$2,$3) ON CONFLICT(directory) DO NOTHING',
        [randomUUID(), path, name || basename(path) || path]);
      return json(res, 201, await one(db, 'SELECT * FROM projects WHERE directory=$1', [path]));
    }
    const projectRoute = pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/preferences$/);
    if (req.method === 'POST' && projectRoute) {
      const input = await body(req);
      const archived = preference(input, 'archived');
      const pinned = preference(input, 'pinned');
      if (archived === null && pinned === null) throw new HttpError(400, 'Choose a pinned or archived state.');
      const result = await one(db, 'UPDATE projects SET archived=coalesce($1,archived), pinned=coalesce($2,pinned) WHERE id=$3 RETURNING *',
        [archived, pinned, projectRoute[1]]);
      if (!result) throw new HttpError(404, 'Project not found.');
      return json(res, 200, result);
    }
    if (req.method === 'POST' && pathname === '/api/sessions') {
      const input = await body(req);
      if (!(input.project === null || (typeof input.project === 'string' && /^[a-f0-9-]{36}$/.test(input.project)))) {
        throw new HttpError(400, 'Choose a valid project.');
      }
      if (!(await inventoryFor()).find(agent => agent.id === input.agent && agent.available)) {
        throw new HttpError(409, 'The agent is unavailable on this machine. Detect again.');
      }
      const result = await withTransaction(db, async client => {
        const project = await one(client, 'SELECT * FROM projects WHERE id=$1', [input.project ?? recentProject]);
        if (!project) throw new HttpError(404, 'Project not found.');
        if (project.archived) throw new HttpError(409, 'Restore the project first.');
        return one(client,
          "INSERT INTO sessions(id,project,agent,title,state,updated) VALUES ($1,$2,$3,'','idle',$4) RETURNING *",
          [randomUUID(), project.id, input.agent, Date.now()]);
      });
      return json(res, 201, publicSession(result));
    }
    const attachmentRoute = pathname.match(/^\/api\/attachments\/([a-f0-9-]{36})$/);
    if (req.method === 'GET' && attachmentRoute) {
      const image = await one(db, 'SELECT media_type,content FROM attachments WHERE id=$1', [attachmentRoute[1]]);
      if (!image) throw new HttpError(404, 'Attachment not found.');
      if (videoExtensions.has(image.media_type)) return await serveVideo(req, res, attachmentRoute[1], image.media_type);
      res.writeHead(200, { 'content-type': image.media_type, 'content-length': image.content.length,
        'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
      return res.end(image.content);
    }
    const scheduleRoute = pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/schedules(?:\/([a-f0-9-]{36}))?$/);
    if (scheduleRoute) {
      const [, sessionId, scheduleId] = scheduleRoute;
      const session = await getSession(sessionId);
      if (!session) throw new HttpError(404, 'Chat not found.');
      if (!scheduleId && req.method === 'GET') {
        const list = await db.query('SELECT * FROM scheduled_tasks WHERE session=$1 ORDER BY next_at,id', [sessionId]);
        return json(res, 200, { schedules: list.rows });
      }
      if (req.method === 'POST') {
        const input = await body(req);
        if (scheduleId) return json(res, 200, await setScheduleEnabled(db, sessionId, scheduleId, input.enabled));
        if (session.archived || (await getProject(session.project)).archived) throw new HttpError(409, 'Restore it from the archive first.');
        return json(res, 201, await createSchedule(db, sessionId, input));
      }
      throw new HttpError(405, 'Operation not supported.');
    }
    const route = pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(events|messages|send|answer|stop|preferences|image|branches))?$/);
    if (!route) throw new HttpError(404, 'Endpoint not found.');
    const [, id, action] = route;
    if (req.method === 'GET' && (!action || action === 'messages')) {
      const before = action ? numeric(searchParams.get('before')) : Number.MAX_SAFE_INTEGER;
      const page = await readHistory(db, id, before, !action, recentWorkspace);
      if (!page) throw new HttpError(404, 'Chat not found.');
      const { session, cursor, older, messages } = page;
      return json(res, 200, action ? { messages, older } : {
        session: publicSession(session), messages, older, cursor, includesRecentReplies: true,
      });
    }
    const session = await getSession(id);
    if (!session) throw new HttpError(404, 'Chat not found.');
    if (req.method === 'POST' && action === 'answer') {
      const input = await body(req, 32768);
      if (typeof input.id !== 'string' || !/^question-[a-f0-9-]{36}$/.test(input.id)) throw new HttpError(400, 'Invalid question.');
      const run = running.get(id);
      if (run?.answer) await run.answer(input.id, input.answers);
      else if (!await answeredQuestion(id, input.id)) throw new HttpError(409, 'This question has ended.');
      return json(res, 200, { id: input.id });
    }
    if (req.method === 'POST' && action === 'branches') {
      const input = await body(req);
      const { id: branchId, kind } = input;
      if (typeof branchId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(branchId)
          || !['fork', 'side'].includes(kind)) throw new HttpError(400, 'Invalid fork or side chat request.');
      let task = creatingBranches.get(branchId);
      if (!task) {
        task = (async () => await getSession(branchId) ?? await createBranch(session, branchId, kind))();
        creatingBranches.set(branchId, task);
      }
      try {
        const branch = await task;
        if (branch.branch_parent !== id || branch.branch_kind !== kind) throw new HttpError(409, 'This request ID is already in use.');
        return json(res, 201, publicSession(branch));
      } finally {
        if (creatingBranches.get(branchId) === task) creatingBranches.delete(branchId);
      }
    }
    if (req.method === 'GET' && action === 'image') {
      const { content, mediaType } = await projectImage(session, searchParams.get('path'));
      res.writeHead(200, { 'content-type': mediaType, 'content-length': content.length, 'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff' });
      return res.end(content);
    }
    if (req.method === 'GET' && action === 'events') {
      return events(res, id, numeric(req.headers['last-event-id'] || searchParams.get('after')));
    }
    if (req.method === 'POST' && action === 'preferences') {
      const input = await body(req);
      const pinned = preference(input, 'pinned');
      const archived = preference(input, 'archived');
      let title = null;
      if (Object.hasOwn(input, 'title')) {
        title = typeof input.title === 'string' ? input.title.trim() : '';
        if (!title || title.length > 120 || /[\r\n\u0000-\u001f\u2028\u2029]/.test(title)) {
          throw new HttpError(400, 'Titles must be a single line of 1 to 120 characters.');
        }
      }
      if (pinned === null && archived === null && title === null) throw new HttpError(400, 'Choose a chat setting to change.');
      const result = await one(db, `
        UPDATE sessions SET pinned=coalesce($1,pinned), archived=coalesce($2,archived),
          title=coalesce($3,title), custom_title=CASE WHEN $3 IS NOT NULL THEN 1 ELSE custom_title END
        WHERE id=$4 RETURNING *`, [pinned, archived, title, id]);
      return json(res, 200, publicSession(result));
    }
    if (req.method === 'POST' && action === 'send') {
      const input = await body(req, sendLimit);
      const images = readImages(input.images);
      const video = readVideo(input.video);
      if (adapters.get(session.agent)?.mediaInput === false && (images.length || video)) {
        throw new HttpError(400, 'This agent CLI accepts text messages only.');
      }
      if (typeof input.id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.id) ||
          typeof input.text !== 'string' || input.text.length > 32000 || (!input.text.trim() && !images.length && !video)) {
        throw new HttpError(400, 'Enter a message or add images or a video.');
      }
      const model = optionalChoice(input.model, /^[a-zA-Z0-9][a-zA-Z0-9_.:/\[\]-]{0,91}$/);
      const effort = optionalChoice(input.effort, /^(low|medium|high|xhigh|max|ultra|minimal|none)$/);
      const steer = input.steer;
      if (steer !== undefined && (typeof steer !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(steer))) {
        throw new HttpError(400, 'Invalid turn for guidance.');
      }
      if (steer && adapters.get(session.agent)?.steer === false) throw new HttpError(409, 'Wait for the current turn to finish before sending.');
      const key = createHash('sha256').update(JSON.stringify([input.text, model, effort, images.map(image =>
        [image.name, image.mediaType, image.content.toString('base64')]), ...(steer ? [steer] : []),
        ...(video ? [[video.name, video.mediaType, createHash('sha256').update(video.content).digest('hex')]] : [])])).digest('hex');
      function verifyPrevious(previous) {
        if (previous && (previous.request_key ? previous.request_key !== key : previous.text !== input.text || images.length || video)) {
          throw new HttpError(409, 'The same request cannot submit a different message.');
        }
        return Boolean(previous);
      }
      if (verifyPrevious(await commandAt(db, id, input.id))) {
        return json(res, 202, { id: input.id, session: publicSession(await getSession(id)) });
      }
      let prompt = input.text;
      if (video) {
        video.id = randomUUID();
        const path = join(videoDirectory, video.id + '.' + video.extension);
        mkdirSync(videoDirectory, { recursive: true, mode: 0o700 });
        const file = await open(path, 'wx', 0o600);
        temporaryVideo = path;
        try { await file.writeFile(video.content); } finally { await file.close(); }
        // Agent CLIs have no native video input, so pass only the file path on the execution machine.
        prompt += (prompt ? '\n\n' : '') + 'Attached video: ' + JSON.stringify(path);
      }
      async function checkArchive(client, current) {
        const selectedProject = await one(client, 'SELECT archived FROM projects WHERE id=$1', [current.project]);
        if (current.archived || selectedProject.archived) throw new HttpError(409, 'Restore it from the archive to keep sending.');
      }
      async function saveInput(client, role, offset = null, createdAt) {
        await client.query('INSERT INTO commands(session,id,text,request_key) VALUES ($1,$2,$3,$4)', [id, input.id, input.text, key]);
        const message = input.id + '-user';
        const attachments = images.map(image => ({ ...image, id: randomUUID() }));
        if (video) attachments.push({ ...video, content: Buffer.alloc(0) });
        await addMessage(client, id, message, role, input.text, attachments.map(image =>
          imageMetadata({ id: image.id, name: image.name, media_type: image.mediaType })), offset, createdAt);
        for (const [position, image] of attachments.entries()) {
          await addAttachment(client, id, message, image, position);
        }
      }
      if (steer) {
        const run = running.get(id);
        if (run?.command !== steer) throw new HttpError(409, 'The original turn has ended. Your draft is kept.');
        await run.guide({ id: input.id, text: prompt, images }, async deliver => {
          const duplicate = await withTransaction(db, async client => {
            const current = await getSession(id, client);
            if (verifyPrevious(await commandAt(client, id, input.id))) return true;
            await checkArchive(client, current);
            if (current.state !== 'running') throw new HttpError(409, 'The current turn has stopped or ended.');
            return false;
          });
          if (duplicate) return;
          const { offset, createdAt } = await deliver();
          await withTransaction(db, async client => {
            await getSession(id, client);
            await saveInput(client, 'steer', offset, createdAt);
          });
          temporaryVideo = undefined;
          publish(id);
        });
        return json(res, 202, { id: input.id });
      }
      const project = await getProject(session.project);
      const cwd = await directory(session.project === recentProject ? recentWorkspace : project.directory);
      const update = await withTransaction(db, async client => {
        const current = await getSession(id, client);
        if (verifyPrevious(await commandAt(client, id, input.id))) return null;
        await checkArchive(client, current);
        if (running.has(id) || ['running', 'stopping'].includes(current.state)) throw new HttpError(409, 'This chat is still running.');
        const options = { model: model ?? current.model, effort: effort ?? current.effort };
        const title = input.text.trim().split('\n')[0].slice(0, 60) || (images[0] ?? video).name;
        await client.query("UPDATE sessions SET model=$1,effort=$2,title=CASE WHEN title='' AND custom_title=0 THEN $3 ELSE title END WHERE id=$4",
          [options.model, options.effort, title, id]);
        await saveInput(client, 'user');
        await changeState(client, id, 'running');
        return { current, options };
      });
      if (update) {
        temporaryVideo = undefined;
        const run = { command: input.id, controller: new AbortController() };
        running.set(id, run);
        publish(id);
        const task = execute(update.current, run, prompt, cwd, update.options, images).catch(console.error);
        activeTasks.add(task);
        void task.finally(() => activeTasks.delete(task));
      }
      return json(res, 202, { id: input.id, session: publicSession(await getSession(id)) });
    }
    if (req.method === 'POST' && action === 'stop') {
      const run = running.get(id);
      const controller = run?.controller;
      if (controller && !controller.signal.aborted) {
        await withTransaction(db, async client => {
          const current = await getSession(id, client);
          if (current.state === 'running' && running.get(id) === run) await changeState(client, id, 'stopping');
        });
        controller.abort(new Error('Stopped this turn.'));
        publish(id);
      }
      return json(res, 200, { session: publicSession(await getSession(id)) });
    }
    throw new HttpError(404, 'Action not found.');
  } catch (error) {
    failure(res, error);
  } finally {
    if (temporaryVideo) await unlink(temporaryVideo).catch(() => {});
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
let stopScheduler;
server.listen(port, bind, async () => {
  recovered = recoverInterruptedTurns();
  await recovered;
  const address = server.address();
  const local = address.address === '0.0.0.0' ? '127.0.0.1' : address.address === '::' ? '[::1]'
    : address.family === 'IPv6' ? '[' + address.address + ']' : address.address;
  const base = 'http://' + local + ':' + address.port + '/api/sessions/';
  stopScheduler = startScheduler(db, async (session, id, prompt) => {
    const response = await fetch(base + session + '/send', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ id, text: prompt }), signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (response.status === 409) return false;
    if (response.status !== 202) throw Error('Scheduled turn was rejected.');
    return true;
  });
  console.log('Agent Host listening on ' + bind + ':' + port);
  process.send?.('ready');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close();
  server.closeAllConnections();
  for (const { controller } of running.values()) controller.abort(new Error('The execution host is shutting down.'));
  void Promise.allSettled([...activeTasks, stopScheduler?.()]).then(() => db.end());
});
