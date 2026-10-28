#!/usr/bin/env node
'use strict';
const USAGE = `把学习网站的进度同步进 Obsidian 知识库。

进度来源（二选一）：
  - 进度仓库里的 progress.json（默认 djzts/Railway_Study_progress），用本机 git 拉取；私有仓库要求本机 git 有权限
  - --file：网站"设置 → 导出进度"得到的 JSON 文件

写入知识库：
  - MOC/6周学习计划.md：网站上完成的天打勾；"进度记录"表填考试分数（只填空格子或之前由脚本填的格子）
  - 30-Practice/错题本.md：每周标题下的"网站错题"表（两行 %% 标记之间的内容每次重写，标记外的手写内容不动）
  - 30-Practice/网站学习进度.md：进度汇总（整篇自动生成）
然后在知识库里只提交这三个文件。

用法：
  node tools/sync_obsidian.js [选项]

选项：
  --repo 用户名/仓库名   进度仓库，也可以是完整的 git 地址（默认 djzts/Railway_Study_progress）
  --branch 分支          默认用仓库的默认分支
  --path 文件            仓库里的进度文件（默认 progress.json）
  --file 进度.json       不拉仓库，直接读这个文件
  --vault 路径           知识库路径（默认 F:\\Obsidian_vault\\Train_dispatch\\Train_dispatch）
  --dry-run              只显示会改什么，不写文件
  --no-commit            写文件，但不在知识库里提交`;

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.dirname(__dirname);
const DEFAULTS = { repo: 'djzts/Railway_Study_progress', branch: '', path: 'progress.json', file: '', vault: 'F:\\Obsidian_vault\\Train_dispatch\\Train_dispatch' };
const PASS = 80;
const FILES = { plan: 'MOC/6周学习计划.md', wrong: '30-Practice/错题本.md', summary: '30-Practice/网站学习进度.md' };
// 试卷在知识库里的笔记名，以及"进度记录"表里的行名
const EXAM_NOTES = { w1: '第1周测验', w2: '第2周 阶段考一 运输组织基础', w3: '第3周测验', w4: '第4周 阶段考二 调度指挥', w5: '第5周测验', w6: '第6周 结业考' };
const EXAM_ROWS = { w1: '第 1 周测验', w2: '阶段考一', w3: '第 3 周测验', w4: '阶段考二', w5: '第 5 周测验', w6: '结业考' };
const WRONG_START = '%% 网站错题开始：这一段由 tools/sync_obsidian.js 自动生成，每次同步重写，不要在这里手改 %%';
const WRONG_END = '%% 网站错题结束 %%';
const WRONG_HEAD = ['| 日期 | 来源 | 题目（简写） | 错在哪里 | 正确要点 | 对应笔记 | 重做 |', '|---|---|---|---|---|---|---|'];
const WEEKDAYS = '日一二三四五六';
const LETTERS = 'ABCDEFGH';

// 网站的数据文件（学习安排、每日测试题、试卷）
global.window = {};
['plan', 'quiz', 'exams'].forEach(f => require(path.join(ROOT, 'data', f + '.js')));
const { PLAN, QUIZ, EXAMS } = global.window;

// ---------- 小工具 ----------
const pad = n => String(n).padStart(2, '0');
const stripBom = s => s.replace(/^\uFEFF/, '');
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return d; }
const mmdd = d => `${d.getMonth() + 1}/${pad(d.getDate())}`;
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = d => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtNum = x => Number.isInteger(x) ? String(x) : x.toFixed(1);
const weekNo = n => Math.max(1, Math.ceil(n / 7));

function plain(md) {
  return String(md || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`/g, '') // 不去 __：填空题的空格是 ______
    .replace(/^\s*(>|#+|[-+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
// 截断时不把 $…$ 公式截成半个
function short(md, k) {
  let s = plain(md);
  if (s.length <= k) return s;
  s = s.slice(0, k);
  if ((s.match(/\$/g) || []).length % 2) s = s.slice(0, s.lastIndexOf('$'));
  return s.trimEnd() + '…';
}
const cell = s => String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
// 试卷答案里网站格式的笔记链接 [名称](#/note/…) → [[名称]]
function noteLinks(md) {
  const names = [];
  String(md || '').replace(/\(#\/note\/([^)\s]+)\)/g, (m, x) => {
    try { x = decodeURIComponent(x); } catch (e) { /* 原样 */ }
    if (!names.includes(x)) names.push(x);
    return m;
  });
  return names;
}

// ---------- 进度 ----------
function examState(P, key) { return P.exams[key] || {}; }
function examScore(P, key) {
  const es = examState(P, key);
  if (es.finished) return es.score;
  const h = es.history || [];
  return h.length ? h[h.length - 1].score : null;
}
function examMissed(P, key) {
  const es = examState(P, key), ex = EXAMS[key];
  if (!es.finished || !ex) return [];
  return ex.questions.filter(q => { const g = (es.grades || {})[q.id]; return g != null && g < 1; });
}
function dayStatus(P, day) {
  if (day.type === 'exam') {
    if (examScore(P, day.exam) != null) return 'done';
    return examState(P, day.exam).startedAt ? 'partial' : 'none';
  }
  const st = P.days[day.n] || {};
  if (st.completed) return 'done';
  const touched = st.started || Object.values(st.read || {}).some(Boolean) || Object.values(st.tasks || {}).some(Boolean);
  return touched ? 'partial' : 'none';
}

function wrongInfo(w) {
  if (w.type === 'exam') {
    const ex = EXAMS[w.exam];
    const q = ex && ex.questions.find(x => x.id === w.qid);
    return q ? { kind: 'exam', q } : null;
  }
  const q = (QUIZ[w.src] || [])[w.idx - 1];
  return q ? { kind: 'quiz', q } : null;
}
function sourceDay(w) { return w.type === 'exam' ? ((PLAN.days.find(d => d.exam === w.exam) || {}).n || 0) : w.src; }
function sourceOrder(w) { return w.type === 'exam' ? (EXAMS[w.exam] ? EXAMS[w.exam].questions.findIndex(q => q.id === w.qid) : 0) : w.idx; }
function sortWrong(list) { return list.sort((a, b) => sourceDay(a) - sourceDay(b) || sourceOrder(a) - sourceOrder(b)); }
function examShort(key) { return ((EXAMS[key] || {}).title || key).split('：')[0].replace(/\s+/g, ''); }

// 和网站"导出 Markdown"同样的格式
function wrongRow(w) {
  const info = wrongInfo(w);
  let q = '', right = '', notes = [];
  if (info && info.kind === 'quiz') {
    const x = info.q;
    q = x.q;
    right = x.t === 's' ? `${LETTERS[x.a]}. ${x.o[x.a]}` : x.t === 'j' ? (x.a ? '正确' : '错误') : x.a;
    if (x.n) notes = [x.n];
  } else if (info) {
    q = info.q.body;
    right = String(info.q.answer).split(/\n?出处[:：]/)[0];
    notes = noteLinks(info.q.answer);
  }
  const src = w.type === 'exam' ? `${examShort(w.exam)} 第${w.qid}题` : `第${w.src}天测试 第${w.idx}题`;
  const redo = w.mastered ? '✅' : (w.streak || 0) >= 1 ? '[x] [ ]' : '[ ] [ ]';
  const date = w.added ? `${+w.added.slice(5, 7)}/${w.added.slice(8, 10)}` : '';
  return `| ${date} | ${cell(src)} | ${cell(short(q, 40))} | ${cell(short(w.mine, 40))} | ${cell(short(right, 60))} | ${notes.map(n => `[[${n}]]`).join('、')} | ${redo} |`;
}

function relearnText(P, key) {
  const missed = examMissed(P, key);
  if (!missed.length) return (examScore(P, key) || 0) >= PASS ? '—' : '';
  const notes = [];
  missed.forEach(q => noteLinks(q.answer).forEach(n => { if (!notes.includes(n)) notes.push(n); }));
  const ids = missed.map(q => q.id).join('、');
  return `第 ${ids} 题${notes.length ? '：' + notes.slice(0, 6).map(n => `[[${n}]]`).join('、') + (notes.length > 6 ? ' 等' : '') : ''}`;
}

// ---------- 读进度 ----------
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function loadProgress(opt) {
  if (opt.file) return { data: JSON.parse(stripBom(fs.readFileSync(opt.file, 'utf8'))), from: path.basename(opt.file) };
  const url = /^[\w.-]+\/[\w.-]+$/.test(opt.repo) ? `https://github.com/${opt.repo}.git` : opt.repo;
  const dir = path.join(ROOT, '.progress', opt.repo.replace(/[^\w.-]+/g, '_'));
  try {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      git(['clone', '-q', '--depth', '1'].concat(opt.branch ? ['--branch', opt.branch] : [], [url, dir]));
    } else {
      git(['fetch', '-q', '--depth', '1', 'origin', opt.branch || 'HEAD'], dir);
      git(['reset', '-q', '--hard', 'FETCH_HEAD'], dir);
    }
  } catch (e) {
    throw new Error(`拉取进度仓库失败（${url}）：${String(e.stderr || e.message).trim()}\n检查仓库名和分支，以及本机 git 有没有访问这个仓库的权限；也可以用 --file 指定网站导出的进度文件。`);
  }
  const p = path.join(dir, opt.path);
  if (!fs.existsSync(p)) throw new Error(`仓库里没有 ${opt.path}：网站还没同步过，先在网站"设置"里连上仓库。`);
  return { data: JSON.parse(stripBom(fs.readFileSync(p, 'utf8'))), from: `${opt.repo}${opt.branch ? '（' + opt.branch + ' 分支）' : ''} 的 ${opt.path}` };
}

// ---------- 改写知识库文件 ----------
function updatePlan(lines, P, log) {
  // 知识库里的日期按原计划（PLAN.start）对应到第几天
  const start = parseDate(PLAN.start);
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)- \[ \] \*\*周.\s*(\d{1,2})\/(\d{1,2})｜/);
    if (!m) return;
    const n = Math.round((new Date(start.getFullYear(), +m[2] - 1, +m[3]) - start) / 864e5) + 1;
    const day = PLAN.days.find(d => d.n === n);
    if (!day || dayStatus(P, day) !== 'done') return;
    lines[i] = line.replace('- [ ]', '- [x]');
    log.push(`学习计划：第 ${n} 天「${day.title}」打勾`);
  });
  Object.entries(EXAM_ROWS).forEach(([key, label]) => {
    const sc = examScore(P, key);
    if (sc == null) return;
    const i = lines.findIndex(l => l.replace(/\s+/g, ' ').startsWith(`| ${label} |`));
    if (i < 0) { log.push(`学习计划：没找到"进度记录"表里的「${label}」这一行，跳过`); return; }
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
    if (cells[1] && !cells[1].includes('（网站）')) { log.push(`学习计划：「${label}」已经有手填的分数（${cells[1]}），没有覆盖`); return; }
    const row = `| ${label} | ${fmtNum(sc)} 分（网站） | ${sc >= PASS ? '✅ 合格' : '❌ 不合格'} | ${relearnText(P, key)} |`;
    if (row !== lines[i]) { lines[i] = row; log.push(`学习计划：「${label}」填入 ${fmtNum(sc)} 分`); }
  });
  return lines;
}

function updateWrongBook(lines, P, log) {
  // 先删掉上次生成的段落
  for (;;) {
    const s = lines.findIndex(l => l.startsWith('%% 网站错题开始'));
    if (s < 0) break;
    let e = lines.findIndex((l, i) => i > s && l.startsWith('%% 网站错题结束'));
    if (e < 0) e = s;
    const from = s > 0 && lines[s - 1] === '' ? s - 1 : s;
    lines.splice(from, e - from + 1);
  }
  const byWeek = {};
  sortWrong(Object.values(P.wrong)).forEach(w => { (byWeek[weekNo(sourceDay(w))] = byWeek[weekNo(sourceDay(w))] || []).push(w); });
  Object.keys(byWeek).map(Number).sort((a, b) => a - b).forEach(k => {
    const list = byWeek[k];
    const block = ['', WRONG_START, '', ...WRONG_HEAD, ...list.map(wrongRow), '', WRONG_END];
    let h = lines.findIndex(l => new RegExp(`^## 第 ${k} 周(?!\\d)`).test(l));
    if (h < 0) {
      if (lines[lines.length - 1] === '') lines.pop();
      lines.push('', `## 第 ${k} 周`, '');
      h = lines.length - 2;
    }
    lines.splice(h + 1, 0, ...block);
    if (lines[h + 1 + block.length] !== '') lines.splice(h + 1 + block.length, 0, '');
    const todo = list.filter(w => !w.mastered).length;
    log.push(`错题本：第 ${k} 周 ${list.length} 道（待复习 ${todo}，已掌握 ${list.length - todo}）`);
  });
  return lines;
}

function buildSummary(P, from, created) {
  const now = new Date();
  const start = P.start || PLAN.start;
  const today = parseDate(ymd(now));
  const doneN = PLAN.days.filter(d => dayStatus(P, d) === 'done').length;
  let got = 0, tot = 0;
  Object.values(P.days).forEach(st => { if (st.quiz && st.quiz.finished) { got += st.quiz.got; tot += st.quiz.total; } });
  const wrong = Object.values(P.wrong);
  const pending = wrong.filter(w => !w.mastered).length;
  const scores = Object.keys(EXAM_NOTES).map(k => examScore(P, k)).filter(s => s != null);

  const L = [
    '---', 'type: practice', 'tags: [自测, 进度]', `created: ${created}`, `updated: ${stamp(now)}`, '---',
    '# 网站学习进度', '',
    '> [!info] 自动生成',
    '> 这篇由学习网站的进度自动生成（`tools/sync_obsidian.js`），每次同步整篇重写，不要手改。',
    `> 进度来源：${from}；网站上最后一次改动：${P.updatedAt ? stamp(new Date(P.updatedAt)) : '未知'}`,
    '> 配套：[[6周学习计划]]、[[错题本]]', '',
    '## 总览', '',
    '| 项目 | 数值 |', '|---|---|',
    `| 已完成 | ${doneN} / ${PLAN.days.length} 天 |`,
    `| 每日测试正确率 | ${tot ? Math.round(got / tot * 100) + '%（' + fmtNum(got) + ' / ' + tot + ' 题）' : '—'} |`,
    `| 错题本 | 待复习 ${pending} 道，已掌握 ${wrong.length - pending} 道 |`,
    `| 考试平均分 | ${scores.length ? fmtNum(scores.reduce((a, b) => a + b, 0) / scores.length) + '（' + scores.length + ' / 6 场）' : '—'} |`,
    `| 计划开始日期 | ${start} |`, '',
    '## 考试', '',
    '| 考试 | 日期 | 成绩 | 用时 | 没拿满分的题 | 历次成绩 |', '|---|---|---|---|---|---|'
  ];
  PLAN.days.filter(d => d.type === 'exam').forEach(d => {
    const es = examState(P, d.exam), sc = examScore(P, d.exam);
    const res = sc == null ? (es.startedAt ? '进行中' : '未考') : `${fmtNum(sc)} ${sc >= PASS ? '✅' : '❌'}`;
    const used = es.finished && es.usedSec ? Math.max(1, Math.round(es.usedSec / 60)) + ' 分钟' : '';
    const missed = examMissed(P, d.exam).map(q => q.id).join('、');
    const hist = (es.history || []).map(h => `${fmtNum(h.score)}（${h.at ? +h.at.slice(5, 7) + '/' + h.at.slice(8, 10) : ''}）`).join('、');
    L.push(`| [[${EXAM_NOTES[d.exam]}]] | ${mmdd(addDays(start, d.n - 1))} | ${res} | ${used} | ${missed} | ${hist} |`);
  });
  L.push('', '## 每天', '');
  PLAN.weeks.forEach(wk => {
    L.push(`### 第 ${wk.w} 周 · ${wk.theme}`, '', '| 日期 | 第几天 | 内容 | 状态 | 测试 |', '|---|---|---|---|---|');
    PLAN.days.filter(d => weekNo(d.n) === wk.w).forEach(d => {
      const date = addDays(start, d.n - 1), s = dayStatus(P, d);
      const status = s === 'done' ? '✅ 完成' : s === 'partial' ? '🟡 进行中' : date < today ? '⬜ 没完成' : '';
      let test = '';
      if (d.type === 'exam') { const sc = examScore(P, d.exam); test = sc == null ? '' : fmtNum(sc) + ' 分'; }
      else { const q = (P.days[d.n] || {}).quiz; if (q && q.finished) test = `${fmtNum(q.got)} / ${q.total}`; }
      L.push(`| ${mmdd(date)} 周${WEEKDAYS[date.getDay()]} | ${d.n} | ${cell(d.title)} | ${status} | ${test} |`);
    });
    L.push('');
  });
  L.push('## 错题', '', '| 周 | 待复习 | 已掌握 |', '|---|---|---|');
  PLAN.weeks.forEach(wk => {
    const list = wrong.filter(w => weekNo(sourceDay(w)) === wk.w);
    if (list.length) { const todo = list.filter(w => !w.mastered).length; L.push(`| 第 ${wk.w} 周 | ${todo} | ${list.length - todo} |`); }
  });
  if (!wrong.length) L.push('| — | 0 | 0 |');
  L.push('', '错题明细在 [[错题本]] 里每周标题下的"网站错题"表。', '');
  return L.join('\n');
}

// ---------- 主流程 ----------
function readText(file) {
  if (!fs.existsSync(file)) return null;
  const raw = stripBom(fs.readFileSync(file, 'utf8'));
  return { lines: raw.split(/\r?\n/), eol: raw.includes('\r\n') ? '\r\n' : '\n', raw };
}

function main() {
  const opt = Object.assign({ dryRun: false, commit: true }, DEFAULTS);
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opt.dryRun = true;
    else if (a === '--no-commit') opt.commit = false;
    else if (['--repo', '--branch', '--path', '--file', '--vault'].includes(a) && argv[i + 1] != null) opt[a.slice(2)] = argv[++i];
    else if (a === '-h' || a === '--help') { console.log(USAGE); return; }
    else throw new Error('不认识的参数：' + a + '\n\n' + USAGE);
  }
  if (!fs.existsSync(path.join(opt.vault, FILES.plan))) throw new Error('找不到知识库：' + opt.vault);

  const { data, from } = loadProgress(opt);
  const P = { start: data.start || PLAN.start, updatedAt: data.updatedAt, days: data.days || {}, exams: data.exams || {}, wrong: data.wrong || {} };
  console.log(`进度来源：${from}`);

  const log = [];
  const outputs = [];
  const plan = readText(path.join(opt.vault, FILES.plan));
  outputs.push([FILES.plan, plan, updatePlan(plan.lines.slice(), P, log).join(plan.eol)]);
  const wb = readText(path.join(opt.vault, FILES.wrong));
  if (wb) outputs.push([FILES.wrong, wb, updateWrongBook(wb.lines.slice(), P, log).join(wb.eol)]);
  else log.push(`没找到 ${FILES.wrong}，跳过错题本`);
  const old = readText(path.join(opt.vault, FILES.summary));
  const created = (old && (old.raw.match(/^created:\s*(\S+)/m) || [])[1]) || ymd(new Date());
  const eol = old ? old.eol : plan.eol;
  outputs.push([FILES.summary, old, buildSummary(P, from, created).split('\n').join(eol)]);

  const changed = [];
  outputs.forEach(([rel, before, after]) => {
    // 汇总页的 updated 时间每次都会变，只有内容变了才算改动
    const norm = s => (s || '').replace(/^updated: .*$/m, '');
    if (before && norm(before.raw) === norm(after)) return;
    changed.push(rel);
    if (!opt.dryRun) fs.writeFileSync(path.join(opt.vault, rel), after, 'utf8');
  });

  log.forEach(l => console.log('  ' + l));
  if (!changed.length) { console.log('知识库已经是最新的，没有改动。'); return; }
  console.log((opt.dryRun ? '会改动：' : '已改动：') + changed.join('、'));
  if (opt.dryRun || !opt.commit) return;

  try { git(['rev-parse', '--is-inside-work-tree'], opt.vault); } catch (e) { console.log('知识库不是 git 仓库，没有提交。'); return; }
  git(['add', '--'].concat(changed), opt.vault);
  if (!git(['diff', '--cached', '--name-only', '--'].concat(changed), opt.vault)) { console.log('没有需要提交的改动。'); return; }
  const msg = `同步网站学习进度（${stamp(new Date())}）`;
  git(['commit', '-q', '-m', msg, '--'].concat(changed), opt.vault);
  console.log('已在知识库提交：' + msg);
}

try { main(); } catch (e) { console.error('出错了：' + e.message); process.exit(1); }
