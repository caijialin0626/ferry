import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';
import { adapters, readCodexQuota } from './agents.mjs';

const exec = promisify(execFile);
const label = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, 140) : '';
const percentage = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(100, value) : null;

function codexWindows(usage) {
  const buckets = Object.entries(usage?.rateLimitsByLimitId ?? {});
  if (!buckets.length && usage?.rateLimits) buckets.push(['codex', usage.rateLimits]);
  return buckets.flatMap(([bucket, snapshot]) => [snapshot?.primary, snapshot?.secondary].flatMap((window, index) => {
    const used = percentage(window?.usedPercent);
    if (used === null) return [];
    const mins = window.windowDurationMins;
    const period = mins > 0 ? mins % 1440 === 0 ? mins / 1440 + ' days' : mins % 60 === 0 ? mins / 60 + ' hours' : mins + ' minutes'
      : index ? 'Long-term limit' : 'Short-term limit';
    return [{ label: bucket === 'codex' ? period : label(snapshot.limitName || bucket) + ' · ' + period,
      usedPercent: used, resetsAt: Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt : null }];
  }));
}

async function codexAccounts(profile) {
  const { account, sessions, usage } = await readCodexQuota(profile.directory);
  const windows = codexWindows(usage);
  const active = { profile: profile.name, name: label(account?.email), workspace: label(account?.workspaceName),
    plan: label(account?.planType), method: label(account?.type),
    status: !account ? 'signed-out' : windows.length ? 'ok' : account.type === 'chatgpt' ? 'unavailable' : 'external', windows };
  const inactive = (sessions?.sessions ?? []).filter(item => !item.isActive && item.sessionId !== sessions.activeSessionId)
    .map(item => ({ profile: profile.name, name: label(item.email || item.displayName),
      workspace: label(item.workspaces?.find(it => it.accountId === item.selectedWorkspaceAccountId)?.name),
      method: 'chatgpt', status: 'inactive', windows: [] }));
  return [active, ...inactive];
}

export function claudeWindows(text) {
  const headings = [...text.matchAll(/Current[ \t]*(session|week|day)(?:[ \t]*\(([^\r\n)]{1,60})\))?/gi)];
  const windows = new Map();
  for (const [index, heading] of headings.entries()) {
    const [, kind, model] = heading;
    const end = Math.min(headings[index + 1]?.index ?? text.length, heading.index + 420);
    const block = text.slice(heading.index + heading[0].length, end);
    const used = /(<[ \t]*)?(\d+(?:\.\d+)?)%[ \t]*used/i.exec(block);
    if (!used) continue;
    const reset = /resets?[ \t]*([^\r\n]{2,96})/i.exec(block)?.[1];
    let name = { session: '5 hours', week: '7 days', day: 'Daily' }[kind.toLowerCase()];
    if (model && !/^all\s*models$/i.test(model.trim())) name += ' · ' + label(model);
    windows.set(name, { label: name, usedPercent: Math.min(100, Number(used[2])),
      ...(used[1] && { approximate: true }), resetLabel: label(reset).trim() });
  }
  return [...windows.values()];
}

async function claudePanel(file, env, directory) {
  const [{ default: pty }, { default: xterm }] = await Promise.all([import('@lydell/node-pty'), import('@xterm/headless')]);
  return new Promise((resolve, reject) => {
    const viewport = { cols: 132, rows: 50 };
    const screen = new xterm.Terminal({ ...viewport, allowProposedApi: true, scrollback: 30 });
    const terminal = pty.spawn(file, ['--restricted', '--setting-sources', '', '--strict-mcp-config', '--mcp-config',
      '{"mcpServers":{}}', '--settings', '{"disableAllHooks":true}', '--no-chrome'], {
      cwd: directory, env, name: 'xterm-256color', ...viewport,
    });
    let windows = [];
    let trusted = false;
    let asked = false;
    let done = false;
    let debounce;
    const timers = [];
    const later = (callback, ms) => timers.push(setTimeout(callback, ms));
    const finish = error => {
      if (done) return;
      done = true;
      for (const timer of timers) clearTimeout(timer);
      clearTimeout(debounce);
      dataHandle.dispose();
      exitHandle.dispose();
      screen.dispose();
      try { terminal.kill(); } catch { /* The CLI may already have exited. */ }
      if (error && !windows.length) reject(error);
      else resolve(windows);
    };
    const dataHandle = terminal.onData(chunk => screen.write(chunk, () => {
      if (done) return;
      const buffer = screen.buffer.active;
      const lines = Array.from({ length: viewport.rows }, (_, index) =>
        buffer.getLine(index + buffer.baseY)?.translateToString(true) || '');
      const text = lines.join('\n');
      if (!trusted && /Yes,\s*I\s*trust\s*this\s*folder/i.test(text)) {
        trusted = true;
        // The cwd is a private empty directory owned by Ferry.
        later(() => terminal.write('\x1b[B'), 400);
        later(() => terminal.write('\r'), 900);
      }
      if (!asked && /Claude\s*Code\s*v\d/i.test(text) && /^\s*[❯›]/m.test(text)) {
        asked = true;
        later(() => terminal.write('/usage'), 180);
        later(() => terminal.write('\r'), 500);
      }
      if (!asked) return;
      const found = claudeWindows(text);
      if (!found.length) return;
      windows = found;
      clearTimeout(debounce);
      debounce = setTimeout(() => finish(), 360);
    }));
    const exitHandle = terminal.onExit(() => finish(new Error('Claude Code usage panel closed.')));
    later(() => finish(new Error('Claude Code usage panel timed out.')), 11000);
  });
}

async function claudeAccounts(profile, directory) {
  const file = profile.executable || adapters.get('claude').file;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('FERRY_') && !['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'].includes(key)));
  if (profile.directory) env.CLAUDE_CONFIG_DIR = profile.directory;
  const { stdout } = await exec(file, ['auth', 'status', '--json'], { cwd: directory, env, timeout: 3300, maxBuffer: 32768 })
    .catch(error => {
      if (error.code === 1 && error.stdout) return error;
      throw error;
    });
  const account = JSON.parse(stdout);
  if (profile.directory && account.configDirectory && account.configDirectory !== profile.directory) {
    return [{ profile: profile.name, status: 'profile-mismatch', windows: [] }];
  }
  const supported = account.authMethod === 'claude.ai';
  const windows = supported ? await claudePanel(file, { ...env, TERM: 'xterm-256color', LANG: 'en_US.UTF-8' }, directory)
    .catch(() => []) : [];
  return [{ profile: profile.name, name: label(account.email), workspace: label(account.orgName),
    plan: label(account.subscriptionType), method: label(account.authMethod),
    status: !account.loggedIn ? 'signed-out' : windows.length ? 'ok' : supported ? 'unavailable' : 'external', windows }];
}

export function agyWindows(quota) {
  const names = { '3p': 'Claude / GPT', gemini: 'Gemini', 'gemini-argon-wtu': 'Gemini Argon WTU' };
  const periods = { '5h': '5 hours', weekly: '7 days', daily: 'Daily' };
  return Object.entries(quota ?? {}).flatMap(([key, info]) => {
    if (info?.disabled || !info) return [];
    const match = /^(.*)-(5h|weekly|daily)$/.exec(key);
    const name = match ? (names[match[1]] || match[1]) + ' · ' + periods[match[2]] : key;
    const millis = typeof info.reset_time === 'string' ? Date.parse(info.reset_time) : NaN;
    const resetsAt = Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
    const fraction = info.remaining_fraction;
    if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
      return [{ label: label(name), usedPercent: Math.round((1 - fraction) * 1000) / 10, resetsAt }];
    }
    const amount = info.remaining_amount;
    return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
      ? [{ label: label(name), remainingAmount: amount, resetsAt }] : [];
  });
}

async function agyAccount(directory) {
  const { default: pty } = await import('@lydell/node-pty');
  const cwd = await mkdtemp(join(directory, 'agy-'));
  const output = join(cwd, 'quota.json');
  // Antigravity supplies its documented status-line payload on stdin.
  const command = process.platform === 'win32'
    ? `node -e "require('node:fs').writeFileSync(process.env.FERRY_AGY_QUOTA_FILE,require('node:fs').readFileSync(0))"`
    : 'umask 077; cat > "$FERRY_AGY_QUOTA_FILE"';
  const settings = JSON.stringify({ statusLine: { type: 'command', command, enabled: true } });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FERRY_')));
  let terminal;
  let exited = false;
  let account;
  let windows = [];
  try {
    terminal = pty.spawn(adapters.get('agy').file, ['--settings', settings], {
      cwd, name: 'xterm-256color', cols: 132, rows: 48,
      env: { ...env, TERM: 'xterm-256color', FERRY_AGY_QUOTA_FILE: output },
    });
    terminal.onExit(() => { exited = true; });
    for (let i = 0; i < 46 && !exited; i++) {
      await pause(200);
      const sample = await readFile(output, 'utf8').then(JSON.parse).catch(() => undefined);
      if (!sample) continue;
      account = sample;
      windows = agyWindows(account.quota);
      if (windows.length && account.agent_state === 'idle') break;
    }
    return { profile: 'Default', name: label(account?.email), plan: label(account?.plan_tier), windows,
      status: windows.length ? 'ok' : account?.agent_state === 'authenticating' ? 'signed-out' : 'unavailable' };
  } finally {
    try { if (!exited) terminal?.kill(); } catch { /* The CLI may have exited. */ }
    await rm(cwd, { recursive: true, force: true });
  }
}

export function createQuotaReader(data) {
  const cache = new Map();
  async function query(agent) {
    if (!adapters.get(agent).file) return { accounts: [], checkedAt: Date.now() };
    const directory = join(data, 'quota-terminal');
    await mkdir(directory, { mode: 0o700, recursive: true });
    if (agent === 'agy') {
      const account = await agyAccount(directory).catch(() => ({ profile: 'Default', status: 'error', windows: [] }));
      return { accounts: [account], checkedAt: Date.now() };
    }
    const content = await readFile(join(data, 'quota-profiles.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    });
    const configured = JSON.parse(content)?.[agent];
    const profiles = [{ name: 'Default' }, ...(Array.isArray(configured) ? configured : [])
      .filter(profile => typeof profile?.directory === 'string' && isAbsolute(profile.directory))
      .map(profile => ({ name: label(profile.name) || 'Unnamed profile', directory: profile.directory,
        executable: typeof profile.executable === 'string' && isAbsolute(profile.executable) ? profile.executable : undefined }))];
    const results = await Promise.all(profiles.map(async profile => {
      try { return agent === 'codex' ? await codexAccounts(profile) : await claudeAccounts(profile, directory); }
      catch { return [{ profile: profile.name, status: 'error', windows: [] }]; }
    }));
    return { accounts: results.flat(), checkedAt: Date.now() };
  }
  return (agent, force) => {
    const current = cache.get(agent);
    if (current?.pending || (!force && current && current.until > Date.now())) return current.promise;
    const request = { pending: true };
    request.promise = query(agent).finally(() => { request.pending = false; request.until = Date.now() + 60000; });
    cache.set(agent, request);
    return request.promise;
  };
}
