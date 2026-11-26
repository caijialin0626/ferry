// A real browser exercises the Web-to-host relay. Only the external CLI is simulated.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_CORE || '/opt/ferry-checks/node_modules/playwright-core');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  const tmp = await fs.mkdtemp(join(tmpdir(), 'ferry-browser-'));
  const hostPort = process.env.SMOKE_HOST_PORT || '18788';
  const url = 'http://127.0.0.1:' + (process.env.SMOKE_WEB_PORT || '18787');
  const token = randomBytes(32).toString('hex');
  const code = randomBytes(32).toString('hex');
  const children = [];
  let browser;
  try {
    const cli = join(tmp, 'agy');
    await fs.writeFile(cli, `#!/usr/bin/env node
if (process.argv.includes('--version')) console.log('agy-test');
else if (process.argv.includes('models')) console.log('demo\\tDemo');
else {
  let input = '';
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    const text = JSON.parse(input).message.content;
    const sid = '00000000-0000-4000-8000-000000000001';
    console.log(JSON.stringify({event:'init',conversation_id:sid,init:{permission_mode:'always-proceed'}}));
    const output = text_delta => console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',text_delta}}));
    const calls = [];
    for (let i = 1; i <= 105; i++) {
      const cmd = 'example ' + i;
      calls.push({name:'run_command',args:{CommandLine:JSON.stringify(cmd),toolSummary:JSON.stringify('Inspect sample ' + i)}});
      console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:i+1,state:'DONE',
        tool_name:'run_command',tool_info:{parameters:{CommandLine:cmd}}}}));
    }
    const fs = require('node:fs');
    const folder = require('node:path').join(process.env.FIXTURE_BRAIN, sid, '.system_generated', 'logs');
    fs.mkdirSync(folder, {recursive:true});
    fs.writeFileSync(folder+'/transcript.jsonl', [ {type:'USER_INPUT',content:text,step_index:0},
      {type:'PLANNER_RESPONSE',step_index:1,tool_calls:calls} ].map(JSON.stringify).join('\\n')+'\\n');
    const wait = setInterval(() => {
      if (!fs.existsSync(process.env.FIXTURE_BRAIN+'/finish')) return;
      clearInterval(wait);
      output('Browser reply: ');
      setTimeout(() => {
        output(text + '\\n\\n- Inspect [sample.go](file:///demo/sample.go#L12-L19) and [guide](https://example.org/guide).');
        console.log(JSON.stringify({event:'result',result:{conversation_id:sid,status:'SUCCESS'}}));
      }, 150);
    }, 50);
  });
}`, { mode: 0o700 });
    function start(name, settings) {
      const child = spawn(process.execPath, ['src/' + name + '.mjs'], {
        env: { ...process.env, FERRY_HOST_TOKEN: token, ...settings }, stdio: 'ignore',
      });
      children.push(child);
    }
    start('host', { FERRY_HOST_DATA: join(tmp, 'host'), FERRY_HOST_PORT: hostPort, FERRY_AGY_BIN: cli, FERRY_AGY_HISTORY_DIR: join(tmp, 'brain'), FIXTURE_BRAIN: join(tmp, 'brain'),
      FIXTURE_COMPACTION_FINISH: join(tmp, 'finish-compaction'),
      FERRY_CODEX_BIN: join(process.cwd(), '.github/maintenance/codex-question-fixture.cjs'),
      FERRY_CODEX_APP_SERVER_SOCKET: join(tmp, 'absent.sock'), FERRY_CLAUDE_BIN: join(tmp, 'absent') });
    start('web', { FERRY_WEB_DATA: join(tmp, 'web'), FERRY_WEB_LOGIN_TOKEN: code,
      FERRY_HOST_URL: 'http://127.0.0.1:' + hostPort, FERRY_WEB_PORT: new URL(url).port });
    for (let i = 0; i < 100; i++) {
      if (await fetch(url).then(r => r.ok).catch(() => false)) break;
      await delay(100);
    }
    browser = process.env.SMOKE_WEBKIT === '1' ? await webkit.launch() : await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: process.env.SMOKE_WEBKIT === '1', colorScheme: 'dark' });
    // Verify the first paint and live system changes without reloading or a saved theme preference.
    async function appearance(scheme) {
      await page.waitForFunction(expected => {
        const root = document.documentElement;
        const color = name => getComputedStyle(root).getPropertyValue(name).trim();
        const meta = [...document.querySelectorAll('meta[name="theme-color"]')].find(tag => matchMedia(tag.media).matches);
        const surface = getComputedStyle(document.querySelector('.login-card')).backgroundColor;
        const canvas = getComputedStyle(document.querySelector('.main')).backgroundColor;
        return document.querySelector('meta[name="color-scheme"]').content === 'light dark' &&
          meta?.content === color('--page') && surface === expected.surface && canvas === expected.canvas;
      }, scheme === 'dark' ? { surface: 'rgb(32, 38, 34)', canvas: 'rgb(23, 27, 25)' }
        : { surface: 'rgb(255, 255, 255)', canvas: 'rgb(251, 251, 250)' });
    }
    await page.goto(url);
    await appearance('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await appearance('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await appearance('dark');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#login-code').fill(code);
    await page.locator('#login-code').press('Enter');
    await page.locator('#new-chat').click();
    await page.locator('#agent').selectOption('agy', { force: true });
    await page.locator('#prompt').fill('hello from the browser');
    await page.locator('#send').click();
    const count = page.locator('.group-label').filter({ hasText: '105' });
    const summary = page.locator('.group-last').filter({ hasText: 'Inspect sample 105' });
    await count.waitFor();
    await summary.waitFor();
    await page.reload();
    await count.waitFor();
    await summary.waitFor();
    await fs.writeFile(join(tmp, 'brain', 'finish'), '');
    const reply = page.locator('#messages').getByText('Browser reply: hello from the browser', { exact: true });
    await reply.waitFor();
    async function checkFileReference() {
      const item = page.locator('.markdown li').filter({ hasText: 'Inspect' });
      await item.locator('code[title="file:///demo/sample.go#L12-L19"]').filter({ hasText: /^sample\.go:12–19$/ }).waitFor();
      if ((await item.innerText()).includes('file:///')) throw new Error('Local file URI leaked into visible reply');
      await item.locator('a[href="https://example.org/guide"]').waitFor();
    }
    await checkFileReference();
    const sessionId = new URL(page.url()).searchParams.get('session');
    const historyUrl = url + '/api/sessions/' + sessionId;
    const snapshot = await (await page.request.get(historyUrl)).json();
    const agent = snapshot.messages.find(message => message.role === 'agent');
    if (!(agent.updated_at > agent.created_at)) throw new Error('Later output must advance the reply time');
    const latestTime = page.locator('.reply-meta time[datetime="' + new Date(agent.updated_at).toISOString() + '"]');
    await latestTime.waitFor();
    await page.reload();
    await reply.waitFor();
    await checkFileReference();
    await latestTime.waitFor();
    // Older hosts only know when output began, even if more text followed a steer.
    await page.route(historyUrl, route => route.fulfill({ json: { ...snapshot, messages: [
      { ...agent, text: 'First. Second.', updated_at: null },
      { id: 'fixture-steer', role: 'steer', text: 'Continue', reply_offset: 6, created_at: agent.created_at + 60000 },
    ] } }));
    await page.reload();
    await page.getByText('Second.', { exact: true }).waitFor();
    if (await page.locator('.reply-meta time').count()) throw new Error('Legacy reply time precedes guidance');
    await appearance('dark');
    const compactChat = await page.request.post(url + '/api/sessions', { headers: { origin: url }, data: { project: null, agent: 'codex' } });
    await page.goto(url + '/?session=' + (await compactChat.json()).id);
    await page.locator('#prompt').fill('compact');
    await page.locator('#send').click();
    const compacting = page.locator('.reply-wait').getByText('正在压缩上下文…', { exact: true });
    await compacting.waitFor();
    await page.reload();
    await compacting.waitFor();
    await fs.writeFile(join(tmp, 'finish-compaction'), '');
    const compacted = page.getByText('上下文已压缩', { exact: true });
    await compacted.waitFor();
    await page.getByText('Continued after compaction.', { exact: true }).waitFor();
    await page.reload();
    await compacted.waitFor(); // Strict locator also rejects duplicate markers.
    if (await compacting.isVisible()) throw new Error('Finished chat still shows active compaction');
    for (const [prompt, method] of [['ask-live', 'turn/steer'], ['ask-idle', 'turn/start']]) {
      const created = await page.request.post(url + '/api/sessions', { headers: { origin: url }, data: { project: null, agent: 'codex' } });
      if (!created.ok()) throw new Error('Could not create Codex test chat: ' + await created.text());
      const { id } = await created.json();
      await page.goto(url + '/?session=' + id);
      await page.locator('#prompt').fill(prompt);
      await page.locator('#send').click();
      const card = page.locator('.interactive-question');
      await card.waitFor();
      if (prompt === 'ask-idle') {
        await page.locator('#stop').waitFor({ state: 'hidden' });
        await page.reload();
      }
      await card.getByRole('radio', { name: 'Blue' }).check();
      await card.locator('.question-freeform').last().fill('Sample');
      await card.locator('[type=submit]').click();
      await page.locator('.markdown').getByText('Received via ' + method).waitFor();
      async function checkAnswer() {
        const message = page.locator('.message.user').filter({ has: page.locator('.question-reply') });
        await message.getByText('Blue', { exact: true }).waitFor();
        await message.getByText('Sample', { exact: true }).waitFor();
        await message.locator('time').waitFor();
        if (await page.locator('#messages .question-reply').count() !== 1) throw new Error('Duplicate answer card');
      }
      await checkAnswer();
      await page.reload();
      await checkAnswer();
      const historyUrl = url + '/api/sessions/' + id;
      const history = await (await page.request.get(historyUrl)).json();
      const question = history.messages.find(message => message.role === 'question');
      const answerAgain = color => page.request.post(historyUrl + '/answer', { headers: { origin: url },
        data: { id: question.id, answers: { 0: [color], 1: ['Sample'] } } });
      if (!(await answerAgain('Blue')).ok() || (await answerAgain('Red')).status() !== 409) {
        throw new Error('Retrying the same question must preserve the first answer');
      }
      if (await page.locator('.markdown li').count()) throw new Error('Questions were also rendered as a list');
    }
    await page.route('**/api/quota?*', route => route.fulfill({ json: { accounts: [] } }));
    await page.locator('#quota-footer').click();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => {
        const select = document.getElementById('quota-machine-trigger').getBoundingClientRect();
        const refresh = document.getElementById('quota-refresh').getBoundingClientRect();
        return select.width > 0 && refresh.width > 0 && Math.abs(select.top - refresh.top) < 1 &&
          Math.abs(select.bottom - refresh.bottom) < 1;
      }, undefined, { timeout: 3000 });
    }
    console.log('Browser login, chat, native reply and persisted history passed.');
  } finally {
    await browser?.close();
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode) return;
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    }));
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
