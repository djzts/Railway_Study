/* 铁路调度 6 周学习：单页应用，无构建步骤。学习进度和错题本保存在浏览器 localStorage。 */
(function () {
  'use strict';

  const PLAN = window.PLAN;
  const QUIZ = window.QUIZ || {};
  const NOTES = window.NOTES || {};
  const EXAMS = window.EXAMS || {};

  const KEY = 'railway-study-v1';
  const DAY_MS = 86400000;
  const PASS = 80;
  const LETTERS = 'ABCDEFGH';
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const TYPE_LABEL = { study: '学习日', buffer: '缓冲日', exam: '考试', review: '总复习', wrap: '总结' };
  const KIND_LABEL = { s: '单选', j: '判断', x: '简答' };
  const app = document.getElementById('app');

  // ---------- 小工具 ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function today() { return ymd(new Date()); }
  function dayDate(n) { const d = parseDate(S.start); d.setDate(d.getDate() + n - 1); return d; }
  function fmtDate(d) { return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`; }
  function todayIndex() { return Math.round((parseDate(today()) - parseDate(S.start)) / DAY_MS) + 1; }
  function getDay(n) { return PLAN.days.find(d => d.n === n); }
  function weekNo(n) { return Math.max(1, Math.ceil(n / 7)); }
  function weekOf(n) { return PLAN.weeks[weekNo(n) - 1]; }
  function examDay(key) { return PLAN.days.find(d => d.exam === key); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function fmtNum(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }
  function noteHref(name) { return '#/note/' + encodeURIComponent(name); }
  function noteLink(name, label) { return NOTES[name] ? `<a href="${noteHref(name)}">${esc(label || name)}</a>` : esc(label || name); }
  function sectionTitle(no, text) { return `<h2 class="section-title"><span class="no">${no}</span>${esc(text)}</h2>`; }

  function plain(md) {
    return String(md || '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*(>|#+|[-+]|\d+\.)\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function short(md, k) { const s = plain(md); return s.length > k ? s.slice(0, k) + '…' : s; }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- 进度存储 ----------
  // S = { start, days: {n: {read, started, tasks, quiz, completed, round}}, exams: {key: {...}}, wrong: {id: {...}} }
  function blank() { return { start: PLAN.start, days: {}, exams: {}, wrong: {} }; }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s === 'object') return Object.assign(blank(), s);
    } catch (e) { /* 隐私模式等读不到存储时，用空进度 */ }
    return blank();
  }
  let S = load();
  let saveWarned = false;
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    S.updatedAt = Date.now();
    writeLocal();
    updateWrongCount();
    scheduleSync();
  }
  function writeLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { if (!saveWarned) { saveWarned = true; toast('浏览器不允许保存，刷新后进度会丢失'); } }
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function flush() { if (saveTimer) save(); }
  const dayState = n => S.days[n] || (S.days[n] = {});
  const examState = k => S.exams[k] || (S.exams[k] = {});

  // ---------- 同步到 GitHub 仓库 ----------
  // 用 GitHub Contents API 读写仓库里的进度文件。Token 只存在本机浏览器里，不写进进度文件。
  // 合并用三方合并：base 是上次同步时两边一致的版本，按 days[n] / exams[k] / wrong[id] 逐条比较。
  const SYNC_KEY = 'railway-study-sync';
  const BASE_KEY = 'railway-study-v1-base';
  const SYNC_DELAY = 10000;
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 存不了就算了 */ } }

  let syncCfg = readJSON(SYNC_KEY) || {};
  let syncInfo = { status: 'off', msg: '', at: null };
  let syncTimer = null, syncBusy = false, syncAgain = false, lastSyncAt = 0;

  const syncOn = () => !!(syncCfg.token && /^[\w.-]+\/[\w.-]+$/.test(syncCfg.repo || ''));
  const syncTarget = () => [syncCfg.repo, syncCfg.branch || '', syncCfg.path || 'progress.json'].join('|');
  const coreOf = s => ({ start: s.start, days: s.days || {}, exams: s.exams || {}, wrong: s.wrong || {} });
  const same = (a, b) => JSON.stringify(coreOf(a)) === JSON.stringify(coreOf(b));
  function readBase() { const b = readJSON(BASE_KEY); return b && b.target === syncTarget() ? b.state : {}; }
  function writeBase(state) { writeJSON(BASE_KEY, { target: syncTarget(), state: coreOf(state) }); }

  function merge3(base, local, remote) {
    const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
    const pick = (b, l, r) => {
      const bs = JSON.stringify(b), ls = JSON.stringify(l), rs = JSON.stringify(r);
      if (ls === rs || rs === bs) return l;
      if (ls === bs) return r;
      return localNewer ? l : r; // 两边都改了同一条：取较新的一边
    };
    const out = { start: pick(base.start, local.start, remote.start) || PLAN.start, days: {}, exams: {}, wrong: {}, updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0) };
    ['days', 'exams', 'wrong'].forEach(sec => {
      const b = base[sec] || {}, l = local[sec] || {}, r = remote[sec] || {};
      new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]).forEach(k => {
        const v = pick(b[k], l[k], r[k]);
        if (v !== undefined) out[sec][k] = v;
      });
    });
    return out;
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  async function ghApi(method, path, body, keepalive) {
    const headers = { Authorization: 'Bearer ' + syncCfg.token, Accept: 'application/vnd.github+json' };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch('https://api.github.com' + path, { method, headers, cache: 'no-store', keepalive: !!keepalive, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 没有正文 */ }
    return { status: res.status, ok: res.ok, data, message: (data && data.message) || res.statusText };
  }
  const repoPath = () => '/repos/' + syncCfg.repo;
  const filePath = () => repoPath() + '/contents/' + (syncCfg.path || 'progress.json').split('/').map(encodeURIComponent).join('/');
  function apiError(r) {
    if (r.status === 401) return 'Token 无效或已过期';
    if (r.status === 403 && /rate limit/i.test(r.message)) return 'GitHub 接口调用太频繁，稍后会再试';
    if (r.status === 403) return 'Token 没有写这个仓库的权限（需要 Contents: Read and write）';
    if (r.status === 404) return '找不到仓库或分支：检查仓库名，以及 Token 有没有授权这个仓库';
    return `GitHub 返回 ${r.status}：${r.message}`;
  }

  async function syncPull() {
    const q = syncCfg.branch ? '?ref=' + encodeURIComponent(syncCfg.branch) : '';
    const r = await ghApi('GET', filePath() + q);
    if (r.status === 404) return null; // 第一次同步时文件还不存在；仓库不存在的情况推送时会报错
    if (!r.ok) throw new Error(apiError(r));
    return { sha: r.data.sha, state: JSON.parse(b64decode(r.data.content)) };
  }
  async function createBranch() {
    const repo = await ghApi('GET', repoPath());
    if (!repo.ok) throw new Error(apiError(repo));
    const ref = await ghApi('GET', `${repoPath()}/git/ref/heads/${encodeURIComponent(repo.data.default_branch)}`);
    if (!ref.ok) throw new Error(apiError(ref));
    const made = await ghApi('POST', `${repoPath()}/git/refs`, { ref: 'refs/heads/' + syncCfg.branch, sha: ref.data.object.sha });
    if (!made.ok) throw new Error(apiError(made));
  }
  async function syncPush(text, sha, keepalive) {
    const now = new Date();
    const body = { message: `学习进度 ${today()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, content: b64encode(text) };
    if (syncCfg.branch) body.branch = syncCfg.branch;
    if (sha) body.sha = sha;
    let r = await ghApi('PUT', filePath(), body, keepalive);
    if (!r.ok && !keepalive && syncCfg.branch && /branch/i.test(r.message)) {
      await createBranch();
      r = await ghApi('PUT', filePath(), body);
    }
    if (r.status === 409 || (r.status === 422 && /sha/i.test(r.message))) return { conflict: true };
    if (!r.ok) throw new Error(apiError(r));
    return { sha: r.data.content.sha };
  }
  function fileText(state) {
    return JSON.stringify(Object.assign({ app: 'railway-study', version: 1, updatedAt: state.updatedAt || Date.now() }, coreOf(state)), null, 1);
  }

  async function syncNow() {
    if (!syncOn()) return;
    if (syncBusy) { syncAgain = true; return; }
    syncBusy = true;
    clearTimeout(syncTimer);
    setSync('busy', '同步中…');
    let changed = false;
    try {
      for (let tries = 0; ; tries++) {
        const remote = await syncPull();
        if (remote) syncCfg.sha = remote.sha;
        const merged = remote ? merge3(readBase(), S, remote.state) : S;
        const text = fileText(merged);
        const snap = JSON.parse(text); // 快照：等待网络期间的新改动不会混进这次的 base
        if (!same(snap, S)) { S = Object.assign(blank(), JSON.parse(text)); writeLocal(); updateWrongCount(); changed = true; }
        if (remote && same(snap, remote.state)) { writeBase(snap); break; }
        const res = await syncPush(text, remote && remote.sha);
        if (res.conflict) {
          if (tries < 2) continue;
          throw new Error('别的设备也在同步，稍后再试');
        }
        syncCfg.sha = res.sha;
        writeBase(snap);
        break;
      }
      writeJSON(SYNC_KEY, syncCfg);
      lastSyncAt = Date.now();
      setSync('ok', '已同步');
      if (changed) { toast('已合并仓库里的进度'); route(); }
    } catch (e) {
      setSync('error', e.message || String(e));
    }
    syncBusy = false;
    if (syncAgain) { syncAgain = false; scheduleSync(1000); }
  }
  function scheduleSync(delay) {
    if (!syncOn()) return;
    clearTimeout(syncTimer);
    if (!syncBusy) setSync('wait', '有改动，稍后自动同步');
    syncTimer = setTimeout(syncNow, delay == null ? SYNC_DELAY : delay);
  }
  // 页面切走或关闭时，把还没同步的改动直接推上去（keepalive 请求在页面关闭后也会发出）
  function syncOnHide() {
    flush();
    if (!syncOn() || syncBusy || same(S, readBase())) return;
    clearTimeout(syncTimer);
    const text = fileText(S), snap = JSON.parse(text);
    syncPush(text, syncCfg.sha, true).then(res => {
      if (res && res.sha) { syncCfg.sha = res.sha; writeJSON(SYNC_KEY, syncCfg); writeBase(snap); lastSyncAt = Date.now(); setSync('ok', '已同步'); }
      else scheduleSync(1000);
    }).catch(() => scheduleSync(1000));
  }
  function setSync(status, msg) {
    syncInfo = { status, msg, at: status === 'ok' ? new Date() : syncInfo.at };
    const b = $('#sync-status');
    if (b) {
      b.hidden = !syncOn() && status !== 'error';
      b.className = 'sync ' + ({ ok: 'ok', busy: 'busy', error: 'error' }[status] || '');
      b.textContent = { ok: '✓', busy: '↻', wait: '…', error: '!' }[status] || '';
      b.title = '同步到 GitHub：' + msg;
    }
    const log = $('#sync-log');
    if (log) {
      log.className = 'sync-log' + (status === 'error' ? ' error' : '');
      log.innerHTML = syncLogHTML();
    }
  }
  function syncLogHTML() {
    if (!syncOn()) return '还没有连上仓库。';
    const at = syncInfo.at ? `上次同步：${syncInfo.at.getHours()}:${String(syncInfo.at.getMinutes()).padStart(2, '0')}。` : '';
    const url = `https://github.com/${syncCfg.repo}/blob/${encodeURIComponent(syncCfg.branch || 'HEAD')}/${(syncCfg.path || 'progress.json').split('/').map(encodeURIComponent).join('/')}`;
    return `${esc(syncInfo.msg)}　${at}<a href="${esc(url)}" target="_blank" rel="noopener">在 GitHub 上查看进度文件</a>`;
  }

  function examScore(key) {
    const es = S.exams[key] || {};
    if (es.finished) return es.score;
    const h = es.history || [];
    return h.length ? h[h.length - 1].score : null;
  }

  function dayStatus(day) {
    if (day.type === 'exam') {
      const es = S.exams[day.exam] || {};
      if (examScore(day.exam) != null) return 'done';
      return es.startedAt ? 'partial' : 'none';
    }
    const st = S.days[day.n] || {};
    if (st.completed) return 'done';
    const touched = st.started || Object.values(st.read || {}).some(Boolean) || Object.values(st.tasks || {}).some(Boolean);
    return touched ? 'partial' : 'none';
  }

  // ---------- 错题本 ----------
  // 做错：加入（或重新计数）；做对：连续答对次数 +1，同一天只算一次，满 2 次算已掌握
  function recordResult(ref, right, mine) {
    const t = today();
    let w = S.wrong[ref.id];
    if (right) {
      if (w && !w.mastered && w.lastRight !== t) {
        w.streak = (w.streak || 0) + 1;
        w.lastRight = t;
        if (w.streak >= 2) { w.mastered = true; w.masteredAt = t; }
      }
      return;
    }
    if (!w) {
      w = S.wrong[ref.id] = { id: ref.id, type: ref.type, added: t, times: 0 };
      if (ref.type === 'exam') { w.exam = ref.exam; w.qid = ref.qid; } else { w.src = ref.src; w.idx = ref.idx; }
    }
    w.times = (w.times || 0) + 1;
    w.streak = 0;
    w.mastered = false;
    w.lastWrong = t;
    w.lastRight = null;
    if (mine != null) w.mine = mine;
  }

  function pendingWrong() { return Object.values(S.wrong).filter(w => !w.mastered); }
  function updateWrongCount() { const n = pendingWrong().length; $('#wrong-count').textContent = n ? n : ''; }

  function wrongQuestion(w) {
    if (w.type === 'exam') {
      const ex = EXAMS[w.exam];
      const q = ex && ex.questions.find(x => x.id === w.qid);
      return q ? { kind: 'exam', q } : null;
    }
    const q = (QUIZ[w.src] || [])[w.idx - 1];
    return q ? { kind: 'quiz', q } : null;
  }
  function examShort(key) { return ((EXAMS[key] || {}).title || key).split('：')[0]; }
  function sourceDay(w) { return w.type === 'exam' ? ((examDay(w.exam) || {}).n || 0) : w.src; }
  function sourceOrder(w) { return w.type === 'exam' ? (EXAMS[w.exam] ? EXAMS[w.exam].questions.findIndex(q => q.id === w.qid) : 0) : w.idx; }
  function sortWrong(list) { return list.sort((a, b) => sourceDay(a) - sourceDay(b) || sourceOrder(a) - sourceOrder(b)); }
  function sourceLabel(w) {
    if (w.type === 'exam') return `${examShort(w.exam)} 第 ${w.qid} 题`;
    const d = getDay(w.src);
    return `第 ${w.src} 天测试${d ? ' · ' + d.title : ''}`;
  }
  function mineText(q, a) {
    if (q.t === 's') return a == null ? '（没作答）' : `选了 ${LETTERS[a]}. ${plain(q.o[a])}`;
    if (q.t === 'j') return a == null ? '（没作答）' : `判断为"${a ? '正确' : '错误'}"`;
    return String(a || '').trim() || '（没作答）';
  }
  function correctText(q) {
    if (q.t === 's') return `${LETTERS[q.a]}. ${renderInline(q.o[q.a])}`;
    return q.a ? '正确' : '错误';
  }

  // ---------- Markdown / 公式 / Callout ----------
  const CALLOUT_NAMES = {
    note: '笔记', info: '信息', tip: '提示', hint: '提示', important: '重要', success: '答案', check: '答案', done: '完成',
    question: '问题', help: '问题', faq: '问题', warning: '注意', caution: '注意', attention: '注意', failure: '失败',
    fail: '失败', missing: '缺失', danger: '危险', error: '错误', bug: 'Bug', example: '例子', quote: '引用', cite: '引用',
    abstract: '摘要', summary: '摘要', tldr: '摘要', todo: '待办'
  };

  function setupLibs() {
    if (window.marked) marked.use({ gfm: true, breaks: true });
    if (window.mermaid) {
      try {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default' });
      } catch (e) { /* 图表渲染失败时显示源码 */ }
    }
  }

  // 先把代码和公式换成占位符，避免 marked 改动公式里的 _ * \ 等字符
  function protect(md, math) {
    const codes = [];
    let src = String(md).replace(/```[\s\S]*?```|`[^`\n]+`/g, m => { codes.push(m); return `CODETOKEN${codes.length - 1}END`; });
    const token = (tex, display) => {
      math.push({ tex: tex.replace(/\n\s*>\s?/g, '\n').trim(), display });
      return `MATHTOKEN${math.length - 1}END`;
    };
    src = src
      .replace(/%%[\s\S]*?%%/g, '')
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => token(tex, true))
      .replace(/\$([^$\n]+?)\$/g, (m, tex) => token(tex, false))
      .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
    return src.replace(/CODETOKEN(\d+)END/g, (m, i) => codes[+i]);
  }
  function restoreMath(html, math) {
    return html.replace(/MATHTOKEN(\d+)END/g, (m, i) => {
      const x = math[+i];
      if (!x) return m;
      if (window.katex) {
        try { return katex.renderToString(x.tex, { displayMode: x.display, throwOnError: false, strict: 'ignore' }); } catch (e) { /* 退回源码 */ }
      }
      return `<code>${esc(x.tex)}</code>`;
    });
  }
  function renderMD(md) {
    if (!md) return '';
    if (!window.marked) return `<pre class="plain">${esc(md)}</pre>`;
    const math = [];
    return postProcess(restoreMath(marked.parse(protect(md, math)), math));
  }
  function renderInline(md) {
    if (!md) return '';
    if (!window.marked) return esc(md);
    const math = [];
    return restoreMath(marked.parseInline(protect(md, math)), math);
  }

  // Obsidian callout（> [!warning] 标题）→ 彩色框；带 - 或 + 的是折叠框
  function postProcess(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const root = tpl.content;
    $$('blockquote', root).forEach(bq => {
      const p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') return;
      const m = p.innerHTML.match(/^\s*\[!([\w-]+)\]([+-]?)[ \t]*/);
      if (!m) return;
      const type = m[1].toLowerCase();
      const rest = p.innerHTML.slice(m[0].length);
      const br = rest.match(/<br\s*\/?>\s*/);
      let title = br ? rest.slice(0, br.index) : rest;
      const body = br ? rest.slice(br.index + br[0].length) : '';
      if (!title.trim()) title = CALLOUT_NAMES[type] || type;
      const fold = m[2];
      const box = document.createElement(fold ? 'details' : 'div');
      box.className = 'callout c-' + type;
      if (fold === '+') box.open = true;
      const head = document.createElement(fold ? 'summary' : 'div');
      if (!fold) head.className = 'callout-title';
      head.innerHTML = title;
      box.appendChild(head);
      if (body.trim()) p.innerHTML = body; else p.remove();
      while (bq.firstChild) box.appendChild(bq.firstChild);
      bq.replaceWith(box);
    });
    $$('pre > code.language-mermaid', root).forEach(code => {
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
    });
    $$('a[href]', root).forEach(a => {
      if (/^https?:/i.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; }
    });
    const div = document.createElement('div');
    div.appendChild(root);
    return div.innerHTML;
  }
  function runMermaid(container) {
    if (!window.mermaid) return;
    const nodes = $$('.mermaid:not([data-processed])', container);
    if (nodes.length) mermaid.run({ nodes }).catch(() => { /* 显示源码即可 */ });
  }

  // ---------- 路由 ----------
  let actions = {};
  let cleanup = [];
  const retry = {}; // 错题重做的临时状态，不保存

  function route() {
    flush();
    cleanup.forEach(fn => fn());
    cleanup = [];
    actions = {};
    Object.keys(retry).forEach(k => delete retry[k]);
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/');
    const head = parts[0];
    let arg = parts.slice(1).join('/');
    try { arg = decodeURIComponent(arg); } catch (e) { /* 保留原样 */ }
    let nav = head || 'home';
    if (head === 'today') {
      location.replace('#/day/' + Math.min(Math.max(todayIndex(), 1), PLAN.days.length));
      return;
    }
    if (head === 'day') { const n = parseInt(arg, 10); viewDay(n); nav = n === todayIndex() ? 'today' : ''; }
    else if (head === 'wrong') viewWrong();
    else if (head === 'note') { viewNote(arg); nav = 'notes'; }
    else if (head === 'notes') viewNotes();
    else if (head === 'settings') viewSettings();
    else { viewHome(); nav = 'home'; }
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
    window.scrollTo(0, 0);
    runMermaid(app);
  }

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  app.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && actions[el.dataset.change]) actions[el.dataset.change](el, e);
  });
  app.addEventListener('input', e => {
    const el = e.target.closest('[data-input]');
    if (el && actions[el.dataset.input]) actions[el.dataset.input](el, e);
  });
  // 笔记卡片展开时才渲染正文
  app.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches || !d.matches('details.note') || !d.open) return;
    const body = $('.note-body', d);
    if (body.dataset.done) return;
    body.dataset.done = '1';
    const name = d.dataset.note;
    body.innerHTML = renderMD(stripTitle(NOTES[name].md)) + `<div class="note-foot">${noteFoot(name, +d.dataset.track || 0)}</div>`;
    runMermaid(body);
  }, true);

  function stripTitle(md) { return String(md || '').replace(/^# [^\n]*\n+/, ''); }

  // ---------- 笔记卡片 ----------
  function noteCard(name, track) {
    const n = NOTES[name];
    if (!n) return `<div class="card muted small">（网站里没有「${esc(name)}」这篇笔记）</div>`;
    const read = track && ((S.days[track] || {}).read || {})[name];
    return `<details class="note" data-note="${esc(name)}" data-track="${track || ''}">
      <summary><span class="left"><span class="nt">${esc(name)}</span><span class="badge">${esc(n.kind)}</span></span>
      ${track ? `<span class="badge ${read ? 'ok' : ''}" data-readbadge>${read ? '✓ 已读' : '未读'}</span>` : ''}</summary>
      <div class="note-body md"></div></details>`;
  }
  function noteFoot(name, track) {
    let h = '<div class="row" style="margin-top:14px">';
    if (track) {
      const read = ((S.days[track] || {}).read || {})[name];
      h += `<button class="btn small ${read ? '' : 'ok'}" data-action="mark-read" data-name="${esc(name)}">${read ? '改回未读' : '✓ 读完了，收起'}</button>`;
    }
    return h + `<a class="btn small" href="${noteHref(name)}">单独打开</a></div>`;
  }

  // ---------- 首页 ----------
  function viewHome() {
    const ti = todayIndex();
    const total = PLAN.days.length;
    const doneN = PLAN.days.filter(d => dayStatus(d) === 'done').length;
    let got = 0, tot = 0;
    Object.values(S.days).forEach(st => { if (st.quiz && st.quiz.finished) { got += st.quiz.got; tot += st.quiz.total; } });
    const scores = PLAN.days.filter(d => d.type === 'exam').map(d => examScore(d.exam)).filter(s => s != null);
    const pending = pendingWrong().length;
    const missed = PLAN.days.filter(d => d.n < ti && dayStatus(d) !== 'done');

    let hero;
    if (ti < 1) {
      hero = `<div class="card hero"><div class="muted small">还没开始</div>
        <h2 style="margin:4px 0">计划从 ${fmtDate(dayDate(1))} 开始，还有 ${1 - ti} 天</h2>
        <p>可以先预习第 1 天的内容。</p><a class="btn primary" href="#/day/1">看第 1 天 →</a></div>`;
    } else if (ti > total) {
      hero = `<div class="card hero"><h2 style="margin:4px 0">6 周计划已经结束 🎉</h2>
        <p>完成了 ${doneN} / ${total} 天。把错题本清零，就可以安心入职了。</p><a class="btn primary" href="#/wrong">打开错题本</a></div>`;
    } else {
      const d = getDay(ti), s = dayStatus(d);
      const sub = d.type === 'exam' && EXAMS[d.exam] ? `<p>${esc(EXAMS[d.exam].title)} · 建议 ${esc(EXAMS[d.exam].duration)} 分钟</p>` : d.goal ? `<p>${renderInline(d.goal)}</p>` : '';
      hero = `<div class="card hero"><div class="muted small">今天 · ${fmtDate(dayDate(ti))} · 第 ${ti} 天 · 第 ${weekNo(ti)} 周「${esc(weekOf(ti).theme)}」</div>
        <h2 style="margin:6px 0">${esc(d.title)} <span class="badge ${d.type}">${TYPE_LABEL[d.type]}</span></h2>${sub}
        <a class="btn primary" href="#/day/${ti}">${s === 'done' ? '已完成 ✓ 再看看' : s === 'partial' ? '继续今天的学习 →' : '开始今天的学习 →'}</a></div>`;
    }

    const missedHTML = missed.length ? `<div class="card small">还有 <b>${missed.length}</b> 天没完成：${missed.slice(0, 8).map(d => `<a href="#/day/${d.n}">第 ${d.n} 天</a>`).join('、')}${missed.length > 8 ? ' 等' : ''}。可以在周六缓冲日补上。</div>` : '';

    const stats = `<div class="grid-stats">
      <div class="stat"><div class="num">${doneN}<span class="muted small"> / ${total}</span></div><div class="lbl">已完成天数</div></div>
      <div class="stat"><div class="num">${tot ? pct(got, tot) + '%' : '—'}</div><div class="lbl">每日测试正确率</div></div>
      <div class="stat"><div class="num"><a href="#/wrong">${pending}</a></div><div class="lbl">错题待复习</div></div>
      <div class="stat"><div class="num">${scores.length ? fmtNum(scores.reduce((a, b) => a + b, 0) / scores.length) : '—'}</div><div class="lbl">考试平均分（${scores.length}/6 场）</div></div>
    </div>`;

    let cal = '';
    PLAN.weeks.forEach(wk => {
      const days = PLAN.days.filter(d => weekNo(d.n) === wk.w);
      cal += `<div class="week"><div class="week-head"><b>第 ${wk.w} 周 · ${esc(wk.theme)}</b><span class="muted small">要求：${esc(wk.level)}</span></div><div class="cal">`;
      cal += days.map(d => {
        const date = dayDate(d.n), s = dayStatus(d);
        const cls = ['cell', d.type, s === 'done' ? 'done' : s === 'partial' ? 'partial' : '', d.n === ti ? 'today' : '', d.n < ti && s !== 'done' ? 'missed' : ''].join(' ');
        const mark = s === 'done' ? '✓' : d.type === 'exam' ? '考' : d.type === 'buffer' ? '缓冲' : d.type === 'review' ? '复习' : '';
        return `<a class="${cls}" href="#/day/${d.n}" title="第 ${d.n} 天：${esc(d.title)}"><div class="d"><span>${date.getMonth() + 1}/${date.getDate()}<span class="wd"> 周${WEEKDAYS[date.getDay()]}</span></span><span>${mark}</span></div><div class="t">${esc(d.title)}</div></a>`;
      }).join('');
      cal += '</div></div>';
    });

    app.innerHTML = `${hero}${missedHTML}${stats}
      <h2>6 周日历</h2>
      <p class="small muted">平日每晚约 90 分钟：先学内容，再做测试，错题自动进错题本。周六缓冲（补漏 + 重做错题），周日考试。<br>绿色 = 已完成，黄色 = 做了一半，虚线框 = 日期已过但没完成。</p>
      ${cal}
      <h2>考试成绩</h2>${examTable()}`;
  }

  function examTable() {
    const rows = PLAN.days.filter(d => d.type === 'exam').map(d => {
      const es = S.exams[d.exam] || {}, sc = examScore(d.exam);
      const res = sc != null
        ? `<b>${fmtNum(sc)}</b> <span class="badge ${sc >= PASS ? 'ok' : 'bad'}">${sc >= PASS ? '通过' : '未到 80'}</span>`
        : es.startedAt ? '进行中' : '<span class="muted">未考</span>';
      return `<tr><td><a href="#/day/${d.n}">${esc(d.title)}</a></td><td>${fmtDate(dayDate(d.n))}</td><td>${res}</td></tr>`;
    }).join('');
    return `<div class="card md"><table><thead><tr><th>考试</th><th>日期</th><th>成绩</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---------- 每一天 ----------
  function viewDay(n) {
    const day = getDay(n);
    if (!day) { app.innerHTML = `<div class="card">没有这一天。<a href="#/">回首页</a></div>`; return; }
    const ti = todayIndex();
    const rel = n === ti ? ' · 今天' : n === ti - 1 ? ' · 昨天' : n === ti + 1 ? ' · 明天' : '';
    const wk = weekOf(n);
    app.innerHTML = `<div class="crumb"><a href="#/">日历</a> · 第 ${weekNo(n)} 周 ${esc(wk.theme)}（${esc(wk.level)}） · 第 ${n} 天 · ${fmtDate(dayDate(n))}${rel}</div>
      <h1>${esc(day.title)} <span class="badge ${day.type}">${TYPE_LABEL[day.type]}</span></h1>
      <div id="day-body"></div>${dayNav(n)}`;
    const box = $('#day-body');
    if (day.type === 'exam') renderExam(day, box);
    else if (day.type === 'study' || day.type === 'review') renderStudy(day, box);
    else renderBuffer(day, box);
  }

  function dayNav(n) {
    const prev = getDay(n - 1), next = getDay(n + 1);
    return `<div class="daynav">
      ${prev ? `<a class="btn" href="#/day/${n - 1}">← 第 ${n - 1} 天</a>` : '<span></span>'}
      <a class="btn" href="#/">日历</a>
      ${next ? `<a class="btn" href="#/day/${n + 1}">第 ${n + 1} 天 →</a>` : '<span></span>'}
    </div>`;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, seed) {
    const r = mulberry32(seed), a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function quizItems(day) {
    if (day.type === 'review') {
      const all = [];
      (day.pool || []).forEach(src => (QUIZ[src] || []).forEach((q, i) => all.push({ id: `d${src}-${i + 1}`, q, src, idx: i + 1 })));
      const round = (S.days[day.n] || {}).round || 0;
      return seededShuffle(all, day.n * 1000 + round).slice(0, day.count || 12);
    }
    return (QUIZ[day.n] || []).map((q, i) => ({ id: `d${day.n}-${i + 1}`, q, src: day.n, idx: i + 1 }));
  }
  function quizResult(it, qs) {
    const q = it.q, a = qs.ans[it.id];
    if (q.t === 's' || q.t === 'j') return a === q.a ? 1 : 0;
    return qs.self[it.id] == null ? null : qs.self[it.id];
  }
  function isAnswered(it, qs) {
    const a = qs.ans[it.id];
    return it.q.t === 'x' ? String(a || '').trim() !== '' : a != null;
  }

  function optionsHTML(q, name, chosen, locked, reveal, attrs) {
    const opts = q.t === 'j' ? [true, false] : q.o.map((_, i) => i);
    return `<div class="opts">${opts.map((v, i) => {
      let c = 'opt' + (locked ? ' locked' : '');
      if (reveal && v === q.a) c += ' correct';
      else if (reveal && v === chosen) c += ' chosen-wrong';
      const label = q.t === 'j' ? (v ? '✓ 正确' : '✗ 错误') : `${LETTERS[i]}. ${renderInline(q.o[i])}`;
      return `<label class="${c}"><input type="radio" name="${esc(name)}" value="${i}" ${v === chosen ? 'checked' : ''} ${locked ? 'disabled' : ''} ${attrs}><span class="md">${label}</span></label>`;
    }).join('')}</div>`;
  }
  const radioValue = (q, el) => q.t === 'j' ? el.value === '0' : +el.value;

  function quizQuestion(it, k, qs, showSrc) {
    const q = it.q, sub = !!qs.submitted, a = qs.ans[it.id];
    const r = sub ? quizResult(it, qs) : null;
    const cls = r == null ? '' : r === 1 ? 'right' : r === 0 ? 'wrong' : 'half';
    let h = `<div class="q ${cls}" id="q-${esc(it.id)}"><div class="q-head"><b>${k + 1}.</b><span class="badge">${KIND_LABEL[q.t]}</span>${showSrc ? `<span>来自第 ${it.src} 天</span>` : ''}</div>
      <div class="md">${renderMD(q.q)}</div>`;
    if (q.t === 'x') {
      h += `<textarea class="answer" data-input="quiz-text" data-qid="${esc(it.id)}" placeholder="写下你的答案（简写要点就行）" ${sub ? 'readonly' : ''}>${esc(a || '')}</textarea>`;
    } else {
      h += optionsHTML(q, it.id, a, sub, sub, `data-change="quiz-choice" data-qid="${esc(it.id)}"`);
    }
    if (sub) h += quizFeedback(it, qs, r);
    return h + '</div>';
  }

  function quizFeedback(it, qs, r) {
    const q = it.q;
    const note = q.n ? `<div class="small muted" style="margin-top:6px">对应笔记：${noteLink(q.n)}</div>` : '';
    const expl = q.e ? `<div class="md">${renderMD(q.e)}</div>` : '';
    if (q.t !== 'x') {
      const right = r === 1;
      const head = right ? '✓ 回答正确' : qs.ans[it.id] == null ? '✗ 没有作答' : '✗ 回答错误';
      return `<div class="feedback ${right ? 'ok' : 'bad'}"><b>${head}</b>${right ? '' : `　正确答案：${correctText(q)}`}${expl}${note}</div>`;
    }
    let h = `<div class="ref"><b>参考答案</b><div class="md">${renderMD(q.a)}</div>${expl}${note}</div>`;
    const g = qs.self[it.id];
    if (qs.finished) {
      h += `<div class="feedback ${g === 1 ? 'ok' : g === 0 ? 'bad' : ''}">自评：${g === 1 ? '答对了' : g === 0.5 ? '部分对' : '答错了'}</div>`;
    } else {
      h += `<div class="grade-btns"><span class="muted small">对照参考答案自评：</span>${[[1, '答对了'], [0.5, '部分对'], [0, '答错了']].map(([v, t]) =>
        `<button class="btn small ${g === v ? 'primary' : ''}" data-action="self-grade" data-qid="${esc(it.id)}" data-v="${v}">${t}</button>`).join('')}</div>`;
    }
    return h;
  }

  function finalizeQuiz(st, items) {
    const qs = st.quiz;
    let got = 0;
    const wrongIds = [];
    items.forEach(it => {
      const r = quizResult(it, qs) || 0;
      got += r;
      const right = r === 1;
      recordResult({ id: it.id, type: 'quiz', src: it.src, idx: it.idx }, right, right ? null : mineText(it.q, qs.ans[it.id]));
      if (!right) wrongIds.push(it.id);
    });
    Object.assign(qs, { finished: true, got, total: items.length, wrongIds, at: today() });
    st.completed = true;
  }

  function renderStudy(day, box) {
    const n = day.n, st = dayState(n);
    let items = quizItems(day);
    const qs = () => st.quiz || (st.quiz = { ans: {}, self: {} });
    const isReview = day.type === 'review';

    let html = '<div id="steps"></div>';
    html += reviewNotice(day);
    if (day.goal) html += `<div class="card hero"><b>今天的目标</b><div>${renderInline(day.goal)}</div></div>`;
    html += sectionTitle(1, '学习内容');
    if (isReview) html += '<p class="muted">总复习不学新内容。下面的笔记可以翻一翻，然后直接做测试。</p>';
    if (day.notes && day.notes.length) {
      html += `<h3>必读 <span class="muted small" id="read-progress"></span></h3><p class="muted small">点开阅读，读完点"读完了"。</p>` + day.notes.map(nm => noteCard(nm, n)).join('');
    }
    if (day.extra && day.extra.length) html += `<h3>选读</h3><p class="muted small">时间够再看。</p>` + day.extra.map(nm => noteCard(nm, 0)).join('');
    if (day.ask && day.ask.length) {
      html += `<h3>睡前三问</h3><div class="card"><p class="muted small" style="margin-top:0">合上笔记，在心里或纸上回答：</p><ol class="ask">${day.ask.map(a => `<li>${renderInline(a)}</li>`).join('')}</ol></div>`;
    }
    html += sectionTitle(2, isReview ? '复习测试' : '今日测试') + '<div id="quiz"></div>';
    html += sectionTitle(3, '错题进错题本') + '<div id="day-wrong"></div>';
    box.innerHTML = html;

    const drawSteps = () => {
      const q = st.quiz || {};
      const notes = day.notes || [];
      const readAll = notes.every(nm => (st.read || {})[nm]);
      const c1 = (notes.length ? readAll : st.started) ? 'done' : 'on';
      const c2 = q.finished ? 'done' : st.started ? 'on' : '';
      const c3 = q.finished ? 'done' : '';
      $('#steps').innerHTML = `<div class="steps"><span class="step ${c1}">① 学习内容</span><span class="step ${c2}">② 测试</span><span class="step ${c3}">③ 错题进错题本</span></div>`;
    };
    const drawReadProgress = () => {
      const el = $('#read-progress');
      if (el) el.textContent = `已读 ${(day.notes || []).filter(nm => (st.read || {})[nm]).length} / ${day.notes.length}`;
    };
    const barHTML = () => {
      const q = qs();
      if (!q.submitted) {
        return `<div class="sticky-bar"><span>已答 ${items.filter(it => isAnswered(it, q)).length} / ${items.length}</span><button class="btn primary" data-action="submit-quiz">提交答案</button></div>`;
      }
      if (!q.finished) {
        const left = items.filter(it => it.q.t === 'x' && q.self[it.id] == null).length;
        return `<div class="sticky-bar"><span>单选和判断已自动批改。还有 <b>${left}</b> 道简答题等你对照参考答案自评。</span></div>`;
      }
      const p = pct(q.got, q.total);
      const next = getDay(n + 1);
      return `<div class="card"><div class="result ${p >= 80 ? 'pass' : 'fail'}">得分 ${fmtNum(q.got)} / ${q.total}（${p}%）</div>
        <p class="muted small">${p >= 80 ? '不错！' : '正确率不到 80%，建议把对应笔记再看一遍。'}答错和自评没拿满分的题已经进了错题本。</p>
        <div class="row"><button class="btn" data-action="redo-quiz">重新做一遍</button>${isReview ? '<button class="btn" data-action="reshuffle">换一组题</button>' : ''}${next ? `<a class="btn primary" href="#/day/${n + 1}">下一天 →</a>` : ''}</div></div>`;
    };
    const drawBar = () => { const b = $('#quiz-bar'); if (b) b.innerHTML = barHTML(); };
    const drawQuiz = () => {
      const qbox = $('#quiz');
      if (!items.length) { qbox.innerHTML = '<div class="card muted">今天没有测试题。</div>'; return; }
      if (!st.started) {
        const unread = (day.notes || []).filter(nm => !(st.read || {})[nm]).length;
        qbox.innerHTML = `<div class="card"><p style="margin-top:0">共 ${items.length} 题：单选、判断自动批改，简答题对照参考答案自评。做错的题自动进错题本。</p>
          ${unread ? `<p class="muted small">还有 ${unread} 篇必读没标记读完，建议先学完再做。</p>` : ''}
          <button class="btn primary" data-action="start-quiz">开始测试</button></div>`;
        return;
      }
      qbox.innerHTML = items.map((it, k) => quizQuestion(it, k, qs(), isReview)).join('') + `<div id="quiz-bar">${barHTML()}</div>`;
    };
    const drawDayWrong = () => {
      const q = st.quiz || {};
      const pend = pendingWrong().length;
      if (!q.finished) {
        $('#day-wrong').innerHTML = `<div class="card muted">做完测试后，答错的题会自动加进错题本。错题本里现在有 ${pend} 道待复习。</div>`;
        return;
      }
      const ids = q.wrongIds || [];
      const list = ids.map(id => { const it = items.find(x => x.id === id); return it ? `<li>${renderInline(plain(it.q.q))}</li>` : ''; }).join('');
      $('#day-wrong').innerHTML = `<div class="card">${ids.length ? `<p style="margin-top:0">这次有 <b>${ids.length}</b> 道题进了错题本：</p><ul>${list}</ul>` : '<p style="margin-top:0">这次全对，没有新错题 🎉</p>'}
        <p class="muted small">错题本里共 ${pend} 道待复习，周六缓冲日集中重做。</p><a class="btn" href="#/wrong">打开错题本 →</a></div>`;
    };
    const refresh = () => { drawSteps(); drawQuiz(); drawDayWrong(); };

    actions['mark-read'] = el => {
      const name = el.dataset.name, d = el.closest('details.note');
      st.read = st.read || {};
      st.read[name] = !st.read[name];
      save();
      const b = $('[data-readbadge]', d);
      if (b) { b.className = 'badge' + (st.read[name] ? ' ok' : ''); b.textContent = st.read[name] ? '✓ 已读' : '未读'; }
      $('.note-foot', d).innerHTML = noteFoot(name, n);
      if (st.read[name]) { d.open = false; d.scrollIntoView({ block: 'nearest' }); }
      drawReadProgress();
      drawSteps();
    };
    actions['start-quiz'] = () => {
      st.started = true;
      save();
      refresh();
      $('#quiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    actions['quiz-choice'] = el => {
      const it = items.find(x => x.id === el.dataset.qid);
      if (!it || qs().submitted) return;
      qs().ans[it.id] = radioValue(it.q, el);
      save();
      drawBar();
    };
    actions['quiz-text'] = el => {
      if (qs().submitted) return;
      qs().ans[el.dataset.qid] = el.value;
      saveSoon();
      drawBar();
    };
    actions['submit-quiz'] = () => {
      const q = qs();
      const left = items.filter(it => !isAnswered(it, q)).length;
      if (left && !confirm(`还有 ${left} 题没答，没答的单选、判断算错。确定提交？`)) return;
      q.submitted = true;
      if (!items.some(it => it.q.t === 'x')) finalizeQuiz(st, items);
      save();
      refresh();
      $('#quiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    actions['self-grade'] = el => {
      const q = qs();
      if (q.finished) return;
      q.self[el.dataset.qid] = +el.dataset.v;
      if (items.every(it => it.q.t !== 'x' || q.self[it.id] != null)) finalizeQuiz(st, items);
      save();
      refresh();
    };
    actions['redo-quiz'] = () => {
      if (!confirm('清空这次的答案，重新做一遍？错题本里的记录会保留。')) return;
      st.quiz = { ans: {}, self: {} };
      save();
      refresh();
      $('#quiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    actions.reshuffle = () => {
      st.round = (st.round || 0) + 1;
      st.quiz = { ans: {}, self: {} };
      items = quizItems(day);
      save();
      refresh();
      $('#quiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    drawReadProgress();
    refresh();
  }

  // 不到 80 分时，下一个周六改成重学（第 6 周没有缓冲日，改在总复习时重学）
  function relearnDay(key) {
    const d = examDay(key);
    const b = d && getDay(d.n + 6);
    return b && b.type === 'buffer' ? b : null;
  }
  function relearnNotice(day) {
    const e = getDay(day.n - 6);
    if (!e || e.type !== 'exam') return '';
    const sc = examScore(e.exam);
    if (sc == null || sc >= PASS) return '';
    return `<div class="callout c-warning"><div class="callout-title">${esc(e.title)}得了 ${fmtNum(sc)} 分，不到 80</div>按计划，今天改成重学这场考试对应的内容：先重做错题本里这场考试的错题，再把没拿到分的题对应的笔记重读一遍。</div>`;
  }
  function reviewNotice(day) {
    if (day.type !== 'review' || day.n !== 37) return '';
    const sc = examScore('w5');
    if (sc == null || sc >= PASS) return '';
    return `<div class="callout c-warning"><div class="callout-title">第 5 周测验得了 ${fmtNum(sc)} 分，不到 80</div>第 6 周没有缓冲日：总复习这几天多留时间重学机车机班内容（第 29–33 天），先把错题本里第 5 周的错题做到掌握。</div>`;
  }

  // ---------- 缓冲日 / 总结日 ----------
  function renderBuffer(day, box) {
    const n = day.n, st = dayState(n);
    let html = relearnNotice(day);
    if (day.goal) html += `<div class="card hero"><b>今天的目标</b><div>${renderInline(day.goal)}</div></div>`;
    html += sectionTitle(1, '今天要做的事');
    html += `<div class="opts">${(day.tasks || []).map((t, i) => `<label class="opt"><input type="checkbox" data-change="task" data-i="${i}" ${(st.tasks || {})[i] ? 'checked' : ''}><span>${renderInline(t)}</span></label>`).join('')}</div>`;
    if (day.type === 'wrap') html += '<h3>6 周考试成绩</h3>' + examTable();
    if (day.extra && day.extra.length) html += `<h3>选读</h3>` + day.extra.map(nm => noteCard(nm, 0)).join('');
    html += sectionTitle(2, '重做错题') + '<p class="muted small">在不同的两天各做对一次就算掌握。</p><div id="buf-wrong"></div>';
    html += sectionTitle(3, '打卡') + '<div class="card" id="buf-done"></div>';
    box.innerHTML = html;

    const drawWrong = () => {
      const list = sortWrong(pendingWrong());
      $('#buf-wrong').innerHTML = list.length ? list.map(wrongCard).join('') : '<div class="card muted">错题本里没有待复习的题 👍</div>';
    };
    const drawDone = () => {
      $('#buf-done').innerHTML = st.completed
        ? '<div class="spread"><b>✓ 今天已完成</b><button class="btn small" data-action="undo-day">撤销</button></div>'
        : '<div class="spread"><span>做完了就打个卡。</span><button class="btn primary" data-action="complete-day">完成本日 ✓</button></div>';
    };
    actions.task = el => { st.tasks = st.tasks || {}; st.tasks[el.dataset.i] = el.checked; save(); };
    actions['complete-day'] = () => { st.completed = true; save(); drawDone(); toast('打卡成功'); };
    actions['undo-day'] = () => { st.completed = false; save(); drawDone(); };
    bindWrongActions(null);
    drawWrong();
    drawDone();
  }

  // ---------- 考试 ----------
  let timer = null;
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function renderExam(day, box) {
    const key = day.exam, ex = EXAMS[key];
    if (!ex) { box.innerHTML = '<div class="card">找不到这份试卷。</div>'; return; }
    const main = ex.questions.filter(q => !q.bonus), bonus = ex.questions.filter(q => q.bonus);
    const total = main.reduce((s, q) => s + q.points, 0);
    cleanup.push(stopTimer);

    const es = () => examState(key);
    const scoreOf = st => main.reduce((s, q) => s + q.points * ((st.grades || {})[q.id] || 0), 0);

    const questionHTML = (q, st) => {
      const g = (st.grades || {})[q.id];
      const sub = !!st.submitted, fin = !!st.finished;
      const cls = sub && g != null ? (g === 1 ? 'right' : g === 0 ? 'wrong' : 'half') : '';
      let h = `<div class="q ${cls}" id="q-${esc(key + '-' + q.id)}"><div class="q-head"><b>${esc(q.heading)}</b>${q.bonus ? '<span class="badge">附加题 · 不计分</span>' : ''}</div>
        <div class="md">${renderMD(q.body)}</div>
        <textarea class="answer" data-input="exam-text" data-qid="${esc(q.id)}" placeholder="${sub ? '（没有作答）' : '作答……'}" ${sub ? 'readonly' : ''}>${esc((st.ans || {})[q.id] || '')}</textarea>`;
      if (sub) {
        h += `<div class="ref"><b>参考答案</b><div class="md">${renderMD(q.answer)}</div></div>`;
        const labels = q.bonus ? [[1, '答对了'], [0.5, '部分对'], [0, '不会']] : [[1, `满分 ${q.points}`], [0.5, `一半 ${fmtNum(q.points / 2)}`], [0, '0 分']];
        if (fin) {
          const lab = (labels.find(l => l[0] === g) || [0, '没评分'])[1];
          h += `<div class="feedback ${g === 1 ? 'ok' : g === 0 ? 'bad' : ''}">自评：${lab}</div>`;
        } else {
          h += `<div class="grade-btns"><span class="muted small">自评：</span>${labels.map(([v, t]) =>
            `<button class="btn small ${g === v ? 'primary' : ''}" data-action="exam-grade" data-qid="${esc(q.id)}" data-v="${v}">${t}</button>`).join('')}</div>`;
        }
      }
      return h + '</div>';
    };

    const questionsHTML = st => {
      let h = '', sec = null;
      ex.questions.forEach(q => {
        if (q.section !== sec) { sec = q.section; if (sec) h += `<h2>${esc(sec)}</h2>`; }
        h += questionHTML(q, st);
      });
      return h;
    };

    const barHTML = st => {
      if (!st.submitted) {
        const written = ex.questions.filter(q => String((st.ans || {})[q.id] || '').trim()).length;
        return `<div class="sticky-bar"><span>⏱ <b id="timer">0:00</b> / 建议 ${esc(ex.duration)} 分钟 · 已写 ${written} / ${ex.questions.length} 题</span><button class="btn primary" data-action="submit-exam">交卷，看答案</button></div>`;
      }
      const graded = main.filter(q => (st.grades || {})[q.id] != null).length;
      return `<div class="sticky-bar"><span>已评 ${graded} / ${main.length} 题 · 目前 <b>${fmtNum(scoreOf(st))}</b> 分${bonus.length ? '（附加题可评可不评）' : ''}</span><button class="btn primary" data-action="finish-exam" ${graded === main.length ? '' : 'disabled'}>完成评分</button></div>`;
    };

    const tick = () => {
      const el = $('#timer'), st = es();
      if (!el || !st.startedAt) return;
      const sec = Math.max(0, Math.round((Date.now() - st.startedAt) / 1000));
      el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      el.style.color = sec > (+ex.duration || 0) * 60 ? 'var(--bad)' : '';
    };

    const draw = () => {
      stopTimer();
      const st = es();
      const history = (st.history || []).map(h => `${fmtNum(h.score)} 分（${h.at.slice(5).replace('-', '/')}）`).join('、');
      let h = `<div class="card hero"><b>${esc(ex.title)}</b><div class="small muted">建议时长 ${esc(ex.duration)} 分钟 · 满分 ${total} · ${PASS} 分及格 · 共 ${main.length} 题${bonus.length ? `，另有附加题 ${bonus.length} 道（不计分）` : ''}</div>${history ? `<div class="small">历次成绩：${history}</div>` : ''}</div>`;
      if (!st.startedAt) {
        h += `<div class="card"><b>考试规则</b><ul class="tasks">
          <li>闭卷：不看笔记，在文本框里作答（也可以写在纸上，文本框里简写要点）。</li>
          <li>交卷后逐题对照参考答案自评：满分 / 一半 / 0 分。</li>
          <li>没拿满分的题自动进错题本。</li>
          <li>不到 ${PASS} 分：按计划把下一个周六改成重学本周内容。</li></ul>
          <button class="btn primary" data-action="start-exam">开始考试</button></div>`;
        box.innerHTML = h;
        return;
      }
      if (st.finished) {
        const pass = st.score >= PASS;
        const notFull = ex.questions.filter(q => { const g = (st.grades || {})[q.id]; return g != null && g < 1; }).length;
        let advice = '';
        if (!pass) {
          const b = relearnDay(key);
          advice = b ? `按计划，把下一个周六（第 ${b.n} 天，${fmtDate(dayDate(b.n))}）改成重学这场考试的内容，那天的页面会提醒你。`
            : key === 'w5' ? '第 6 周没有缓冲日：在第 37–40 天总复习时多留时间重学机车机班内容。'
              : '在第 42 天订正时，重点重学没拿到分的部分。';
        }
        h += `<div class="card"><div class="result ${pass ? 'pass' : 'fail'}">${fmtNum(st.score)} 分 · ${pass ? '通过 ✓' : `未到 ${PASS} 分`}</div>
          ${st.usedSec ? `<div class="small muted">用时 ${Math.max(1, Math.round(st.usedSec / 60))} 分钟</div>` : ''}
          ${advice ? `<p>${advice}</p>` : ''}
          <p class="small muted">${notFull ? `${notFull} 道没拿满分的题已进错题本。` : '全部满分！'}</p>
          <div class="row"><a class="btn" href="#/wrong">打开错题本</a><button class="btn" data-action="retake-exam">重考一次</button></div></div>`;
        box.innerHTML = h + questionsHTML(st);
        return;
      }
      box.innerHTML = h + questionsHTML(st) + `<div id="exam-bar">${barHTML(st)}</div>`;
      if (!st.submitted) { tick(); timer = setInterval(tick, 1000); }
    };
    const drawBar = () => { const b = $('#exam-bar'); if (b) b.innerHTML = barHTML(es()); tick(); };

    actions['start-exam'] = () => {
      S.exams[key] = { history: es().history || [], startedAt: Date.now(), ans: {}, grades: {} };
      save();
      draw();
    };
    actions['exam-text'] = el => {
      const st = es();
      if (st.submitted) return;
      st.ans = st.ans || {};
      st.ans[el.dataset.qid] = el.value;
      saveSoon();
      drawBar();
    };
    actions['submit-exam'] = () => {
      const st = es();
      const empty = ex.questions.filter(q => !q.bonus && !String((st.ans || {})[q.id] || '').trim()).length;
      if (!confirm(empty ? `还有 ${empty} 题没写，确定交卷？交卷后就能看到参考答案。` : '确定交卷？交卷后就能看到参考答案。')) return;
      st.submitted = true;
      st.usedSec = Math.round((Date.now() - st.startedAt) / 1000);
      save();
      draw();
      window.scrollTo(0, 0);
    };
    actions['exam-grade'] = el => {
      const st = es();
      if (st.finished) return;
      st.grades = st.grades || {};
      st.grades[el.dataset.qid] = +el.dataset.v;
      save();
      const q = ex.questions.find(x => x.id === el.dataset.qid);
      const card = document.getElementById('q-' + key + '-' + q.id);
      if (card) card.outerHTML = questionHTML(q, st);
      drawBar();
    };
    actions['finish-exam'] = () => {
      const st = es();
      st.score = scoreOf(st);
      st.finished = true;
      st.at = today();
      st.history = (st.history || []).concat([{ score: st.score, at: st.at }]);
      ex.questions.forEach(q => {
        const g = (st.grades || {})[q.id];
        if (g == null) return;
        const ans = String((st.ans || {})[q.id] || '').trim();
        recordResult({ id: `${key}-${q.id}`, type: 'exam', exam: key, qid: q.id }, g === 1, g === 1 ? null : ans || '（没作答）');
      });
      save();
      draw();
      window.scrollTo(0, 0);
    };
    actions['retake-exam'] = () => {
      if (!confirm('清空答卷重新考一次？之前的成绩会留在"历次成绩"里。')) return;
      S.exams[key] = { history: es().history || [] };
      save();
      draw();
    };

    draw();
  }

  // ---------- 错题卡片（错题本页和缓冲日共用） ----------
  function wrongCard(w) {
    const info = wrongQuestion(w);
    const r = retry[w.id] || (retry[w.id] = {});
    const wid = esc(w.id);
    let h = `<div class="q ${w.mastered ? 'right' : ''}" data-card="${wid}">
      <div class="wmeta"><span>${esc(sourceLabel(w))}</span><span>· ${esc(w.added)} 加入</span><span>· 错 ${w.times || 1} 次</span>
      <span>· 掌握 <span class="streak"><i class="${w.mastered || w.streak >= 1 ? 'on' : ''}"></i><i class="${w.mastered ? 'on' : ''}"></i></span></span>
      ${w.mastered ? '<span class="badge ok">已掌握</span>' : ''}</div>`;
    if (!info) {
      h += '<p class="muted">（这道题在题库里找不到了）</p>';
    } else if (info.kind === 'quiz' && info.q.t !== 'x') {
      const q = info.q, done = r.result != null;
      h += `<div class="md">${renderMD(q.q)}</div>` + optionsHTML(q, 'w-' + w.id, r.ans, done, done, `data-change="retry-choice" data-wid="${wid}"`);
      if (done) h += retryMsg(w, r.result, q);
    } else {
      const q = info.q;
      const isQuiz = info.kind === 'quiz';
      h += `${isQuiz ? '' : `<div class="small muted">${esc(q.heading)}</div>`}<div class="md">${renderMD(isQuiz ? q.q : q.body)}</div>
        <textarea class="answer" data-input="retry-text" data-wid="${wid}" placeholder="先自己答一遍（不保存），再看参考答案">${esc(r.text || '')}</textarea>`;
      if (!r.shown) {
        h += `<div class="grade-btns"><button class="btn small" data-action="retry-show" data-wid="${wid}">看参考答案</button></div>`;
      } else {
        h += `<div class="ref"><b>参考答案</b><div class="md">${renderMD(isQuiz ? q.a : q.answer)}</div>${isQuiz && q.e ? `<div class="md">${renderMD(q.e)}</div>` : ''}</div>`;
        h += r.result == null
          ? `<div class="grade-btns"><span class="muted small">这次：</span><button class="btn small ok" data-action="retry-self" data-wid="${wid}" data-v="1">答对了 ✓</button><button class="btn small bad" data-action="retry-self" data-wid="${wid}" data-v="0">还没掌握 ✗</button></div>`
          : retryMsg(w, r.result, null);
      }
    }
    if (w.mine) {
      const mine = info && info.kind === 'quiz' && info.q.t !== 'x' ? renderInline(w.mine) : esc(w.mine);
      h += `<details class="small muted" style="margin-top:8px"><summary>上次的答案</summary><div style="white-space:pre-wrap">${mine}</div></details>`;
    }
    const note = info && info.kind === 'quiz' && info.q.n ? `<span class="small">对应笔记：${noteLink(info.q.n)}</span>` : '';
    h += `<div class="row" style="margin-top:10px">${note}<span style="flex:1"></span>
      ${r.result != null ? `<button class="btn small" data-action="retry-again" data-wid="${wid}">再做一次</button>` : ''}
      <button class="btn small" data-action="wrong-toggle" data-wid="${wid}">${w.mastered ? '移回待复习' : '直接标记掌握'}</button>
      <button class="btn small bad" data-action="wrong-delete" data-wid="${wid}">删除</button></div>`;
    return h + '</div>';
  }

  function retryMsg(w, right, q) {
    const expl = q && q.e ? `<div class="md">${renderMD(q.e)}</div>` : '';
    if (!right) {
      return `<div class="feedback bad"><b>✗ 还是不对</b>${q ? `　正确答案：${correctText(q)}` : ''}${expl}</div>`;
    }
    const msg = w.mastered ? '这题已掌握 🎉' : '换一天再做对一次，就算掌握。';
    return `<div class="feedback ok"><b>✓ 答对了</b>　${msg}${expl}</div>`;
  }

  function bindWrongActions(refresh) {
    const redraw = id => {
      const el = app.querySelector(`[data-card="${CSS.escape(id)}"]`);
      if (el) el.outerHTML = S.wrong[id] ? wrongCard(S.wrong[id]) : '';
      if (refresh) refresh();
    };
    actions['retry-choice'] = el => {
      const w = S.wrong[el.dataset.wid], info = w && wrongQuestion(w);
      if (!info) return;
      const r = retry[w.id] || (retry[w.id] = {});
      if (r.result != null) return;
      r.ans = radioValue(info.q, el);
      r.result = r.ans === info.q.a;
      recordResult(w, r.result, r.result ? null : mineText(info.q, r.ans));
      save();
      redraw(w.id);
    };
    actions['retry-text'] = el => { (retry[el.dataset.wid] || (retry[el.dataset.wid] = {})).text = el.value; };
    actions['retry-show'] = el => { (retry[el.dataset.wid] || (retry[el.dataset.wid] = {})).shown = true; redraw(el.dataset.wid); };
    actions['retry-self'] = el => {
      const w = S.wrong[el.dataset.wid];
      if (!w) return;
      const r = retry[w.id] || (retry[w.id] = {});
      r.result = el.dataset.v === '1';
      recordResult(w, r.result, r.result ? null : (String(r.text || '').trim() || null));
      save();
      redraw(w.id);
    };
    actions['retry-again'] = el => { retry[el.dataset.wid] = {}; redraw(el.dataset.wid); };
    actions['wrong-toggle'] = el => {
      const w = S.wrong[el.dataset.wid];
      if (!w) return;
      w.mastered = !w.mastered;
      if (w.mastered) { w.streak = 2; w.masteredAt = today(); } else { w.streak = 0; w.lastRight = null; }
      save();
      redraw(w.id);
    };
    actions['wrong-delete'] = el => {
      const id = el.dataset.wid;
      if (!confirm('从错题本删除这道题？')) return;
      delete S.wrong[id];
      delete retry[id];
      save();
      redraw(id);
    };
  }

  // ---------- 错题本 ----------
  let wrongTab = 'todo';
  function viewWrong() {
    app.innerHTML = `<h1>错题本</h1>
      <p class="muted">每日测试、考试里做错（或自评没拿满分）的题会自动进来。<b>在不同的两天各做对一次</b>就算掌握。</p>
      <div class="spread"><div class="tabs" id="wtabs"></div><button class="btn small" data-action="export-md">导出 Markdown（贴进 Obsidian 错题本）</button></div>
      <div id="wlist"></div>`;
    const drawTabs = () => {
      const all = Object.values(S.wrong), todo = all.filter(w => !w.mastered).length;
      $('#wtabs').innerHTML = [['todo', `待复习 ${todo}`], ['done', `已掌握 ${all.length - todo}`], ['all', `全部 ${all.length}`]]
        .map(([k, t]) => `<button class="tab ${wrongTab === k ? 'on' : ''}" data-action="wtab" data-k="${k}">${t}</button>`).join('');
    };
    const drawList = () => {
      const list = sortWrong(Object.values(S.wrong).filter(w => wrongTab === 'all' || (wrongTab === 'done') === !!w.mastered));
      if (!list.length) {
        const empty = wrongTab === 'todo'
          ? (Object.keys(S.wrong).length ? '待复习的错题都清空了 👍' : '还没有错题。做完每日测试或考试后，错题会自动出现在这里。')
          : '这里还没有题。';
        $('#wlist').innerHTML = `<div class="card muted">${empty}</div>`;
        return;
      }
      let h = '', wk = 0;
      list.forEach(w => {
        const k = weekNo(sourceDay(w));
        if (k !== wk) { wk = k; h += `<h3>第 ${k} 周 · ${esc((PLAN.weeks[k - 1] || {}).theme || '')}</h3>`; }
        h += wrongCard(w);
      });
      $('#wlist').innerHTML = h;
    };
    actions.wtab = el => { wrongTab = el.dataset.k; drawTabs(); drawList(); };
    actions['export-md'] = () => showModal('导出错题（Obsidian 表格格式）', exportWrongMD(), '复制后贴到知识库 30-Practice/错题本.md 里对应周的标题下。');
    bindWrongActions(drawTabs);
    drawTabs();
    drawList();
  }

  function exportWrongMD() {
    const cell = s => String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
    const links = md => {
      const names = [];
      String(md || '').replace(/\(#\/note\/([^)\s]+)\)/g, (m, x) => { try { x = decodeURIComponent(x); } catch (e) { /* 原样 */ } if (!names.includes(x)) names.push(x); return m; });
      return names.map(x => `[[${x}]]`).join('、');
    };
    const rows = sortWrong(Object.values(S.wrong)).map(w => {
      const info = wrongQuestion(w);
      let q = '', right = '', note = '';
      if (info && info.kind === 'quiz') {
        const x = info.q;
        q = x.q;
        right = x.t === 's' ? x.o[x.a] : x.t === 'j' ? (x.a ? '正确' : '错误') : x.a;
        note = x.n ? `[[${x.n}]]` : '';
      } else if (info) {
        q = info.q.body;
        right = String(info.q.answer).split(/\n?出处[:：]/)[0];
        note = links(info.q.answer);
      }
      const src = w.type === 'exam' ? `${examShort(w.exam).replace(/\s+/g, '')} 第${w.qid}题` : `第${w.src}天测试 第${w.idx}题`;
      const redo = w.mastered ? '✅' : w.streak >= 1 ? '[x] [ ]' : '[ ] [ ]';
      return `| ${w.added.slice(5).replace('-', '/')} | ${cell(src)} | ${cell(short(q, 40))} | ${cell(short(w.mine, 40))} | ${cell(short(right, 60))} | ${note} | ${redo} |`;
    });
    return ['| 日期 | 来源 | 题目（简写） | 错在哪里 | 正确要点 | 对应笔记 | 重做 |', '|---|---|---|---|---|---|---|'].concat(rows).join('\n');
  }

  function showModal(title, text, hint) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><div class="spread"><b>${esc(title)}</b><button class="btn small" data-close>关闭</button></div>
      <textarea readonly>${esc(text)}</textarea>
      <div class="row"><button class="btn primary" data-copy>复制</button><span class="muted small">${esc(hint)}</span></div></div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', e => {
      if (e.target === bg || e.target.matches('[data-close]')) bg.remove();
      if (e.target.matches('[data-copy]')) {
        const ta = $('textarea', bg);
        ta.select();
        const fallback = () => { try { document.execCommand('copy'); toast('已复制'); } catch (err) { toast('请手动复制'); } };
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(() => toast('已复制'), fallback); else fallback();
      }
    });
  }

  // ---------- 知识库 ----------
  function viewNotes() {
    const names = Object.keys(NOTES).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    app.innerHTML = `<h1>知识库</h1>
      <p class="muted">共 ${names.length} 篇：概念笔记、资料笔记（教材章节、论文、文章）和术语表。原书 PDF 只在本地知识库里。</p>
      <input type="search" id="nsearch" placeholder="搜索标题、别名或正文……" autocomplete="off">
      <div id="nlist"></div>`;
    const draw = () => {
      const kw = $('#nsearch').value.trim().toLowerCase();
      let h = '';
      ['概念', '资料', '索引'].forEach(kind => {
        const list = names.filter(nm => NOTES[nm].kind === kind).map(nm => {
          const n = NOTES[nm];
          if (!kw) return { nm, body: false };
          const head = nm.toLowerCase().includes(kw) || n.aliases.some(a => a.toLowerCase().includes(kw));
          if (head) return { nm, body: false };
          return n.md.toLowerCase().includes(kw) ? { nm, body: true } : null;
        }).filter(Boolean).sort((x, y) => x.body - y.body);
        if (!list.length) return;
        h += `<h2>${kind === '概念' ? '概念笔记' : kind === '资料' ? '资料笔记' : '索引'} <span class="muted small">${list.length}</span></h2><ul class="note-list">`;
        h += list.map(({ nm, body }) => `<li>${noteLink(nm)}${NOTES[nm].aliases.slice(0, 3).map(a => ` <span class="alias">${esc(a)}</span>`).join('')}${body ? ' <span class="muted small">（正文提到）</span>' : ''}</li>`).join('');
        h += '</ul>';
      });
      $('#nlist').innerHTML = h || '<div class="card muted">没有找到。</div>';
    };
    $('#nsearch').addEventListener('input', draw);
    draw();
  }

  function viewNote(name) {
    const n = NOTES[name];
    if (!n) { app.innerHTML = `<div class="card">找不到笔记「${esc(name)}」。<a href="#/notes">去知识库</a></div>`; return; }
    const used = PLAN.days.filter(d => (d.notes || []).includes(name) || (d.extra || []).includes(name));
    app.innerHTML = `<div class="crumb"><a href="#/notes">知识库</a> · ${esc(n.kind)}笔记</div>
      <h1>${esc(name)}</h1>
      ${n.aliases.length ? `<div>${n.aliases.map(a => `<span class="alias">${esc(a)}</span>`).join('')}</div>` : ''}
      ${used.length ? `<p class="small muted">学习计划：${used.map(d => `<a href="#/day/${d.n}">第 ${d.n} 天 ${esc(d.title)}</a>`).join('、')}</p>` : ''}
      <div class="card md">${renderMD(stripTitle(n.md))}</div>
      <div class="row"><button class="btn" data-action="back">← 返回</button></div>`;
    actions.back = () => { if (history.length > 1) history.back(); else location.hash = '#/notes'; };
  }

  // ---------- 设置 ----------
  function viewSettings() {
    const qn = Object.values(QUIZ).reduce((s, l) => s + l.length, 0);
    app.innerHTML = `<h1>设置</h1>
      <div class="card"><h3 style="margin-top:0">开始日期</h3>
        <p class="muted small">计划默认从 ${PLAN.start}（周一）开始。如果推迟开始，改这里，日历会整体顺延。</p>
        <div class="row"><input type="date" id="start" value="${esc(S.start)}"><button class="btn primary" data-action="set-start">保存</button><button class="btn" data-action="reset-start">恢复默认</button></div></div>
      <div class="card"><h3 style="margin-top:0">导出 / 导入进度</h3>
        <p class="muted small">学习进度和错题本只存在这个浏览器里。换电脑或换浏览器前先导出，再在新设备上导入。</p>
        <div class="row"><button class="btn" data-action="export-json">导出进度（JSON 文件）</button><label class="btn">导入进度<input type="file" id="import" accept=".json,application/json" hidden></label></div></div>
      <div class="card" id="sync-card"><h3 style="margin-top:0">同步到 GitHub 仓库</h3>
        <p class="small">连上以后，进度一有变化，大约 10 秒后自动提交到仓库里的进度文件；关闭或切走页面时也会马上提交。在别的电脑或手机上填同样的设置，两边的进度会自动合并。</p>
        <div class="field">
          <label for="sync-repo">仓库</label><input type="text" id="sync-repo" placeholder="用户名/仓库名，如 djzts/Railway_Study_progress" value="${esc(syncCfg.repo || '')}" autocomplete="off" spellcheck="false">
          <label for="sync-branch">分支</label><input type="text" id="sync-branch" placeholder="留空 = 仓库的默认分支" value="${esc(syncCfg.branch || '')}" autocomplete="off" spellcheck="false">
          <label for="sync-path">文件</label><input type="text" id="sync-path" placeholder="progress.json" value="${esc(syncCfg.path || '')}" autocomplete="off" spellcheck="false">
          <label for="sync-token">Token</label><input type="password" id="sync-token" placeholder="${syncCfg.token ? '已保存（不显示）；留空就不改' : 'github_pat_……'}" autocomplete="off">
        </div>
        <div class="row"><button class="btn primary" data-action="sync-save">保存并同步</button><button class="btn" data-action="sync-now" ${syncOn() ? '' : 'disabled'}>立即同步</button><button class="btn bad" data-action="sync-off" ${syncCfg.token ? '' : 'disabled'}>断开（删除本机 Token）</button></div>
        <div class="sync-log ${syncInfo.status === 'error' ? 'error' : ''}" id="sync-log">${syncLogHTML()}</div>
        <details class="small" style="margin-top:10px"><summary>第一次设置看这里</summary>
          <ol>
            <li>在 GitHub 上新建一个<b>私有</b>仓库，比如 <code>Railway_Study_progress</code>。<br><span class="muted">不建议用网站本身的公开仓库：公开仓库里的进度（包括你写的答案）谁都能看到；而且能写网站仓库的 Token 一旦泄露，别人就能改你的网站。</span></li>
            <li>打开 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Settings → Developer settings → Fine-grained tokens</a>，新建一个 Token：Repository access 选 <b>Only select repositories</b>，只选这个进度仓库；Permissions 里只把 <b>Contents</b> 设成 <b>Read and write</b>；设一个过期时间（比如 90 天）。</li>
            <li>把 Token 和仓库名（<code>用户名/仓库名</code>）填到上面，点"保存并同步"。分支和文件可以留空。</li>
            <li>换设备时，在新设备上填同样的设置（也可以再建一个 Token），两边的进度会自动合并。</li>
          </ol>
          <p class="muted">Token 只保存在这个浏览器里，只发给 GitHub，不会写进进度文件。在公用电脑上用完记得点"断开"。</p>
        </details></div>
      <div class="card"><h3 style="margin-top:0">清空进度</h3>
        <p class="muted small">删除这个浏览器里的全部学习记录和错题本，不能撤销。建议先导出。连着 GitHub 时，仓库里的进度文件也会被清空（仓库的提交历史里还能找回）。</p>
        <button class="btn bad" data-action="reset-all">清空全部进度</button></div>
      <div class="card"><h3 style="margin-top:0">关于</h3>
        <p class="small">${Object.keys(NOTES).length} 篇笔记 · ${qn} 道每日测试题 · ${Object.keys(EXAMS).length} 份试卷。内容由 Obsidian 知识库生成，车次字头按新版车次规定。</p></div>`;
    actions['set-start'] = () => {
      const v = $('#start').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('日期格式不对'); return; }
      S.start = v;
      save();
      toast('开始日期已改为 ' + v);
    };
    actions['reset-start'] = () => { S.start = PLAN.start; save(); $('#start').value = S.start; toast('已恢复默认开始日期'); };
    actions['export-json'] = () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `铁路调度学习进度-${today()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    actions['sync-save'] = () => {
      const repo = $('#sync-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
      const branch = $('#sync-branch').value.trim();
      const path = $('#sync-path').value.trim().replace(/^\/+/, '');
      const token = $('#sync-token').value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast('仓库要写成 用户名/仓库名'); return; }
      if (!token && !syncCfg.token) { toast('请填 Token'); return; }
      const targetChanged = repo !== syncCfg.repo || branch !== (syncCfg.branch || '') || path !== (syncCfg.path || '');
      syncCfg = { repo, branch, path, token: token || syncCfg.token, sha: targetChanged ? null : syncCfg.sha };
      writeJSON(SYNC_KEY, syncCfg);
      $('#sync-token').value = '';
      $('#sync-token').placeholder = '已保存（不显示）；留空就不改';
      $$('#sync-card button').forEach(b => { b.disabled = false; });
      syncNow();
    };
    actions['sync-now'] = () => syncNow();
    actions['sync-off'] = () => {
      if (!confirm('断开后不再自动同步，这个浏览器里的 Token 会删除。仓库里的进度文件不受影响。确定？')) return;
      clearTimeout(syncTimer);
      syncCfg = { repo: syncCfg.repo, branch: syncCfg.branch, path: syncCfg.path };
      writeJSON(SYNC_KEY, syncCfg);
      try { localStorage.removeItem(BASE_KEY); } catch (e) { /* 忽略 */ }
      setSync('off', '已断开');
      $('#sync-token').placeholder = 'github_pat_……';
      $('[data-action="sync-now"]').disabled = true;
      $('[data-action="sync-off"]').disabled = true;
    };
    actions['reset-all'] = () => {
      if (!confirm('确定清空全部学习进度和错题本？不能撤销。')) return;
      if (!confirm('再确认一次：真的清空？')) return;
      S = blank();
      save();
      toast('已清空');
    };
    $('#import').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          if (!d || typeof d !== 'object' || typeof d.days !== 'object' || typeof d.wrong !== 'object') throw new Error('格式不对');
          if (confirm('导入会覆盖这个浏览器里的进度，确定？')) {
            S = Object.assign(blank(), d);
            save();
            route();
            toast('导入成功');
          }
        } catch (err) { toast('文件格式不对，导入失败'); }
        e.target.value = '';
      };
      reader.readAsText(f);
    });
  }

  // ---------- 启动 ----------
  if (!PLAN) { app.innerHTML = '<div class="card">数据没有加载成功，请刷新页面。</div>'; return; }
  setupLibs();
  updateWrongCount();
  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', syncOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncOnHide();
    else if (syncOn() && Date.now() - lastSyncAt > 30000) syncNow(); // 回到页面时拉一下别的设备的进度
  });
  route();
  if (syncOn()) syncNow(); else setSync('off', '');
})();
