// A real browser exercises the Web-to-host relay. Only the external CLI is simulated.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/opt/ferry-checks/node_modules/playwright-core');
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
    console.log(JSON.stringify({event:'init',conversation_id:'demo',init:{permission_mode:'always-proceed'}}));
    console.log(JSON.stringify({event:'result',result:{conversation_id:'demo',status:'SUCCESS',response:'Browser reply: ' + text}}));
  });
}`, { mode: 0o700 });
    function start(name, settings) {
      const child = spawn(process.execPath, ['src/' + name + '.mjs'], {
        env: { ...process.env, FERRY_HOST_TOKEN: token, ...settings }, stdio: 'ignore',
      });
      children.push(child);
    }
    start('host', { FERRY_HOST_DATA: join(tmp, 'host'), FERRY_HOST_PORT: hostPort, FERRY_AGY_BIN: cli,
      FERRY_CODEX_BIN: join(tmp, 'absent'), FERRY_CLAUDE_BIN: join(tmp, 'absent') });
    start('web', { FERRY_WEB_DATA: join(tmp, 'web'), FERRY_WEB_LOGIN_TOKEN: code,
      FERRY_HOST_URL: 'http://127.0.0.1:' + hostPort, FERRY_WEB_PORT: new URL(url).port });
    for (let i = 0; i < 100; i++) {
      if (await fetch(url).then(r => r.ok).catch(() => false)) break;
      await delay(100);
    }
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.goto(url);
    await page.locator('#login-code').fill(code);
    await page.locator('#login-code').press('Enter');
    await page.locator('#new-chat').click();
    await page.waitForFunction(() => document.querySelector('#agent')?.value === 'agy');
    await page.locator('#prompt').fill('hello from the browser');
    await page.locator('#send').click();
    const reply = page.locator('#messages').getByText('Browser reply: hello from the browser', { exact: true });
    await reply.waitFor();
    await page.reload();
    await reply.waitFor();
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
