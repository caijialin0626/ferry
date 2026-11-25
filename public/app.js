import { enhanceSelects } from './select-menu.js';
import { languages, locale, savedLanguage, setLanguage, t, translatePage, translateServer } from './i18n.js';

translatePage();

const $ = id => document.getElementById(id);

/* ---------- icons (inline SVG via DOM, CSP-safe) ---------- */
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  compose: 'M11.5 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4.5M17.6 4.4a1.9 1.9 0 0 1 2.7 2.7L12.6 14.8l-3.4.8.8-3.4z',
  edit: 'M15.5 5.5l3 3M5 19l4-.8 10.2-10.2a2.1 2.1 0 0 0-3-3L6 15.1z',
  branch: 'M7 5v14m0-9a5 5 0 0 0 5 5h4m0-3 3 3-3 3',
  'side-chat': 'M5 5h14v11H9l-4 3V5Zm8 0v11',
  'arrow-left': 'M19 12H5m6-6-6 6 6 6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  folder: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h3.6l2 2H19A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
  'folder-open': 'M3.5 17.5V7A1.5 1.5 0 0 1 5 5.5h3.6l2 2H18A1.5 1.5 0 0 1 19.5 9v1.5M3.5 17.5 6 11.6a1.5 1.5 0 0 1 1.4-1h12.3a1 1 0 0 1 .9 1.4L18.4 18a1.5 1.5 0 0 1-1.4 1H5a1.5 1.5 0 0 1-1.5-1.5z',
  'folder-plus': 'M3.5 7A1.5 1.5 0 0 1 5 5.5h3.6l2 2H19A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM12 10.5v5M9.5 13h5',
  chevron: 'M9 6l6 6-6 6',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6',
  archive: 'M4 5h16v4H4zM5.5 9v10h13V9M10 13h4',
  restore: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
  sidebar: 'M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM9.5 4.5v15',
  device: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM12 17v3m-4 0h8',
  gauge: 'M4.5 17a8 8 0 1 1 15 0H4.5zM12 14l3.6-3.6',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2',
  stop: 'M7.5 7.5h9v9h-9z',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  tool: 'M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM7.5 9.5 10 12l-2.5 2.5M12.5 15h4',
  alert: 'M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.2h.01',
  chat: 'M6.5 5h11A2.5 2.5 0 0 1 20 7.5v6a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16A2.5 2.5 0 0 1 4 13.5v-6A2.5 2.5 0 0 1 6.5 5z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  up: 'M12 19V7M7 12l5-5 5 5',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17M15.5 9.5h.01',
  search: 'M15.8 15.8 20 20M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon icon-' + name);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function btn(className, children, onClick, label) {
  const node = el('button', className);
  node.type = 'button';
  node.append(...[children].flat().map(child => typeof child === 'string' ? el('span', '', child) : child));
  if (label) { node.setAttribute('aria-label', label); node.title = label; }
  if (onClick) node.addEventListener('click', onClick);
  return node;
}
function iconBtn(name, label, onClick, className = '') {
  return btn('icon-btn ' + className, icon(name), onClick, label);
}
for (const slot of document.querySelectorAll('[data-icon]')) slot.replaceWith(icon(slot.dataset.icon));
enhanceSelects(icon);

/* ---------- image preview ---------- */
const imagePreview = $('image-preview');
const fullImage = $('image-preview-image');
const imageStatus = $('image-preview-status');
function showImage(source, name) {
  $('image-preview-title').textContent = name || t('Image preview');
  fullImage.alt = name || t('Image');
  imageStatus.textContent = t('Loading image…');
  fullImage.hidden = true;
  imageStatus.hidden = false;
  fullImage.src = source;
  if (!imagePreview.open) imagePreview.showModal();
}
fullImage.onload = () => { fullImage.hidden = false; imageStatus.hidden = true; };
fullImage.onerror = () => { imageStatus.textContent = t('Could not load the image.'); };
$('image-preview-close').onclick = () => imagePreview.close();
imagePreview.addEventListener('click', event => {
  if (event.target === imagePreview || event.target === $('image-preview-stage')) imagePreview.close();
});
imagePreview.addEventListener('close', () => { if (!imagePreview.open) fullImage.removeAttribute('src'); });

function imageButton(image, className) {
  const trigger = btn(className + ' image-trigger', image, () => showImage(image.src, image.alt), t('View full size: {name}', { name: image.alt }));
  trigger.setAttribute('aria-haspopup', 'dialog');
  return trigger;
}
function previewLink(link, source) {
  link.removeAttribute('target');
  link.setAttribute('aria-haspopup', 'dialog');
  link.addEventListener('click', event => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    showImage(source, link.querySelector('img')?.alt || link.textContent.trim());
  });
}

/* ---------- markdown ---------- */
const md = (() => {
  if (typeof window.markdownit !== 'function') return null;
  try {
    const parser = window.markdownit({ html: false, linkify: true, breaks: false });
    const fallback = (tokens, index, options, env, self) => self.renderToken(tokens, index, options);
    const linkOpen = parser.renderer.rules.link_open || fallback;
    parser.renderer.rules.link_open = (tokens, index, options, env, self) => {
      tokens[index].attrSet('target', '_blank');
      tokens[index].attrSet('rel', 'noopener noreferrer nofollow');
      return linkOpen(tokens, index, options, env, self);
    };
    return parser;
  } catch { return null; }
})();
const ALLOWED_TAGS = new Set(['A', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'EM', 'STRONG', 'DEL', 'S', 'HR', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN', 'SUP', 'SUB']);
function responseImageUrl(value) {
  if (!session || !value) return;
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.username && !url.password && url.origin !== location.origin) return url.href;
    } catch { return; }
    return;
  }
  if (/^\/api\/attachments\/[a-f0-9-]{36}$/.test(value)) return apiUrl(value, session.machine);
  if (value.startsWith('//') || (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:\//i.test(value))) return;
  let path;
  try { path = decodeURIComponent(value); } catch { return; }
  if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) return;
  const query = new URLSearchParams({ path });
  return apiUrl('sessions/' + encodeURIComponent(session.id) + '/image?' + query, session.machine);
}
function sanitize(root) {
  for (const node of [...root.querySelectorAll('*')]) {
    if (!node.isConnected && node.getRootNode() !== root) continue;
    if (node.tagName === 'IMG') {
      const source = responseImageUrl(node.getAttribute('src'));
      const alt = node.getAttribute('alt') || t('Reply image');
      if (!source) { node.replaceWith(document.createTextNode(alt)); continue; }
      const image = el('img', 'reply-image');
      image.alt = alt;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('load', () => { if (stick && scrollArea.contains(image)) schedule(); });
      image.src = source;
      const link = node.closest('a');
      if (link?.hasAttribute('href')) {
        if (link.childNodes.length === 1 && !link.hasAttribute('aria-haspopup')) previewLink(link, source);
        image.addEventListener('click', event => { event.preventDefault(); showImage(source, alt); });
        node.replaceWith(image);
      } else node.replaceWith(imageButton(image, 'inline-image-trigger'));
      continue;
    }
    if (!ALLOWED_TAGS.has(node.tagName)) { node.replaceWith(document.createTextNode(node.textContent)); continue; }
    for (const { name, value } of [...node.attributes]) {
      if (name === 'href' && node.tagName === 'A') {
        if (!/^(https?:|mailto:)/i.test(value.trim())) {
          const source = responseImageUrl(value);
          if (source) { node.setAttribute('href', source); previewLink(node, source); }
          else { node.removeAttribute('href'); node.classList.add('dead-link'); }
        } else if (/^https:\/\/[^?#]+\.(png|jpe?g|gif|webp)(?:[?#]|$)/i.test(value)) {
          const source = responseImageUrl(value);
          if (source) previewLink(node, source);
        }
      } else if (name === 'style') {
        const align = /text-align:\s*(left|right|center)/.exec(value);
        node.removeAttribute('style');
        if (align) node.classList.add('align-' + align[1]);
      } else if (name === 'class' && node.tagName === 'CODE') {
        const lang = /language-([\w+#.-]+)/.exec(value);
        node.className = lang ? 'language-' + lang[1] : '';
      } else if (!['target', 'rel', 'start'].includes(name)) node.removeAttribute(name);
    }
  }
}
function enhance(root) {
  for (const pre of [...root.querySelectorAll('pre')]) {
    const code = pre.querySelector('code');
    const lang = /language-([\w+#.-]+)/.exec(code?.className || '')?.[1] || '';
    const block = el('div', 'code-block');
    const head = el('div', 'code-head');
    head.append(el('span', 'code-lang', lang || t('Code')));
    pre.replaceWith(block);
    block.append(head, pre);
  }
  for (const table of [...root.querySelectorAll('table')]) {
    const wrap = el('div', 'table-wrap');
    table.replaceWith(wrap);
    wrap.append(table);
  }
}
function renderMarkdown(target, text) {
  if (!md) { target.classList.add('plain'); target.textContent = text; return; }
  const template = document.createElement('template');
  try { template.innerHTML = md.render(text); }
  catch { target.classList.add('plain'); target.textContent = text; return; }
  sanitize(template.content);
  enhance(template.content);
  target.classList.remove('plain');
  target.replaceChildren(template.content);
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall back */ }
  const area = el('textarea', 'clipboard');
  area.value = text;
  area.setAttribute('readonly', '');
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

/* ---------- state ---------- */
const inventories = new Map();
const runtimeVersions = new Map();
const observedStates = new Map();
const viewedLiveResults = new Map();
let runtimeVersion = 0;
let projectId = null;
let session;
let stream;
let generation = 0;
let navigation = 0;
let opening = 0;
let stateEvent = 0;
let older;
let locked = false;
let rendered = new Map();
let currentPath;
let homePath;
let folderRequest = 0;
let folderOffsets = [];
let draftKey = '';
let retry;
let outgoing;
let pendingSession;
let sessionRequest;
let authMode;
let attachments = [];
let attachmentDraftLoading = false;
let choice = { scope: '', model: '', effort: '' };
const optionCache = new Map();
let menuFor = '';
const initialUrl = new URLSearchParams(location.search);
const sideFrame = initialUrl.get('panel') === 'side' && window.parent !== window;
document.body.toggleAttribute('data-side-frame', sideFrame);
// Matches the Web service's optional primary execution machine, which needs no machine query parameter.
const primaryMachine = 'local';
let machineId = initialUrl.get('machine') || (initialUrl.has('session') ? primaryMachine : localStorage.getItem('ra.machine')) || primaryMachine;
let machines = [];
const showAll = new Set();
const mobile = matchMedia('(max-width: 760px)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const appleKeys = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const navState = (() => {
  const base = { groups: { pinned: true, projects: true, recent: true, archivedProjects: false, archivedSessions: false },
    projects: {}, sessionOrder: {}, collapsed: false };
  try {
    const saved = JSON.parse(localStorage.getItem('ra.nav') || '{}');
    return { groups: { ...base.groups, ...saved.groups }, projects: { ...saved.projects },
      sessionOrder: { ...saved.sessionOrder }, collapsed: Boolean(saved.collapsed) };
  } catch { return base; }
})();
function saveNav() { localStorage.setItem('ra.nav', JSON.stringify(navState)); }

function apiUrl(path, target = machineId) {
  const url = new URL(path.startsWith('/') ? path : '/api/' + path, location.origin);
  if (target !== primaryMachine) url.searchParams.set('machine', target);
  else url.searchParams.delete('machine');
  return url.pathname + url.search;
}
function workspaceUrl(id, target = machineId, panel = sideFrame) {
  const query = new URLSearchParams();
  if (target !== primaryMachine) query.set('machine', target);
  if (id) query.set('session', id);
  if (panel) query.set('panel', 'side');
  return query.size ? '/?' + query : '/';
}
const machineKey = (key, target = machineId) => target === primaryMachine ? key : key + '.' + target;
async function api(path, data, target, signal) {
  const url = apiUrl(path, target);
  const options = { signal, ...(data === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  }) };
  const response = await fetch(url, options).catch(error => {
    if (error instanceof TypeError) error.networkFailure = true;
    throw error;
  });
  let value = {};
  try { value = await response.json(); } catch { value = {}; }
  if (!response.ok) {
    if (response.status === 401 && path !== 'login' && path !== 'auth' && (await api('auth').catch(() => ({}))).signedIn === false) loginView();
    throw Object.assign(new Error(translateServer(value.error) || t('Request failed ({status}).', { status: response.status })), { status: response.status });
  }
  return value;
}
function setError(text = '') {
  $('error').hidden = !text;
  $('error').textContent = text;
}
const connectionStatus = $('connection-status');
const connectionProblems = new Set();
let connectionAlert;
let connectionOverdue = false;
function drawConnectionStatus() {
  if (!connectionProblems.size || document.hidden) {
    clearTimeout(connectionAlert);
    connectionAlert = undefined;
    connectionOverdue = false;
    connectionStatus.hidden = true;
    return;
  }
  if (!connectionAlert && !connectionOverdue) {
    connectionAlert = setTimeout(() => {
      connectionAlert = undefined;
      connectionOverdue = true;
      drawConnectionStatus();
    }, 8000);
  }
  connectionStatus.hidden = false;
  connectionStatus.dataset.state = connectionOverdue ? 'disconnected' : 'connecting';
  const text = !connectionOverdue ? t('Reconnecting…') :
    connectionProblems.has('offline') ? t('Offline. Ferry reconnects when the network is back.') : t('Cannot connect right now. Retrying…');
  if (connectionStatus.textContent !== text) connectionStatus.textContent = text;
}
function setConnectionProblem(source, failed) {
  if (failed) connectionProblems.add(source);
  else connectionProblems.delete(source);
  drawConnectionStatus();
}
function isConnectionError(error) {
  return error?.networkFailure || error?.name === 'TimeoutError' || [502, 503, 504].includes(error?.status);
}
async function readWithReconnect(source, read, signal) {
  for (;;) {
    signal?.throwIfAborted();
    try {
      const data = await read();
      signal?.throwIfAborted();
      setConnectionProblem(source, false);
      return data;
    } catch (error) {
      if (signal?.aborted || !isConnectionError(error)) throw error;
      setConnectionProblem(source, true);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}
function loginView() {
  closeSide();
  ++generation;
  ++navigation;
  sessionRequest?.abort();
  clearSessionLoading();
  closeStream();
  connectionProblems.clear();
  drawConnectionStatus();
  document.body.prepend(connectionStatus);
  session = undefined;
  machines = [];
  inventories.clear();
  runtimeVersions.clear();
  observedStates.clear();
  viewedLiveResults.clear();
  optionCache.clear();
  draftKey = '';
  attachmentDraftLoading = false;
  releaseAttachments();
  if ($('quick-dialog')?.open) $('quick-dialog').close();
  $('app').hidden = true;
  $('login').hidden = authMode === 'tailnet';
  $('tailnet-required').hidden = authMode !== 'tailnet';
}

const projectOf = (id, target = machineId) => id ? inventories.get(target)?.projects.find(project => project.id === id) : undefined;
const currentProject = () => projectOf(projectId);
const machineName = id => machines.find(machine => machine.id === id)?.name || inventories.get(id)?.machine.name || id;
const agentName = (id, target = machineId) => inventories.get(target)?.agents.find(agent => agent.id === id)?.name || id || 'Agent';
const resourceKey = (target, id) => target + ':' + id;
const sessionActions = [
  ['origin-session', 'arrow-left'], ['rename-open', 'edit'], ['pin-session', 'pin'],
  ['archive-session', 'archive'], ['schedule-open', 'clock'],
];
const isCurrentSession = (id, target) => session?.id === id && machineId === target;
const projectsAcrossMachines = () => [...inventories.values()].flatMap(snapshot => snapshot.projects);
const sessionsAcrossMachines = () => [...inventories.values()].flatMap(snapshot => snapshot.sessions);
const isRunning = item => ['running', 'stopping'].includes(item?.state);
const canRename = item => inventories.get(item?.machine)?.machine?.sessionRenaming === true;
const canBranch = item => !sideFrame && item?.canBranch && !item.archived && !projectOf(item.project, item.machine)?.archived;
const resultLabel = { idle: t('Completed'), failed: t('Failed'), interrupted: t('Interrupted') };
const hasRun = item => item?.native_id || item?.title;
const completionKey = 'ra.completed-result.';
const readKey = 'ra.read-result.';
const runningKey = 'ra.running-result.';
const storedTime = key => Number(localStorage.getItem(key)) || 0;
function storeNewerTime(key, time) {
  if (!(time > storedTime(key))) return false;
  localStorage.setItem(key, String(time));
  return true;
}
const isViewingSession = () => session && !pendingSession && !document.hidden && document.hasFocus();
function markOpenResultRead() {
  if (!isViewingSession() || !resultLabel[session.state]) return false;
  return storeNewerTime(readKey + resourceKey(session.machine, session.id), session.updated);
}
function sessionStatus(item) {
  if (isRunning(item)) return 'running';
  if (resultLabel[item?.state]) {
    const key = resourceKey(item.machine, item.id);
    return storedTime(completionKey + key) > storedTime(readKey + key) ? item.state : '';
  }
  return '';
}
function statusDot(item) {
  const status = sessionStatus(item);
  if (!status) return;
  const dot = el('span', 'session-dot');
  dot.dataset.status = status;
  dot.title = status === 'idle' ? t('Completed · unread') : resultLabel[status] || t('Running');
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', dot.title);
  return dot;
}
const byUpdated = (a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0);
const live = item => !item.archived && !projectOf(item.project, item.machine)?.archived;
function blocked() {
  if (session) return Boolean(session.archived) || Boolean(projectOf(session.project)?.archived);
  return Boolean(currentProject()?.archived);
}
function relTime(value) {
  const time = Number(value) || 0;
  if (!time) return '';
  const diff = Date.now() - time;
  if (diff < 60e3) return t('now');
  if (diff < 3600e3) return t('{n}m', { n: Math.floor(diff / 60e3) });
  if (diff < 86400e3) return t('{n}h', { n: Math.floor(diff / 3600e3) });
  if (diff < 7 * 86400e3) return t('{n}d', { n: Math.floor(diff / 86400e3) });
  const date = new Date(time);
  return (date.getMonth() + 1) + '/' + date.getDate();
}

/* ---------- sidebar ---------- */
function drawer(open) {
  const wasOpen = $('app').classList.contains('nav-open');
  $('app').classList.toggle('nav-open', open);
  $('overlay').hidden = !open;
  if (open) $('new-chat').focus({ preventScroll: true });
  else if (wasOpen && mobile.matches && $('sidebar').contains(document.activeElement)) $('menu').focus({ preventScroll: true });
}
function applyCollapse() {
  const rail = navState.collapsed && !mobile.matches;
  $('app').classList.toggle('nav-collapsed', navState.collapsed);
  const label = rail ? t('Expand sidebar') : t('Collapse sidebar');
  $('collapse').setAttribute('aria-label', label);
  $('collapse').title = label + '（Ctrl/⌘ + B）';
  $('collapse').setAttribute('aria-expanded', String(!rail));
  applySideWidth();
}
function toggleSidebar() {
  if (mobile.matches) return drawer(!$('app').classList.contains('nav-open'));
  navState.collapsed = !navState.collapsed;
  saveNav();
  applyCollapse();
}
const SIDE_MIN = 210;
let sideWidth = Number(localStorage.getItem('ra.sideWidth')) || 0;
let sideDrag;
function sideMax() { return Math.max(SIDE_MIN, Math.min(520, window.innerWidth - 420)); }
function applySideWidth() {
  const handle = $('resizer');
  const max = sideMax();
  if (sideWidth) $('app').style.setProperty('--side-width', Math.min(max, Math.max(SIDE_MIN, sideWidth)) + 'px');
  handle.setAttribute('aria-valuemin', String(SIDE_MIN));
  handle.setAttribute('aria-valuemax', String(max));
  handle.setAttribute('aria-valuenow', String(Math.round($('sidebar').getBoundingClientRect().width) || sideWidth || 276));
}
function setSideWidth(value, save) {
  sideWidth = Math.round(Math.min(sideMax(), Math.max(SIDE_MIN, value)));
  applySideWidth();
  if (save) localStorage.setItem('ra.sideWidth', String(sideWidth));
}
function toggleMenu(key) {
  menuFor = menuFor === key ? '' : key;
  drawNav();
  if (menuFor) $('nav').querySelector('.menu button')?.focus();
}
function menu(items) {
  const node = el('div', 'menu');
  node.setAttribute('role', 'menu');
  for (const [name, text, run] of items) {
    const item = btn('menu-item', [icon(name), text], () => { menuFor = ''; drawNav(); run(); });
    item.setAttribute('role', 'menuitem');
    node.append(item);
  }
  return node;
}
function moreBtn(key, label) {
  const node = iconBtn('more', label, event => { event.stopPropagation(); toggleMenu(key); }, 'more');
  node.dataset.key = 'm:' + key;
  node.setAttribute('aria-haspopup', 'menu');
  node.setAttribute('aria-expanded', String(menuFor === key));
  return node;
}
const orderedGroups = new Map();
let rowDrag;
const sessionKey = item => resourceKey(item.machine, item.id);
function orderRows(items, scope) {
  const saved = navState.sessionOrder[scope];
  const rank = new Map((Array.isArray(saved) ? saved : []).map((key, index) => [key, index]));
  const ranked = item => item.agent && rank.has(sessionKey(item));
  const ordered = items.filter(ranked).sort((a, b) => rank.get(sessionKey(a)) - rank.get(sessionKey(b)));
  let next = 0;
  const result = items.map(item => ranked(item) ? ordered[next++] : item);
  orderedGroups.set(scope, result.filter(item => item.agent).map(sessionKey));
  return result;
}
function moveRow(scope, from, to, before) {
  const order = [...(orderedGroups.get(scope) ?? [])];
  const index = order.indexOf(from);
  if (from === to || index < 0 || !order.includes(to)) return;
  order.splice(index, 1);
  order.splice(order.indexOf(to) + (before ? 0 : 1), 0, from);
  navState.sessionOrder[scope] = order;
  saveNav();
  drawNav();
}
function sessionRow(item, sub, scope) {
  const project = projectOf(item.project, item.machine);
  const key = 's:' + resourceKey(item.machine, item.id);
  const current = pendingSession ? pendingSession.id === item.id && pendingSession.target === item.machine : isCurrentSession(item.id, item.machine);
  const row = el('div', 'row session-row' + (current ? ' active' : '') + (menuFor === key ? ' menu-open' : ''));
  const main = btn('row-main', [], () => openSession(item.id, { target: item.machine }).catch(error => setError(error.message)));
  main.dataset.key = key;
  main.title = (item.title || t('New chat')) + ' · ' + machineName(item.machine);
  main.setAttribute('aria-label', main.title);
  if (current) main.setAttribute('aria-current', 'page');
  main.append(el('span', 'row-title', item.title || t('New chat')));
  if (sub) main.append(el('span', 'row-sub', sub));
  main.append(statusDot(item) ?? el('span', 'row-time', relTime(item.updated)));
  row.append(main, moreBtn(key, t('Chat actions')));
  if ((orderedGroups.get(scope)?.length ?? 0) > 1) {
    row.dataset.orderScope = scope;
    row.dataset.orderKey = sessionKey(item);
    const grip = iconBtn('grip', t('Reorder chat'), null, 'row-grip');
    grip.title = t('Drag to reorder, or use the arrow keys');
    grip.dataset.key = 'drag:' + key;
    grip.onkeydown = event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const rows = orderedGroups.get(scope);
      const up = event.key === 'ArrowUp';
      const target = rows[rows.indexOf(row.dataset.orderKey) + (up ? -1 : 1)];
      if (target) moveRow(scope, row.dataset.orderKey, target, up);
    };
    row.prepend(grip);
  }
  if (menuFor === key) {
    const items = [];
    if (canRename(item)) items.push(['edit', t('Rename'), () => openRename(item)]);
    if (canBranch(item)) items.push(['branch', t('Fork and side chat'), () => openBranches(item)]);
    if (project?.archived) items.push(['restore', t('Restore project'), () => setProjectPref(project, { archived: false })]);
    else {
      if (!item.archived) items.push(['pin', item.pinned ? t('Unpin') : t('Pin'), () => setSessionPref(item, { pinned: !item.pinned })]);
      items.push(item.archived ? ['restore', t('Restore chat'), () => setSessionPref(item, { archived: false })] : ['archive', t('Archive chat'), () => setSessionPref(item, { archived: true })]);
    }
    row.append(menu(items));
  }
  return row;
}
function projectBlock(project) {
  const key = resourceKey(project.machine, project.id);
  const selected = project.machine === machineId && project.id === projectId;
  const open = navState.projects[key] ?? navState.projects[project.id] ?? selected;
  const startChat = () => compose(project.id, project.machine);
  const block = el('div', 'project-block');
  const row = el('div', 'row project-row' + (selected && !session ? ' active' : '') + (menuFor === 'p:' + key ? ' menu-open' : ''));
  const glyph = el('span', 'row-glyph');
  glyph.append(icon(open ? 'folder-open' : 'folder'), icon('chevron'));
  const main = btn('row-main', [glyph, el('span', 'row-title', project.name), el('span', 'row-sub', machineName(project.machine))], () => {
    navState.projects[key] = !open;
    saveNav();
    drawNav();
  });
  main.dataset.key = 'p:' + key;
  main.title = machineName(project.machine) + ' · ' + project.directory;
  main.setAttribute('aria-label', project.name + ' · ' + machineName(project.machine));
  main.setAttribute('aria-expanded', String(open));
  row.append(main);
  if (!project.archived) row.append(iconBtn('compose', t('New chat in {name}', { name: project.name }), startChat, 'row-act'));
  row.append(moreBtn('p:' + key, t('Project actions')));
  if (menuFor === 'p:' + key) {
    row.append(menu(project.archived
      ? [['restore', t('Restore project'), () => setProjectPref(project, { archived: false })]]
      : [['compose', t('New chat'), startChat],
        ...(project.pinned === undefined ? [] : [['pin', project.pinned ? t('Unpin project') : t('Pin project'), () => setProjectPref(project, { pinned: !project.pinned })]]),
        ['archive', t('Archive project'), () => setProjectPref(project, { archived: true })]]));
  }
  block.append(row);
  if (open) {
    const children = el('div', 'children');
    const scope = 'project:' + key;
    const items = orderRows((inventories.get(project.machine)?.sessions ?? [])
      .filter(item => item.branch_kind !== 'side' && item.project === project.id && (project.archived || (!item.archived && !item.pinned)))
      .sort(byUpdated), scope);
    if (!project.archived && !items.length) {
      const start = btn('row-main child-new', [icon('compose'), el('span', 'row-title', t('New chat'))], startChat);
      start.dataset.key = 'n:' + key;
      const wrap = el('div', 'row');
      wrap.append(start);
      children.append(wrap);
    }
    const limit = showAll.has(key) ? items.length : 5;
    children.append(...items.slice(0, limit).map(item => sessionRow(item, project.archived && item.archived ? t('Archived') : '', scope)));
    if (items.length > 5) {
      const toggle = btn('show-more', showAll.has(key) ? t('Show less') : t('Show all ({n})', { n: items.length }), () => {
        if (showAll.has(key)) showAll.delete(key); else showAll.add(key);
        drawNav();
      });
      toggle.dataset.key = 'x:' + key;
      children.append(toggle);
    }
    block.append(children);
  }
  return block;
}
function group(key, label, count, children, action) {
  const open = navState.groups[key];
  const section = el('section', 'group');
  const head = el('div', 'group-head');
  const toggle = btn('group-toggle', [label], () => {
    navState.groups[key] = !navState.groups[key];
    saveNav();
    drawNav();
  });
  toggle.dataset.key = 'g:' + key;
  toggle.setAttribute('aria-expanded', String(open));
  if (count) toggle.append(el('span', 'count', String(count)));
  toggle.append(icon('chevron'));
  head.append(toggle);
  if (action) head.append(action);
  section.append(head);
  if (open) {
    const body = el('div', 'group-body');
    body.append(...children);
    section.append(body);
  }
  return section;
}
function drawNav() {
  if (sideFrame || rowDrag) return;
  orderedGroups.clear();
  const focusKey = $('nav').contains(document.activeElement) ? document.activeElement.dataset.key : undefined;
  const projects = projectsAcrossMachines();
  const sessions = sessionsAcrossMachines().filter(item => item.branch_kind !== 'side');
  const active = projects.filter(project => !project.archived && !project.pinned);
  const pinnedProjects = projects.filter(project => project.pinned && !project.archived);
  const archivedProjects = projects.filter(project => project.archived);
  const pinned = orderRows([...pinnedProjects, ...sessions.filter(item => item.pinned && live(item))].sort((a, b) => b.pinned - a.pinned), 'pinned');
  const recent = orderRows(sessions.filter(item => !item.project && !item.pinned && live(item)).sort(byUpdated), 'recent');
  const archivedSessions = orderRows(sessions.filter(item => item.archived && !projectOf(item.project, item.machine)?.archived).sort(byUpdated), 'archivedSessions');
  const label = item => [projectOf(item.project, item.machine)?.name, machineName(item.machine)].filter(Boolean).join(' · ');
  const groups = [];
  if (pinned.length) groups.push(group('pinned', t('Pinned'), pinned.length, pinned.map(item =>
    item.agent ? sessionRow(item, label(item), 'pinned') : projectBlock(item))));
  const addProject = iconBtn('folder-plus', t('New project'), showFolders, 'group-act');
  addProject.dataset.key = 'a:projects';
  const projectRows = !active.length && !pinnedProjects.length ? [el('p', 'nav-hint', t('Open a folder to create a project.'))] : active.map(projectBlock);
  groups.push(group('projects', t('Projects'), active.length, projectRows, addProject));
  const addChat = iconBtn('plus', t('New standalone chat'), newChat, 'group-act');
  addChat.dataset.key = 'a:recent';
  groups.push(group('recent', t('Recent'), recent.length, recent.map(item => sessionRow(item, machineName(item.machine), 'recent')), addChat));
  if (archivedProjects.length) {
    groups.push(group('archivedProjects', t('Archived projects'), archivedProjects.length, archivedProjects.map(projectBlock)));
  }
  if (archivedSessions.length) {
    groups.push(group('archivedSessions', t('Archived chats'), archivedSessions.length, archivedSessions.map(item => sessionRow(item, label(item), 'archivedSessions'))));
  }
  $('nav').replaceChildren(...groups);
  if (focusKey) [...$('nav').querySelectorAll('[data-key]')].find(node => node.dataset.key === focusKey)?.focus();
  if ($('quick-dialog')?.open) refreshQuickTargets();
}

{
  const nav = $('nav');
  let scrollFrame = 0;
  function indicate() {
    const drag = rowDrag;
    drag.over?.classList.remove('drop-before', 'drop-after');
    const over = document.elementFromPoint(drag.x, drag.y)?.closest('[data-order-scope]');
    drag.over = over?.dataset.orderScope === drag.row.dataset.orderScope && over !== drag.row ? over : null;
    if (!drag.over) return;
    const bounds = drag.over.getBoundingClientRect();
    drag.before = drag.y < bounds.top + bounds.height / 2;
    drag.over.classList.add(drag.before ? 'drop-before' : 'drop-after');
  }
  function autoScroll() {
    scrollFrame = 0;
    if (!rowDrag?.moved) return;
    const { top, bottom, left, right } = nav.getBoundingClientRect();
    const { x, y } = rowDrag;
    const distance = x < left || x > right || y < top || y > bottom ? 0
      : y < top + 28 ? y - top - 28 : y > bottom - 28 ? y - bottom + 28 : 0;
    if (distance) {
      nav.scrollTop += distance / 3;
      indicate();
      scrollFrame = requestAnimationFrame(autoScroll);
    }
  }
  nav.addEventListener('pointerdown', event => {
    const grip = event.target.closest('.row-grip');
    if (!grip || rowDrag || !event.isPrimary || event.button !== 0) return;
    rowDrag = { row: grip.closest('[data-order-scope]'), pointer: event.pointerId,
      x: event.clientX, y: event.clientY, startY: event.clientY };
    nav.setPointerCapture(event.pointerId);
  });
  nav.addEventListener('pointermove', event => {
    if (rowDrag?.pointer !== event.pointerId) return;
    const drag = rowDrag;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.moved && Math.abs(drag.y - drag.startY) < 5) return;
    drag.moved = true;
    drag.row.classList.add('dragging-row');
    nav.classList.add('reordering');
    indicate();
    if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
  });
  function finish(event) {
    if (rowDrag?.pointer !== event.pointerId) return;
    const { row, over, before, moved } = rowDrag;
    rowDrag = undefined;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    nav.classList.remove('reordering');
    row.classList.remove('dragging-row');
    over?.classList.remove('drop-before', 'drop-after');
    if (event.type === 'pointerup' && moved && over) moveRow(row.dataset.orderScope, row.dataset.orderKey, over.dataset.orderKey, before);
    else drawNav();
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) nav.addEventListener(event, finish);
}

/* ---------- quick switch ---------- */
const normalizeQuick = value => value.normalize('NFKC').toLowerCase();
let quickTargets = [];
let quickResults = [];
let quickSelected = 0;
function refreshQuickTargets() {
  const projects = projectsAcrossMachines().map(item => ({ item, project: true, title: item.name, archived: item.archived,
    detail: [machineName(item.machine), item.directory] }));
  const sessions = sessionsAcrossMachines().filter(item => item.branch_kind !== 'side').map(item => {
    const project = projectOf(item.project, item.machine);
    return { item, project: false, title: item.title || t('New chat'), archived: item.archived || project?.archived,
      detail: [machineName(item.machine), project?.name || t('Standalone chat')] };
  });
  quickTargets = [...sessions, ...projects].map(target => ({
    ...target, index: [target.title, ...target.detail, target.item.machine].map(normalizeQuick),
    running: isRunning(target.item), key: (target.project ? 'p:' : 's:') + resourceKey(target.item.machine, target.item.id),
  })).sort((a, b) => Number(b.running) - Number(a.running) || (Number(b.item.pinned) || 0) - (Number(a.item.pinned) || 0)
    || byUpdated(a.item, b.item));
  drawQuickResults(quickResults[quickSelected]?.key);
}
function quickScore(target, words) {
  let score = 0;
  for (const word of words) {
    if (target.index[0].startsWith(word)) continue;
    if (target.index[0].includes(word)) score += 1;
    else if (target.index.slice(1).some(field => field.includes(word))) score += 2;
    else return Infinity;
  }
  return score + (target.archived ? 1 : 0);
}
function drawQuickResults(previous) {
  const input = $('quick-search');
  const list = $('quick-results');
  const words = normalizeQuick(input.value).trim().split(/\s+/).filter(Boolean);
  quickResults = (words.length ? quickTargets.map(target => ({ target, score: quickScore(target, words) }))
    .filter(match => Number.isFinite(match.score)).sort((a, b) => a.score - b.score).map(match => match.target)
    : quickTargets.filter(target => !target.archived)).slice(0, 20);
  quickSelected = Math.max(0, quickResults.findIndex(target => target.key === previous));
  list.replaceChildren(...quickResults.map((target, index) => {
    const detail = [...target.detail, ...(target.archived ? [t('Archived')] : [])].join(' · ');
    const text = el('span', 'quick-result-text');
    text.append(el('span', '', target.title), el('small', '', detail));
    const row = btn('quick-result', [icon(target.project ? 'folder' : 'chat'), text], () => selectQuickTarget(target));
    const dot = statusDot(target.item);
    if (dot) row.append(dot);
    row.id = 'quick-result-' + index;
    row.title = target.title + ' · ' + detail;
    row.setAttribute('role', 'option');
    row.tabIndex = -1;
    return row;
  }));
  $('quick-empty').hidden = quickResults.length > 0;
  $('quick-empty').textContent = words.length ? t('No matching projects or chats') : t('No projects or chats yet');
  list.hidden = !quickResults.length;
  input.setAttribute('aria-expanded', String(quickResults.length > 0));
  highlightQuickResult();
}
function highlightQuickResult() {
  const rows = $('quick-results').children;
  for (const [index, row] of [...rows].entries()) row.setAttribute('aria-selected', String(index === quickSelected));
  const row = rows[quickSelected];
  if (row) {
    $('quick-search').setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
  } else $('quick-search').removeAttribute('aria-activedescendant');
}
function selectQuickTarget({ item, project }) {
  $('quick-dialog').close();
  if (project && (session || projectId !== item.id || machineId !== item.machine)) compose(item.id, item.machine);
  else if (!project && !isCurrentSession(item.id, item.machine)) void openSession(item.id, { target: item.machine }).catch(error => setError(error.message));
  else drawer(false);
}
function openQuickSwitch() {
  const dialog = $('quick-dialog');
  if (dialog.open) { dialog.close(); return; }
  const input = $('quick-search');
  input.value = '';
  quickResults = [];
  dialog.showModal();
  refreshQuickTargets();
  input.focus({ preventScroll: true });
}
if ($('quick-open')) {
  $('quick-open').hidden = false;
  $('quick-open').onclick = openQuickSwitch;
  $('quick-close').onclick = () => $('quick-dialog').close();
  $('quick-search').addEventListener('input', () => drawQuickResults());
  $('quick-search').addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      $('quick-dialog').close();
      return;
    }
    if (!quickResults.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      selectQuickTarget(quickResults[quickSelected]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      quickSelected = (quickSelected + (event.key === 'ArrowDown' ? 1 : -1) + quickResults.length) % quickResults.length;
      highlightQuickResult();
    }
  });
}

/* ---------- preferences ---------- */
function mergeSession(value, target = machineId) {
  const item = value?.session ?? value;
  const snapshot = inventories.get(target);
  if (!item?.id || !snapshot) return;
  const known = snapshot.sessions.find(it => it.id === item.id);
  const fields = ['project', 'agent', 'title', 'state', 'updated', 'activeTurn', 'waiting', 'pinned', 'archived', 'model', 'effort',
    'canBranch', 'branch_parent', 'branch_kind'];
  const patch = Object.fromEntries(fields.filter(field => field in item).map(field => [field, item[field]]));
  const key = resourceKey(target, item.id);
  if ('state' in item || 'activeTurn' in item) runtimeVersions.set(key, ++runtimeVersion);
  if (isRunning(item)) storeNewerTime(runningKey + key, item.updated ?? known?.updated);
  if (known) Object.assign(known, patch); else snapshot.sessions.unshift({ ...patch, id: item.id, machine: target });
  if (isCurrentSession(item.id, target)) Object.assign(session, patch);
}
async function setSessionPref(item, change) {
  try {
    const value = await api('sessions/' + encodeURIComponent(item.id) + '/preferences', change, item.machine);
    mergeSession(value, item.machine);
    setError();
  } catch (error) { setError(error.message); }
  drawNav();
  drawChrome();
}
async function setProjectPref(project, change) {
  if (!project) return;
  try {
    const value = await api('projects/' + encodeURIComponent(project.id) + '/preferences', change, project.machine);
    const item = value?.project ?? value;
    const known = projectOf(project.id, project.machine);
    if (known && item) Object.assign(known, item, { machine: project.machine });
    setError();
  } catch (error) { setError(error.message); }
  drawNav();
  drawChrome();
}

let renameTarget;
function openRename(item) {
  if (!canRename(item) || $('rename-save').disabled) return;
  renameTarget = { id: item.id, machine: item.machine };
  $('rename-title').value = item.title || t('New chat');
  $('rename-error').hidden = true;
  $('rename-dialog').showModal();
  $('rename-title').select();
}
$('rename-open').onclick = () => openRename(session);
$('rename-cancel').onclick = () => $('rename-dialog').close();
$('rename-form').onsubmit = async event => {
  event.preventDefault();
  if (!renameTarget || $('rename-save').disabled) return;
  const { id, machine } = renameTarget;
  const title = $('rename-title').value.trim();
  const error = $('rename-error');
  if (!title) {
    error.textContent = t('Enter a chat title.');
    error.hidden = false;
    $('rename-title').focus();
    return;
  }
  $('rename-save').disabled = true;
  error.hidden = true;
  try {
    const value = await api('sessions/' + encodeURIComponent(id) + '/preferences', { title }, machine);
    mergeSession({ id, title: value.title }, machine);
    $('rename-dialog').close();
    drawNav();
    drawChrome();
    void refresh();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally { $('rename-save').disabled = false; }
};

/* ---------- conversation branches ---------- */
const overlaySide = matchMedia('(max-width: 1059px)');
let branchTarget;
let sideOrigin;
let branchBusy = false;
function syncSideLayout() {
  const overlay = Boolean(sideOrigin && overlaySide.matches);
  $('app').querySelector('.main').inert = $('sidebar').inert = overlay;
}
overlaySide.addEventListener('change', syncSideLayout);
function closeSide() {
  if (!sideOrigin) return;
  sideOrigin = undefined;
  $('side-panel').hidden = true;
  $('side-frame').removeAttribute('src');
  $('app').classList.remove('side-open');
  syncSideLayout();
}
function openSide(item) {
  sideOrigin = resourceKey(item.machine, item.branch_parent);
  drawer(false);
  $('side-frame').src = workspaceUrl(item.id, item.machine, true);
  $('side-panel').hidden = false;
  $('app').classList.add('side-open');
  syncSideLayout();
  $('side-close').focus();
}
$('side-close').onclick = () => { closeSide(); $('branches-open').focus(); };
$('branches-close').onclick = () => $('branches-dialog').close();
function openBranches(item) {
  if (!canBranch(item) || branchBusy) return;
  branchTarget = { ...item };
  $('branch-error').hidden = true;
  $('branch-fork').querySelector('small').textContent = item.agent === 'claude'
    ? t('Copy the history; Claude Code forks it on the first send')
    : t('Copy the history and explore another direction');
  const sides = inventories.get(item.machine)?.sessions.filter(it =>
    it.branch_kind === 'side' && it.branch_parent === item.id && !it.archived).sort(byUpdated) ?? [];
  $('branch-list').replaceChildren(...sides.map(child => btn('branch-item', [icon('side-chat'), child.title], () => {
    $('branches-dialog').close();
    void showBranch(child, item).catch(error => setError(error.message));
  })));
  $('branch-list').hidden = sides.length === 0;
  $('branches-dialog').showModal();
}
async function showBranch(child, parent) {
  if (child.branch_kind === 'side') {
    if (!isCurrentSession(parent.id, parent.machine)) await openSession(parent.id, { target: parent.machine });
    if (isCurrentSession(parent.id, parent.machine) && !pendingSession) openSide(child);
  } else await openSession(child.id, { target: parent.machine });
}
async function createBranch(kind) {
  if (branchBusy || !branchTarget) return;
  const parent = branchTarget;
  const dialog = $('branches-dialog');
  const error = $('branch-error');
  if (!branchTarget[kind]) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    branchTarget[kind] = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
      .replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
  }
  const request = branchTarget[kind];
  branchBusy = true;
  $('branch-side').disabled = $('branch-fork').disabled = true;
  error.hidden = true;
  try {
    const result = await api('sessions/' + encodeURIComponent(parent.id) + '/branches', { id: request, kind }, parent.machine);
    const child = { ...result, machine: parent.machine };
    mergeSession(child, parent.machine);
    drawNav();
    if (dialog.open) {
      dialog.close();
      await showBranch(child, parent);
    }
    void refresh();
  } catch (failure) {
    if (dialog.open) {
      error.textContent = failure.message;
      error.hidden = false;
    } else setError(failure.message);
  } finally {
    branchBusy = false;
    $('branch-side').disabled = $('branch-fork').disabled = false;
  }
}
$('branch-side').onclick = () => void createBranch('side');
$('branch-fork').onclick = () => void createBranch('fork');
$('branches-open').onclick = () => openBranches(session);
$('origin-session').onclick = () => {
  if (session?.branch_parent) void openSession(session.branch_parent, { target: session.machine }).catch(error => setError(error.message));
};

/* ---------- chrome ---------- */
function persistDraft() {
  if (!draftKey) return;
  if ($('prompt').value) localStorage.setItem(draftKey, $('prompt').value);
  else localStorage.removeItem(draftKey);
}
function draft(key, legacy, keepAttachments = false) {
  if (draftKey === key) return;
  persistDraft();
  const previous = draftKey;
  draftKey = key;
  const saved = localStorage.getItem(key);
  const old = saved === null && legacy && legacy !== key ? localStorage.getItem(legacy) : null;
  $('prompt').value = saved ?? old ?? '';
  if (old) { persistDraft(); localStorage.removeItem(legacy); }
  restoreDraftAttachments(key, keepAttachments ? previous : undefined);
  fitPrompt();
}
/* Grow the prompt with its content where `field-sizing` is unsupported (Safari, Firefox). */
const sizeByScript = !(window.CSS?.supports?.('field-sizing', 'content'));
function fitPrompt() {
  if (!sizeByScript) return;
  const area = $('prompt');
  area.style.height = 'auto';
  area.style.height = area.scrollHeight + 'px';
}
function agentKey() { return machineKey('ra.agent.' + (projectId || 'standalone')); }
function agentOptions(refresh = false) {
  const select = $('agent');
  const items = inventories.get(machineId)?.agents ?? [];
  const available = items.filter(agent => agent.available);
  const shown = session ? items.filter(it => it.id === session.agent) : items;
  select.replaceChildren(...(shown.length ? shown : session ? [{ id: session.agent, name: agentName(session.agent), available: true }] : []).map(agent => {
    const option = new Option(agent.name + (!agent.available ? t(' (not installed)') : ''), agent.id);
    option.disabled = !agent.available && !session;
    return option;
  }));
  const remembered = localStorage.getItem(agentKey());
  select.value = session?.agent || (available.some(it => it.id === remembered) ? remembered : available[0]?.id ?? '');
  select.disabled = Boolean(session) || available.length <= 1;
  $('agent-picker').classList.toggle('locked', select.disabled);
  const shownName = select.selectedOptions[0]?.textContent || '';
  select.title = t('Agent: {name}', { name: shownName || t('No agent available') }) + (session ? t(' · fixed for this chat') : '');
  syncChoice();
  loadOptions(select.value, refresh);
  drawPickers();
  drawState();
}

/* ---------- model / effort ---------- */
function choiceScope() {
  return resourceKey(machineId, session ? 's:' + session.id : 'n:' + (projectId || '')) + '|' + $('agent').value;
}
function syncChoice() {
  const scope = choiceScope();
  if (choice.scope === scope) return;
  let saved = {};
  if (session) saved = { model: session.model, effort: session.effort };
  else {
    try { saved = JSON.parse(localStorage.getItem(machineKey('ra.model.' + $('agent').value)) || '{}') || {}; } catch { saved = {}; }
  }
  choice = {
    scope,
    model: typeof saved.model === 'string' ? saved.model : '',
    effort: typeof saved.effort === 'string' ? saved.effort : '',
  };
}
function rememberChoice() {
  const agent = $('agent').value;
  if (agent) localStorage.setItem(machineKey('ra.model.' + agent), JSON.stringify({ model: choice.model, effort: choice.effort }));
}
const validItem = item => item && typeof item.id === 'string' && item.id;
const catalogLifetime = 5 * 60_000;
function loadOptions(agent, refresh = false) {
  if (!agent) return;
  const target = machineId;
  const key = resourceKey(target, agent);
  const storage = 'ra.catalog.' + key;
  let info = optionCache.get(key);
  if (!info) {
    info = { status: 'loading' };
    try {
      const saved = JSON.parse(localStorage.getItem(storage) || 'null');
      if (Array.isArray(saved?.models) && Number.isFinite(saved.at) && Date.now() - saved.at < 24 * 60 * 60_000) {
        info = { ...saved, status: 'ready', cached: true, retryAt: saved.at + catalogLifetime };
      }
    } catch { /* A browser may disable storage. */ }
    optionCache.set(key, info);
  }
  if (info.pending || (!refresh && info.retryAt > Date.now())) return;
  info.pending = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  fetch(apiUrl('agents/' + encodeURIComponent(agent) + '/options' + (refresh ? '?refresh=1' : ''), target), { signal: controller.signal })
    .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then(value => {
      if (value?.unavailable || (value?.fallback && info.at)) throw new Error(t('Model catalog unavailable'));
      info.models = (Array.isArray(value?.models) ? value.models : []).filter(item => typeof item?.id === 'string').map(model => ({
        id: model.id,
        aliases: Array.isArray(model.aliases) ? model.aliases : [],
        name: typeof model.name === 'string' && model.name ? translateServer(model.name) : model.id,
        efforts: (Array.isArray(model.efforts) ? model.efforts : []).filter(validItem)
          .map(item => ({ ...item, name: translateServer(item.name) })),
        defaultEffort: typeof model.defaultEffort === 'string' ? model.defaultEffort : '',
        imageInput: model.imageInput !== false,
      }));
      info.defaultEffort = typeof value?.defaultEffort === 'string' ? value.defaultEffort : '';
      info.status = 'ready';
      const now = Date.now();
      const at = Number.isFinite(value.catalogUpdatedAt) ? value.catalogUpdatedAt : now;
      info.cached = Boolean(value.fallback) || now - at >= catalogLifetime;
      info.retryAt = info.cached ? now + 30_000 : at + catalogLifetime;
      if (!value.fallback && info.models.length) {
        info.at = at;
        try { localStorage.setItem(storage, JSON.stringify({ models: info.models, defaultEffort: info.defaultEffort, at })); }
        catch { /* The in-page cache is still available. */ }
      }
    })
    .catch(() => { if (!info.models) info.status = 'error'; info.retryAt = Date.now() + 30e3; })
    .finally(() => {
      clearTimeout(timer);
      info.pending = false;
      if (machineId === target && $('agent').value === agent && optionCache.get(key) === info) drawPickers();
    });
}
function drawPickers() {
  const info = optionCache.get(resourceKey(machineId, $('agent').value));
  const ready = info?.status === 'ready';
  const fresh = ready && !info.cached;
  const models = ready ? info.models : [];
  const status = ready ? '' : info?.status === 'error' ? t('Model catalog unavailable; using the agent defaults') : t('Loading model catalog…');
  const defaultModel = models.find(model => model.id === '');
  const listed = models.filter(model => model.id !== '');
  // Different ids can share a display name (e.g. dated snapshots); show the id so they stay distinguishable.
  const nameCount = new Map();
  for (const model of listed) nameCount.set(model.name, (nameCount.get(model.name) || 0) + 1);
  const modelLabel = model => (nameCount.get(model.name) > 1 && model.name !== model.id ? model.name + ' · ' + model.id : model.name);
  const modelOptions = [new Option(defaultModel?.name || (ready ? t('Default') : info?.status === 'error' ? t('Default (catalog unavailable)') : t('Default (loading…)')), '')];
  modelOptions.push(...listed.map(model => new Option(modelLabel(model), model.id)));
  if (choice.model && !models.some(model => model.id === choice.model)) {
    const alias = models.find(model => model.aliases.includes(choice.model));
    if (alias || fresh) choice.model = alias?.id || '';
    else modelOptions.push(new Option(choice.model, choice.model));
  }
  $('model').replaceChildren(...modelOptions);
  $('model').value = choice.model;
  const current = models.find(model => model.id === choice.model);
  let efforts = current ? current.efforts : [];
  if (!current) {
    const seen = new Set();
    efforts = models.flatMap(model => model.efforts).filter(item => !seen.has(item.id) && seen.add(item.id));
  }
  const fallback = current?.defaultEffort || info?.defaultEffort || '';
  const fallbackName = efforts.find(item => item.id === fallback)?.name || fallback;
  const effortOptions = [new Option(fallbackName ? t('Default ({name})', { name: fallbackName }) : t('Default'), '')];
  effortOptions.push(...efforts.map(item => new Option(item.name || item.id, item.id)));
  if (choice.effort && !efforts.some(item => item.id === choice.effort)) {
    if (fresh) choice.effort = '';
    else effortOptions.push(new Option(choice.effort, choice.effort));
  }
  $('effort').replaceChildren(...effortOptions);
  $('effort').value = choice.effort;
  $('effort').hidden = ready && !efforts.length;
  $('effort-picker').hidden = $('effort').hidden;
  $('model').disabled = $('effort').disabled = blocked() || !$('agent').value;
  pickerTitles(status);
  updateAttachButton();
}
function pickerTitles(status = '') {
  const chosen = id => $(id).selectedOptions[0]?.textContent || (id === 'agent' ? t('Not detected') : t('Default'));
  const agent = agentName($('agent').value);
  $('model').title = t('Model (run by {agent}): {name}', { agent, name: chosen('model') }) + (status ? ' · ' + status : '');
  $('effort').title = t('Reasoning effort: {name}', { name: chosen('effort') }) + (status ? ' · ' + status : '');
}

/* ---------- media attachments ---------- */
let attachmentDatabase;
let attachmentDraftRevision = 0;
const inMemoryDraftFiles = new Map();

function openAttachmentDatabase() {
  return attachmentDatabase ??= new Promise(resolve => {
    const request = indexedDB.open('remote-agent-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('attachments');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  }).catch(() => null);
}

async function draftFiles(key, change) {
  if (!key) return [];
  let next;
  try {
    const db = await openAttachmentDatabase();
    if (db && !inMemoryDraftFiles.has(key)) {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('attachments', change ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('attachments');
        const read = store.get(key);
        read.onsuccess = () => {
          const current = read.result ?? [];
          next = change ? change(current) : current;
          if (change) {
            if (next.length) store.put(next, key);
            else store.delete(key);
          }
        };
        transaction.oncomplete = () => resolve(next);
        transaction.onabort = () => reject(transaction.error);
      });
    }
  } catch { /* Keep drafts in this page if browser storage is unavailable. */ }
  const current = inMemoryDraftFiles.get(key) ?? [];
  if (change) inMemoryDraftFiles.set(key, next ?? change(current));
  return inMemoryDraftFiles.get(key) ?? current;
}

const attachmentRecords = () => attachments.map(({ key, file, name, mediaType }) => ({ key, file, name, mediaType }));
const deleteDraftFiles = (key, ids) => draftFiles(key, files => files.filter(file => !ids.has(file.key)));
function releaseAttachments() {
  for (const item of attachments) URL.revokeObjectURL(item.url);
  attachments = [];
}
function restoreDraftAttachments(key, previous) {
  const revision = ++attachmentDraftRevision;
  if (previous) {
    const moved = attachmentRecords();
    if (moved.length) {
      void draftFiles(key, () => moved);
      void deleteDraftFiles(previous, new Set(moved.map(item => item.key)));
    }
    return;
  }
  releaseAttachments();
  attachmentDraftLoading = true;
  void draftFiles(key).then(files => {
    if (revision !== attachmentDraftRevision || draftKey !== key) return;
    attachments = files.map(file => ({ ...file, url: URL.createObjectURL(file.file) }));
    attachmentDraftLoading = false;
    drawAttachments();
    drawState();
    if (stick) schedule();
  });
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const IMAGE_MAX = 2 * 1024 * 1024;
const IMAGE_ENCODING_CONCURRENCY = 3;
const VIDEO_MAX = 8 * 1024 * 1024;
const VIDEO_TYPES = new Map([['mp4', 'video/mp4'], ['mov', 'video/quicktime'], ['webm', 'video/webm']]);
const IMAGE_EXTENSIONS = new Map([['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['gif', 'image/gif'], ['webp', 'image/webp']]);
const mediaTypes = new Set([...IMAGE_TYPES, ...VIDEO_TYPES.values()]);
function mediaType(file) {
  const type = file.type.toLowerCase().split(';')[0];
  const extension = file.name.toLowerCase().split('.').at(-1);
  return mediaTypes.has(type) ? type : VIDEO_TYPES.get(extension) ?? IMAGE_EXTENSIONS.get(extension) ?? type;
}
const agentAcceptsMedia = () => inventories.get(machineId)?.agents.find(agent => agent.id === $('agent').value)?.mediaInput !== false;
const acceptsVideo = () => agentAcceptsMedia() && inventories.get(machineId)?.machine.videoInput === true;
const imageCountLimit = () => inventories.get(machineId)?.machine.maxImages ?? 3;
const isVideo = item => item.mediaType?.startsWith('video/');
function acceptsImages() {
  const info = optionCache.get(resourceKey(machineId, $('agent').value));
  const model = session?.state === 'running' ? session.model : $('model').value;
  return agentAcceptsMedia() && info?.models?.find(item => item.id === model)?.imageInput !== false;
}
function updateAttachButton() {
  const limit = imageCountLimit();
  const images = acceptsImages() && attachments.filter(item => !isVideo(item)).length < limit;
  const video = acceptsVideo() && !attachments.some(isVideo);
  $('attach').disabled = attachmentDraftLoading || blocked() || (!images && !video);
  $('attach').title = !video ? t('Add images (up to {n} per message)', { n: limit }) : images ?
    t('Add images or a video (up to {n} images, video ≤ 8 MiB)', { n: limit }) : t('Add a video (≤ 8 MiB)');
  $('attach').setAttribute('aria-label', $('attach').title);
}
function addMedia(files) {
  if (attachmentDraftLoading || blocked()) return;
  const problems = [];
  const count = attachments.length;
  const limit = imageCountLimit();
  for (const file of files) {
    const type = mediaType(file);
    if (type.startsWith('video/')) {
      if (!acceptsVideo()) { problems.push(t('This machine cannot receive videos')); continue; }
      if (![...VIDEO_TYPES.values()].includes(type) || file.size > VIDEO_MAX) {
        problems.push(t('Videos must be MP4, MOV, or WebM up to 8 MiB')); continue;
      }
      if (attachments.some(isVideo)) { problems.push(t('Each message can include one video')); continue; }
    } else {
      if (!type.startsWith('image/')) { problems.push(t('{name} is not an image or video', { name: file.name || t('File') })); continue; }
      if (!acceptsImages()) { problems.push(t('The selected model does not accept images')); continue; }
      if (attachments.filter(item => !isVideo(item)).length >= limit) { problems.push(t('Up to {n} images', { n: limit })); continue; }
      if (file.size > 32 * 1024 * 1024) { problems.push(t('Image is larger than 32 MiB')); continue; }
    }
    const media = file.type === type ? file : new Blob([file], { type });
    const key = crypto.getRandomValues(new Uint32Array(4)).join('-');
    attachments.push({ key, file: media, name: file.name || t('Attachment'), mediaType: type, url: URL.createObjectURL(media) });
  }
  if (attachments.length !== count) {
    const snapshot = attachmentRecords();
    void draftFiles(draftKey, () => snapshot);
  }
  drawAttachments();
  setError([...new Set(problems)].join('，'));
}
function removeAttachment(key) {
  const item = attachments.find(it => it.key === key);
  if (item) URL.revokeObjectURL(item.url);
  attachments = attachments.filter(it => it.key !== key);
  void deleteDraftFiles(draftKey, new Set([key]));
  drawAttachments();
  if (!$('prompt').disabled) $('prompt').focus();
}
function drawAttachments() {
  $('attachments').hidden = !attachments.length;
  $('attachments').replaceChildren(...attachments.map(item => {
    const node = el('div', 'attachment');
    node.title = item.name;
    const preview = isVideo(item) ? el('video') : el('img');
    preview.src = item.url;
    if (isVideo(item)) {
      preview.preload = 'metadata';
      preview.muted = true;
      preview.playsInline = true;
      node.append(preview, el('small', 'video-badge', t('Video')));
    } else {
      preview.alt = item.name;
      node.append(imageButton(preview, 'attachment-image-trigger'));
    }
    node.append(iconBtn('x', t('Remove {name}', { name: item.name }), () => removeAttachment(item.key), 'remove-attachment'));
    return node;
  }));
  updateAttachButton();
}
async function prepareImage(item) {
  if (IMAGE_TYPES.includes(item.mediaType) && item.file.size <= IMAGE_MAX) return item.file;
  const bitmap = await createImageBitmap(item.file).catch(() => { throw new Error(t('The browser cannot read the image: {name}', { name: item.name })); });
  try {
    const canvas = el('canvas');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.68, 0.48]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= IMAGE_MAX) return blob;
    }
    throw new Error(t('Image is still over 2 MiB after compression: {name}', { name: item.name }));
  } finally { bitmap.close(); }
}
function encodeMedia(item) {
  item.encoded ??= Promise.resolve(isVideo(item) ? item.file : prepareImage(item)).then(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result);
      const name = file.type === 'image/jpeg' && item.mediaType !== file.type ? item.name.replace(/\.[^.]*$/, '') + '.jpg' : item.name;
      resolve({ name, mediaType: file.type, data: value.slice(value.indexOf(',') + 1) });
    };
    reader.onerror = () => reject(new Error(t('Could not read the attachment: {name}', { name: item.name })));
    reader.readAsDataURL(file);
  })).catch(error => { item.encoded = undefined; throw error; });
  return item.encoded;
}
function drawChrome() {
  if (pendingSession) { drawSessionLoadingTitle(); return; }
  const project = session ? projectOf(session.project) : currentProject();
  if (session) {
    $('title').textContent = session.title || t('New chat');
    $('breadcrumb').textContent = [project?.name, machineName(machineId), agentName(session.agent)].filter(Boolean).join(' · ');
    $('breadcrumb').title = project?.directory || '';
  } else {
    // The empty screen names the destination itself; keep the header quiet.
    $('title').textContent = t('New chat');
    $('breadcrumb').textContent = '';
    $('breadcrumb').title = '';
    $('empty-title').textContent = project ? project.name : t('Standalone chat');
    $('empty-title').title = project ? project.directory : '';
    $('empty-text').textContent = project ? machineName(project.machine) + ' · ' + project.directory : '';
    $('empty-text').classList.toggle('path', Boolean(project));
    $('empty-action').hidden = projectsAcrossMachines().some(item => !item.archived);
  }
  $('chat-destination').hidden = Boolean(session);
  if (!session) {
    const selected = projectId ? resourceKey(machineId, projectId) : '';
    const projects = projectsAcrossMachines().filter(item => !item.archived || resourceKey(item.machine, item.id) === selected);
    $('chat-project').replaceChildren(new Option(t('Standalone chat'), ''), ...projects.map(item => {
      const key = resourceKey(item.machine, item.id);
      const online = machines.some(machine => machine.id === item.machine && machine.online);
      const option = new Option(item.name + ' · ' + machineName(item.machine) + (online ? '' : t(' (offline)')), key);
      option.disabled = !online && key !== selected;
      return option;
    }));
    $('chat-project').value = selected;
    $('chat-machine-field').hidden = Boolean(projectId || machines.length < 2);
    drawMachineOptions($('chat-machine'), machineId);
  }
  drawStarts();
  document.title = (session?.title || project?.name || t('New chat')) + ' · Ferry';
  const pin = $('pin-session');
  const archive = $('archive-session');
  $('rename-open').hidden = !canRename(session);
  $('branches-open').hidden = !canBranch(session);
  $('origin-session').hidden = sideFrame || !session?.branch_parent;
  $('schedule-open').hidden = !session || blocked() || inventories.get(machineId)?.machine?.scheduling !== true;
  pin.hidden = archive.hidden = !session || Boolean(project?.archived);
  if (session) {
    pin.hidden = pin.hidden || Boolean(session.archived);
    const pinLabel = session.pinned ? t('Unpin') : t('Pin chat');
    pin.title = pinLabel + (appleKeys ? '（⌥⌘P）' : '');
    pin.setAttribute('aria-label', pinLabel);
    pin.setAttribute('aria-pressed', String(Boolean(session.pinned)));
    const archiveLabel = session.archived ? t('Restore chat') : t('Archive chat');
    archive.title = archiveLabel;
    archive.setAttribute('aria-label', archiveLabel);
  }
  if ($('session-more')) $('session-more').hidden = sideFrame || !sessionActions.some(([id]) => !$(id).hidden);
  let text = '';
  let label = '';
  if (project?.archived) {
    text = t('Project “{name}” is archived. You can read its history; restore the project to send messages.', { name: project.name });
    label = t('Restore project');
  } else if (session?.archived) {
    text = t('This chat is archived. You can read its history; restore it to keep chatting.');
    label = t('Restore chat');
  }
  $('archived-banner').hidden = !text;
  $('archived-text').textContent = text;
  $('restore').textContent = label;
  $('compose-target').replaceChildren(icon(project ? 'folder' : 'device'), el('span', '', project ? project.name + ' · ' + machineName(machineId) : machineName(machineId)));
  $('compose-target').title = project ? project.directory : t('The machine chooses the working directory');
  $('prompt').disabled = Boolean(text);
  $('prompt').placeholder = text ? t('Archived. Restore to send.') : session ? t('Continue the chat…') : t('Describe what you want to get done…');
  $('model').disabled = $('effort').disabled = Boolean(text) || !$('agent').value;
  drawAttachments();
  drawState();
}
/* Composer-first empty screen: a short list of recent threads for the same destination. */
function drawStarts() {
  if (session || !inventories.size) { $('starts').hidden = true; return; }
  $('starts').hidden = false;
  const project = currentProject();
  const items = sessionsAcrossMachines()
    .filter(item => item.branch_kind !== 'side' && (item.project || null) === (projectId || null) &&
      (!projectId || item.machine === machineId) && !item.archived && (project?.archived || live(item)))
    .sort(byUpdated)
    .slice(0, 5);
  $('starts-title').hidden = !items.length;
  $('starts-list').replaceChildren(...items.map(item => {
    const row = btn('start-row', [], () => openSession(item.id, { target: item.machine }).catch(error => setError(error.message)));
    row.title = item.title || t('New chat');
    row.append(icon('chat'), el('span', 'start-title', item.title || t('New chat')), el('span', 'start-agent',
      projectId ? agentName(item.agent, item.machine) : machineName(item.machine)));
    row.append(statusDot(item) ?? el('span', 'start-time', relTime(item.updated)));
    return row;
  }));
}
function drawState() {
  const active = isRunning(session);
  const steer = session?.state === 'running' && session.activeTurn;
  $('stop').hidden = !active;
  $('stop').disabled = session?.state === 'stopping';
  $('send').hidden = active && !steer;
  $('send').disabled = locked || attachmentDraftLoading || (active && !steer) || blocked() || !$('agent').value || Boolean($('agent').selectedOptions[0]?.disabled);
  $('send').setAttribute('aria-label', steer ? t('Send guidance') : t('Send'));
  $('send').title = steer ? t('Send guidance (Enter)') : t('Send (Enter)');
  $('chat-machine').disabled = locked;
  $('chat-project').disabled = locked;
  $('composer').classList.toggle('steering', Boolean(steer));
  updateAttachButton();
  if (!$('prompt').disabled && session) $('prompt').placeholder = steer ? t('Add guidance to the current turn…') : t('Continue the chat…');
  drawProgress();
  if (turns.length) { pending.add(turns.at(-1)); schedule(); }
}

/* ---------- messages ---------- */
let frame = 0;
let stick = false;
const scrollArea = $('scroll');
let lastScrollTop = 0;
const pending = new Set(); // turns waiting to redraw
const reveals = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let revealAt = 0;
let turns = [];
let entries = [];
const openGroups = new Set();
const replyWait = el('p', 'reply-wait');
const replyWaitLabel = el('span');
replyWait.setAttribute('role', 'status');
replyWait.hidden = true;
replyWait.append(replyWaitLabel);
$('messages').after(replyWait);
function drawProgress() {
  const sending = outgoing?.navigation === navigation && !rendered.has(outgoing.messageId);
  const steering = sending && outgoing.steer;
  const inThread = Boolean(session && !pendingSession);
  const running = inThread && session.state === 'running';
  const latest = turns.at(-1);
  const waiting = running && session.waiting;
  const thinking = (sending && !steering) || (running && (!latest || latest.answer.hidden));
  const showingTool = running && latest?.answer.lastElementChild?.matches('.activity-group.running');
  let progress = '';
  if (waiting) progress = translateServer(waiting);
  else if (thinking) progress = t('Thinking…');
  else if (running && !showingTool) progress = t('Working…');
  else if (inThread && session.state === 'stopping') progress = t('Stopping…');
  const replyLabel = inThread ? progress : '';
  replyWait.hidden = !replyLabel;
  if (replyWaitLabel.textContent !== replyLabel) replyWaitLabel.textContent = replyLabel;

  const state = $('turn-state');
  const result = inThread && ({ idle: hasRun(session) ? t('Completed') : '', failed: t('Turn failed'), interrupted: t('Turn interrupted') })[session.state];
  const label = steering ? t('Sending…') : inThread ? (progress ? '' : result || '') : progress;
  if (state.textContent !== label) state.textContent = label;
  state.dataset.state = sending || thinking ? 'running' : session?.state || '';
}
function atBottom(distance = 72) {
  return scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight <= distance;
}
function scrollToLatest() {
  scrollArea.scrollTop = scrollArea.scrollHeight;
  lastScrollTop = scrollArea.scrollTop;
}
function updateToBottom() {
  $('to-bottom').hidden = Boolean(pendingSession) || $('conversation').hidden || atBottom(stick ? 72 : 2);
}
// Layout can settle after a session opens, for example when an image loads or the composer resizes.
const scrollLayout = new ResizeObserver(() => {
  if ($('conversation').hidden) return;
  if (stick && !atBottom(2)) scrollToLatest();
  updateToBottom();
});
scrollLayout.observe(scrollArea);
scrollLayout.observe(scrollArea.querySelector('.thread'));
function schedule() {
  if (!frame) frame = requestAnimationFrame(flush);
}
function flush(now) {
  frame = 0;
  if (reveals.size && (!revealAt || now - revealAt >= 24 || reducedMotion.matches)) {
    const elapsed = revealAt ? Math.min(50, now - revealAt) : 24;
    revealAt = now;
    for (const [entry, queued] of reveals) {
      let end = reducedMotion.matches ? queued.length
        : Math.min(queued.length, Math.max(queued.length - 2600,
          Math.ceil(elapsed * Math.min(520, Math.max(90, queued.length * 3)) / 1000)));
      // Keep UTF-16 surrogate pairs together.
      if (end < queued.length && /[\uDC00-\uDFFF]/.test(queued[end])) end++;
      entry.text += queued.slice(0, end);
      pending.add(entry.turn);
      if (end === queued.length) reveals.delete(entry);
      else reveals.set(entry, queued.slice(end));
    }
  }
  if (!reveals.size) revealAt = 0;
  if (!pending.size) {
    if (reveals.size) schedule();
    return;
  }
  for (const turn of pending) {
    drawTurn(turn);
    pending.delete(turn);
  }
  drawProgress();
  if (stick) scrollToLatest();
  if (reveals.size) schedule();
  updateToBottom();
}
function makeEntry(message) {
  return {
    id: message.id, role: message.role, text: message.text || '',
    createdAt: message.created_at,
    replyOffset: Number.isSafeInteger(message.reply_offset) ? message.reply_offset : null,
    images: Array.isArray(message.images) ? message.images : [],
  };
}
const messageClock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const messageDateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'medium', hourCycle: 'h23' });
function messageTime(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 8.64e15) return;
  const date = new Date(value);
  const today = new Date();
  const clock = messageClock.format(date);
  const day = today.toDateString() === date.toDateString() ? '' : date.toLocaleDateString(locale,
    { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }) }) + ' ';
  const node = el('time', 'message-time', day + clock);
  node.dateTime = date.toISOString();
  node.title = label + ' · ' + messageDateTime.format(date);
  node.setAttribute('aria-label', node.title);
  return node;
}
function sameOrigin(url) {
  try {
    const parsed = new URL(url, location.href);
    return parsed.origin === location.origin && /^https?:$/.test(parsed.protocol);
  } catch { return false; }
}
function questionReply(text) {
  const wrapped = /^<send_user_message_question_reply>\s*([\s\S]+?)\s*<\/send_user_message_question_reply>\s*$/.exec(text.trim());
  if (!wrapped) return;
  let answers;
  try { answers = JSON.parse(wrapped[1]); } catch { return; }
  if (!Array.isArray(answers) || !answers.length || !answers.every(item =>
    typeof item?.question === 'string' && typeof item.answer === 'string')) return;
  const card = el('section', 'question-reply');
  card.append(el('small', 'steer-label', t('Answered')));
  for (const { question, answer } of answers) {
    const row = el('div', 'question-answer');
    row.append(el('div', '', question), el('div', 'question-value', answer));
    card.append(row);
  }
  return card;
}
function interactiveQuestion(entry) {
  let questions;
  try { questions = JSON.parse(entry.text); } catch { return; }
  if (!Array.isArray(questions) || !questions.length) return;
  const { id, machine } = session;
  const asyncQuestion = entry.id.startsWith('async-question-');
  const node = el('form', 'interactive-question question-reply');
  const fields = el('fieldset', 'question-fields');
  const status = el('p', 'question-status');
  status.setAttribute('role', 'status');
  const submit = el('button', 'btn primary', t('Submit answers'));
  submit.type = 'submit';
  const values = questions.map(question => {
    const field = el('fieldset', 'interactive-question-field');
    const legend = el('legend', '', question.question);
    const options = question.options.map((option, index) => {
      const control = el('input');
      control.type = question.multiple ? 'checkbox' : 'radio';
      control.name = question.id;
      control.checked = asyncQuestion && index === 0;
      control.value = option.label;
      const label = el('label', 'question-option');
      const copy = el('span', 'question-option-copy', option.label);
      if (option.description) copy.append(el('small', '', option.description));
      label.append(control, copy);
      return { control, label };
    });
    const custom = el('input', 'question-freeform');
    custom.type = question.secret ? 'password' : 'text';
    custom.placeholder = options.length ? t('Other answer') : t('Your answer');
    custom.setAttribute('aria-label', `${question.question} · ${custom.placeholder}`);
    custom.maxLength = 2000;
    custom.autocomplete = 'off';
    if (!question.multiple) {
      custom.addEventListener('input', () => { for (const { control } of options) control.checked = false; });
      for (const { control } of options) control.addEventListener('change', () => { custom.value = ''; });
    }
    field.append(legend, ...options.map(option => option.label));
    if (question.other) field.append(custom);
    fields.append(field);
    return [question.id, () => [
      ...options.filter(option => option.control.checked).map(option => option.control.value),
      ...(custom.value.trim() ? [custom.value.trim()] : []),
    ]];
  });
  const receipt = el('div', 'question-receipt');
  fields.append(submit);
  node.append(fields, receipt, status);
  let sending = false;
  let previousAnswer;
  entry.drawQuestion = () => {
    const answer = entry.answer;
    if (answer?.answers && answer !== previousAnswer) {
      receipt.replaceChildren(el('small', 'steer-label', t('Answered')));
      for (const question of questions) {
        const row = el('div', 'question-answer');
        row.append(el('div', '', question.question), el('div', 'question-value', answer.answers[question.id]?.join('、') ?? ''));
        receipt.append(row);
      }
      previousAnswer = answer;
    }
    fields.hidden = Boolean(answer?.answers);
    receipt.hidden = !answer?.answers;
    const ended = !asyncQuestion && session?.state !== 'running';
    fields.disabled = sending || Boolean(answer) || ended || blocked();
    if (answer?.answers) status.textContent = '';
    else if (answer?.closed || ended) status.textContent = t('This question has ended.');
  };
  node.onsubmit = async event => {
    event.preventDefault();
    if (fields.disabled) return;
    const answers = Object.fromEntries(values.map(([key, read]) => [key, read()]));
    if (Object.values(answers).some(value => !value.length)) { status.textContent = t('Answer every question.'); return; }
    sending = true;
    status.textContent = '';
    entry.drawQuestion();
    try {
      await api('sessions/' + encodeURIComponent(id) + '/answer', { id: entry.id, answers }, machine);
      if (!entry.answer) status.textContent = t('Answer sent.');
    } catch (error) { status.textContent = error.message; sending = false; }
    entry.drawQuestion();
  };
  return node;
}
function userNode(entry) {
  const node = el('div', 'message user');
  const question = questionReply(entry.text);
  if (entry.role === 'steer' && !question) node.append(el('small', 'steer-label', t('Guidance')));
  const images = entry.images.filter(image => typeof image?.url === 'string' && sameOrigin(image.url));
  if (images.length) {
    const strip = el('div', 'user-images');
    for (const image of images) {
      if (isVideo(image)) {
        const video = el('video', 'user-video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'none';
        video.src = apiUrl(image.url, session?.machine ?? machineId);
        video.setAttribute('aria-label', image.name || t('Video'));
        strip.append(video);
        continue;
      }
      const img = el('img');
      img.src = apiUrl(image.url, session?.machine ?? machineId);
      img.alt = image.name || t('Image');
      img.loading = 'lazy';
      strip.append(imageButton(img, 'user-image'));
    }
    node.append(strip);
  }
  if (question) node.append(question);
  else if (entry.text || !images.length) node.append(el('div', 'bubble', entry.text));
  const time = messageTime(entry.createdAt, t('Sent'));
  if (time) node.append(time);
  return node;
}
function appendReply(out, text) {
  if (!text.trim()) return out;
  if (!out) return text;
  // Some older records split one sentence around a tool call.
  const block = !/\s$/.test(out) && !/^\s/.test(text)
    && (/[。！？.!?]$/.test(out) || /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~)/.test(text));
  return out + (block ? '\n\n' : '') + text;
}
function markdownBlocks(text) {
  if (!md) return [];
  const offsets = [0];
  for (const match of text.matchAll(/\n/g)) offsets.push(match.index + 1);
  return md.parse(text, {}).filter(token => token.level === 0 && token.map && token.type !== 'paragraph_open')
    .map(token => [offsets[token.map[0]], offsets[token.map[1]] ?? text.length]);
}
function activityOffset(text, offset, blocks, keepOffset) {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  const protectedBlock = blocks.find(([start, end]) => start < offset && offset < end);
  if (protectedBlock && text.slice(offset, protectedBlock[1]).trim()) return protectedBlock[1];
  if (keepOffset) return offset;
  const head = text.slice(0, offset).trimEnd();
  const tail = text.slice(offset);
  if (/[。！？.!?][”’」』）"]?$/.test(head) || /^[ \t]*\r?\n/.test(tail) || /\n\s*$/.test(text.slice(0, offset))) return offset;
  const end = /[。！？!?][”’」』）"]?|\.(?=\s|$)|\r?\n\s*\n/.exec(tail);
  return end ? offset + end.index + end[0].length : text.length;
}
function turnTranscript(flow) {
  let text = '';
  const marks = [];
  for (const entry of flow) {
    if (entry.role === 'agent') text = appendReply(text, entry.text);
    else marks.push({ entry, offset: entry.replyOffset ?? text.length });
  }
  const blocks = marks.some(mark => mark.offset > 0 && mark.offset < text.length) ? markdownBlocks(text) : [];
  const groups = [];
  for (const mark of marks) {
    const previous = groups.at(-1);
    const offset = Math.max(previous?.offset ?? 0, activityOffset(text, mark.offset, blocks,
      session?.agent === 'claude' || mark.entry.role === 'question'));
    if (mark.entry.role === 'steer') groups.push({ offset, steer: mark.entry });
    else if (mark.entry.role === 'question') groups.push({ offset, question: mark.entry });
    else if (previous?.tools && !text.slice(previous.offset, offset).trim()) previous.tools.push(mark.entry);
    else groups.push({ offset, tools: [mark.entry] });
  }
  return { text, groups };
}
/*
 * Tool rows are built once and updated in place while deltas stream in, so a click
 * on a row (or its disclosure) is never lost to a node swap mid-gesture.
 */
function toolNode(entry) {
  const node = el('details', 'tool-row flat');
  const summary = el('summary');
  const mark = el('span', 'tool-mark');
  mark.append(icon('chevron'));
  entry.label = el('span', 'tool-text');
  entry.meta = el('span', 'tool-meta');
  summary.append(mark, entry.label, entry.meta);
  entry.summary = summary;
  entry.detail = el('pre', 'tool-detail');
  node.append(summary, entry.detail);
  summary.addEventListener('click', event => { if (node.classList.contains('flat')) event.preventDefault(); });
  node.addEventListener('toggle', () => { if (node.open) entry.detail.textContent = entry.text.trim(); });
  entry.node = node;
  drawTool(entry);
  return node;
}
function drawTool(entry) {
  const text = entry.text.trim();
  const lines = text.split('\n');
  const first = lines[0];
  const long = lines.length > 1 || first.length > 110 || /^(?:Bash|PowerShell|Shell) · /.test(first);
  entry.label.textContent = translateServer(first) || '…';
  entry.meta.textContent = lines.length > 1 ? t('{n} lines', { n: lines.length }) : '';
  entry.node.classList.toggle('flat', !long);
  entry.summary.tabIndex = long ? 0 : -1;
  if (!long) entry.node.open = false;
  entry.summary.title = first.length > 60 ? first.slice(0, 600) : '';
  if (entry.node.open) entry.detail.textContent = text;
}
function extraNode(entry) {
  const node = el('div', 'message ' + (entry.role === 'notice' ? 'notice' : 'other'));
  entry.body = el('p', '', entry.role === 'notice' ? translateServer(entry.text) : entry.text);
  if (entry.role === 'notice') { node.setAttribute('role', 'note'); node.append(icon('alert')); }
  node.append(entry.body);
  return node;
}
function newTurn(user, key) {
  const turn = { flow: [], extras: [], at: 0, groups: new Map(), fragments: new Map(), node: el('section', 'turn') };
  turn.node.dataset.key = key;
  if (user) turn.node.append(userNode(user));
  turn.answer = el('article', 'message agent');
  turn.answer.hidden = true;
  turn.copy = iconBtn('copy', t('Copy reply'), () => void flashCopy(turn.copy, turn.replyText), 'copy-message');
  turn.meta = el('div', 'reply-meta');
  turn.extra = el('div', 'turn-extra');
  turn.node.append(turn.answer, turn.extra);
  return turn;
}
function newActivity(key) {
  const group = { node: el('details', 'activity-group'), toolIcon: icon('tool'), toolPulse: el('span', 'pulse'),
    label: el('span', 'group-label'), lastTool: el('span', 'group-last'), list: el('div', 'tool-list') };
  const summary = el('summary');
  const text = el('span', 'group-text');
  text.append(group.label, group.lastTool);
  const caret = el('span', 'group-caret');
  caret.append(icon('chevron'));
  summary.append(group.toolIcon, group.toolPulse, text, caret);
  group.node.open = openGroups.has(key);
  group.node.append(summary, group.list);
  group.node.addEventListener('toggle', () => {
    if (group.node.open) {
      openGroups.add(key);
      drawActivityTools(group);
    } else openGroups.delete(key);
  });
  return group;
}
function place(entry, list = turns, container = $('messages')) {
  rendered.set(entry.id, entry);
  let turn = list.at(-1);
  if (entry.role === 'user' || !turn) {
    const previous = turn;
    turn = newTurn(entry.role === 'user' ? entry : null, entry.id);
    list.push(turn);
    container.append(turn.node);
    if (previous) pending.add(previous);
  }
  entry.turn = turn;
  if (entry.role === 'answer') {
    let answer;
    try { answer = JSON.parse(entry.text); } catch { return turn; }
    const question = rendered.get(answer?.id);
    if (question?.role === 'question') {
      question.answer = answer;
      pending.add(question.turn);
    }
  } else if (['agent', 'tool', 'steer', 'question'].includes(entry.role)) {
    if (entry.role === 'steer') entry.node = userNode(entry);
    turn.flow.push(entry);
  }
  else if (entry.role !== 'user') { turn.extras.push(entry); turn.extra.append(extraNode(entry)); }
  return turn;
}
function orderNodes(parent, nodes) {
  let current = parent.firstChild;
  for (const node of nodes) {
    if (node === current) current = current.nextSibling;
    else parent.insertBefore(node, current);
  }
  while (current) {
    const next = current.nextSibling;
    current.remove();
    current = next;
  }
}
function drawActivityTools(group) {
  for (const entry of group.tools) {
    if (!entry.node) toolNode(entry);
    if (entry.dirty) { entry.dirty = false; drawTool(entry); }
  }
  orderNodes(group.list, group.tools.map(entry => entry.node));
}
function drawActivity(group, tools, running) {
  group.tools = tools;
  if (group.node.open) drawActivityTools(group);
  const last = tools.at(-1).text.trim().split('\n', 1)[0];
  const label = t(running ? 'Running · {n} actions' : 'Ran {n} actions', { n: tools.length });
  group.toolIcon.toggleAttribute('hidden', running);
  group.toolPulse.hidden = !running;
  if (group.label.textContent !== label) group.label.textContent = label;
  group.lastTool.hidden = !running || !last;
  if (group.lastTool.textContent !== last) group.lastTool.textContent = last;
  group.node.classList.toggle('running', running);
}
function readableClaudeParagraph(text) {
  if (session?.agent !== 'claude' || text.length < 440 || text.includes('\n')) return text;
  const paragraphs = [];
  let start = 0;
  // Legacy CLI output can contain many complete sentences in one paragraph.
  // Code spans take precedence over sentence punctuation.
  for (const match of text.matchAll(/(`+)[^`]*\1|[。！？][」』”）]?|[.!?](?=\s)/g)) {
    const end = match.index + match[0].length;
    if (match[1] || end - start < 270 || text.length - end < 100) continue;
    paragraphs.push(text.slice(start, end));
    start = end;
  }
  return [...paragraphs, text.slice(start)].join('\n\n');
}
function markdownTailStart(text) {
  if (!md || !text.includes('\n\n')) return 0;
  const last = md.parse(text, {}).findLast(token => token.level === 0 && token.map && token.nesting !== -1);
  const startLine = last?.map?.[0] ?? 0;
  let start = 0;
  for (let i = 0; i < startLine; i++) start = text.indexOf('\n', start) + 1;
  return start;
}
function drawTurn(turn) {
  const { text, groups } = turnTranscript(turn.flow);
  const nodes = [];
  const visibleGroups = new Map();
  const visibleFragments = new Map();
  let start = 0;
  let lastReply = -1;
  function displayText(key, end, typing = false) {
    const value = readableClaudeParagraph(text.slice(start, end));
    start = end;
    if (!value.trim()) return;
    const fragment = turn.fragments.get(key) ?? { node: el('div', 'markdown') };
    if (fragment.text !== value || fragment.typing !== typing) {
      fragment.text = value;
      fragment.typing = typing;
      if (typing) {
        if (!fragment.raw) {
          fragment.markup = el('div');
          fragment.raw = el('div', 'typing-tail');
          fragment.node.replaceChildren(fragment.markup, fragment.raw);
        }
        const candidate = value.lastIndexOf('\n\n');
        if (candidate !== fragment.candidate || !value.startsWith(fragment.prefix ?? '')) {
          fragment.candidate = candidate;
          const prefix = value.slice(0, markdownTailStart(value));
          if (prefix !== fragment.prefix) {
            fragment.prefix = prefix;
            renderMarkdown(fragment.markup, prefix);
          }
        }
        renderMarkdown(fragment.raw, value.slice(fragment.prefix?.length ?? 0));
      } else {
        fragment.raw = undefined;
        fragment.markup = undefined;
        fragment.prefix = undefined;
        fragment.candidate = undefined;
        renderMarkdown(fragment.node, value);
      }
    }
    visibleFragments.set(key, fragment);
    return fragment.node;
  }
  for (const { offset, tools, steer, question } of groups) {
    const key = (steer ?? question ?? tools[0]).id;
    const fragment = displayText(key, offset);
    if (fragment) lastReply = nodes.push(fragment) - 1;
    if (steer) { nodes.push(steer.node); continue; }
    if (question) {
      question.node ??= interactiveQuestion(question);
      if (question.node) { question.drawQuestion(); nodes.push(question.node); }
      continue;
    }
    const group = turn.groups.get(key) ?? newActivity(key);
    const running = turn === turns.at(-1) && session?.state === 'running' && offset === text.length;
    drawActivity(group, tools, running);
    visibleGroups.set(key, group);
    nodes.push(group.node);
  }
  const revealing = turn.flow.some(entry => reveals.has(entry));
  const typing = turn === turns.at(-1) && (isRunning(session) || revealing);
  const tail = displayText('tail', text.length, typing);
  if (tail) lastReply = nodes.push(tail) - 1;
  const unfinished = turn === turns.at(-1) && (isRunning(session) || ['failed', 'interrupted'].includes(session?.state));
  const hasNotice = turn.extras.some(entry => entry.role === 'notice');
  turn.replyText = text;
  if (lastReply >= 0) {
    const createdAt = turn.flow.find(entry => entry.role === 'agent' && entry.text.trim())?.createdAt;
    if (turn.timeValue !== createdAt) {
      turn.timeValue = createdAt;
      turn.time = messageTime(createdAt, t('Replied'));
    }
    const actions = [];
    if (!unfinished && !revealing && !hasNotice) actions.push(turn.copy);
    if (turn.time) actions.push(turn.time);
    if (actions.length) {
      orderNodes(turn.meta, actions);
      nodes.splice(lastReply + 1, 0, turn.meta);
    }
  }
  turn.groups = visibleGroups;
  turn.fragments = visibleFragments;
  turn.answer.hidden = !nodes.length;
  orderNodes(turn.answer, nodes);
  for (const entry of turn.extras) {
    if (entry.dirty) { entry.dirty = false; entry.body.textContent = entry.text; }
  }
}
function rebuild(list) {
  pending.clear();
  turns = [];
  entries = list;
  rendered = new Map();
  $('messages').replaceChildren();
  for (const entry of list) if (!rendered.has(entry.id)) place(entry);
  for (const turn of turns) drawTurn(turn);
  pending.clear();
}
function addMessage(message) {
  if (!message?.id || rendered.has(message.id)) return;
  if (outgoing?.navigation === navigation && outgoing.messageId === message.id) outgoing = undefined;
  const entry = makeEntry(message);
  entries.push(entry);
  pending.add(place(entry));
}
async function flashCopy(button, text) {
  const ok = await copyText(text);
  const feedback = ok ? t('Copied') : t('Copy failed');
  button.setAttribute('aria-label', feedback);
  button.replaceChildren(icon(ok ? 'check' : 'x'));
  setTimeout(() => {
    if (!button.isConnected) return;
    button.setAttribute('aria-label', button.title);
    button.replaceChildren(icon('copy'));
  }, 1600);
}

/* ---------- navigation ---------- */
function closeStream() {
  stream?.close();
  stream = undefined;
  clearTimeout(streamRetry);
  setConnectionProblem('stream', false);
  pending.clear();
  reveals.clear();
  revealAt = 0;
}
function independentMachine() {
  const preferred = localStorage.getItem('ra.machine');
  const online = machines.filter(machine => machine.online);
  return online.find(machine => machine.id === preferred)?.id ?? online.find(machine => machine.id === machineId)?.id ?? online[0]?.id ?? machineId;
}
function newChat() { compose(null, independentMachine()); }
function compose(id, target = machineId) {
  closeSide();
  ++navigation;
  opening = 0;
  sessionRequest?.abort();
  setConnectionProblem('history', false);
  clearSessionLoading();
  ++generation;
  closeStream();
  machineId = target;
  session = undefined;
  retry = undefined;
  projectId = id || null;
  history.replaceState(null, '', workspaceUrl());
  const project = currentProject();
  if (project) { navState.projects[resourceKey(target, project.id)] = true; saveNav(); }
  $('app').classList.add('view-empty');
  $('app').classList.remove('scrolled');
  $('empty').hidden = false;
  $('conversation').hidden = true;
  $('composer').hidden = false;
  openGroups.clear();
  rebuild([]);
  older = undefined;
  if (projectId) draft(machineKey('ra.draft.p.' + projectId));
  else draft('ra.draft.standalone', machineKey('ra.draft.standalone'));
  agentOptions();
  drawChrome();
  drawNav();
  drawer(false);
  updateToBottom();
  if (finePointer.matches && !$('prompt').disabled) $('prompt').focus();
}
const notificationKey = 'ra.finish-notifications';
function notificationsAvailable() {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator
    && typeof ServiceWorkerRegistration !== 'undefined' && 'showNotification' in ServiceWorkerRegistration.prototype;
}
function notificationsEnabled() {
  return notificationsAvailable() && Notification.permission === 'granted' && localStorage.getItem(notificationKey) === '1';
}
function drawNotificationSettings() {
  const available = notificationsAvailable();
  const denied = available && Notification.permission === 'denied';
  const enabled = notificationsEnabled();
  $('notification-toggle').disabled = !available || denied;
  $('notification-toggle').textContent = enabled ? t('Turn off notifications') : t('Turn on notifications');
  $('notification-status').textContent = !available ? t('Not supported in this browser') : denied ? t('Blocked by the browser') : enabled ? t('On') : t('Off');
}
let notificationRegistration;
function notificationWorker() {
  return notificationRegistration ??= navigator.serviceWorker.register('/notifications.js')
    .then(() => navigator.serviceWorker.ready).catch(error => { notificationRegistration = undefined; throw error; });
}
async function notifyResult(item, key) {
  try {
    const worker = await notificationWorker();
    if (!notificationsEnabled() || $('app').hidden) return;
    const seen = 'ra.finish.' + key;
    if (Number(localStorage.getItem(seen)) >= item.updated) return;
    localStorage.setItem(seen, String(item.updated));
    await worker.showNotification('Ferry · ' + resultLabel[item.state], {
      body: item.title || t('Chat ended'),
      tag: 'ra:' + key + ':' + item.updated, icon: '/icon.svg',
      data: { url: workspaceUrl(item.id, item.machine) },
    });
  } catch { /* The in-app status remains available if system notifications fail. */ }
}
$('notification-toggle').onclick = async () => {
  const button = $('notification-toggle');
  button.disabled = true;
  try {
    if (notificationsEnabled()) localStorage.removeItem(notificationKey);
    else if (await Notification.requestPermission() === 'granted') {
      await notificationWorker();
      localStorage.setItem(notificationKey, '1');
    }
  } catch { $('machine-scan-result').textContent = t('Could not turn on notifications.'); }
  finally { drawNotificationSettings(); }
};
function observeResult(item, key) {
  const previous = observedStates.get(key);
  if (previous && item.updated < previous.updated) return;
  observedStates.set(key, { state: item.state, updated: item.updated });
  if (isRunning(item)) {
    storeNewerTime(runningKey + key, item.updated);
    return;
  }
  if (!resultLabel[item.state]) return;
  const runningAt = storedTime(runningKey + key);
  const finished = Boolean(runningAt && item.updated >= runningAt) ||
    Boolean(previous && (isRunning(previous) || (item.updated > previous.updated && hasRun(item))));
  if (!finished) return;
  if (runningAt && item.updated >= runningAt) localStorage.removeItem(runningKey + key);
  const unreadChanged = storeNewerTime(completionKey + key, item.updated);
  if (runningAt && viewedLiveResults.get(key) === runningAt) storeNewerTime(readKey + key, item.updated);
  viewedLiveResults.delete(key);
  if (previous && notificationsEnabled()) void notifyResult(item, key);
  return unreadChanged;
}

const runtimeFields = ['state', 'updated', 'activeTurn', 'waiting'];
let refreshRequest = 0;
let refreshing = false;
async function refresh(detect = false, quiet = false) {
  if (quiet && (refreshing || $('app').hidden)) return false;
  const revision = ++refreshRequest;
  const observedVersion = runtimeVersion;
  refreshing = true;
  try {
    const discover = detect || !machines.length;
    const list = discover ? await discoverMachines(detect) : machines;
    const updates = await Promise.allSettled(list.map(machine =>
      api('overview', undefined, machine.id, AbortSignal.timeout(6500))));
    if (revision !== refreshRequest || $('app').hidden) return false;
    setConnectionProblem('inventory', Boolean(stream?.readyState !== EventSource.OPEN && list.length && updates.every(result =>
      result.status === 'rejected' && isConnectionError(result.reason))));
    let redrawNav = !quiet;
    let redrawChrome = !quiet;
    for (const [index, result] of updates.entries()) {
      const machine = list[index];
      if (quiet && result.status !== 'fulfilled') continue;
      machine.online = result.status === 'fulfilled';
      if (!machine.online) continue;
      const snapshot = result.value;
      const previous = inventories.get(machine.id);
      const knownSessions = new Map(previous?.sessions.map(item => [item.id, item]));
      if (!previous || ['storage', 'maxImages', 'videoInput', 'scheduling', 'sessionRenaming', 'name'].some(field => previous.machine[field] !== snapshot.machine[field])) {
        redrawChrome = redrawNav = true;
      }
      machine.name = snapshot.machine.name;
      machine.platform = snapshot.machine.platform;
      machine.agents = snapshot.agents;
      const sessions = snapshot.sessions.map(data => {
        const item = { ...data, machine: machine.id };
        const key = resourceKey(machine.id, item.id);
        const current = isCurrentSession(item.id, machine.id);
        const known = current ? session : knownSessions.get(item.id);
        const stale = known && ((runtimeVersions.get(key) || 0) > observedVersion || known.updated > item.updated);
        if (stale) for (const field of runtimeFields) item[field] = known[field];
        else if (observeResult(item, key)) redrawNav = true;
        const previousItem = knownSessions.get(item.id);
        const runtimeChanged = runtimeFields.some(field => known?.[field] !== item[field]);
        if (!previousItem || ['state', 'title', 'updated', 'pinned', 'archived', 'project', 'canBranch'].some(field =>
          previousItem[field] !== item[field])) redrawNav = true;
        if (current) {
          if (runtimeChanged) ++stateEvent;
          const metadata = ['title', 'pinned', 'archived', 'project', 'canBranch', 'branch_parent', 'branch_kind'];
          if (runtimeChanged || metadata.some(field => session[field] !== item[field])) redrawChrome = true;
          for (const field of [...runtimeFields, ...metadata]) session[field] = item[field];
          if (markOpenResultRead()) redrawNav = true;
        }
        return item;
      });
      if (previous && previous.sessions.length !== sessions.length) redrawNav = true;
      inventories.set(machine.id, {
        ...snapshot,
        projects: snapshot.projects.map(project => ({ ...project, machine: machine.id })),
        sessions,
      });
    }
    const registered = new Set(list.map(machine => machine.id));
    for (const id of inventories.keys()) if (!registered.has(id)) inventories.delete(id);
    if (detect) for (const info of optionCache.values()) info.retryAt = 0;
    const online = list.filter(machine => machine.online).length;
    $('machine').textContent = t('Machines');
    $('machine-detail').textContent = t('{online} / {total} online', { online, total: list.length });
    $('machine-dot').classList.toggle('online', online > 0);
    $('machine-dot').title = $('machine-detail').textContent;
    if (redrawNav) drawNav();
    if (!quiet || discover) agentOptions(detect);
    if (redrawChrome || (redrawNav && !session)) drawChrome();
    if (!quiet && $('machines-dialog').open) drawMachines();
    return online > 0;
  } catch (error) {
    if (revision !== refreshRequest || $('app').hidden) return false;
    const disconnected = isConnectionError(error);
    if (disconnected) setConnectionProblem('inventory', stream?.readyState !== EventSource.OPEN);
    if (quiet) return false;
    $('machine-dot').classList.remove('online');
    $('machine-detail').textContent = t('Disconnected');
    $('machine-dot').title = t('Lost connection to the machines');
    if (!disconnected) setError(error.message);
    if ($('machines-dialog').open) drawMachines();
    return false;
  } finally { if (revision === refreshRequest) refreshing = false; }
}
function drawMachines() {
  const platforms = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
  $('machine-list').replaceChildren(...machines.map(machine => {
    const entry = el('section', 'machine-entry');
    const card = el('div', 'machine-card');
    const title = el('div');
    title.append(el('strong', '', machine.name), el('small', '', platforms[machine.platform] || machine.platform || ''));
    const status = el('span', 'machine-state', machine.online ? t('Online') : t('Offline'));
    status.dataset.state = machine.online ? 'online' : 'offline';
    card.append(icon('device'), title, status);
    if (machine.online && machine.quota) card.append(btn('btn machine-quota', t('Quota'), () => showQuota(machine)));
    const agents = el('ul', 'agent-inventory');
    for (const agent of machine.agents) {
      const item = el('li', 'agent-inventory-item');
      item.append(el('strong', '', agent.name), el('span', '', agent.available ? agent.version || t('Available') : t('Not detected')));
      agents.append(item);
    }
    entry.append(card, agents);
    return entry;
  }));
}
const quotaResults = new Map();
const quotaDialog = $('quota-dialog');
let quotaTarget;
let quotaBackToMachines = false;
let findingQuotaMachines = false;
const supportsQuota = machine => machine.online && machine.quota;
const quotaStates = { 'signed-out': t('Native account signed out'), external: t('Quota managed by the provider'),
  inactive: t('Inactive · no quota from the native API'), unavailable: t('The native client returned no quota'),
  error: t('Could not read'), 'profile-mismatch': t('The launcher uses a different login directory') };
const quotaNames = { codex: 'Codex', claude: 'Claude Code', agy: 'Antigravity' };
function quotaAgents(machine) {
  return machine.agents?.some(agent => agent.id === 'agy' && agent.available) ? ['codex', 'claude', 'agy'] : ['codex', 'claude'];
}
function selectQuotaMachine(id) {
  const supported = machines.filter(supportsQuota);
  quotaTarget = supported.find(machine => machine.id === id) ?? supported[0];
  const picker = $('quota-machine');
  const options = machines.map(machine => {
    const note = !machine.online ? t(' (offline)') : !machine.quota ? t(' (no quota API)') : '';
    const option = new Option(machine.name + note, machine.id);
    option.disabled = !supportsQuota(machine);
    return option;
  });
  if (!quotaTarget) options.unshift(new Option(t('No machine available'), ''));
  picker.replaceChildren(...options);
  picker.value = quotaTarget?.id ?? '';
  picker.disabled = supported.length < 2;
}
function drawQuota() {
  if (!quotaTarget) {
    $('quota-refresh').disabled = findingQuotaMachines;
    $('quota-results').replaceChildren(el('p', 'quota-note',
      findingQuotaMachines ? t('Connecting to machines…') : t('No online machine reports quota.')));
    return;
  }
  const state = quotaResults.get(quotaTarget.id);
  $('quota-refresh').disabled = [...(state?.values() ?? [])].some(item => item.pending);
  $('quota-results').replaceChildren(...quotaAgents(quotaTarget).map(agent => {
    const group = el('section', 'quota-group');
    group.append(el('h3', '', quotaNames[agent]));
    const data = state?.get(agent);
    if (!data?.accounts?.length) {
      group.append(el('p', 'quota-note', data?.pending ? t('Reading quota…') : translateServer(data?.error) || t('No account detected')));
      return group;
    }
    for (const item of data.accounts) {
      const account = el('div', 'quota-account');
      account.append(el('strong', '', item.name || translateServer(item.profile) || t('Default')));
      const details = [item.workspace, item.plan, item.name && item.profile !== 'Default' && item.profile].filter(Boolean);
      if (details.length) account.append(el('p', 'quota-note', details.join(' · ')));
      if (!item.windows.length) account.append(el('p', 'quota-note', quotaStates[item.status] || t('No quota data')));
      for (const window of item.windows) {
        const windowRow = el('div', 'quota-window');
        const description = el('div', 'quota-window-label');
        const windowLabel = String(window.label ?? '').split(' · ').map(translateServer).join(' · ');
        const hasPercent = Number.isFinite(window.usedPercent);
        if (!hasPercent && !Number.isFinite(window.remainingAmount)) continue;
        const usage = hasPercent ? t('{value}% used', { value: (window.approximate ? '<' : '') + window.usedPercent })
          : t('{value} left', { value: window.remainingAmount.toLocaleString(locale) });
        description.append(el('span', '', windowLabel), el('strong', '', usage));
        windowRow.append(description);
        if (hasPercent) {
          const bar = el('progress');
          bar.max = 100;
          bar.value = window.usedPercent;
          bar.setAttribute('aria-label', t('{name} used percentage', { name: windowLabel }));
          windowRow.append(bar);
        }
        const reset = window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString(locale) : window.resetLabel;
        if (reset) windowRow.append(el('small', '', t('Resets {time}', { time: reset })));
        account.append(windowRow);
      }
      group.append(account);
    }
    if (data.checkedAt) group.append(el('p', 'quota-note', t('Updated {time}', { time: new Date(data.checkedAt).toLocaleTimeString(locale) })));
    if (data.error) group.append(el('p', 'quota-note', data.error));
    return group;
  }));
}
async function loadQuota(force = false) {
  const machine = quotaTarget;
  const { id } = machine;
  const state = quotaResults.get(id) ?? new Map();
  quotaResults.set(id, state);
  const requests = quotaAgents(machine).map(async agent => {
    if (state.get(agent)?.pending) return;
    state.set(agent, { ...state.get(agent), pending: true });
    try {
      const result = await api('quota?agent=' + agent + (force ? '&refresh=1' : ''), undefined, id);
      state.set(agent, result);
    } catch (error) {
      state.set(agent, { ...state.get(agent), pending: false, error: error.message });
    }
    if (quotaTarget?.id === id && quotaDialog.open) drawQuota();
  });
  drawQuota();
  await Promise.all(requests);
}
async function findQuotaMachines(force = false) {
  if (findingQuotaMachines) return;
  findingQuotaMachines = true;
  drawQuota();
  let error;
  try { await discoverMachines(force); }
  catch (failure) { error = failure; }
  finally { findingQuotaMachines = false; }
  if (!quotaDialog.open || quotaTarget) return;
  selectQuotaMachine(machineId);
  if (quotaTarget) void loadQuota(force);
  else {
    drawQuota();
    if (error) $('quota-results').replaceChildren(el('p', 'quota-note', error.message));
  }
}
function showQuota(machine) {
  quotaBackToMachines = $('machines-dialog').open;
  if (quotaBackToMachines) $('machines-dialog').close();
  const close = $('quota-close');
  close.setAttribute('aria-label', quotaBackToMachines ? t('Back to machines') : t('Close quota'));
  close.replaceChildren(icon(quotaBackToMachines ? 'arrow-left' : 'x'));
  selectQuotaMachine(machine?.id ?? machineId);
  quotaDialog.showModal();
  if (quotaTarget) void loadQuota();
  else if (!machines.length) void findQuotaMachines();
  else drawQuota();
}
if ($('quota-footer')) $('quota-footer').onclick = () => showQuota();
$('quota-machine').onchange = event => {
  selectQuotaMachine(event.currentTarget.value);
  if (quotaTarget) void loadQuota();
  else drawQuota();
};
$('quota-refresh').onclick = () => void (quotaTarget ? loadQuota(true) : findQuotaMachines(true));
function closeQuota() {
  quotaDialog.close();
  if (quotaBackToMachines) void showMachines();
}
$('quota-close').onclick = closeQuota;
quotaDialog.addEventListener('cancel', event => { event.preventDefault(); closeQuota(); });
let discoveryRequest = 0;
async function discoverMachines(detect = false) {
  const request = ++discoveryRequest;
  const result = await api('machines' + (detect ? '?refresh=1' : ''), undefined, primaryMachine, AbortSignal.timeout(6500));
  if (request === discoveryRequest) machines = sideFrame ? result.machines.filter(item => item.id === machineId) : result.machines;
  if ($('machines-dialog').open) drawMachines();
  return machines;
}
function drawMachineOptions(select, selected) {
  const options = machines.map(machine => {
    const option = new Option(machine.name + (machine.online ? '' : t(' (offline)')), machine.id);
    option.disabled = !machine.online && machine.id !== selected;
    return option;
  });
  if (!options.some(option => option.value === selected)) options.unshift(new Option(machineName(selected), selected));
  select.replaceChildren(...options);
  select.value = selected;
}
async function showMachines() {
  drawer(false);
  drawMachines();
  drawNotificationSettings();
  $('machines-dialog').showModal();
  $('machine-scan-result').textContent = t('Loading machines…');
  try { await discoverMachines(); $('machine-scan-result').textContent = ''; }
  catch (error) { $('machine-scan-result').textContent = error.message; }
}
$('machines-top').onclick = showMachines;
if ($('machines-footer')) $('machines-footer').onclick = showMachines;
$('close-machines').onclick = () => $('machines-dialog').close();
$('language').replaceChildren(new Option(t('Automatic'), ''), ...languages.map(([id, name]) => new Option(name, id)));
$('language').value = savedLanguage();
$('language').onchange = () => setLanguage($('language').value);
$('scan-machines').onclick = async () => {
  const button = $('scan-machines');
  const result = $('machine-scan-result');
  button.disabled = true;
  result.textContent = t('Detecting machines and agents…');
  try {
    await refresh(true);
    result.textContent = t('{n} machines online', { n: machines.filter(machine => machine.online).length });
  } catch (error) { result.textContent = error.message; }
  finally { button.disabled = false; }
};

if ($('pair-machine-form')) {
  const dialog = $('pair-machine-dialog');
  const form = $('pair-machine-form');
  const address = $('pair-machine-address');
  const code = $('pair-machine-code');
  const status = $('pair-machine-status');
  const cancel = $('cancel-pair-machine');
  const confirm = $('confirm-pair-machine');
  $('add-machine').onclick = () => {
    form.reset();
    status.textContent = '';
    delete status.dataset.error;
    dialog.showModal();
  };
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (confirm.disabled) event.preventDefault(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (confirm.disabled) return;
    const verification = code.value.replace(/\s/g, '');
    if (!/^[0-9]{8}$/.test(verification)) {
      status.textContent = t('Enter the 8-digit code.');
      status.dataset.error = 'true';
      code.focus();
      return;
    }
    confirm.disabled = cancel.disabled = address.disabled = code.disabled = true;
    status.textContent = t('Verifying…');
    delete status.dataset.error;
    try {
      const machine = await api('machines/pair', { address: address.value.trim(), code: verification }, primaryMachine);
      ++discoveryRequest;
      if (!machines.some(item => item.id === machine.id)) {
        machines = [...machines, { ...machine, agents: [], online: true }];
      }
      dialog.close();
      form.reset();
      drawMachines();
      $('machine-scan-result').textContent = t('Added {name}', { name: machine.name });
      void refresh();
    } catch (error) {
      status.textContent = error.message;
      status.dataset.error = 'true';
    } finally {
      confirm.disabled = cancel.disabled = address.disabled = code.disabled = false;
      if (dialog.open) code.focus();
    }
  };
  $('add-machine').hidden = false;
}
function drawSessionLoadingTitle() {
  const { id, target } = pendingSession;
  const item = inventories.get(target)?.sessions.find(it => it.id === id);
  const project = projectOf(item?.project, target);
  $('title').textContent = item?.title || t('Opening chat');
  $('breadcrumb').textContent = [project?.name, machineName(target), item?.agent && agentName(item.agent, target)].filter(Boolean).join(' · ');
  $('breadcrumb').title = project?.directory || '';
  $('pin-session').hidden = $('archive-session').hidden = true;
  $('rename-open').hidden = true;
  $('branches-open').hidden = $('origin-session').hidden = true;
  if ($('session-more')) $('session-more').hidden = true;
  $('schedule-open').hidden = true;
}
function showSessionLoading(id, target) {
  pendingSession = { id, target };
  $('app').classList.remove('view-empty');
  $('empty').hidden = true;
  $('conversation').hidden = false;
  $('conversation').setAttribute('aria-busy', 'true');
  $('session-loading').hidden = false;
  $('scroll').inert = $('composer').inert = true;
  drawSessionLoadingTitle();
  drawProgress();
  drawNav();
  drawer(false);
  updateToBottom();
  setError();
}
function clearSessionLoading() {
  if (!pendingSession) return;
  pendingSession = undefined;
  $('conversation').removeAttribute('aria-busy');
  $('session-loading').hidden = true;
  $('scroll').inert = $('composer').inert = false;
}
async function loadSession(id, target, signal) {
  const path = 'sessions/' + encodeURIComponent(id);
  const data = await api(path, undefined, target, signal);
  // Older hosts can cut the first page inside a long batch of tools.
  if (!data.older || data.includesRecentReplies) return data;
  const countReplies = messages => messages.filter(message => message?.role === 'agent' && message.text?.trim()).length;
  const pages = [data.messages ?? []];
  let replies = countReplies(pages[0]);
  let before = data.older;
  while (before && replies < 3) {
    const previous = await api(path + '/messages?before=' + before, undefined, target, signal);
    if (previous.older && previous.older >= before) throw new Error(t('Could not load more history. Reopen the chat.'));
    const messages = previous.messages ?? [];
    pages.push(messages);
    before = previous.older;
    replies += countReplies(messages);
  }
  return { ...data, messages: pages.reverse().flat(), older: before };
}
async function openSession(id, { reset = false, keep = false, target = machineId } = {}) {
  if (!reset && !keep && !pendingSession && isCurrentSession(id, target)) {
    if (markOpenResultRead()) drawNav();
    drawer(false);
    stick = true;
    scrollToLatest();
    updateToBottom();
    return;
  }
  const request = ++navigation;
  sessionRequest?.abort();
  setConnectionProblem('history', false);
  const controller = new AbortController();
  sessionRequest = controller;
  opening = request;
  if (!reset) showSessionLoading(id, target);
  let data;
  try {
    data = await readWithReconnect('history', () => loadSession(id, target,
      AbortSignal.any?.([controller.signal, AbortSignal.timeout(10000)]) ?? controller.signal), controller.signal);
  }
  catch (error) {
    if (request !== navigation) return;
    setConnectionProblem('history', false);
    clearSessionLoading();
    $('conversation').hidden = !session;
    $('empty').hidden = Boolean(session);
    $('app').classList.toggle('view-empty', !session);
    drawChrome();
    drawNav();
    updateToBottom();
    throw error;
  }
  finally {
    if (sessionRequest === controller) sessionRequest = undefined;
    if (opening === request) opening = 0;
  }
  if (request !== navigation) return;
  clearSessionLoading();
  if (sideOrigin && sideOrigin !== resourceKey(target, id)) closeSide();
  const revision = ++generation;
  closeStream();
  const keepPosition = reset && !stick && !atBottom(2);
  const scrollTop = scrollArea.scrollTop;
  if (!isCurrentSession(id, target)) {
    openGroups.clear();
  }
  machineId = target;
  session = { ...data.session, machine: target };
  mergeSession(session, target);
  markOpenResultRead();
  projectId = session.project || null;
  if (projectId) {
    const key = resourceKey(target, projectId);
    navState.projects[key] ??= navState.projects[projectId] ?? true;
    saveNav();
  }
  history.replaceState(null, '', workspaceUrl(id));
  $('app').classList.remove('view-empty', 'scrolled');
  $('empty').hidden = true;
  $('conversation').hidden = false;
  $('composer').hidden = false;
  rebuild((data.messages ?? []).filter(message => message?.id).map(makeEntry));
  older = data.older;
  $('older').hidden = !older;
  const oldDraft = 'ra.draft.' + id;
  const hasPrimarySession = inventories.get(primaryMachine)?.sessions.some(item => item.id === id);
  draft(machineKey(oldDraft, target), target !== primaryMachine && !hasPrimarySession ? oldDraft : undefined, keep);
  agentOptions();
  drawChrome();
  drawNav();
  drawer(false);
  if (!reset && finePointer.matches && !$('prompt').disabled) $('prompt').focus({ preventScroll: true });
  stick = !keepPosition;
  if (stick) scrollToLatest();
  else {
    scrollArea.scrollTop = scrollTop;
    lastScrollTop = scrollArea.scrollTop;
  }
  updateToBottom();
  watchSession(id, target, revision, data.cursor);
}
let streamRetry;
function watchSession(id, target, revision, cursor) {
  const source = new EventSource(apiUrl('sessions/' + encodeURIComponent(id) + '/events?after=' + cursor, target));
  stream = source;
  const current = () => generation === revision && stream === source;
  source.onmessage = ({ data: encoded }) => {
    if (!current()) return;
    let event;
    try { event = JSON.parse(encoded); } catch { return; }
    if (event.seq <= cursor) return;
    cursor = event.seq;
    if (event.type === 'message') addMessage(event.payload);
    else if (event.type === 'delta') {
      const entry = rendered.get(event.payload.id);
      if (entry?.role === 'agent' && event.payload.text) reveals.set(entry, (reveals.get(entry) || '') + event.payload.text);
      else if (entry) { entry.text += event.payload.text || ''; entry.dirty = true; pending.add(entry.turn); }
    } else if (event.type === 'state') {
      ++stateEvent;
      if (isRunning(session) && resultLabel[event.payload.state] && isViewingSession()) {
        const key = resourceKey(target, session.id);
        viewedLiveResults.set(key, storedTime(runningKey + key));
      }
      session.state = event.payload.state;
      session.activeTurn = event.payload.turn || null;
      session.waiting = '';
      mergeSession({ id: session.id, state: session.state, activeTurn: session.activeTurn, waiting: session.waiting }, target);
      drawState();
      drawNav();
      if (resultLabel[session.state]) void refresh(false, true);
    } else if (event.type === 'waiting') {
      ++stateEvent;
      session.waiting = event.payload.text;
      session.activeTurn = event.payload.turn;
      mergeSession({ id: session.id, activeTurn: session.activeTurn, waiting: session.waiting }, target);
      drawState();
    }
    schedule();
  };
  source.addEventListener('reset', () => {
    if (current() && !opening) void openSession(id, { reset: true, target }).catch(error => setError(error.message));
  });
  source.onopen = () => {
    if (!current()) return;
    connectionProblems.delete('inventory');
    setConnectionProblem('stream', false);
  };
  source.onerror = () => {
    if (!current()) return;
    setConnectionProblem('stream', true);
    if (source.readyState !== EventSource.CLOSED) return;
    clearTimeout(streamRetry);
    streamRetry = setTimeout(async () => {
      if (!current()) return;
      const auth = await api('auth', undefined, primaryMachine, AbortSignal.timeout(6500)).catch(() => undefined);
      if (!current()) return;
      if (auth?.signedIn === false) loginView();
      else watchSession(id, target, revision, cursor);
    }, 1800);
  };
}

/* ---------- folder picker ---------- */
function folderError(error) { $('folder-error').textContent = error.message; }
function drawPlaces(locations) {
  const places = [];
  const seen = new Set();
  const add = (name, path) => {
    if (path === undefined || seen.has(path)) return;
    seen.add(path);
    places.push({ name, path });
  };
  if (homePath) add(t('Home'), homePath);
  add(t('Root'), '/');
  const activeLocations = inventories.get($('folder-machine').value)?.machine.locations;
  for (const place of locations ?? activeLocations ?? []) add(translateServer(place.name), place.path);
  $('folder-places').replaceChildren(...places.map(place => {
    const node = btn('place', place.name, () => { folderOffsets = []; void browse(place.path).catch(folderError); });
    node.title = place.path;
    node.setAttribute('aria-pressed', String(place.path === currentPath));
    return node;
  }));
}
async function browse(path, offset = 0) {
  const revision = ++folderRequest;
  $('folders').setAttribute('aria-busy', 'true');
  const target = $('folder-machine').value;
  const query = (path ? 'path=' + encodeURIComponent(path) + '&' : '') + 'offset=' + offset;
  try {
    const data = await api('directories?' + query, undefined, target);
    if (revision !== folderRequest) return;
    if (!path && !homePath) homePath = data.path;
    if (data.path !== currentPath) folderOffsets = offset ? folderOffsets : [];
    currentPath = data.path;
    $('folder-path').value = data.path;
    $('folder-current').textContent = t('Current: {path}', { path: data.path });
    $('folder-error').textContent = '';
    const rows = [];
    if (data.parent) rows.push(btn('folder-row parent', [icon('up'), t('Up one level')], () => { folderOffsets = []; void browse(data.parent).catch(folderError); }));
    rows.push(...(data.entries ?? []).map(entry => {
      const node = btn('folder-row', [icon('folder'), entry.name], () => { folderOffsets = []; void browse(entry.path).catch(folderError); });
      node.title = entry.path;
      return node;
    }));
    if (!(data.entries ?? []).length) rows.push(el('p', 'folder-none', t('No subfolders')));
    $('folders').replaceChildren(...rows);
    $('folders').scrollTop = 0;
    const pager = [];
    if (offset) pager.push(btn('btn', t('Previous'), () => { void browse(data.path, folderOffsets.pop() ?? 0).catch(folderError); }));
    if (data.next !== null && data.next !== undefined) pager.push(btn('btn', t('Next'), () => { folderOffsets.push(offset); void browse(data.path, data.next).catch(folderError); }));
    $('folder-pager').replaceChildren(...pager);
    drawPlaces(data.locations);
  } finally {
    if (revision === folderRequest) $('folders').removeAttribute('aria-busy');
  }
}
function resetFolder() {
  homePath = undefined;
  $('folder-error').textContent = '';
  $('folder-current').textContent = '';
  currentPath = undefined;
  folderOffsets = [];
  $('folder-path').value = '';
  $('folders').replaceChildren();
  $('folder-pager').replaceChildren();
  drawPlaces();
  void browse().catch(folderError);
}
function showFolders() {
  drawer(false);
  const select = $('folder-machine');
  drawMachineOptions(select, machines.find(machine => machine.id === machineId && machine.online)?.id ??
    machines.find(machine => machine.online)?.id ?? machineId);
  $('folder-dialog').showModal();
  resetFolder();
  void discoverMachines().then(() => {
    if ($('folder-dialog').open) drawMachineOptions(select, select.value);
  }).catch(folderError);
}

/* ---------- wiring ---------- */
$('new-project').onclick = $('empty-action').onclick = showFolders;
$('new-chat').onclick = newChat;
function setDraftDestination(project, target) {
  ++navigation;
  opening = 0;
  ++generation;
  projectId = project;
  machineId = target;
  history.replaceState(null, '', workspaceUrl());
  agentOptions();
  drawChrome();
  drawNav();
}
$('chat-project').onchange = () => {
  if (session || locked) return;
  const key = $('chat-project').value;
  const project = projectsAcrossMachines().find(item => !item.archived && resourceKey(item.machine, item.id) === key);
  if (project) setDraftDestination(project.id, project.machine);
  else if (!key) setDraftDestination(null, independentMachine());
};
$('chat-machine').onchange = () => {
  if (session || projectId || locked) return;
  const target = $('chat-machine').value;
  if (!machines.some(machine => machine.id === target && machine.online)) return;
  localStorage.setItem('ra.machine', target);
  setDraftDestination(null, target);
};
$('close-folder').onclick = $('cancel-folder').onclick = () => $('folder-dialog').close();
$('folder-machine').onchange = resetFolder;
$('browse-path').onclick = () => { folderOffsets = []; void browse($('folder-path').value.trim()).catch(folderError); };
$('folder-path').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('browse-path').click(); }
});
$('folder-form').onsubmit = async event => {
  event.preventDefault();
  const submit = event.submitter || $('folder-form').querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const target = $('folder-machine').value;
    const project = await api('projects', { path: $('folder-path').value.trim() || currentPath }, target);
    const projects = inventories.get(target)?.projects;
    if (projects && !projects.some(item => item.id === project.id)) projects.unshift({ ...project, machine: target });
    if (!projects) await refresh();
    if ($('folder-dialog').open && $('folder-machine').value === target) {
      $('folder-dialog').close();
      compose(project.id, target);
    } else drawNav();
    void refresh();
  } catch (error) { folderError(error); }
  finally { submit.disabled = false; }
};
$('older').onclick = async () => {
  const activeId = session?.id;
  const target = machineId;
  if (!activeId || !older) return;
  $('older').disabled = true;
  try {
    const data = await api('sessions/' + encodeURIComponent(activeId) + '/messages?before=' + older, undefined, target);
    if (!isCurrentSession(activeId, target)) return;
    const area = $('scroll');
    const height = area.scrollHeight;
    const top = area.scrollTop;
    const fresh = (data.messages ?? []).filter(message => message?.id && !rendered.has(message.id)).map(makeEntry);
    // Only remount the boundary turn if its user message is on the previous page.
    if (fresh.length && entries[0]?.role !== 'user' && turns.length) {
      const boundary = turns.shift();
      const split = entries.findIndex(entry => entry.turn !== boundary);
      fresh.push(...entries.splice(0, split < 0 ? entries.length : split));
      pending.delete(boundary);
      boundary.node.remove();
    }
    const fragment = document.createDocumentFragment();
    const prepend = [];
    for (const entry of fresh) place(entry, prepend, fragment);
    turns.unshift(...prepend);
    entries = [...fresh, ...entries];
    for (const turn of prepend) { drawTurn(turn); pending.delete(turn); }
    $('messages').prepend(fragment);
    older = data.older;
    $('older').hidden = !older;
    area.scrollTop = top + area.scrollHeight - height;
    lastScrollTop = area.scrollTop;
  } catch (error) { setError(error.message); }
  finally { $('older').disabled = false; }
};
scrollArea.addEventListener('scroll', () => {
  const top = scrollArea.scrollTop;
  if (atBottom(2)) stick = true;
  else if (top < lastScrollTop) stick = false;
  lastScrollTop = top;
  updateToBottom();
  $('app').classList.toggle('scrolled', top > 4);
}, { passive: true });
scrollArea.addEventListener('wheel', event => { if (event.deltaY < 0) stick = false; }, { passive: true });
{
  const app = $('app');
  let touchStart;
  app.addEventListener('touchstart', event => {
    touchStart = event.touches.length === 1 ? event.touches[0] : undefined;
  }, { passive: true });
  app.addEventListener('touchmove', event => {
    if (!touchStart || event.touches.length !== 1 || !event.cancelable) return;
    const { identifier, clientX, clientY, target } = event.touches[0];
    if (identifier !== touchStart.identifier || (window.visualViewport?.scale ?? 1) > 1.01) return;
    const dy = clientY - touchStart.clientY;
    if (Math.abs(dy) <= Math.abs(clientX - touchStart.clientX)) return;

    // iOS can hand the swipe to the viewport when the touched area has no scroll range.
    for (let node = target; node instanceof Element && node !== app; node = node.parentElement) {
      const available = dy > 0 ? node.scrollTop : node.scrollHeight - node.clientHeight - node.scrollTop;
      if (available <= 0.5 || !/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) continue;
      if (node === scrollArea && dy > 0) stick = false;
      return;
    }
    event.preventDefault();
  }, { passive: false });
}
$('to-bottom').onclick = () => { stick = true; scrollToLatest(); updateToBottom(); };
$('prompt').addEventListener('input', () => { persistDraft(); fitPrompt(); });
$('prompt').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
  if (event.metaKey || event.ctrlKey || (finePointer.matches && !event.shiftKey && !event.altKey)) {
    event.preventDefault();
    if (!$('send').disabled) $('composer').requestSubmit();
  }
});
$('agent').onchange = () => {
  localStorage.setItem(agentKey(), $('agent').value);
  syncChoice();
  loadOptions($('agent').value);
  drawPickers();
  drawState();
};
$('model').onchange = () => { choice.model = $('model').value; drawPickers(); rememberChoice(); };
$('effort').onchange = () => { choice.effort = $('effort').value; rememberChoice(); pickerTitles(); };
$('attach').onclick = () => $('file').click();
$('file').onchange = () => { addMedia([...$('file').files]); $('file').value = ''; };
$('composer').addEventListener('paste', event => {
  const data = event.clipboardData;
  if (!data) return;
  const files = [...data.files].filter(file => /^(image|video)\//.test(mediaType(file)));
  if (!files.length) {
    for (const item of data.items ?? []) {
      const file = item.kind === 'file' && item.getAsFile();
      if (file && /^(image|video)\//.test(mediaType(file))) files.push(file);
    }
  }
  if (!files.length) return;
  if (!data.getData('text/plain')) event.preventDefault();
  addMedia(files);
});
{
  const box = $('compose-box');
  const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
  box.addEventListener('dragover', event => {
    if (!hasFiles(event) || blocked()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    box.classList.add('dragging');
  });
  box.addEventListener('dragleave', event => { if (!box.contains(event.relatedTarget)) box.classList.remove('dragging'); });
  box.addEventListener('drop', event => {
    box.classList.remove('dragging');
    if (!hasFiles(event) || blocked()) return;
    event.preventDefault();
    addMedia([...event.dataTransfer.files]);
  });
}
$('composer').onsubmit = async event => {
  event.preventDefault();
  if (locked || $('send').disabled || blocked()) return;
  const text = $('prompt').value;
  const files = attachments.slice();
  const video = files.find(isVideo);
  const pictures = files.filter(item => !isVideo(item));
  if (!text.trim() && !files.length) return;
  if (pictures.length && !acceptsImages()) { setError(t('The selected model does not accept images. Remove them or choose a model that does.')); return; }
  const limit = imageCountLimit();
  if (pictures.length > limit) { setError(t('This machine accepts up to {n} images per message.', { n: limit })); return; }
  if (video && !acceptsVideo()) { setError(t('This machine cannot receive videos.')); return; }
  const steer = session?.state === 'running' ? session.activeTurn : undefined;
  const model = $('model').value;
  const effort = $('effort').value;
  const priorDraft = draftKey;
  const selection = generation;
  const target = machineId;
  const destination = projectId || null;
  const chosenAgent = $('agent').value;
  const submission = { navigation, steer };
  outgoing = submission;
  let accepted = false;
  locked = true;
  drawState();
  if (session && !steer) {
    stick = true;
    scrollToLatest();
    updateToBottom();
  }
  try {
    const images = [];
    for (let offset = 0; offset < pictures.length; offset += IMAGE_ENCODING_CONCURRENCY) {
      images.push(...await Promise.all(pictures.slice(offset, offset + IMAGE_ENCODING_CONCURRENCY).map(encodeMedia)));
    }
    const clip = video && await encodeMedia(video);
    if (generation !== selection) return;
    if (!session) {
      const created = await api('sessions', { project: destination, agent: chosenAgent }, target);
      localStorage.setItem(machineKey('ra.agent.' + (destination || 'standalone'), target), created.agent);
      mergeSession(created, target);
      if (generation !== selection) { drawNav(); return; }
      submission.navigation = navigation + 1;
      await openSession(created.id, { keep: true, target });
      if (!isCurrentSession(created.id, target)) return;
      $('prompt').value = text;
      persistDraft();
      localStorage.removeItem(priorDraft);
      choice = { scope: choiceScope(), model, effort };
      drawPickers();
    }
    const id = session.id;
    const sentDraft = draftKey;
    const requestState = stateEvent;
    const settings = steer ? { steer } : { model, effort };
    const signature = JSON.stringify([text, settings, files.map(item => item.key)]);
    const retryKey = resourceKey(target, id);
    if (retry?.signature !== signature || retry.session !== retryKey) {
      retry = { session: retryKey, signature, id: Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('') };
    }
    submission.messageId = retry.id + '-user';
    const value = await api('sessions/' + encodeURIComponent(id) + '/send', { id: retry.id, text, ...settings, images, ...(clip && { video: clip }) }, target);
    accepted = value.session?.state === 'running';
    retry = undefined;
    const sentFiles = new Set(files.map(item => item.key));
    if (sentFiles.size) await deleteDraftFiles(sentDraft, sentFiles);
    if (isCurrentSession(id, target)) {
      if ($('prompt').value === text) $('prompt').value = '';
      persistDraft();
      fitPrompt();
      for (const item of attachments) if (sentFiles.has(item.key)) URL.revokeObjectURL(item.url);
      attachments = attachments.filter(item => !sentFiles.has(item.key));
      drawAttachments();
      if (!steer) {
        if (choice.model === model && choice.effort === effort) rememberChoice();
        if (value.session) {
          const patch = { ...value.session };
          if (stateEvent !== requestState) {
            delete patch.state;
            delete patch.activeTurn;
            delete patch.waiting;
          }
          Object.assign(session, patch);
          mergeSession(patch, target);
        }
      }
      stick = true;
      schedule();
      drawChrome();
      drawNav();
    } else if (localStorage.getItem(sentDraft) === text) localStorage.removeItem(sentDraft);
    setError();
  } catch (error) { setError(error.message); }
  finally {
    if (outgoing === submission && (!accepted || steer || session?.state !== 'running' || submission.navigation !== navigation)) {
      outgoing = undefined;
    }
    locked = false;
    drawState();
  }
};
$('stop').onclick = async () => {
  if (!session) return;
  const { id, machine } = session;
  $('stop').disabled = true;
  try { await api('sessions/' + encodeURIComponent(id) + '/stop', {}, machine); }
  catch (error) { if (isCurrentSession(id, machine)) { $('stop').disabled = false; setError(error.message); } }
};
$('restore').onclick = () => {
  const project = session ? projectOf(session.project) : currentProject();
  if (project?.archived) void setProjectPref(project, { archived: false });
  else if (session?.archived) void setSessionPref(session, { archived: false });
};
$('pin-session').onclick = async () => {
  const pin = $('pin-session');
  if (!session || pin.hidden || pin.disabled) return;
  pin.disabled = true;
  try { await setSessionPref(session, { pinned: !session.pinned }); }
  finally { pin.disabled = false; }
};
$('archive-session').onclick = () => { if (session) void setSessionPref(session, { archived: !session.archived }); };
if ($('session-more')) {
  const dialog = $('session-actions-dialog');
  $('session-more').onclick = () => {
    const items = sessionActions.flatMap(([id, glyph]) => {
      const action = $(id);
      if (action.hidden) return [];
      return [btn('branch-item', [icon(glyph), action.getAttribute('aria-label')], () => {
        dialog.close();
        action.click();
      })];
    });
    if (items.length) {
      $('session-actions-list').replaceChildren(...items);
      dialog.showModal();
    }
  };
  $('session-actions-close').onclick = () => dialog.close();
}

{
  const dialog = $('schedule-dialog');
  const form = $('schedule-form');
  const errors = $('schedule-error');
  const timeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  let selection;
  let refreshTimer;
  const localTime = date => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0,16);
  async function refreshSchedules() {
    const selected = selection;
    if (!selected) return;
    try {
      const { schedules } = await api(selected.path, undefined, selected.machine);
      if (selection !== selected) return;
      $('schedule-list').replaceChildren(...schedules.map(task => {
        const item = el('div', 'schedule-item');
        const content = el('div');
        const name = el('div', 'schedule-item-title', task.prompt.split('\n')[0]);
        name.title = task.prompt;
        const status = task.state === 'paused' ? t('Paused') : task.state === 'done' ? (task.last_at ? t('Ran') : t('Expired'))
          : task.next_at <= Date.now() ? t('Waiting to run') : t('Next {time}', { time: timeFormat.format(task.next_at) });
        const repeat = task.every_min ? t('Every {n} min', { n: task.every_min }) : t('Once');
        content.append(name, el('small', 'schedule-item-meta', [status, repeat, task.last_error].filter(Boolean).join(' · ')));
        item.append(content);
        if (task.state !== 'done' && (!task.until_at || task.until_at > Date.now())) {
          const toggle = btn('btn', task.state === 'paused' ? t('Resume') : t('Pause'), async event => {
            const button = event.currentTarget;
            button.disabled = true;
            errors.textContent = '';
            try {
              await api(selected.path + '/' + task.id, { enabled: task.state === 'paused' }, selected.machine);
              await refreshSchedules();
            } catch (error) { if (selection === selected) errors.textContent = error.message; }
            finally { button.disabled = false; }
          });
          item.append(toggle);
        }
        return item;
      }));
    } catch (error) { if (selection === selected) errors.textContent = error.message; }
  }
  $('schedule-open').onclick = () => {
    if (!session || pendingSession || blocked()) return;
    selection = { path: 'sessions/' + encodeURIComponent(session.id) + '/schedules', machine: machineId };
    form.reset();
    $('schedule-repeat').hidden = true;
    $('schedule-start').min = localTime(new Date());
    $('schedule-start').value = localTime(new Date(Date.now() + 5 * 60_000));
    $('schedule-context').textContent = (session.title || t('New chat')) + ' · ' + machineName(machineId);
    errors.textContent = '';
    $('schedule-list').replaceChildren();
    dialog.showModal();
    void refreshSchedules();
    refreshTimer = setInterval(refreshSchedules, 8000);
  };
  $('schedule-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { selection = undefined; clearInterval(refreshTimer); });
  $('schedule-mode').onchange = () => { $('schedule-repeat').hidden = $('schedule-mode').value !== 'repeat'; };
  form.onsubmit = async event => {
    event.preventDefault();
    const selected = selection;
    if (!selected) return;
    const button = $('schedule-create');
    button.disabled = true;
    errors.textContent = '';
    try {
      const every = $('schedule-mode').value === 'repeat' ? Number($('schedule-every').value) : 0;
      if ($('schedule-mode').value === 'repeat' && !every) throw new Error(t('Enter a repeat interval.'));
      const limit = every && $('schedule-until').value;
      await api(selected.path, {
        prompt: $('schedule-prompt').value,
        startAt: new Date($('schedule-start').value).getTime(),
        every, untilAt: limit ? new Date(limit).getTime() : null,
      }, selected.machine);
      if (selection === selected) {
        $('schedule-prompt').value = '';
        await refreshSchedules();
      }
    } catch (error) { if (selection === selected) errors.textContent = error.message; }
    finally { button.disabled = false; }
  };
}
$('menu').onclick = () => {
  if (mobile.matches) drawer(true);
  else { navState.collapsed = false; saveNav(); applyCollapse(); }
};
$('collapse').onclick = () => {
  if (mobile.matches) return drawer(false);
  toggleSidebar();
};
{
  const handle = $('resizer');
  handle.addEventListener('pointerdown', event => {
    if (mobile.matches || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    sideDrag = { x: event.clientX, width: $('sidebar').getBoundingClientRect().width };
    $('app').classList.add('resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (sideDrag && handle.hasPointerCapture(event.pointerId)) setSideWidth(sideDrag.width + event.clientX - sideDrag.x, false);
  });
  const end = () => {
    if (!sideDrag) return;
    sideDrag = undefined;
    $('app').classList.remove('resizing');
    if (sideWidth) localStorage.setItem('ra.sideWidth', String(sideWidth));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
  handle.addEventListener('keydown', event => {
    const now = $('sidebar').getBoundingClientRect().width;
    const step = event.shiftKey ? 48 : 16;
    const next = ({ ArrowLeft: now - step, ArrowRight: now + step, Home: SIDE_MIN, End: sideMax() })[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSideWidth(next, true);
  });
  window.addEventListener('resize', () => { applySideWidth(); fitPrompt(); });
}
$('overlay').onclick = () => drawer(false);
$('logout').onclick = async () => {
  try { await api('logout', {}); } catch (error) { setError(error.message); return; }
  loginView();
};
mobile.addEventListener('change', () => { drawer(false); applyCollapse(); });
/* Workspace shortcuts */
if (appleKeys) $('pin-session').setAttribute('aria-keyshortcuts', 'Alt+Meta+P');
if ($('quick-open')) {
  $('quick-open').title = t('Quick switch ({key})', { key: appleKeys ? '⌘K' : 'Ctrl+K' });
  $('quick-open').setAttribute('aria-keyshortcuts', appleKeys ? 'Meta+K' : 'Control+K');
}
document.addEventListener('keydown', event => {
  if (!(appleKeys ? event.metaKey : event.ctrlKey) || event.defaultPrevented || event.isComposing) return;
  if (sideFrame || $('app').hidden || $('folder-dialog').open || $('machines-dialog').open || quotaDialog.open || $('branches-dialog').open) return;
  if (event.altKey) {
    const pin = $('pin-session');
    if (!appleKeys || event.code !== 'KeyP' || event.ctrlKey || event.shiftKey || pin.hidden || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (!event.repeat) pin.click();
    return;
  }
  if (event.code === 'KeyK' && !event.shiftKey && $('quick-dialog')) {
    event.preventDefault();
    if (!event.repeat) openQuickSwitch();
    return;
  }
  if ($('quick-dialog')?.open) return;
  if (event.code === 'KeyB' && !event.shiftKey) { event.preventDefault(); toggleSidebar(); }
  else if (event.code === 'KeyO' && event.shiftKey) { event.preventDefault(); $('new-chat').click(); }
});
/* Sidebar arrow-key navigation: ↑/↓/Home/End move between rows, ←/→ collapse/expand. */
$('nav').addEventListener('keydown', event => {
  const { key, target } = event;
  const list = target.closest('.menu');
  if (list && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
    const items = [...list.querySelectorAll('.menu-item')];
    const index = items.indexOf(target);
    const next = key === 'Home' ? 0 : key === 'End' ? items.length - 1 : (index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
    return;
  }
  if (!target.matches('.group-toggle, .row-main, .show-more')) return;
  if ((key === 'ArrowRight' || key === 'ArrowLeft') && target.hasAttribute('aria-expanded')) {
    const open = target.getAttribute('aria-expanded') === 'true';
    if (open === (key === 'ArrowLeft')) { event.preventDefault(); target.click(); }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
  const items = [...$('nav').querySelectorAll('.group-toggle, .row-main, .show-more')];
  const index = items.indexOf(target);
  const next = key === 'Home' ? 0 : key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();
  items[next]?.focus();
});
/* Track the visual viewport so the composer stays above on-screen keyboards (iOS ignores interactive-widget). */
{
  const view = window.visualViewport;
  if (view) {
    let pendingFrame = 0;
    let keepBottom = false;
    const sync = () => {
      pendingFrame = 0;
      const follow = keepBottom;
      keepBottom = false;
      if (Math.abs(view.scale - 1) > 0.01) return; // pinch-zoom: leave layout alone
      document.documentElement.style.setProperty('--vvh', Math.round(view.height) + 'px');
      document.documentElement.style.setProperty('--vvt', Math.round(view.offsetTop) + 'px');
      if (follow && stick && !$('conversation').hidden) scrollToLatest();
    };
    const queue = () => {
      keepBottom ||= stick && atBottom(); // measured before the shell is resized
      if (!pendingFrame) pendingFrame = requestAnimationFrame(sync);
    };
    view.addEventListener('resize', queue);
    view.addEventListener('scroll', queue);
    sync();
  }
}
document.addEventListener('click', event => {
  if (menuFor && !event.target.closest('.menu, .more')) { menuFor = ''; drawNav(); }
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.key !== 'Escape' || imagePreview.open || $('folder-dialog').open || $('machines-dialog').open || quotaDialog.open || $('quick-dialog')?.open) return;
  if (menuFor) {
    const key = menuFor;
    menuFor = '';
    drawNav();
    [...$('nav').querySelectorAll('[data-key]')].find(node => node.dataset.key === 'm:' + key)?.focus();
  } else if ($('app').classList.contains('nav-open')) drawer(false);
  else if (sideOrigin && !$('branches-dialog').open) closeSide();
});
document.addEventListener('visibilitychange', () => {
  setConnectionProblem('offline', !navigator.onLine);
  if (document.visibilityState === 'visible' && !$('app').hidden) {
    if (markOpenResultRead()) drawNav();
    if ($('machines-dialog').open) drawNotificationSettings();
    void refresh();
  }
});
window.addEventListener('offline', () => setConnectionProblem('offline', true));
window.addEventListener('online', () => {
  setConnectionProblem('offline', false);
  if (!$('app').hidden) void refresh();
});
window.addEventListener('pageshow', event => {
  if (event.persisted && !$('app').hidden) {
    setConnectionProblem('offline', !navigator.onLine);
    void refresh();
  }
});
window.addEventListener('focus', () => {
  if (!$('app').hidden && markOpenResultRead()) drawNav();
});
window.addEventListener('storage', event => {
  if ($('app').hidden || !(event.key?.startsWith(completionKey) || event.key?.startsWith(readKey))) return;
  markOpenResultRead();
  drawNav();
  if (!session) drawStarts();
});
setInterval(() => {
  if (!$('app').hidden && (!document.hidden || notificationsEnabled() || sessionsAcrossMachines().some(isRunning))) {
    void refresh(false, true);
  }
}, 8000);

async function start() {
  $('login').hidden = true;
  $('tailnet-required').hidden = true;
  $('logout').hidden = authMode === 'tailnet';
  $('error').before(connectionStatus);
  $('app').hidden = false;
  applyCollapse();
  const linked = new URLSearchParams(location.search).get('session');
  const inventory = refresh();
  if (linked) {
    try { await openSession(linked); return; }
    catch (error) { newChat(); setError(error.message); return; }
  }
  await inventory;
  if (!machines.some(machine => machine.id === machineId && machine.online)) {
    machineId = machines.find(machine => machine.online)?.id ?? machineId;
  }
  compose(null);
}
$('login-form').onsubmit = async event => {
  event.preventDefault();
  const submit = event.submitter || $('login-form').querySelector('[type=submit]');
  submit.disabled = true;
  try {
    await api('login', { code: $('login-code').value.trim() });
    $('login-code').value = '';
    $('login-error').textContent = '';
    await start();
  } catch (error) { $('login-error').textContent = error.message; }
  finally { submit.disabled = false; }
};
history.scrollRestoration = 'manual';
setConnectionProblem('offline', !navigator.onLine);
const auth = await readWithReconnect('auth', () => api('auth', undefined, primaryMachine, AbortSignal.timeout(6500)))
  .catch(() => ({ signedIn: false }));
authMode = auth.mode;
if (auth.signedIn) await start();
else loginView();
