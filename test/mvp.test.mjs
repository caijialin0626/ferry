import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer, request } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { HttpError, failure, json } from '../src/common.mjs';
import { issuePairingCode, openPairing } from '../src/pairing.mjs';
import { agyWindows, claudeWindows } from '../src/quota.mjs';

test('Claude quota retains zero, model limits, and reset labels', () => {
  assert.deepEqual(claudeWindows(`
    Estimated cost: $0.0000
    Current session
                         0% used
    Resets 9:50pm (Asia/Shanghai)
    Current week (all models)
                         38% used
    Resets Nov 29 at 11pm (Asia/Shanghai)
    Current week (Sonnet)
                         <1% used
  `), [
    { label: '5 hours', usedPercent: 0, resetLabel: '9:50pm (Asia/Shanghai)' },
    { label: '7 days', usedPercent: 38, resetLabel: 'Nov 29 at 11pm (Asia/Shanghai)' },
    { label: '7 days · Sonnet', usedPercent: 1, approximate: true, resetLabel: '' },
  ]);
});

test('Antigravity quota distinguishes percentage and count limits and ignores disabled buckets', () => {
  const reset = '2026-11-23T12:00:00Z';
  assert.deepEqual(agyWindows({ '3p-5h': { remaining_fraction: 0, reset_time: reset },
    'gemini-weekly': { remaining_fraction: 1 }, 'credits': { remaining_amount: 12.5 },
    'disabled-5h': { remaining_fraction: 0.8, disabled: true }, 'unknown': { remaining_fraction: null } }), [
    { label: 'Claude / GPT · 5 hours', usedPercent: 100, resetsAt: Date.parse(reset) / 1000 },
    { label: 'Gemini · 7 days', usedPercent: 0, resetsAt: null },
    { label: 'credits', remainingAmount: 12.5, resetsAt: null },
  ]);
});


function freePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(() => resolve(String(port)));
    });
  });
}

function boot(script, env, expectedOrigin) {
  const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  return new Promise((resolve, reject) => {
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', () => reject(new Error(script + ' exited: ' + output)));
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      if (expectedOrigin && String(chunk).includes('listening on ' + expectedOrigin)) {
        resolve({ child, url: expectedOrigin });
        return;
      }
      const url = String(chunk).match(/listening on (?:http:\/\/)?(127\.0\.0\.1:\d+)/)?.[1];
      if (url) resolve({ child, url: 'http://' + url });
    });
  });
}

test('execution machines require an authorized, one-use pairing code and survive restarts', { timeout: 15000 }, async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'ferry-pair-'));
  const hostData = join(tmp, 'host');
  const webData = join(tmp, 'web');
  const hostToken = 'test-host-' + randomUUID();
  const login = 'test-login-' + randomUUID();
  let pairing = await openPairing(hostData);
  let web;
  let forwardedCredential;
  const name = '配对测试执行机';
  const host = createHttpServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/pair/redeem') {
        assert.equal(req.headers.authorization, undefined);
        return json(res, 200, { ...await pairing.redeem(req), name });
      }
      if (!pairing.authorized(req.headers.authorization)) throw new HttpError(401, 'Unauthorized');
      forwardedCredential = req.headers.authorization;
      return json(res, 200, { name, agents: [] });
    } catch (error) {
      failure(res, error);
    }
  });
  t.after(async () => {
    if (web && web.child.exitCode === null && web.child.signalCode === null) {
      web.child.kill();
      await once(web.child, 'exit');
    }
    await new Promise(resolve => host.close(resolve));
    await rm(tmp, { recursive: true, force: true });
  });
  host.listen(0, '127.0.0.1');
  await once(host, 'listening');
  const address = 'http://127.0.0.1:' + host.address().port;
  const port = await freePort();
  const env = { FERRY_WEB_PORT: port, FERRY_WEB_ORIGIN: 'http://127.0.0.1:' + port, FERRY_WEB_LOGIN_TOKEN: login,
    FERRY_TAILSCALE_LOGIN: '', FERRY_HOST_TOKEN: hostToken, FERRY_HOST_URL: 'http://127.0.0.1:1',
    FERRY_EXTRA_HOSTS: '[]', FERRY_WEB_DATA: webData };
  web = await boot('src/web.mjs', env);
  let cookie = '';
  async function call(path, status, data, from = web.url) {
    const response = await fetch(web.url + '/api/' + path, {
      method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000),
      headers: { origin: from, cookie, 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const resource = await response.json();
    assert.equal(response.status, status, JSON.stringify(resource));
    if (path === 'login') cookie = response.headers.get('set-cookie').split(';')[0];
    return resource;
  }
  const { stdout } = await promisify(execFile)(process.execPath, ['src/pair.mjs'], {
    env: { ...process.env, FERRY_HOST_DATA: hostData },
  });
  const code = stdout.match(/Pairing code: ([0-9]{8})/)[1];
  const wrong = code === '00000000' ? '00000001' : '00000000';
  await call('machines/pair', 401, { address, code });
  await call('login', 200, { code: login });
  await call('machines/pair', 403, { address, code }, 'http://elsewhere.invalid');
  await call('machines/pair', 403, { address, code: wrong });
  assert.deepEqual((await call('machines?refresh=1', 200)).machines.map(machine => machine.id), ['local']);

  const expired = await issuePairingCode(hostData);
  await utimes(join(hostData, 'pairing', 'invitations', expired), new Date(0), new Date(0));
  await call('machines/pair', 403, { address, code: expired });
  const machine = await call('machines/pair', 201, { address, code });
  assert.deepEqual(Object.keys(machine), ['id', 'name']);
  assert.equal(machine.name, name);
  await call('machines/pair', 409, { address: address + '/', code });
  await call('pair/redeem?machine=' + machine.id, 404, { code });
  const list = await call('machines', 200);
  assert.ok(list.machines.some(entry => entry.id === machine.id && entry.online));
  assert.notEqual(forwardedCredential, 'Bearer ' + hostToken);
  assert.equal(list.machines.some(entry => 'token' in entry), false);

  const redeem = code => fetch(address + '/api/pair/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  });
  assert.equal((await redeem(code)).status, 403);
  const concurrent = await issuePairingCode(hostData);
  const results = await Promise.all([redeem(concurrent), redeem(concurrent)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 403]);
  assert.equal((await redeem(wrong)).status, 403);
  assert.equal((await redeem(wrong)).status, 403);
  assert.equal((await redeem(wrong)).status, 429);

  pairing = await openPairing(hostData);
  web.child.kill();
  await once(web.child, 'exit');
  web = await boot('src/web.mjs', env);
  assert.deepEqual(await call('machines', 200), list);
  assert.equal((await call('overview?machine=' + machine.id, 200)).name, name);
});

test('host stores projects, streamed turns, attachments and native resume', {
  timeout: 24000,
}, async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'ferry-test-'));
  const root = join(tmp, 'work');
  const directory = join(root, '项目 1');
  await mkdir(directory, { recursive: true });
  await symlink(tmp, join(root, 'outside'), 'dir');
  const file = join(tmp, 'mock-claude');
  await writeFile(file, `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const args=process.argv.slice(2);
if(args.includes('--version')){ console.log('fixture-1.0'); process.exit(0); }
const resume=args.includes('--resume');
const fork=args.includes('--fork-session');
const sid=args[args.indexOf(resume&&!fork?'--resume':'--session-id')+1];
const line=value=>console.log(JSON.stringify(value));
if(args.includes('--no-session-persistence')) {
  process.stdin.once('data',data=>{
    const {request_id}=JSON.parse(String(data));
    const models=[
      {value:'default',resolvedModel:'claude-opus-5-5',displayName:'Default',description:'Opus 5.5 · Default'},
      {value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus',description:'Opus 5.5 · General',supportedEffortLevels:['low','high']},
      {value:'fable',resolvedModel:'claude-fable-5-2',displayName:'Fable',description:'Fable 5.2 · Complex tasks',supportedEffortLevels:['high']}
    ];
    line({type:'control_response',response:{request_id,subtype:'success',response:{models}}});
  });
  return;
}
let waiting=false;
let background=false;
createInterface({input:process.stdin}).on('line',raw=>{
  const item=JSON.parse(raw);
  if(item.type==='control_response') {
    const {request_id,response}=item.response;
    if(request_id!=='question-fixture'||response.behavior!=='allow'||response.updatedInput.answers['选哪种颜色？']!=='蓝色') process.exit(7);
    line({type:'result',session_id:sid,result:'答案是蓝色。',is_error:false});
    return;
  }
  let input=item.message.content.find(block=>block.type==='text')?.text ?? '';
  const reply=text=>line({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}});
  const done=()=>line({type:'result',session_id:sid,result:'done',is_error:false});
  if(waiting) {
    if(item.priority!=='next') process.exit(5);
    reply('引导已收到。');
    done();
    if(background) line({type:'system',subtype:'background_tasks_changed',tasks:[]});
    return;
  }
  line({type:'system',subtype:'init',permissionMode:'bypassPermissions',session_id:sid});
  if(input==='stop') {setInterval(()=>{},1000);return;}
  if(input.startsWith('reply-image:')) {
    const image = input.slice('reply-image:'.length);
    reply('![外部图片](' + encodeURI(image) + ')');
    done();
    return;
  }
  if(input==='question-test') {
    if(args[args.indexOf('--permission-prompt-tool')+1]!=='stdio') process.exit(8);
    line({type:'control_request',request_id:'question-fixture',request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[
      {question:'选哪种颜色？',header:'颜色',options:[{label:'蓝色'},{label:'红色'}],multiSelect:false}
    ]}}});
    return;
  }
  if(input==='steer-test') { waiting=true; reply('先看。'); return; }
  if(input==='background-test') {
    waiting=background=true;
    line({type:'system',subtype:'background_tasks_changed',tasks:[{task_id:'watch',task_type:'local_bash'}]});
    reply('后台任务已启动。');
    done();
    return;
  }
  if(input==='many-tools') {
    for(let i=0;i<80;i++) line({type:'assistant',message:{content:[{type:'tool_use',name:'tool-'+i}]}});
    setInterval(()=>{},1000);
    return;
  }
  if(input==='timeline') {
    line({type:'stream_event',event:{type:'message_start',message:{id:'fixture-first'}}});
    reply('先看🔎。');
    const bash={type:'tool_use',id:'fixture-bash',name:'Bash',input:{command:'printf %s '+ 'x'.repeat(700)}};
    line({type:'assistant',message:{id:'fixture-first',content:[{type:'text',text:'先看🔎。'},bash,bash,{type:'tool_use',name:'Read',input:{file_path:'src/fixture.js'}}]}});
    line({type:'stream_event',event:{type:'message_start',message:{id:'fixture-second'}}});
    reply('再说明结果。');
    line({type:'assistant',message:{id:'fixture-second',content:[{type:'text',text:'再说明结果。'}]}});
    line({type:'assistant',message:{id:'fixture-complete-only',content:[{type:'text',text:'最后列出 \x60结果\x60。'}]}});
    done();
    return;
  }
  if(input==='branch-check') {
    const tools=args.indexOf('--tools');
    if(fork && args[args.indexOf('--resume')+1]===sid) process.exit(6);
    reply((fork?'fork:':'resume:') + (tools>=0&&args[tools+1]===''?'side':'regular'));
    done();
    return;
  }
  if(input.startsWith('batch-images')) {
    reply('images: ' + item.message.content.filter(block => block.type === 'image').length + ' · ' + input);
    done();
    return;
  }
  if(item.message.content.some(block=>block.type==='image')) {
    if(args[args.indexOf('--model')+1]!=='sonnet'||args[args.indexOf('--effort')+1]!=='high') process.exit(4);
    input='image-present';
  }
  setTimeout(()=>reply((resume?'resume:':'start:')+input),70);
  setTimeout(done,150);
});

`, { mode: 0o700 });
  const agy = join(tmp, 'mock-agy');
  await writeFile(agy, `#!/usr/bin/env node
const args=process.argv.slice(2);
const line=x=>console.log(JSON.stringify(x));
if(args.includes('--version')) { console.log('1.5.15'); process.exit(0); }
if(args.includes('models')) {
  require('node:fs').appendFileSync(process.argv[1] + '.calls', 'x');
  console.log('gemini-fixture-high\\tGemini Fixture (High)'); process.exit(0);
}
if(!args.includes('--dangerously-skip-permissions'))process.exit(4);
require('node:readline').createInterface({input:process.stdin}).on('line',raw=>{
  const msg=JSON.parse(raw);
  const resume=args.indexOf('--conversation');
  const sid=resume<0?'agy-native-fixture':args[resume+1];
  line({event:'init',conversation_id:sid,init:{permission_mode:'always-proceed'}});
  line({event:'step_update',step_update:{step_type:'tool',step_index:1,state:'ACTIVE',tool_name:'run_command'}});
  line({event:'step_update',step_update:{step_type:'tool',step_index:1,state:'DONE',tool_name:'run_command',tool_info:{parameters:{CommandLine:'pwd'}}}});
  const text=(resume<0?'start:':'resume:')+msg.message.content;
  line({event:'step_update',step_update:{step_type:'agent_response',text_delta:text}});
  line({event:'result',result:{status:'SUCCESS',response:text,conversation_id:sid}});
});
`, { mode: 0o700 });
  const token = 'test-host-' + randomUUID();
  const code = 'test-login-' + randomUUID();
  const host = await boot('src/host.mjs', { FERRY_HOST_PORT: await freePort(), FERRY_HOST_TOKEN: token, FERRY_HOST_DATA: join(tmp, 'state'),
    FERRY_CLAUDE_BIN: file, FERRY_AGY_BIN: agy,
    FERRY_CODEX_BIN: join(tmp, 'not-installed'), FERRY_MACHINE_NAME: 'old configured label' });
  t.after(() => host.child.kill());
  const invitation = await issuePairingCode(join(tmp, 'state'));
  const redeemed = await fetch(host.url + '/api/pair/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: invitation }),
  });
  assert.equal(redeemed.status, 200);
  const paired = await redeemed.json();
  const pairedHost = await fetch(host.url + '/api/machine', {
    headers: { authorization: 'Bearer ' + paired.token },
  });
  assert.equal(pairedHost.status, 200);
  assert.equal((await pairedHost.json()).name, hostname());
  const webPort = await freePort();
  const web = await boot('src/web.mjs', { FERRY_WEB_PORT: webPort, FERRY_WEB_LOGIN_TOKEN: code, FERRY_HOST_TOKEN: token,
    FERRY_HOST_URL: host.url, FERRY_WEB_ORIGIN: 'http://127.0.0.1:' + webPort, FERRY_WEB_DATA: join(tmp, 'web'),
    FERRY_EXTRA_HOSTS: JSON.stringify([{ id: 'secondary', url: host.url, token }]) });
  t.after(() => web.child.kill());
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const origin = web.url;
  const raw = async (path, data, { cookie = '', from = origin, headers = {} } = {}) => fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { origin: from, cookie, 'content-type': 'application/json', ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(4500),
  });
  assert.equal((await raw('/api/overview')).status, 401);
  assert.equal((await raw('/api/login', { code }, { from: 'http://example.invalid' })).status, 403);
  const response = await raw('/api/login', { code });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  async function call(path, data, status = 200) {
    const response = await raw('/api/' + path, data, { cookie });
    const resource = await response.json();
    assert.equal(response.status, status, JSON.stringify(resource));
    return resource;
  }
  const initial = await call('overview');
  assert.equal(initial.machine.name, hostname());
  assert.deepEqual(initial.agents.map(a => a.available), [false, true, true]);
  assert.equal(initial.agents.find(a => a.id === 'agy').mediaInput, false);
  assert.equal((await call('agents/agy/options')).models[1].id, 'gemini-fixture-high');
  const { machines } = await call('machines?refresh=1');
  assert.deepEqual(machines.map(({ id, name, online }) => [id, name, online]), [
    ['local', hostname(), true], ['secondary', hostname(), true],
  ]);
  assert.equal((await call('overview')).machine.maxImages, 6);
  await call('agents/agy/options');
  assert.equal(await readFile(agy + '.calls', 'utf8'), 'x');
  await call('agents/agy/options?refresh=1');
  assert.equal(await readFile(agy + '.calls', 'utf8'), 'xx');
  const catalog = await call('agents/claude/options');
  assert.deepEqual(catalog.models.map(({ id, name }) => [id, name]), [
    ['', 'Default · Opus 5.5'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-fable-5-2', 'Fable 5.2'],
  ]);
  assert.deepEqual(catalog.models[2].efforts.map(effort => effort.id), ['high']);
  assert.ok((await call('directories?path=' + encodeURIComponent(root))).entries.some(entry => entry.name === '项目 1'));
  assert.equal((await call('directories?path=' + encodeURIComponent(join(root, 'outside')))).path, await realpath(tmp));
  const disk = await call('directories?path=' + encodeURIComponent('/'));
  assert.equal(disk.parent, null);
  assert.ok(disk.locations.some(location => location.name === 'Home'));
  const project = await call('projects', { path: directory }, 201);
  assert.equal((await call('projects', { path: directory }, 201)).id, project.id);
  assert.ok((await call('projects/' + project.id + '/preferences', { pinned: true })).pinned > 0);
  assert.ok((await call('overview')).projects.find(item => item.id === project.id).pinned > 0);
  const session = await call('sessions', { project: project.id, agent: 'claude' }, 201);
  const url = 'sessions/' + session.id;
  const stream = await raw('/api/' + url + '/events?after=0', undefined, { cookie });
  const id = randomUUID();
  const beforeSend = Date.now();
  await call(url + '/send', { id, text: 'hello' }, 202);
  await call(url + '/send', { id, text: 'hello' }, 202);
  async function finished(path = url) {
    for (let tryNo = 0; tryNo < 60; tryNo++) {
      const snapshot = await call(path);
      if (!['running', 'stopping'].includes(snapshot.session.state)) return snapshot;
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    throw Error('The session did not settle');
  }
  const reader = stream.body.getReader();
  let events = '';
  while (!events.includes('start:hello')) {
    const { value, done } = await reader.read();
    if (done) break;
    events += Buffer.from(value).toString();
  }
  await reader.cancel();
  assert.match(events, /start:hello/);
  const first = await finished();
  assert.equal(first.session.state, 'idle');
  assert.equal(first.messages.filter(m => m.role === 'user').length, 1);
  const messagesById = new Map(first.messages.map(message => [message.id, message]));
  const liveMessages = events.split('\n').slice(0, -1).filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6))).filter(event => event.type === 'message');
  for (const suffix of ['-user', '-assistant']) {
    const message = messagesById.get(id + suffix);
    assert.ok(Number.isSafeInteger(message.created_at) && message.created_at >= beforeSend && message.created_at <= Date.now());
    assert.equal(liveMessages.find(event => event.payload.id === message.id)?.payload.created_at, message.created_at);
  }
  assert.match(first.session.native_id, /^[a-f0-9-]{36}$/);
  await call(url + '/send', { id: randomUUID(), text: 'next' }, 202);
  const resumed = await finished();
  assert.equal(resumed.session.native_id, first.session.native_id);
  assert.ok(resumed.messages.some(m => m.text === 'resume:next'));
  const pin = { pinned: true, agent: 'claude', nativeId: randomUUID(), cwd: directory, title: 'Pinned fixture',
    messages: [{ role: 'user', text: 'Earlier question' }, { role: 'agent', text: 'Earlier reply' }] };
  async function importFixture(record) {
    const child = spawn(process.execPath, ['scripts/ferry.mjs', 'import-pin'], {
      env: { ...process.env, XDG_DATA_HOME: tmp, FERRY_HOST_DATA: join(tmp, 'state') },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const exited = once(child, 'exit');
    child.stdin.end(JSON.stringify(record));
    return (await exited)[0];
  }
  assert.equal(await importFixture({ ...pin, pinned: false }), 1);
  assert.equal(await importFixture(pin), 0);
  assert.equal(await importFixture(pin), 0);
  const imported = (await call('overview')).sessions.filter(item => item.native_id === pin.nativeId);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].pinned, 1);
  assert.equal(imported[0].project, project.id);
  const pinPath = 'sessions/' + imported[0].id;
  const visible = (await call(pinPath)).messages.map(({ role, text }) => ({ role, text }));
  assert.deepEqual(visible, pin.messages);
  await call(pinPath + '/send', { id: randomUUID(), text: 'continue-pin' }, 202);
  const continued = await finished(pinPath);
  assert.equal(continued.session.native_id, pin.nativeId);
  assert.ok(continued.messages.some(m => m.text === 'resume:continue-pin'));

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await writeFile(join(directory, '结果.png'), Buffer.from(png, 'base64'));
  await writeFile(join(root, 'outside.png'), Buffer.from(png, 'base64'));
  await symlink(join(root, 'outside.png'), join(directory, 'link.png'));
  const resultImage = (path, machine = 'secondary') => raw('/api/' + url + '/image?' + new URLSearchParams({ path, machine }), undefined, { cookie });
  const resultPreview = await resultImage('结果.png');
  assert.equal(resultPreview.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await resultPreview.arrayBuffer()).toString('base64'), png);
  assert.equal((await resultImage('../outside.png')).status, 404);
  assert.equal((await resultImage('link.png')).status, 404);
  await call(url + '/send', { id: randomUUID(), text: '', model: 'sonnet', effort: 'high',
    images: [{ name: 'fixture.png', mediaType: 'image/png', data: png }] }, 202);
  const withImage = await finished();
  assert.equal(withImage.session.effort, 'high');
  assert.ok(withImage.messages.some(m => m.text === 'resume:image-present'));
  const image = withImage.messages.find(m => m.images)?.images[0];
  assert.equal(image.name, 'fixture.png');
  const download = await raw(image.url, undefined, { cookie });
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await download.arrayBuffer()).toString('base64'), png);
  const referenced = join(root, '测试图 #1.png');
  await writeFile(referenced, Buffer.from(png, 'base64'));
  assert.equal((await resultImage(referenced)).status, 404);
  await call(url + '/send', { id: randomUUID(), text: 'reply-image:' + referenced }, 202);
  await finished();
  const previews = await Promise.all([resultImage(referenced), resultImage(referenced)]);
  for (const preview of previews) {
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await preview.arrayBuffer()).toString('base64'), png);
  }
  await unlink(referenced);
  const savedPreview = await resultImage(referenced);
  assert.equal(Buffer.from(await savedPreview.arrayBuffer()).toString('base64'), png);
  assert.equal((await resultImage(join(root, 'outside.png'))).status, 404);
  const clip = Buffer.alloc(8 * 1024 * 1024);
  Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex').copy(clip);
  const video = { name: 'clip.mp4', mediaType: 'video/mp4', data: clip.toString('base64') };
  const videoId = randomUUID();
  const imageBytes = Buffer.alloc(2 * 1024 * 1024);
  Buffer.from(png, 'base64').copy(imageBytes);
  const imageData = imageBytes.toString('base64');
  const pictures = Array.from({ length: 6 }, (_, index) => ({ name: 'batch-' + index + '.png', mediaType: 'image/png', data: imageData }));
  await call(url + '/send', { id: randomUUID(), text: 'over limit', images: Array.from({ length: 7 }, () =>
    ({ name: 'extra.png', mediaType: 'image/png', data: png })) }, 400);
  const batch = { id: videoId, text: 'batch-images', images: pictures, video };
  await call(url + '/send', batch, 202);
  await call(url + '/send', batch, 202);
  const withVideo = await finished();
  const batchHistory = withVideo.messages.find(m => m.id === videoId + '-user').images;
  assert.deepEqual(batchHistory.map(image => image.name), [...pictures.map(image => image.name), 'clip.mp4']);
  const historyClip = batchHistory.at(-1);
  assert.match(withVideo.messages.find(m => m.id === videoId + '-assistant').text, /^images: 6/);
  assert.equal(historyClip.name, video.name);
  assert.equal(withVideo.messages.filter(m => m.id === videoId + '-user').length, 1);
  assert.match(withVideo.messages.find(m => m.id === videoId + '-assistant').text, /video-attachments/);
  const partial = await raw(historyClip.url, undefined, { cookie, headers: { range: 'bytes=4-7' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 4-7/' + clip.length);
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), 'ftyp');
  const forkId = randomUUID();
  const createFork = () => call(url + '/branches', { id: forkId, kind: 'fork' }, 201);
  const [fork, duplicate] = await Promise.all([createFork(), createFork()]);
  assert.equal(fork.id, forkId);
  assert.equal(duplicate.id, forkId);
  assert.equal(fork.branch_parent, session.id);
  const forkPath = 'sessions/' + forkId;
  const forkHistory = await call(forkPath);
  assert.deepEqual(forkHistory.messages.find(m => m.id === videoId + '-user').images, batchHistory);
  assert.equal(forkHistory.messages.find(m => m.id === videoId + '-user').created_at,
    withVideo.messages.find(m => m.id === videoId + '-user').created_at);
  assert.equal(forkHistory.cursor, 0);
  await call(forkPath + '/send', { id: randomUUID(), text: 'branch-check' }, 202);
  const forkReply = await finished(forkPath);
  assert.ok(forkReply.session.native_id);
  assert.notEqual(forkReply.session.native_id, first.session.native_id);
  assert.equal(forkReply.messages.at(-1).text, 'fork:regular');
  await call(forkPath + '/send', { id: randomUUID(), text: 'branch-check' }, 202);
  const continuedFork = await finished(forkPath);
  assert.equal(continuedFork.session.native_id, forkReply.session.native_id);
  assert.equal(continuedFork.messages.at(-1).text, 'resume:regular');
  const sideId = randomUUID();
  const side = await call(url + '/branches', { id: sideId, kind: 'side' }, 201);
  assert.equal(side.branch_kind, 'side');
  assert.deepEqual((await call('sessions/' + sideId)).messages, []);
  await call('sessions/' + sideId + '/send', { id: randomUUID(), text: 'branch-check' }, 202);
  const sideReply = await finished('sessions/' + sideId);
  assert.ok(sideReply.session.native_id);
  assert.notEqual(sideReply.session.native_id, first.session.native_id);
  assert.equal(sideReply.messages.at(-1).text, 'fork:side');
  assert.equal((await call(url)).messages.some(m => m.text === 'branch-check'), false);
  await call(url + '/send', { id: randomUUID(), text: 'timeline' }, 202);
  const timeline = (await finished()).messages.slice(-4);
  assert.deepEqual(timeline.map(message => message.role), ['user', 'agent', 'tool', 'tool']);
  assert.equal(timeline[1].text, '先看🔎。\n\n再说明结果。\n\n最后列出 `结果`。');
  assert.equal(timeline[2].text, 'Bash · printf %s ' + 'x'.repeat(700));
  assert.equal(timeline[3].text, 'Read · src/fixture.js');
  assert.deepEqual(timeline.slice(2).map(message => message.reply_offset), ['先看🔎。'.length, '先看🔎。'.length]);
  const turn = randomUUID();
  const guided = { id: randomUUID(), text: '换个方向', steer: turn };
  await call(url + '/send', { id: turn, text: 'steer-test' }, 202);
  for (let attempt = 0; attempt < 60; attempt++) {
    const snapshot = await call(url);
    if (snapshot.messages.some(item => item.id === turn + '-assistant' && item.text === '先看。')) {
      assert.equal(snapshot.session.activeTurn, turn);
      break;
    }
    assert.ok(attempt < 59, 'the Claude fixture started streaming');
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  await call(url + '/send', { ...guided, steer: randomUUID() }, 409);
  await Promise.all([call(url + '/send', guided, 202), call(url + '/send', guided, 202)]);
  const afterGuide = await finished();
  const guides = afterGuide.messages.filter(message => message.role === 'steer');
  assert.deepEqual(guides.map(({ text, reply_offset }) => [text, reply_offset]), [['换个方向', '先看。'.length]]);
  assert.equal(afterGuide.session.native_id, first.session.native_id);
  assert.equal(afterGuide.messages.find(message => message.id === turn + '-assistant').text, '先看。引导已收到。');
  await call(url + '/send', { ...guided, id: randomUUID() }, 409);
  await call(url + '/send', guided, 202);
  const backgroundTurn = randomUUID();
  await call(url + '/send', { id: backgroundTurn, text: 'background-test' }, 202);
  for (let attempt = 0; attempt < 60; attempt++) {
    const snapshot = await call(url);
    if (snapshot.session.waiting === 'Claude replied; background tasks are still running') {
      assert.equal(snapshot.session.activeTurn, backgroundTurn);
      break;
    }
    assert.ok(attempt < 59, 'Claude reported its background task after returning a result');
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  await call(url + '/send', { id: randomUUID(), text: '后台进度？', steer: backgroundTurn }, 202);
  const backgroundReply = await finished();
  assert.equal(backgroundReply.session.state, 'idle');
  assert.equal(backgroundReply.session.activeTurn, null);
  assert.equal(backgroundReply.messages.find(message => message.id === backgroundTurn + '-assistant').text,
    '后台任务已启动。\n\n引导已收到。');
  await call(url + '/send', { id: randomUUID(), text: 'question-test' }, 202);
  let question;
  for (let attempt = 0; attempt < 60; attempt++) {
    const snapshot = await call(url);
    question = snapshot.messages.find(message => message.role === 'question');
    if (question) {
      assert.equal(snapshot.session.waiting, 'Waiting for your answer');
      assert.equal(snapshot.session.activeTurn, null);
      break;
    }
    assert.ok(attempt < 59, 'Claude asked the user a blocking question');
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  const answer = { id: question.id, answers: { 0: ['蓝色'] } };
  await call(url + '/answer', { id: question.id, answers: {} }, 400);
  await Promise.all([call(url + '/answer', answer), call(url + '/answer', answer)]);
  const afterQuestion = await finished();
  const receipts = afterQuestion.messages.filter(message => message.role === 'answer');
  assert.deepEqual(receipts.map(message => JSON.parse(message.text)), [answer]);
  assert.ok(afterQuestion.messages.some(message => message.role === 'agent' && message.text === '答案是蓝色。'));
  await call(url + '/send', { id: randomUUID(), text: 'stop' }, 202);
  await call(url + '/stop', {});
  assert.equal((await finished()).session.state, 'interrupted');

  {
    const scheduledSession = await call('sessions', { project: project.id, agent: 'claude' }, 201);
    const scheduledUrl = 'sessions/' + scheduledSession.id;
    const triggerAt = Date.now() + 300;
    const task = await call(scheduledUrl + '/schedules', { prompt: '按时运行', startAt: triggerAt }, 201);
    const recurring = await call(scheduledUrl + '/schedules', { prompt: '定期检查', startAt: Date.now() + 60_000, every: 10 }, 201);
    const paused = await call(scheduledUrl + '/schedules/' + recurring.id, { enabled: false });
    assert.equal(paused.state, 'paused');
    const resumed = await call(scheduledUrl + '/schedules/' + recurring.id, { enabled: true });
    assert.equal(resumed.state, 'scheduled');
    for (let attempt = 0; attempt < 30; attempt++) {
      const upcoming = (await call(scheduledUrl + '/schedules')).schedules.find(item => item.id === task.id);
      if (upcoming.state === 'done') {
        assert.ok(upcoming.last_at >= triggerAt);
        break;
      }
      assert.ok(attempt < 29, 'scheduled turn did not trigger');
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    const snapshot = await call(scheduledUrl);
    assert.equal(snapshot.messages.filter(m => m.role === 'user' && m.text === '按时运行').length, 1);
  }

  const pinned = await call(url + '/preferences', { pinned: true });
  assert.ok(pinned.pinned > 0);
  await call('projects/' + project.id + '/preferences', { archived: true });
  await call(url + '/send', { id: randomUUID(), text: 'archived' }, 409);
  const archive = await call('overview');
  assert.ok(archive.projects.find(item => item.id === project.id).archived > 0);
  assert.equal((await call(url)).session.native_id, first.session.native_id);
  await call('projects/' + project.id + '/preferences', { archived: false });
  assert.equal((await call('projects/' + project.id + '/preferences', { pinned: false })).pinned, 0);
  assert.equal((await call(url + '/preferences', { pinned: false })).pinned, 0);
  const independent = await call('sessions', { project: null, agent: 'claude' }, 201);
  assert.equal(independent.project, null);
  assert.ok((await call('overview')).sessions.some(item => item.id === independent.id && item.project === null));
  const independentUrl = 'sessions/' + independent.id;
  const prefs = independentUrl + '/preferences';
  await call(prefs, { title: '  ' }, 400);
  await call(prefs, { title: 'x'.repeat(121) }, 400);
  assert.equal((await call(prefs, { title: ' 新对话 ' })).title, '新对话');
  const answers = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID();
    await call(independentUrl + '/send', { id, text: 'reply-' + i }, 202);
    const snapshot = await finished(independentUrl);
    assert.equal(snapshot.session.title, '新对话');
    answers.push(snapshot.messages.find(m => m.id === id + '-assistant'));
  }
  const active = randomUUID();
  await call(independentUrl + '/send', { id: active, text: 'many-tools' }, 202);
  let paged;
  for (let attempt = 0; attempt < 60; attempt++) {
    paged = await call(independentUrl);
    if (paged.messages.filter(item => item.role === 'tool').length === 80) break;
    assert.ok(attempt < 59, 'the tool-only tail was saved');
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  assert.equal(paged.session.state, 'running');
  assert.deepEqual(paged.messages.filter(item => item.role === 'agent'), answers.slice(1));
  assert.equal(paged.messages[0].position, paged.older);
  const olderPage = await call(independentUrl + '/messages?before=' + paged.older);
  assert.ok(olderPage.messages.some(item => item.id === answers[0].id));
  assert.ok(olderPage.messages.every(item => item.position < paged.older));
  assert.equal(olderPage.older, null);
  assert.equal((await call(prefs, { title: '  较长任务  ' })).title, '较长任务');
  assert.equal((await call(independentUrl)).session.updated, paged.session.updated);
  assert.equal((await call('overview')).sessions.find(item => item.id === independent.id).title, '较长任务');
  await call(independentUrl + '/stop', {});
  await finished(independentUrl);
  const antigravity = await call('sessions', { project: null, agent: 'agy' }, 201);
  const agyUrl = 'sessions/' + antigravity.id;
  const native = async text => {
    await call(agyUrl + '/send', { id: randomUUID(), text, model:'gemini-fixture-high' }, 202);
    const result = await finished(agyUrl);
    assert.equal(result.session.native_id, 'agy-native-fixture');
    assert.equal(result.session.state, 'idle');
    return result.messages;
  };
  const agyMessages = await native('hello');
  assert.deepEqual(agyMessages.filter(m => m.role === 'tool').map(m => m.text), ['Shell · pwd']);
  assert.equal(agyMessages.at(-1).text, 'start:hello');
  assert.equal((await native('next')).at(-1).text, 'resume:next');
});

test('Tailscale identity mode accepts only the configured user and has no access-code login', { timeout: 10000 }, async t => {
  const webData = await mkdtemp(join(tmpdir(), 'ferry-web-'));
  t.after(() => rm(webData, { recursive: true, force: true }));
  const port = await freePort();
  const domain = 'agent.example.ts.net';
  const owner = 'owner@example.net';
  const web = await boot('src/web.mjs', {
    FERRY_WEB_DATA: webData,
    FERRY_WEB_BIND: '127.0.0.1',
    FERRY_WEB_PORT: port,
    FERRY_WEB_ORIGIN: 'https://' + domain,
    FERRY_HOST_TOKEN: 'test-host-' + randomUUID(),
    FERRY_TAILSCALE_LOGIN: owner,
    FERRY_WEB_LOGIN_TOKEN: '',
  }, 'https://' + domain);
  t.after(() => web.child.kill());
  const fetchLocal = (path, options = {}) => new Promise((resolve, reject) => {
    const outgoing = request('http://127.0.0.1:' + port + path, {
      ...options,
      headers: { host: domain, ...options.headers },
      signal: AbortSignal.timeout(3500),
    }, async incoming => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers: incoming.headers }));
      } catch (error) { reject(error); }
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
  const denied = await fetchLocal('/api/auth', { headers: { 'tailscale-user-login': 'guest@example.net' } });
  assert.deepEqual(await denied.json(), { signedIn: false, mode: 'tailnet' });
  const direct = await fetchLocal('/api/overview');
  assert.equal(direct.status, 401);
  const signedIn = await fetchLocal('/api/auth', { headers: { 'tailscale-user-login': owner } });
  assert.deepEqual(await signedIn.json(), { signedIn: true, mode: 'tailnet' });
  assert.equal(signedIn.headers.get('set-cookie'), null);
  const legacy = await fetchLocal('/api/login', { method: 'POST', headers: { origin: 'https://' + domain } });
  assert.equal(legacy.status, 404);
});

test('Web runs without a primary execution machine and lists only paired machines', { timeout: 10000 }, async t => {
  const webData = await mkdtemp(join(tmpdir(), 'ferry-web-'));
  t.after(() => rm(webData, { recursive: true, force: true }));
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const code = 'test-login-' + randomUUID();
  const env = { FERRY_WEB_PORT: port, FERRY_WEB_ORIGIN: origin, FERRY_WEB_LOGIN_TOKEN: code, FERRY_WEB_DATA: webData };
  for (const name of ['FERRY_HOST_TOKEN', 'FERRY_HOST_URL', 'FERRY_EXTRA_HOSTS', 'FERRY_TAILSCALE_LOGIN']) env[name] = '';
  const web = await boot('src/web.mjs', env);
  t.after(() => web.child.kill());
  const login = await fetch(origin + '/api/login', { method: 'POST', body: JSON.stringify({ code }),
    headers: { origin, 'content-type': 'application/json' } });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await (await fetch(origin + '/api/machines', { headers: { cookie } })).json(), { machines: [] });
  assert.equal((await fetch(origin + '/api/overview', { headers: { cookie } })).status, 404);
});
