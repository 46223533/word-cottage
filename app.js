'use strict';
/* ==========================================================================
   小学英语趣味背单词工作台
   --------------------------------------------------------------------------
   结构：数据层 → 计算层 → 渲染层 → 交互层
   视觉：全部走 style.css 的变量与下方 ICONS 常量，换素材包只动这两处
   词库：words.js（由 tools/build-words.js 从公开词典生成）
   ========================================================================== */

/* ---------- 复习间隔（天）：借鉴间隔重复法，box 越高间隔越长 ---------- */
const INTERVALS = [1, 2, 4, 7, 15, 30];
const MASTER_BOX = INTERVALS.length;      // 达到此 box 视为已掌握

/* ---------- 奖励数值 ---------- */
const REWARD = {
  learnNew: { xp: 10, coin: 3 },          // 学会一个新词
  reviewOk: { xp: 5, coin: 1 },           // 复习拼对一次
  gamePerRight: { xp: 4, coin: 1 },       // 闯关每答对一题
  gameBonus: { xp: 20, coin: 5 }          // 正确率达标加成
};
const LEVEL_STEP = 120;                    // 每级所需经验

/* ==========================================================================
   数据层
   ========================================================================== */
const STORE_KEY = 'wordfun.v2';

function todayStr(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function addDays(s, n) {
  const p = s.split('-').map(Number);
  return todayStr(new Date(p[0], p[1] - 1, p[2] + n));
}
/* 头像候选图块（都取自素材包，孩子可自选） */
const AVATARS = [109, 108, 121, 120, 122, 83];

/* 教材册次信息。词库现在就是课本词表本身，每个档案只学自己那一册。 */
const BOOK_INFO = {
  '4A': { name: '四年级上册', short: '四上', grade: 4 },
  '6A': { name: '六年级上册', short: '六上', grade: 6 }
};
const BOOK_KEYS = ['4A', '6A'];

/* 单词 → 词条索引，迁移与查词都用它 */
const INDEX_BY_WORD = (function () {
  const m = {};
  WORDS.forEach(function (x) {
    const k = x.w.toLowerCase();
    if (m[k] === undefined) m[k] = x.i;
  });
  return m;
})();

/* 每册包含的词条索引（按课本单元顺序，已经排好） */
const BOOK_INDEX = (function () {
  const m = {};
  WORDS.forEach(function (x) { (m[x.book] = m[x.book] || []).push(x.i); });
  return m;
})();

function newProfile(name, tile, book) {
  return {
    name: name,
    tile: tile || 109,          // 头像用的图块编号
    book: book || '4A',         // 这个档案在学哪一册
    xp: 0, coins: 0, streak: 0, lastDay: '',
    states: {},                 // { 词条索引: {box, due, wrong} }
    statesV3: true,             // 新建档案的记录已经是新索引，不需要迁移
    log: { date: '', newN: 0, revN: 0, gameN: 0 }
  };
}
function defaultDB() {
  return {
    v: 2,
    active: 'a1',
    profiles: {
      a1: newProfile('哥哥', 109, '6A'),     // 六年级
      a2: newProfile('妹妹', 108, '4A')      // 四年级
    },
    cfg: { perDay: 5, pwd: '1234' },
    shop: [
      { id: 's1', name: '看动画 30 分钟', price: 20, emoji: '📺' },
      { id: 's2', name: '一个冰淇淋', price: 15, emoji: '🍦' },
      { id: 's3', name: '周末去公园', price: 30, emoji: '🎡' },
      { id: 's4', name: '心愿小玩具', price: 100, emoji: '🧸' }
    ],
    orders: []
  };
}

/* 老存档兼容：把还在用默认称呼的档案换成孩子真名。
   只要家长自己改过名字就不再动，避免覆盖他的设置。
   注意：这个常量必须声明在 module 顶层且早于 loadDB() 调用，
   否则迁移时读它会踩到暂时性死区，异常被 catch 吞掉后存档会被当成损坏而重置。 */
/* 早期版本的默认称呼（弟弟/妹妹都指过老二）统一成现在的默认称呼。
   注意不要把「哥哥/妹妹」映射成真名——线上是公开链接，默认不显示孩子姓名，
   家长在「家长中心」改一次真名就存进本机，不会被这段覆盖。 */
const NAME_MAP = { '弟弟': '妹妹' };

let db = loadDB();

function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.v === 2 && d.profiles && d.profiles[d.active]) return migrate(d);
    }
  } catch (e) { /* 数据损坏则重建 */ }
  return defaultDB();
}
function migrate(d) {
  Object.keys(d.profiles || {}).forEach(function (k, n) {
    const p = d.profiles[k];
    if (!p.tile) p.tile = n === 0 ? 109 : 108;
    if (NAME_MAP[p.name]) p.name = NAME_MAP[p.name];
    /* 老存档没有 book：按档案位推断（a1=哥哥六年级，a2=妹妹四年级） */
    if (!p.book || !BOOK_INFO[p.book]) p.book = (k === 'a1') ? '6A' : '4A';
    /* 词库从「ECDICT 1464 词」换成了「课本词表」，索引全变了。
       老存档的 states 以旧序号为键，必须按「旧序号 → 旧单词 → 新词条」重映射，
       对不上的（不在课本里的超纲词）丢弃。只做一次。 */
    if (p.statesV3 !== true) {
      p.states = remapStates(p.states);
      p.statesV3 = true;
    }
  });
  return d;
}

/* 旧序号还原成单词再查新库。LEGACY_WORDS 由 tools/legacy-map.js 提供，
   万一那个文件没加载，就当作全新开始，不能让异常冒到 loadDB 的 catch 里去。 */
function remapStates(old) {
  const out = {};
  if (typeof LEGACY_WORDS === 'undefined' || !old) return out;
  Object.keys(old).forEach(function (k) {
    const ow = LEGACY_WORDS[Number(k)];
    if (!ow) return;
    const ni = INDEX_BY_WORD[ow.toLowerCase()];
    if (ni === undefined) return;                 // 不在课本词表里，丢弃
    out[ni] = old[k];
  });
  return out;
}
function saveDB() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* 忽略 */ }
}
function P() { return db.profiles[db.active]; }

/* 档案头像图块 */
function avatarOf(p) { return p.tile || 108; }
/* 除当前档案之外的其他小朋友（目前固定两人，留给以后扩展） */
function rivals() {
  return Object.keys(db.profiles)
    .filter(function (k) { return k !== db.active; })
    .map(function (k) { return { k: k, p: db.profiles[k] }; });
}

/* 跨天时重置当日计数、维护连续天数 */
function touchDay() {
  const p = P();
  const t = todayStr();
  if (p.log.date === t) return;
  const y = addDays(t, -1);
  if (p.lastDay === t) { /* 今天已学过 */ }
  else if (p.lastDay === y) { p.streak = (p.streak || 0) + 1; }
  else if (p.lastDay !== t) { p.streak = 0; }
  p.log = { date: t, newN: 0, revN: 0, gameN: 0 };
  saveDB();
}

/* ==========================================================================
   计算层
   ========================================================================== */
function stateOf(i) { return P().states[i]; }

/* 当前档案要学的那一册的词条索引 */
function bookList(p) { return BOOK_INDEX[p ? p.book : ''] || []; }
function bookLabel(p) {
  const b = BOOK_INFO[p ? p.book : ''];
  return b ? b.name : '课本';
}
/* 当前进度：正在学第几单元、这一册学了多少 */
function progressInfo(p) {
  const pool = bookList(p);
  let total = 0, learned = 0, unit = 0, unitTotal = 0, unitLearned = 0;
  for (let k = 0; k < pool.length; k++) {
    const i = pool[k];
    const w = WORDS[i];
    if (!w) continue;
    total++;
    const st = p.states[i];
    if (st) learned++;
    if (!unit) {
      unit = w.unit;
      unitTotal++;
      if (st) unitLearned++;
    } else if (w.unit === unit) {
      unitTotal++;
      if (st) unitLearned++;
    }
  }
  /* 第一个还有没学的词的单元才算「当前单元」 */
  let curUnit = 0, curLeft = 0;
  for (let k = 0; k < pool.length; k++) {
    const i = pool[k];
    const w = WORDS[i];
    if (!w) continue;
    if (!p.states[i]) {
      if (!curUnit) curUnit = w.unit;
      if (w.unit === curUnit) curLeft++;
    }
  }
  return { total: total, learned: learned, unit: curUnit || unit, curLeft: curLeft,
           unitTotal: unitTotal, unitLearned: unitLearned };
}

function dueWords(p) {
  const t = todayStr();
  return Object.keys(p.states)
    .map(Number)
    .filter((i) => {
      const w = WORDS[i];
      if (!w || w.book !== p.book) return false;
      const st = p.states[i];
      return st.box < MASTER_BOX && st.due <= t;
    })
    .sort((a, b) => (p.states[b].wrong || 0) - (p.states[a].wrong || 0) || a - b);
}
function newWords(p, n) {
  const out = [];
  const pool = bookList(p);
  for (let k = 0; k < pool.length && out.length < n; k++) {
    const i = pool[k];
    const w = WORDS[i];
    if (!w) continue;
    if (!p.states[i]) out.push(i);
  }
  return out;
}
function wrongWords(p) {
  return Object.keys(p.states).map(Number)
    .filter((i) => WORDS[i] && WORDS[i].book === p.book && (p.states[i].wrong || 0) > 0)
    .sort((a, b) => p.states[b].wrong - p.states[a].wrong);
}
/* 已学词里能逐字母拼的个数（闯关要出拼写题，全靠这个数） */
function learnedSpellCount(p) {
  return Object.keys(p.states).filter((i) => WORDS[i] && WORDS[i].book === p.book && WORDS[i].sp).length;
}
function learnedCount(p) {
  return Object.keys(p.states).filter((i) => WORDS[i] && WORDS[i].book === p.book).length;
}
function masteredCount(p) {
  return Object.keys(p.states).filter((i) => WORDS[i] && WORDS[i].book === p.book && p.states[i].box >= MASTER_BOX).length;
}
function levelOf(p) {
  const lv = Math.floor(p.xp / LEVEL_STEP) + 1;
  const cur = p.xp % LEVEL_STEP;
  return { lv: lv, cur: cur, need: LEVEL_STEP, pct: Math.round((cur / LEVEL_STEP) * 100) };
}
function todayDone(p) {
  if (p.log.date !== todayStr()) return { newN: 0, revN: 0, gameN: 0 };
  return p.log;
}

/* 记录一次作答：correct 决定 box 升降 */
function gradeWord(i, correct) {
  const p = P();
  const t = todayStr();
  let st = p.states[i];
  if (!st) st = p.states[i] = { box: 0, due: t, wrong: 0 };
  if (correct) {
    st.box = Math.min(MASTER_BOX, st.box + 1);
    st.due = addDays(t, INTERVALS[Math.min(st.box, INTERVALS.length - 1)]);
  } else {
    st.box = 0;
    st.due = addDays(t, INTERVALS[0]);
    st.wrong = (st.wrong || 0) + 1;
  }
  saveDB();
}

function addReward(kind) {
  const p = P();
  const r = REWARD[kind];
  if (!r) return;
  p.xp += r.xp;
  p.coins += r.coin;
  p.lastDay = todayStr();
  saveDB();
}

/* ==========================================================================
   通用工具
   ========================================================================== */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = r[i];
    r[i] = r[j];
    r[j] = tmp;
  }
  return r;
}

let voices = [];
function loadVoices() { try { voices = window.speechSynthesis.getVoices() || []; } catch (e) {} }
loadVoices();
if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = loadVoices;

function speak(text, rate, onend) {
  if (!('speechSynthesis' in window)) {
    if (typeof onend === 'function') setTimeout(onend, 300);   // 没有语音也要让后续动作接上
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate || 0.8;
    const v = voices.find((v) => /en[-_]US/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
    if (v) u.voice = v;
    if (typeof onend === 'function') u.onend = onend;
    window.speechSynthesis.speak(u);
  } catch (e) {
    if (typeof onend === 'function') setTimeout(onend, 300);
  }
}

let toastTimer = null;
function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 1800);
}

function confetti() {
  const box = $('#fx');
  if (!box) return;
  const colors = ['#fdbe53', '#84c669', '#c34b35', '#c0cbdc', '#eaa56c', '#4e974c'];
  for (let i = 0; i < 30; i++) {
    const d = document.createElement('i');
    d.className = 'confetti';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.animationDelay = (Math.random() * 0.3) + 's';
    box.appendChild(d);
    setTimeout(() => d.remove(), 2000);
  }
}

/* 单词分色渲染：按拼写类型着色（不是发音判断） */
/* seg 是按小写字母切的（PE / Ms / Chinese / T-shirt 这些词也一样），
   显示时必须还原原词的大小写，否则孩子看到的是 ms 而不是课本上的 Ms */
function segHTML(w) {
  const letters = w.w.replace(/[^a-zA-Z]/g, '');
  let k = 0;
  return w.seg.map((s) => {
    const chunk = letters.substr(k, s[0].length);
    k += s[0].length;
    return `<span class="seg k-${s[1]}" data-act="seg" data-w="${w.i}">${esc(chunk)}</span>`;
  }).join('');
}
/* 课本里有 firefighter / gingerbread / electricity 这种 11 字母的词，
   固定 62px 会被挤到换行（firefight / er），按长度递减才好看 */
function wordSize(word) {
  const n = word.length;
  if (n <= 5) return 62;
  if (n <= 7) return 54;
  if (n <= 9) return 44;
  return 36;
}
function plainWord(w) { return esc(w.w); }

/* 词组的作答区：中文在上，四个英文选项；点错的划掉但不结束，可以继续选 */
function phraseBoardHTML(i, sp, hint) {
  const w = WORDS[i];
  const words = w.w.split(' ').length;
  const meta = w.p ? esc(w.p) : '';
  const shape = words > 1 ? words + ' 个词' : '带连字符';
  const opts = sp.opts.map((o) => {
    let cls = 'opt';
    const dead = sp.ok || sp.tried.indexOf(o) !== -1;
    if (sp.tried.indexOf(o) !== -1) cls += ' is-wrong';
    else if (sp.ok && o === w.w) cls += ' is-right';
    return `<button class="${cls}" data-act="phrasePick" data-o="${esc(o)}"${dead ? ' disabled' : ''}>${esc(o)}</button>`;
  }).join('');
  return `
    <div class="board">
      <div class="board__paper">
        <span class="board__lv">L${w.lv}</span>
        <p class="panel__hint" style="text-align:center;margin:0 0 2px">${hint || '选出正确的英文'}</p>
        ${picHTML(w, true)}
        <div class="quiz__q">${esc(w.cn)}</div>
        <div class="board__ipa">${meta}${meta ? ' · ' : ''}${shape}</div>
        <button class="btn btn--sound" data-act="say" data-w="${i}">${ICONS.speak} 听发音</button>
        <div class="opts opts--phr">${opts}</div>
      </div>
    </div>`;
}

const SEG_LEGEND = [
  ['k-v', '元音字母'], ['k-vg', '元音组合'], ['k-c', '辅音'],
  ['k-cg', '辅音组合'], ['k-magice', '词末 e'], ['k-silent', '不发音 e']
];

/* ==========================================================================
   渲染层
   ========================================================================== */
const ui = {
  view: 'today',
  stack: [],
  learn: null,      // 学习会话
  game: null,       // 闯关会话
  quiz: null,       // 单题选择状态
  spell: null,      // 拼字状态
  meaning: null,    // 三选一（看英文选中文）状态
  sheet: null,      // 弹层
  parentOK: false   // 家长验证状态（本次会话有效）
};

function go(view, opts) {
  ui.stack.push(ui.view);
  ui.view = view;
  ui.opt = opts || {};
  render();
}
function back() {
  ui.view = ui.stack.pop() || 'today';
  ui.sheet = null;
  render();
}
function tab(view) {
  ui.stack = [];
  ui.view = view;
  ui.sheet = null;
  render();
}

/* ---------- 素材：图块编号（对应 assets/tinyfarm/tile_XXXX.png） ---------- */
const TILE = {
  chalk: 98, carrot: 8, tomato: 42, tomatoOne: 44, wheat: 68, corn: 32,
  sun: 83, flower: 30, cabbage: 56, eggplant: 18,
  tree: 15, pine: 27, pineS: 3, bush: 53, sprout: 117, bushBerry: 78,
  chicken: 122, sheep: 120, cow: 121, kid: 108, farmer: 109,
  crate: 76, crateX: 90, stall: 11, crateOpen: 98,
  barrel: 72, barrelWater: 73, bucket: 123, well: 124, sack: 74,
  hay: 66, hayOne: 67, stone: 55,
  can: 84, hoe: 87, shovel: 88, hammer: 86,
  door: 12, sign: 96, frame: 128, water: 110
};

/* 图块精灵：size 为显示边长（像素风的整数倍最清晰） */
function spr(tile, size, cls) {
  const t = String(tile).padStart(4, '0');
  return '<i class="sp sp-' + t + (cls ? ' ' + cls : '') + '" style="width:' + size + 'px;height:' + size + 'px" aria-hidden="true"></i>';
}

/* 极小像素图标：素材包没有对应语义（金币/经验/喇叭等）时用它补齐，保持同一像素语言 */
function pix(body) {
  return '<svg class="pi" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">' + body + '</svg>';
}

const ICONS = {
  coin: pix('<circle cx="8" cy="8" r="7" fill="#3f2631"/><circle cx="8" cy="8" r="5.4" fill="#fdbe53"/><rect x="7" y="4" width="2" height="8" fill="#e38628"/><rect x="5" y="3" width="3" height="2" fill="#ffe6ad"/>'),
  xp: pix('<circle cx="8" cy="8" r="7" fill="#3f2631"/><circle cx="8" cy="8" r="5.4" fill="#c0cbdc"/><polygon points="8,3.4 9.4,6.4 12.6,6.4 10,8.5 11,11.8 8,9.9 5,11.8 6,8.5 3.4,6.4 6.6,6.4" fill="#52607c"/>'),
  streak: pix('<polygon points="8,2 10,6 12,5 12.5,9 10.5,13 5.5,13 3.5,9.5 4,7 5.5,8 6,5.5" fill="#3f2631"/><polygon points="8,4.4 9.4,7.2 11,6.6 11.4,9 9.8,11.6 6.2,11.6 4.6,9.2 5.4,8.4 6.4,9 6.8,6.6" fill="#e38628"/><rect x="7" y="9" width="2" height="2" fill="#fdbe53"/>'),
  speak: pix('<rect x="2" y="6" width="2" height="4" fill="#3f2631"/><path d="M5 6h2V4h2v8H7v-2H5z" fill="#3f2631"/><rect x="11" y="5" width="1.5" height="2" fill="#3f2631"/><rect x="12.5" y="7" width="1.5" height="2" fill="#3f2631"/><rect x="11" y="9" width="1.5" height="2" fill="#3f2631"/>'),
  back: pix('<rect x="9" y="3" width="2" height="2" fill="#fff6e4"/><rect x="7" y="5" width="2" height="2" fill="#fff6e4"/><rect x="5" y="7" width="2" height="2" fill="#fff6e4"/><rect x="7" y="9" width="2" height="2" fill="#fff6e4"/><rect x="9" y="11" width="2" height="2" fill="#fff6e4"/>'),
  lock: pix('<rect x="5" y="7" width="8" height="7" fill="#3f2631"/><rect x="6" y="8" width="6" height="5" fill="#fdbe53"/><rect x="6" y="4" width="1.5" height="3" fill="#3f2631"/><rect x="10.5" y="4" width="1.5" height="3" fill="#3f2631"/><rect x="7" y="3" width="4" height="1.5" fill="#3f2631"/><rect x="7.5" y="9.5" width="2" height="2.5" fill="#3f2631"/>'),
  star: pix('<polygon points="8,1.6 9.8,6 14.4,6 10.6,8.9 12.1,13.4 8,10.5 3.9,13.4 5.4,8.9 1.6,6 6.2,6" fill="#fdbe53" stroke="#3f2631" stroke-width="0.9"/>'),
  check: pix('<polyline points="3,9 6.5,12.5 13,4" fill="none" stroke="#4e974c" stroke-width="3" stroke-linecap="square"/>'),
  cross: pix('<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="#aa2c23" stroke-width="3" stroke-linecap="square"/>')
};

/* ---------- 顶部木牌 ---------- */
function topbar(title, sub, showBack) {
  const p = P();
  const subText = sub || (p.name + '的农场');
  return `
  <header class="banner">
    <div class="banner__bar">
      ${showBack
        ? `<button class="banner__back" data-act="back" aria-label="返回">${ICONS.back}</button>`
        : `<button class="banner__badge banner__badge--who" data-act="switchProfile" aria-label="切换小朋友">${spr(avatarOf(p), 32)}</button>`}
      <div class="banner__titles">
        <b class="banner__title">${esc(title)}</b>
        ${subText ? `<em class="banner__sub">${esc(subText)}</em>` : ''}
      </div>
      <div class="banner__stats">
        <span class="chip chip--coin">${ICONS.coin}<b>${p.coins}</b></span>
        <span class="chip chip--xp">${ICONS.xp}<b>${p.xp}</b></span>
      </div>
    </div>
  </header>`;
}

/* ---------- 底部木栈道 ---------- */
function tabbar() {
  const items = [
    ['today', TILE.carrot, '今日'],
    ['game', TILE.hoe, '闯关'],
    ['versus', TILE.hay, '对决'],
    ['shop', TILE.stall, '商店'],
    ['me', TILE.sun, '我的']
  ];
  return `<nav class="dock">${items.map((it) => `
    <button class="dock__item ${ui.view === it[0] ? 'is-on' : ''}" data-act="tab" data-v="${it[0]}">
      <span class="dock__icon">${spr(it[1], 32)}</span><b>${it[2]}</b>
    </button>`).join('')}</nav>`;
}

/* 绝对定位的装饰精灵：pos 形如 'left:-10px;bottom:18px' */
function sprPos(tile, size, pos) {
  const t = String(tile).padStart(4, '0');
  return '<i class="sp sp-' + t + '" style="position:absolute;' + pos + ';width:' + size + 'px;height:' + size + 'px" aria-hidden="true"></i>';
}

/* 场景带：四层横向排列的图块阵列——远处树线、草地上散置物件、
   土垄里成排的作物、田埂上的主人物。同层自动均分，不会互相压住。 */
function sceneBand(o) {
  const item = (x) => {
    const t = String(x[0]).padStart(4, '0');
    return '<i class="sp sp-' + t + '" style="width:' + x[1] + 'px;height:' + x[1] +
      'px;margin-bottom:' + (x[2] || 0) + 'px" aria-hidden="true"></i>';
  };
  const row = (arr, cls) => (arr && arr.length)
    ? '<span class="hero__row ' + cls + '">' + arr.map(item).join('') + '</span>'
    : '';
  return `<div class="hero__scene" aria-hidden="true">
        <span class="hero__field"></span>
        ${(o.trees || []).map((x) => sprPos(x[0], x[1], x[2])).join('')}${row(o.ground, 'hero__row--grass')}${row(o.ridge, 'hero__row--ridge')}
      </div>`;
}

/* 本批收获条：已学会的词长成菜，未学的还是苗 */
function batchBar(s, tile) {
  const crops = s.list.map(function (wi, k) {
    const done = k < s.pos;
    return spr(done ? tile : TILE.sprout, 32, done ? '' : 'is-pending');
  }).join('');
  return `<div class="batchbar"><b>本批 ${s.list.length} 个</b><span class="batchbar__crops">${crops}</span></div>`;
}

/* 页脚农场带：短页面时把版面撑满，同时是场景的一部分 */
function farmFoot() {
  const line = (tiles, size) => '<span class="farmfoot__row">' +
    tiles.map((t) => spr(t, size)).join('') + '</span>';
  const far = [TILE.corn, TILE.wheat, TILE.corn, TILE.wheat, TILE.corn, TILE.wheat, TILE.corn, TILE.wheat, TILE.corn];
  const near = [TILE.carrot, TILE.cabbage, TILE.tomato, TILE.carrot, TILE.cabbage, TILE.tomato, TILE.carrot];
  return `
  <div class="farmfoot" aria-hidden="true">
    ${sprPos(TILE.pine, 96, 'left:-26px;bottom:124px')}
    ${sprPos(TILE.tree, 112, 'right:-28px;bottom:120px')}
    ${sprPos(TILE.barrel, 48, 'left:15%;bottom:146px')}
    ${sprPos(TILE.crate, 32, 'left:31%;bottom:142px')}
    ${sprPos(TILE.chicken, 32, 'left:47%;bottom:144px')}
    ${sprPos(TILE.cow, 48, 'right:32%;bottom:144px')}
    ${sprPos(TILE.flower, 48, 'right:14%;bottom:148px')}
    <div class="farmfoot__field">
      ${line(far, 32)}
      ${line(near, 48)}
    </div>
  </div>`;
}

/* ---------- 今日：农场全景 ---------- */
function viewToday() {
  touchDay();
  const p = P();
  const per = db.cfg.perDay;
  const plan = { fresh: newWords(p, per), due: dueWords(p), wrong: wrongWords(p) };
  const done = todayDone(p);
  const freshLeft = Math.max(0, per - done.newN);
  const totalToday = per + plan.due.length;
  const finished = done.newN + done.revN;
  const pct = totalToday ? Math.min(100, Math.round((finished / totalToday) * 100)) : 0;

  const lv = levelOf(p);
  const prog = progressInfo(p);
  const allDone = freshLeft === 0 && plan.due.length === 0;
  const canGame = learnedCount(p) >= 4 && learnedSpellCount(p) >= 2;

  const tasks = [];
  tasks.push({
    id: 'learn', tile: TILE.carrot,
    name: '种新词',
    meta: freshLeft > 0 ? `Unit ${prog.unit} · 还有 ${freshLeft} 个新词` : '今天的新词种完了',
    done: freshLeft === 0,
    go: freshLeft > 0 ? '去种 →' : '已完成'
  });
  tasks.push({
    id: 'review', tile: TILE.tomato,
    name: '浇水复习',
    meta: plan.due.length > 0 ? `${plan.due.length} 个词到期待复习` : '暂时没有要复习的词',
    done: plan.due.length === 0,
    go: plan.due.length > 0 ? '去浇水 →' : '很干净'
  });
  tasks.push({
    id: 'game', tile: TILE.wheat,
    name: '打谷闯关',
    meta: canGame ? `用 ${learnedCount(p)} 个已学词出题` : '学会 4 个词后开放',
    done: done.gameN > 0,
    go: canGame ? (done.gameN > 0 ? '再玩一次 →' : '去闯关 →') : '未解锁'
  });

  return `
  ${topbar('单词小屋', p.name + ' · ' + bookLabel(p), false)}
  <main class="page">
    <section class="hero">
      ${sceneBand({
        trees: [[TILE.pine, 80, 'left:-26px;bottom:60px'], [TILE.tree, 80, 'right:-26px;bottom:60px']],
        ground: [[TILE.barrel, 32], [TILE.chicken, 32], [TILE.cow, 48, 4], [TILE.well, 48]],
        ridge: [
          [TILE.carrot, 32], [TILE.tomato, 32], [TILE.corn, 32], [TILE.farmer, 64, 4],
          [TILE.cabbage, 32], [TILE.eggplant, 32], [TILE.wheat, 32]
        ]
      })}
      <div class="hero__card">
        <div class="hero__date">${todayStr()}${p.streak > 0 ? ' · 连续 ' + p.streak + ' 天' : ' · 今天开张'}</div>
        <h1 class="hero__title">${allDone ? '今天的农活全干完啦！' : '今天要照料 ' + (freshLeft + plan.due.length) + ' 个词'}</h1>
        <p class="hero__desc">Lv.${lv.lv} · ${bookLabel(p)}${prog.unit ? ' Unit ' + prog.unit : ''} · 本册已学 ${prog.learned}/${prog.total}</p>
        <div class="hero__bar"><i style="width:${pct}%"></i></div>
      </div>
    </section>

    <div class="sign">
      <span class="sign__ico">${spr(TILE.chalk, 16)}</span><b>今日地块</b>
      <em>完成 ${finished} / ${totalToday}</em>
    </div>

    <div class="plots">
      ${tasks.map((t) => `
        <button class="plot ${t.done ? 'is-done' : ''}" data-act="task" data-id="${t.id}" ${t.id === 'game' && !canGame ? 'disabled' : ''}>
          <span class="plot__soil">${spr(t.tile, 32)}</span>
          <span class="plot__body">
            <b>${t.name}</b>
            <em>${t.meta}</em>
          </span>
          <span class="plot__go">${t.go}</span>
        </button>`).join('')}
    </div>

    <div class="harvest">
      <div class="harvest__item"><span class="harvest__ico">${ICONS.coin}</span><b>${p.coins}</b><em>金币</em></div>
      <div class="harvest__item"><span class="harvest__ico">${ICONS.xp}</span><b>${p.xp}</b><em>经验</em></div>
      <div class="harvest__item"><span class="harvest__ico">${ICONS.streak}</span><b>${p.streak}</b><em>连续天数</em></div>
    </div>

    ${(() => {
      const rv = rivals()[0];
      if (!rv) {
        return `<button class="vspeek" data-act="tab" data-v="versus">
          <span class="vspeek__av">${spr(avatarOf(p), 32)}</span>
          <span class="vspeek__body"><b>还没有小伙伴一起比</b><em>去家长中心添加第二个小朋友</em></span>
          <span class="vspeek__go">去设置 →</span>
        </button>`;
      }
      const o = rv.p;
      return `<button class="vspeek" data-act="tab" data-v="versus">
        <span class="vspeek__av">${spr(avatarOf(p), 32)}</span>
        <span class="vspeek__vs">VS</span>
        <span class="vspeek__av">${spr(avatarOf(o), 32)}</span>
        <span class="vspeek__body">
          <b>${esc(o.name)}　${o.coins} 金币 · 已学 ${learnedCount(o)} 词</b>
          <em>今天背了 ${todayDone(o).newN} 个 · 连续 ${o.streak} 天</em>
        </span>
        <span class="vspeek__go">比一比 →</span>
      </button>`;
    })()}

    <div class="sign">
      <span class="sign__ico">${spr(TILE.sign, 16)}</span><b>农场地图</b><em>四个区域 + 擂台</em>
    </div>
    <div class="mapgrid">
      <button class="mapcard" data-act="tab" data-v="today">
        <span class="mapcard__scene">${spr(TILE.carrot, 48)}</span>
        <b>田地</b><em>种词 · 浇水</em>
      </button>
      <button class="mapcard" data-act="tab" data-v="game">
        <span class="mapcard__scene">${spr(TILE.sheep, 48)}</span>
        <b>打谷场</b><em>闯关答题</em>
      </button>
      <button class="mapcard" data-act="tab" data-v="shop">
        <span class="mapcard__scene">${spr(TILE.stall, 48)}</span>
        <b>集市</b><em>金币换奖励</em>
      </button>
      <button class="mapcard" data-act="tab" data-v="me">
        <span class="mapcard__scene">${spr(TILE.sun, 48)}</span>
        <b>我的农场</b><em>成长记录</em>
      </button>
    </div>

    <section class="panel" style="margin-top:12px">
      <div class="panel__head">${spr(TILE.farmer, 16)} 农场提示</div>
      <p class="panel__hint">先种新词，再给旧词浇水。拼错的词会留在错词本里，多浇几次就记住了。</p>
    </section>

    ${plan.wrong.length ? `
    <section class="panel" style="margin-top:12px">
      <div class="panel__head">${spr(TILE.sack, 16)} 错词本 · ${plan.wrong.length} 个</div>
      <p class="panel__hint">拼错的词留在菜地里，连续拼对之后会自动清出去。</p>
      <button class="btn btn--block btn--sm" data-act="openWrong">去收拾这些词</button>
    </section>` : ''}
    ${farmFoot()}
  </main>
  ${tabbar()}`;
}

/* ---------- 学习（新词） ---------- */
function startLearn() {
  const p = P();
  const left = Math.max(0, db.cfg.perDay - todayDone(p).newN);
  const list = newWords(p, left);
  if (!list.length) { toast('今天的新词已经学完啦'); return; }
  /* 每个新词走四步：看图 → 拼读（含跟读录音）→ 选意思 → 拼写 */
  ui.learn = { list: list, pos: 0, phase: 'show', results: { ok: 0, bad: 0 } };
  resetRec();
  clearLit();
  prepSpell(list[0], 'learn');
  go('learn');
}

/* 词组（look after）和带连字符的词（T-shirt）没法逐字母拼，改用「中文→英文」四选一。
   w.sp 为 false 就是这一类，判定只这一处，别的逻辑都调 isPhrase。 */
function isPhrase(w) { return !!w && w.sp === false; }

/* 给词组挑三个同册干扰项：先找同样不可拼写的（同类干扰才有区分度），不够再用同册单词补 */
function phraseOpts(i) {
  const w = WORDS[i];
  const pool = bookList(P()).filter((x) => x !== i && WORDS[x] && WORDS[x].cn !== w.cn);
  const same = shuffle(pool.filter((x) => isPhrase(WORDS[x])));
  const picks = same.slice(0, 3);
  if (picks.length < 3) {
    const rest = shuffle(pool.filter((x) => picks.indexOf(x) === -1));
    picks.push.apply(picks, rest.slice(0, 3 - picks.length));
  }
  return shuffle([w.w].concat(picks.map((x) => WORDS[x].w)));
}

/* ctx 记住这道题属于哪个流程（learn / review / game）。
   结算延迟 900ms，页面可能已经被切走，靠 ctx 判断而不是看 ui.view。 */
function prepSpell(i, ctx) {
  const w = WORDS[i];
  const base = { wi: i, ctx: ctx || 'learn', bad: false, ok: false, settled: false };
  if (isPhrase(w)) {
    ui.spell = Object.assign(base, { type: 'pick', opts: phraseOpts(i), tried: [], missed: false });
    return;
  }
  /* 拼写＝把打散的字母块拼回去。长词先送首字母，避免一上手就卡死；
     复习和闯关不给这个提示，那两处要的是真回忆。 */
  const letters = w.w.split('');
  const pool = shuffle(letters.map((ch, k) => ({ ch: ch, id: k })));
  const filled = new Array(w.w.length).fill(null);
  let hint = 0;
  const giveHint = ctx !== 'review' && ctx !== 'game' && w.w.length >= 6;
  if (giveHint) {
    const first = pool.find((x) => x.ch === letters[0]);
    if (first) { filled[0] = first.id; hint = 1; }
  }
  ui.spell = Object.assign(base, { type: 'letter', pool: pool, filled: filled, hint: hint });
}

/* ---------- 三选一：看英文选中文 ---------- */
/* 干扰项先取同单元（难度接近才有区分度），不够用再用同册其他单元补，
   中文释义必须互不相同，否则会出现两个一样的意思。 */
function meaningOpts(i) {
  const w = WORDS[i];
  const others = bookList(P()).filter((x) => x !== i && WORDS[x] && WORDS[x].cn !== w.cn);
  const near = shuffle(others.filter((x) => WORDS[x].unit === w.unit && WORDS[x].book === w.book));
  const far = shuffle(others.filter((x) => !(WORDS[x].unit === w.unit && WORDS[x].book === w.book)));
  const out = [w.cn];
  near.concat(far).forEach((x) => {
    if (out.length >= 3) return;
    const cn = WORDS[x].cn;
    if (out.indexOf(cn) === -1) out.push(cn);
  });
  return shuffle(out);
}

function prepMeaning(i) {
  ui.meaning = { wi: i, opts: meaningOpts(i), tried: [], missed: false, ok: false };
}

/* ---------- 拼读：慢速朗读 + 字母跟着读音逐个亮 ---------- */
/* 关键：念的是词的**读音**，不是字母名。
   早期版本把词拆成字母块逐块念，合成器读出来的是 "dee-oh-see-tee-oh-ar"，
   那不是拼读、读音也全错。现在改成整词慢速朗读，靠 onboundary 事件拿到
   "现在读到第几个字符"，再把高亮挪过去 —— 听到哪个字母就亮哪个字母。
   浏览器不给 boundary 事件时（部分 Safari），退回按字母数估算时长匀速推进。 */
let litTimers = [];
function clearLit() {
  litTimers.forEach(clearTimeout);
  litTimers = [];
  const el = document.querySelectorAll('.board__word .seg.is-lit, .board__word .ch.is-lit');
  for (let k = 0; k < el.length; k++) el[k].classList.remove('is-lit');
}
function litSegs(n) {
  const els = document.querySelectorAll('.board__word .seg, .board__word .ch');
  for (let k = 0; k < els.length; k++) els[k].classList.toggle('is-lit', k < n);
}
function letterCount(w) { return w.w.replace(/[^a-zA-Z]/g, '').length; }

/* 拼读阶段用：每个字母一个格子，才能一个字母一个字母地点亮。
   颜色仍然按所属拼读块给（or / sh 这类组合保持同色）。 */
function charHTML(w) {
  const letters = w.w.replace(/[^a-zA-Z]/g, '');
  let k = 0;
  let out = '';
  w.seg.forEach(function (s) {
    const chunk = letters.substr(k, s[0].length);
    for (let c = 0; c < chunk.length; c++) {
      out += '<span class="ch k-' + s[1] + '" data-act="seg" data-w="' + w.i + '">' + esc(chunk[c]) + '</span>';
    }
    k += s[0].length;
  });
  return out;
}

let readTimer = null;
function readSlow(i) {
  const w = WORDS[i];
  clearLit();
  if (readTimer) { clearTimeout(readTimer); readTimer = null; }

  const N = letterCount(w);
  if (!('speechSynthesis' in window)) { litSegs(N); return; }

  const RATE = 0.45;                       // 慢，但要听得出词
  let gotBoundary = false;
  let estTimer = null;
  const stopEst = function () { if (estTimer) { clearInterval(estTimer); estTimer = null; } };

  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(w.w);
    u.lang = 'en-US';
    u.rate = RATE;
    const v = voices.find(function (x) { return /en[-_]US/i.test(x.lang); })
      || voices.find(function (x) { return /^en/i.test(x.lang); });
    if (v) u.voice = v;
    u.onboundary = function (e) {
      gotBoundary = true;
      stopEst();
      const ci = typeof e.charIndex === 'number' ? e.charIndex : 0;
      litSegs(Math.min(N, ci + 1));
    };
    u.onend = function () {
      stopEst();
      litSegs(N);
      litTimers.push(setTimeout(function () { litSegs(0); }, 480));
    };
    window.speechSynthesis.speak(u);
  } catch (e) { /* 念不出来就只亮 */ }

  /* 拿不到 boundary 的浏览器：按慢速朗读的大致时长匀速推进 */
  readTimer = setTimeout(function () {
    if (gotBoundary) return;
    const total = Math.max(1200, N * 210);
    const step = total / Math.max(1, N);
    let k = 0;
    estTimer = setInterval(function () {
      k++;
      litSegs(Math.min(N, k));
      if (k >= N) {
        stopEst();
        litTimers.push(setTimeout(function () { litSegs(0); }, 700));   // 读完回位
      }
    }, step);
  }, 380);
}

function readFull(i) {
  const w = WORDS[i];
  clearLit();
  litSegs(letterCount(w));
  speak(w.w, 0.9);
  litTimers.push(setTimeout(function () { litSegs(0); }, 1600));
}

/* ---------- 跟读录音 ---------- */
/* 只做「录下来和原音对比」：不给孩子打发音分数——本地没有可靠的发音评测，
   硬编一个分数出来会误导他以为自己读对了。听感对比交给耳朵。 */
const rec = { state: 'idle', mr: null, stream: null, url: '', sec: 0, timer: null };

function recSupported() {
  return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    && location.protocol !== 'file:');
}
function recMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const list = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (let k = 0; k < list.length; k++) { if (MediaRecorder.isTypeSupported(list[k])) return list[k]; }
  return '';
}
function resetRec() {
  clearInterval(rec.timer);
  rec.timer = null;
  if (rec.mr) { try { if (rec.mr.state !== 'inactive') rec.mr.stop(); } catch (e) { /* 忽略 */ } }
  if (rec.stream) { try { rec.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* 忽略 */ } }
  if (rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) { /* 忽略 */ } }
  rec.state = 'idle'; rec.mr = null; rec.stream = null; rec.url = ''; rec.sec = 0;
}
function recStart() {
  if (!recSupported()) { toast('这个打开方式录不了音，用浏览器打开线上版就行'); return; }
  resetRec();
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    let mr;
    try {
      const mime = recMime();
      mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) { /* 忽略 */ }
      toast('这台设备录不了音');
      return;
    }
    const chunks = [];
    mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = function () {
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      if (rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) { /* 忽略 */ } }
      rec.url = URL.createObjectURL(blob);
      rec.state = 'ready';
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* 忽略 */ }
      render();
    };
    rec.mr = mr; rec.stream = stream; rec.state = 'rec'; rec.sec = 0;
    mr.start();
    rec.timer = setInterval(function () {
      rec.sec++;
      if (rec.sec >= 10) { recStop(); return; }
      const el = $('#recSec');
      if (el) el.textContent = rec.sec + '″';
    }, 1000);
    render();
  }).catch(function () {
    toast('没拿到麦克风权限，在浏览器设置里允许一下');
    rec.state = 'idle';
    render();
  });
}
function recStop() {
  clearInterval(rec.timer);
  rec.timer = null;
  if (rec.mr && rec.mr.state !== 'inactive') { try { rec.mr.stop(); } catch (e) { /* 忽略 */ } }
}
function recPlay() {
  if (!rec.url) return;
  try { new Audio(rec.url).play(); } catch (e) { /* 忽略 */ }
}
/* 先放原音，等它念完再放孩子的录音，两个声音挨着才好比 */
function recCompare() {
  const s = ui.learn;
  if (!s || s.pos >= s.list.length) return;
  speak(WORDS[s.list[s.pos]].w, 0.85, function () { setTimeout(recPlay, 320); });
}

/* 四步指示器：让孩子知道现在走到哪一步 */
const LEARN_STEPS = [['show', '看图'], ['read', '拼读'], ['meaning', '选意思'], ['spell', '拼写']];
function stepsHTML(phase) {
  let at = 0;
  LEARN_STEPS.forEach(function (x, k) { if (x[0] === phase) at = k; });
  return '<div class="steps">' + LEARN_STEPS.map(function (x, k) {
    return '<span class="' + (k === at ? 'is-on' : (k < at ? 'is-done' : '')) + '">' + x[1] + '</span>';
  }).join('<i></i>') + '</div>';
}

/* 释义配图：一个字一个 emoji，不占体积、离线也能显示 */
function picHTML(w, small) {
  const e = w.em || '🌱';
  return '<div class="pic' + (small ? ' pic--sm' : '') + '" aria-hidden="true">' + esc(e) + '</div>';
}

function recHTML(w) {
  if (!recSupported()) {
    return '<div class="recbox recbox--off">这台设备（或现在这个打开方式）录不了音，跟着读三遍效果一样</div>';
  }
  if (rec.state === 'rec') {
    return '<div class="recbox">' +
      '<div class="reclive"><i class="reclive__dot"></i>正在录音 <b id="recSec">' + rec.sec + '″</b></div>' +
      '<button class="btn btn--block btn--danger" data-act="recStop">⏹ 读完了</button>' +
      '</div>';
  }
  if (rec.state === 'ready') {
    return '<div class="recbox">' +
      '<div class="recbox__row">' +
        '<button class="btn btn--sm" data-act="say" data-w="' + w.i + '">' + ICONS.speak + ' 原音</button>' +
        '<button class="btn btn--sm btn--primary" data-act="recPlay">🎧 我的录音</button>' +
      '</div>' +
      '<button class="btn btn--block btn--sm" data-act="recCompare">🔁 先听原音，再听我的</button>' +
      '<button class="btn btn--block btn--sm btn--ghost" data-act="recStart">🔄 再录一次</button>' +
      '</div>';
  }
  return '<div class="recbox">' +
    '<div class="recbox__tip">点一下开始，大声读一遍，再听听自己像不像</div>' +
    '<button class="btn btn--block btn--primary" data-act="recStart">🎙 录下我的跟读</button>' +
    '</div>';
}

function viewLearn() {
  const s = ui.learn;
  if (!s) return viewToday();
  if (s.pos >= s.list.length) return viewLearnDone();

  const i = s.list[s.pos];
  const w = WORDS[i];
  const total = s.list.length;

  /* 进度条按四步细分，孩子看着走得更顺 */
  const phaseAt = { show: 0, read: 1, meaning: 2, spell: 3 }[s.phase] || 0;
  const frac = s.mode === 'review' ? (s.pos / total) : ((s.pos + phaseAt / 4) / total);

  const head = `
  ${topbar('种新词', `第 ${s.pos + 1} / ${total} 个`, true)}
  <main class="page">
    <div class="learn">
      <div class="fieldbar">
        <span>${spr(TILE.carrot, 16)}</span>
        <span class="progressline"><i style="width:${Math.round(frac * 100)}%"></i></span>
        <b>剩 ${total - s.pos} 个</b>
      </div>
      ${batchBar(s, TILE.carrot)}`;

  const wordHTML = isPhrase(w)
    ? `<div class="board__word board__word--phr">${esc(w.w)}</div>`
    : `<div class="board__word" style="font-size:${wordSize(w.w)}px">${segHTML(w)}</div>`;

  if (s.phase === 'show') {
    return head + `
      <div class="board">
        <div class="board__paper">
          <span class="board__lv">L${w.lv}</span>
          ${picHTML(w)}
          <div class="board__cn">${esc(w.cn)}</div>
          ${wordHTML}
          <div class="board__ipa">${esc(w.p)}</div>
          <button class="btn btn--sound" data-act="say" data-w="${i}">${ICONS.speak} 听发音</button>
        </div>
      </div>
      ${isPhrase(w)
        ? '<div class="legend legend--phr">词组按整句读，不拆字母</div>'
        : `<div class="legend">
        ${SEG_LEGEND.map((seg) => `<span class="${seg[0]}">■ ${seg[1]}</span>`).join('')}
      </div>`}
      ${s.mode === 'review' ? '' : stepsHTML(s.phase)}
      <button class="btn btn--primary btn--block btn--big" data-act="${s.mode === 'review' ? 'toSpell' : 'toRead'}">${s.mode === 'review' ? (isPhrase(w) ? '记住了，来选一选' : '记住了，来拼一拼') : '看图记住了，来拼读'}</button>
    </div>
    ${farmFoot()}
  </main>`;
  }

  /* 第二步：拼读（慢速朗读，字母跟着读音亮）+ 跟读录音 */
  if (s.phase === 'read') {
    const readWord = isPhrase(w)
      ? `<div class="board__word board__word--phr">${esc(w.w)}</div>`
      : `<div class="board__word" style="font-size:${wordSize(w.w)}px">${charHTML(w)}</div>`;
    return head + `
      <div class="board">
        <div class="board__paper">
          <span class="board__lv">L${w.lv}</span>
          ${picHTML(w, true)}
          ${readWord}
          <div class="board__ipa">${esc(w.p)}</div>
        </div>
      </div>
      <div class="readbar">
        <button class="btn btn--read" data-act="readSlow" data-w="${i}">🐢 拼读</button>
        <button class="btn btn--read" data-act="readFull" data-w="${i}">⚡ 完整拼读</button>
      </div>
      <div class="readhint">${isPhrase(w) ? '先慢慢读一遍，再整句连起来读' : '慢慢读这个词，读到哪个字母就亮哪个字母'}</div>
      ${recHTML(w)}
      ${stepsHTML(s.phase)}
      <button class="btn btn--primary btn--block btn--big" data-act="toMeaning">读熟了，去选意思</button>
    </div>
    ${farmFoot()}
  </main>`;
  }

  /* 第三步：看英文选中文（这里不能给配图，图就是答案） */
  if (s.phase === 'meaning') {
    const m = ui.meaning || {};
    const opts = m.opts || [];
    return head + `
      <div class="board">
        <div class="board__paper">
          ${wordHTML}
          <div class="board__ipa">${esc(w.p)}</div>
          <button class="btn btn--sound" data-act="say" data-w="${i}">${ICONS.speak} 听发音</button>
        </div>
      </div>
      <div class="ask">这个词是什么意思？</div>
      <div class="meaningopts">
        ${opts.map((cn) => {
          const dead = (m.tried || []).indexOf(cn) !== -1;
          const win = m.ok && cn === w.cn;
          return `<button class="mopt ${dead ? 'is-dead' : ''} ${win ? 'is-ok' : ''}" data-act="meaningPick" data-o="${esc(cn)}"${dead ? ' disabled' : ''}>${esc(cn)}</button>`;
        }).join('')}
      </div>
      <div class="feedback" id="fb">${m.ok ? '✓ 选对了！' : ((m.tried || []).length ? '再想想，划掉的都不对' : '从三个意思里挑一个')}</div>
      ${stepsHTML(s.phase)}
    </div>
    ${farmFoot()}
  </main>`;
  }

  // 词组：四选一（词组拼不了字母）
  const sp = ui.spell;
  if (sp.type === 'pick') {
    return head + phraseBoardHTML(i, sp) + `
      <div class="feedback" id="fb">${sp.ok ? '选对了！' + esc(w.w) : (sp.tried.length ? '再想想，划掉的都不对' : '看看中文，选出对应的英文')}</div>
      <button class="btn btn--ghost btn--block btn--sm" data-act="forget">想不起来，先看看答案</button>
    </div>
    ${farmFoot()}
  </main>`;
  }

  // 拼写阶段：英文隐藏
  const slots = sp.filled.map((f, idx) => {
    const ch = f === null ? '' : sp.pool.find((x) => x.id === f).ch;
    const hintCls = (sp.hint && idx < sp.hint) ? ' slot--hint' : '';
    return `<div class="slot ${f === null ? 'slot--empty' : ''}${hintCls}" data-act="slot" data-i="${idx}">${esc(ch || '·')}</div>`;
  }).join('');
  const letters = sp.pool.map((x) => `
    <button class="letter ${sp.filled.includes(x.id) ? 'is-used' : ''}" data-act="letter" data-id="${x.id}">${esc(x.ch)}</button>`).join('');

  return head + `
      <div class="board">
        <div class="board__paper">
          <span class="board__lv">L${w.lv}</span>
          ${picHTML(w, true)}
          <div class="board__cn">${esc(w.cn)}</div>
          <div class="board__ipa">${esc(w.p)} · ${w.w.length} 个字母</div>
          <button class="btn btn--sound" data-act="say" data-w="${i}">${ICONS.speak} 听发音</button>
        </div>
      </div>
      <div class="bed">
        <div class="slots ${sp.bad ? 'is-bad' : ''} ${sp.ok ? 'is-ok' : ''}" id="slots">${slots}</div>
      </div>
      <div class="pool" id="pool">${letters}</div>
      <div class="feedback" id="fb">${sp.ok ? '拼对了！' : (sp.bad ? '再试一次，加油' : (sp.hint ? '首字母已经放好了，把剩下的字母按顺序点进去' : '按顺序点字母，把这个词拼出来'))}</div>
      <button class="btn btn--ghost btn--block btn--sm" data-act="forget">想不起来，先看看答案</button>
    </div>
    ${farmFoot()}
  </main>`;
}

function viewLearnDone() {
  const s = ui.learn;
  const got = s.results.ok;
  return `
  ${topbar('收工啦', '今日新词完成', true)}
  <main class="page">
    <div class="card result">
      <div class="result__big">${spr(got > 0 ? TILE.bucket : TILE.well, 64)}</div>
      <div class="result__score">种下 ${got} 个新词</div>
      <div class="result__meta">${ICONS.xp} +${got * REWARD.learnNew.xp}　${ICONS.coin} +${got * REWARD.learnNew.coin}</div>
    </div>
    <div class="card">
      <div class="card__title">接下来</div>
      <button class="btn btn--block btn--primary" data-act="toReview">去浇水复习</button>
      <button class="btn btn--block" style="margin-top:9px" data-act="tab" data-v="today">回到农场</button>
    </div>
    ${farmFoot()}
  </main>`;
}

/* ---------- 复习 ---------- */
function startReview() {
  const p = P();
  const list = dueWords(p).slice(0, 20);
  if (!list.length) { toast('暂时没有到期要复习的词'); return; }
  ui.learn = { list: list, pos: 0, phase: 'spell', mode: 'review', results: { ok: 0, bad: 0 } };
  prepSpell(list[0], 'review');
  go('review');
}

function viewReview() {
  const s = ui.learn;
  if (!s) return viewToday();
  if (s.pos >= s.list.length) return viewReviewDone();

  const i = s.list[s.pos];
  const w = WORDS[i];
  const total = s.list.length;
  const sp = ui.spell;
  const st = stateOf(i) || { box: 0, wrong: 0 };

  if (sp.type === 'pick') {
    return `
  ${topbar('浇水复习', `第 ${s.pos + 1} / ${total} 个`, true)}
  <main class="page">
    <div class="learn">
      <div class="fieldbar">
        <span>${spr(TILE.tomato, 16)}</span>
        <span class="progressline"><i style="width:${Math.round((s.pos / total) * 100)}%"></i></span>
        <b>第 ${st.box + 1} 轮 · 剩 ${total - s.pos}</b>
      </div>
      ${batchBar(s, TILE.tomato)}
      ${phraseBoardHTML(i, sp, '还记得这个怎么说吗')}
      <div class="feedback" id="fb">${sp.ok ? '想起来了' : (sp.tried.length ? '再想想，划掉的都不对' : '不看英文，把它选出来')}</div>
    </div>
    ${farmFoot()}
  </main>`;
  }

  const slots = sp.filled.map((f, idx) => {
    const ch = f === null ? '' : sp.pool.find((x) => x.id === f).ch;
    return `<div class="slot ${f === null ? 'slot--empty' : ''}" data-act="slot" data-i="${idx}">${esc(ch || '·')}</div>`;
  }).join('');
  const letters = sp.pool.map((x) => `
    <button class="letter ${sp.filled.includes(x.id) ? 'is-used' : ''}" data-act="letter" data-id="${x.id}">${esc(x.ch)}</button>`).join('');

  return `
  ${topbar('浇水复习', `第 ${s.pos + 1} / ${total} 个`, true)}
  <main class="page">
    <div class="learn">
      <div class="fieldbar">
        <span>${spr(TILE.tomato, 16)}</span>
        <span class="progressline"><i style="width:${Math.round((s.pos / total) * 100)}%"></i></span>
        <b>第 ${st.box + 1} 轮 · 剩 ${total - s.pos}</b>
      </div>
      ${batchBar(s, TILE.tomato)}
      <div class="board">
        <div class="board__paper">
          <span class="board__lv">L${w.lv}</span>
          ${picHTML(w, true)}
          <div class="board__cn">${esc(w.cn)}</div>
          <div class="board__ipa">${esc(w.p)} · ${w.w.length} 个字母</div>
          <button class="btn btn--sound" data-act="say" data-w="${i}">${ICONS.speak} 听发音</button>
        </div>
      </div>
      <div class="bed">
        <div class="slots ${sp.bad ? 'is-bad' : ''} ${sp.ok ? 'is-ok' : ''}">${slots}</div>
      </div>
      <div class="pool">${letters}</div>
      <div class="feedback" id="fb">${sp.ok ? '想起来了' : (sp.bad ? '再试一次' : '不看英文，把它拼出来')}</div>
    </div>
    ${farmFoot()}
  </main>`;
}

function viewReviewDone() {
  const s = ui.learn;
  return `
  ${topbar('浇完了', '复习完成', true)}
  <main class="page">
    <div class="card result">
      <div class="result__big">${spr(TILE.water, 64)}</div>
      <div class="result__score">复习了 ${s.results.ok} 个词</div>
      <div class="result__meta">${ICONS.xp} +${s.results.ok * REWARD.reviewOk.xp}　${ICONS.coin} +${s.results.ok * REWARD.reviewOk.coin}</div>
    </div>
    <div class="card">
      <button class="btn btn--block btn--primary" data-act="tab" data-v="today">回到农场</button>
    </div>
    ${farmFoot()}
  </main>`;
}

/* ---------- 错词本 ---------- */
function viewWrong() {
  const p = P();
  const list = wrongWords(p);
  return `
  ${topbar('错词本', `${list.length} 个`, true)}
  <main class="page">
    ${list.length ? `
      <section class="panel">
        <div class="panel__head">${spr(TILE.sack, 16)} 这块地需要多看几眼</div>
        <p class="panel__hint">这些是拼错过的词。连续拼对之后，错误次数会清零。</p>
        <button class="btn btn--block btn--primary btn--sm" data-act="practiceWrong">练习这些错词</button>
      </section>
      <div class="wordlist" style="margin-top:12px">
        ${list.map((i) => {
          const w = WORDS[i];
          const st = p.states[i];
          return `<div class="wordrow">
            <span class="wordrow__body">
              <span class="wordrow__w">${esc(w.w)}</span>
              <span class="wordrow__cn">${esc(w.cn)} · ${esc(w.p)}</span>
            </span>
            <span class="badge">错 ${st.wrong} 次</span>
            <button class="btn btn--sm" data-act="say" data-w="${i}" aria-label="听发音">${ICONS.speak}</button>
          </div>`;
        }).join('')}
      </div>` : `
      <div class="empty">
        <span class="empty__icon">${spr(TILE.sun, 48)}</span>
        <b>还没有错词，这片地很干净</b>
      </div>`}
    ${farmFoot()}
  </main>`;
}

function practiceWrong() {
  const p = P();
  const list = wrongWords(p).slice(0, 15);
  if (!list.length) { toast('没有需要练习的错词'); return; }
  ui.learn = { list: list, pos: 0, phase: 'spell', mode: 'review', results: { ok: 0, bad: 0 } };
  prepSpell(list[0], 'review');
  go('review');
}

/* ---------- 闯关 ---------- */
function startGame() {
  const p = P();
  const pool = Object.keys(p.states).map(Number)
    .filter((i) => WORDS[i] && WORDS[i].book === p.book);
  const spellPool = pool.filter((i) => WORDS[i].sp);
  if (pool.length < 4 || spellPool.length < 2) { toast('先学会 4 个词再来闯关'); return; }

  const n = Math.min(6, Math.max(4, Math.floor(pool.length / 3)));
  const spellN = Math.min(3, Math.floor(n / 2), spellPool.length);
  const spellQs = shuffle(spellPool).slice(0, spellN).map((i) => ({ i: i, type: 'spell' }));
  const pickQs = shuffle(pool.filter((i) => spellQs.every((q) => q.i !== i)))
    .slice(0, n - spellN).map((i) => ({ i: i, type: 'pick' }));
  const qs = shuffle(pickQs.concat(spellQs));

  ui.game = { qs: qs, pos: 0, ok: 0, bad: 0 };
  ui.spell = null;
  ui.quiz = null;
  ui.learn = null;
  ui.stack = ['today'];
  ui.view = 'game';
  render();
}

function viewGame() {
  const g = ui.game;
  if (!g) return viewGameIntro();
  if (g.pos >= g.qs.length) return viewGameResult();

  const q = g.qs[g.pos];
  const w = WORDS[q.i];

  const head = `
  ${topbar('打谷闯关', `第 ${g.pos + 1} / ${g.qs.length} 题`, true)}
  <main class="page">
    <div class="fieldbar">
      <span>${spr(TILE.wheat, 16)}</span>
      <span class="progressline"><i style="width:${Math.round((g.pos / g.qs.length) * 100)}%"></i></span>
      <b>对 ${g.ok} · 错 ${g.bad}</b>
    </div>`;

  if (q.type === 'pick') {
    if (!ui.quiz || ui.quiz.wi !== q.i) {
      /* 干扰项优先取同类（词组配词组、单词配单词），否则选项一眼就能靠形状排除 */
      const learned = Object.keys(P().states).map(Number)
        .filter((x) => x !== q.i && WORDS[x] && WORDS[x].book === P().book && WORDS[x].cn !== w.cn);
      const same = learned.filter((x) => isPhrase(WORDS[x]) === isPhrase(w));
      let from = same.slice();
      if (from.length < 3) from = from.concat(learned.filter((x) => same.indexOf(x) === -1));
      const others = shuffle(from).slice(0, 3).map((x) => WORDS[x].w);
      ui.quiz = { wi: q.i, opts: shuffle([w.w].concat(others)), picked: '', done: false };
    }
    const z = ui.quiz;
    return head + `
      <div class="board">
        <div class="board__paper">
          <p class="panel__hint" style="text-align:center">选出正确的英文</p>
          <div class="quiz__q">${esc(w.cn)}</div>
          <div class="quiz__ipa">${esc(w.p)}</div>
          <button class="btn btn--sound" data-act="say" data-w="${q.i}">${ICONS.speak} 听发音</button>
          <div class="opts ${isPhrase(w) ? 'opts--phr' : ''}">
            ${z.opts.map((o) => {
              let cls = 'opt';
              if (z.done) {
                if (o === w.w) cls += ' is-right';
                else if (o === z.picked) cls += ' is-wrong';
              }
              return `<button class="${cls}" data-act="quizPick" data-o="${esc(o)}" ${z.done ? 'disabled' : ''}>${esc(o)}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="feedback" id="fb"></div>
      </div>
      ${farmFoot()}
    </main>`;
  }

  // 拼写题
  if (!ui.spell || ui.spell.wi !== q.i || ui.spell.ctx !== 'game') prepSpell(q.i, 'game');
  const sp = ui.spell;
  const slots = sp.filled.map((f, idx) => {
    const ch = f === null ? '' : sp.pool.find((x) => x.id === f).ch;
    return `<div class="slot ${f === null ? 'slot--empty' : ''}" data-act="slot" data-i="${idx}">${esc(ch || '·')}</div>`;
  }).join('');
  const letters = sp.pool.map((x) => `
    <button class="letter ${sp.filled.includes(x.id) ? 'is-used' : ''}" data-act="letter" data-id="${x.id}">${esc(x.ch)}</button>`).join('');

  return head + `
    <div class="board">
      <div class="board__paper">
        <p class="panel__hint" style="text-align:center">听发音，把单词拼出来</p>
        <div class="quiz__q">${esc(w.cn)}</div>
        <div class="quiz__ipa">${esc(w.p)}</div>
        <button class="btn btn--sound" data-act="say" data-w="${q.i}">${ICONS.speak} 再听一遍</button>
        <div class="bed" style="margin-top:12px">
          <div class="slots ${sp.bad ? 'is-bad' : ''} ${sp.ok ? 'is-ok' : ''}">${slots}</div>
        </div>
        <div class="pool" style="margin-top:10px">${letters}</div>
        <div class="feedback" id="fb">${sp.ok ? '正确' : (sp.bad ? '再看一眼字母顺序' : '')}</div>
      </div>
    </div>
    ${farmFoot()}
  </main>`;
}

function viewGameIntro() {
  return `
  ${topbar('打谷闯关', '打谷场', true)}
  <main class="page">
    <section class="hero">
      ${sceneBand({
        trees: [[TILE.tree, 80, 'left:-26px;bottom:60px'], [TILE.pine, 80, 'right:-26px;bottom:60px']],
        ground: [[TILE.hay, 48], [TILE.sack, 32], [TILE.chicken, 32, 2], [TILE.hayOne, 48]],
        ridge: [
          [TILE.wheat, 32], [TILE.corn, 32], [TILE.wheat, 32], [TILE.farmer, 64, 4],
          [TILE.wheat, 32], [TILE.hoe, 48, 2], [TILE.wheat, 32]
        ]
      })}
      <div class="hero__card">
        <div class="hero__date">打谷场 · 用学过的词比一比</div>
        <h1 class="hero__title">准备好下地了吗？</h1>
        <p class="hero__desc">答对越多，经验和金币越多</p>
      </div>
    </section>
    <button class="btn btn--primary btn--block btn--big" style="margin-top:14px" data-act="startGame">开始闯关</button>
    ${farmFoot()}
  </main>`;
}

function viewGameResult() {
  const g = ui.game;
  const total = g.qs.length;
  const rate = total ? Math.round((g.ok / total) * 100) : 0;
  const bonus = rate >= 80;
  return `
  ${topbar('闯关结果', '打谷场', true)}
  <main class="page">
    <div class="card result">
      <div class="result__big">${spr(rate >= 70 ? TILE.frame : TILE.sack, 64)}</div>
      <div class="result__score">答对 ${g.ok} / ${total}</div>
      <div class="result__meta">正确率 ${rate}%　${ICONS.xp} +${g.ok * REWARD.gamePerRight.xp + (bonus ? REWARD.gameBonus.xp : 0)}　${ICONS.coin} +${g.ok * REWARD.gamePerRight.coin + (bonus ? REWARD.gameBonus.coin : 0)}</div>
    </div>
    <div class="card">
      <button class="btn btn--block btn--primary" data-act="startGame">再来一次</button>
      <button class="btn btn--block" style="margin-top:9px" data-act="tab" data-v="today">回到农场</button>
    </div>
    ${farmFoot()}
  </main>`;
}

/* ---------- 商店：集市 ---------- */
function viewShop() {
  const p = P();
  const mine = db.orders.filter((o) => o.pid === db.active);
  return `
  ${topbar('集市', `${p.coins} 金币`, false)}
  <main class="page">
    <section class="hero">
      ${sceneBand({
        trees: [[TILE.tree, 80, 'left:-26px;bottom:60px'], [TILE.pine, 80, 'right:-26px;bottom:60px']],
        ground: [[TILE.sack, 48], [TILE.crate, 32], [TILE.chicken, 32, 2], [TILE.barrel, 48]],
        ridge: [
          [TILE.carrot, 32], [TILE.tomato, 32], [TILE.farmer, 64, 4], [TILE.kid, 48, 4],
          [TILE.cabbage, 32], [TILE.eggplant, 32], [TILE.wheat, 32]
        ]
      })}
      <div class="hero__card">
        <div class="hero__date">集市开张 · 我的金币 ${p.coins}</div>
        <h1 class="hero__title">用金币换奖励</h1>
        <p class="hero__desc">背单词、复习、闯关都能赚金币，兑换后找爸爸妈妈领取</p>
      </div>
    </section>

    ${db.shop.length ? `
    <div class="sign">
      <span class="sign__ico">${spr(TILE.crate, 16)}</span><b>货摊</b><em>${db.shop.length} 件</em>
    </div>
    <div class="stalls">
      ${db.shop.map((s) => `
        <div class="stall">
          <span class="stall__roof"></span>
          <span class="stall__emoji">${s.emoji || '🎁'}</span>
          <div class="stall__name">${esc(s.name)}</div>
          <div class="stall__price">${ICONS.coin}${s.price}</div>
          <button class="btn btn--sm ${p.coins >= s.price ? 'btn--primary' : ''}" data-act="redeem" data-id="${s.id}" ${p.coins < s.price ? 'disabled' : ''}>
            ${p.coins >= s.price ? '兑换' : '金币不足'}
          </button>
        </div>`).join('')}
    </div>` : `
    <div class="empty" style="margin-top:12px">
      <span class="empty__icon">${spr(TILE.crate, 48)}</span>
      <b>摊位还空着</b>
      <p style="margin-top:6px">请家长在「我的 → 家长中心」上架商品</p>
    </div>`}

    ${mine.length ? `
    <div class="sign">
      <span class="sign__ico">${spr(TILE.sign, 16)}</span><b>兑换记录</b>
    </div>
    <div class="wordlist">
      ${mine.slice().reverse().slice(0, 8).map((o) => `
        <div class="wordrow">
          <span class="wordrow__body">
            <span class="wordrow__w">${esc(o.name)}</span>
            <span class="wordrow__cn">${esc(o.date)}　${o.price} 金币</span>
          </span>
          <span class="badge ${o.status === 'done' ? 'badge--soft' : ''}">${o.status === 'done' ? '已发放' : '待发放'}</span>
        </div>`).join('')}
    </div>` : ''}
    ${farmFoot()}
  </main>
  ${tabbar()}`;
}

/* ---------- 对决：两个小朋友的进度并排比一比 ---------- */
function viewVersus() {
  const me = P();
  const other = rivals()[0];
  const you = other ? other.p : null;

  /* [标签, 图标, 取值] —— 都是「越大越好」，比较逻辑统一 */
  const rows = [
    ['金币', ICONS.coin, (x) => x.coins],
    ['背过的词', ICONS.star, (x) => learnedCount(x)],
    ['已掌握', ICONS.check, (x) => masteredCount(x)],
    ['等级', ICONS.xp, (x) => levelOf(x).lv],
    ['连续天数', ICONS.streak, (x) => x.streak],
    ['今天背了', null, (x) => todayDone(x).newN]
  ];

  let myWin = 0, taWin = 0;
  const body = rows.map(function (r) {
    const a = r[2](me);
    const b = you ? r[2](you) : 0;
    if (you) { if (a > b) myWin++; else if (b > a) taWin++; }
    const aw = you && a > b ? ' is-win' : '';
    const bw = you && b > a ? ' is-win' : '';
    return `
      <div class="vsrow">
        <span class="vsrow__v${aw}">${a}</span>
        <span class="vsrow__k">${r[1] || ''}${r[0]}</span>
        <span class="vsrow__v${bw}">${you ? b : '—'}</span>
      </div>`;
  }).join('');

  const total = myWin + taWin;
  const minePct = total ? Math.round((myWin / total) * 100) : 50;
  const lead = !you ? '' : myWin > taWin ? me.name + ' 领先' : taWin > myWin ? (you.name + ' 领先') : '打平';

  return `
  ${topbar('双人擂台', '比一比谁更能干', false)}
  <main class="page">
    <section class="hero">
      ${sceneBand({
        trees: [[TILE.pine, 80, 'left:-26px;bottom:60px'], [TILE.tree, 80, 'right:-26px;bottom:60px']],
        ground: [[TILE.barrel, 32], [TILE.chicken, 32, 2], [TILE.cow, 48, 4], [TILE.hay, 48]],
        ridge: [
          [TILE.carrot, 32], [TILE.wheat, 32], [avatarOf(me), 64, 4],
          [TILE.hayOne, 32], [you ? avatarOf(you) : TILE.kid, 64, 4], [TILE.corn, 32], [TILE.cabbage, 32]
        ]
      })}
      <div class="hero__card">
        <div class="hero__date">${lead || '还没有对手'}</div>
        <h1 class="hero__title">${you ? me.name + ' vs ' + you.name : '一个人也能种地'}</h1>
        <p class="hero__desc">${you ? '赢的项数 ' + myWin + ' : ' + taWin + '，每项都是今天就能追上的' : '家长中心可以添加第二个小朋友'}</p>
        <div class="hero__bar"><i style="width:${minePct}%"></i></div>
      </div>
    </section>

    ${you ? `
    <div class="vshead">
      <div class="vscard vscard--me">
        <span class="vscard__av">${spr(avatarOf(me), 64)}</span>
        <b>${esc(me.name)}</b>
        <em>Lv.${levelOf(me).lv}</em>
        <span class="badge badge--soft">我</span>
      </div>
      <div class="vshead__mid">VS</div>
      <button class="vscard" data-act="pickProfile" data-k="${other.k}">
        <span class="vscard__av">${spr(avatarOf(you), 64)}</span>
        <b>${esc(you.name)}</b>
        <em>Lv.${levelOf(you).lv}</em>
        <span class="badge">切换到 TA</span>
      </button>
    </div>

    <div class="sign">
      <span class="sign__ico">${spr(TILE.frame, 16)}</span><b>逐项比一比</b><em>共 ${rows.length} 项</em>
    </div>
    <div class="panel">
      <div class="vslist">${body}</div>
      <p class="card__hint" style="margin-top:10px">领先的项目会亮起来。今天落后没关系，多种两个词就能追上。</p>
    </div>

    <div class="sign">
      <span class="sign__ico">${spr(TILE.sign, 16)}</span><b>今天的战况</b><em>${todayStr()}</em>
    </div>
    <div class="statgrid">
      <div class="stat"><b>${todayDone(me).newN}</b><span>${esc(me.name)}今天</span></div>
      <div class="stat"><b>${todayDone(you).newN}</b><span>${esc(you.name)}今天</span></div>
      <div class="stat"><b>${myWin} : ${taWin}</b><span>赢的项数</span></div>
    </div>
    ` : `
    <section class="panel" style="margin-top:12px">
      <div class="panel__head">${spr(TILE.farmer, 16)} 还没有第二个小朋友</div>
      <p class="panel__hint">进家长中心可以设置两个小朋友的昵称和头像，之后就能在这里互相看进度了。</p>
      <button class="btn btn--block btn--sm" data-act="openParent">去家长中心设置</button>
    </section>`}

    ${farmFoot()}
  </main>
  ${tabbar()}`;
}

/* ---------- 我的：成长 ---------- */
function viewMe() {
  const p = P();
  const lv = levelOf(p);
  const learned = learnedCount(p);
  const pct = Math.round((learned / WORDS.length) * 100);
  const who = avatarOf(p);

  return `
  ${topbar('我的农场', '', false)}
  <main class="page">
    <section class="hero">
      ${sceneBand({
        trees: [[TILE.pine, 80, 'left:-26px;bottom:60px'], [TILE.tree, 80, 'right:-26px;bottom:60px']],
        ground: [[TILE.well, 48], [TILE.cow, 48, 4], [TILE.chicken, 32], [TILE.flower, 48]],
        ridge: [
          [TILE.carrot, 32], [TILE.tomato, 32], [TILE.corn, 32], [who, 64, 4],
          [TILE.wheat, 32], [TILE.bucket, 48, 2], [TILE.cabbage, 32]
        ]
      })}
      <div class="hero__card">
        <div class="hero__date">Lv.${lv.lv} · ${lv.cur}/${lv.need} 经验</div>
        <h1 class="hero__title">${esc(p.name)}的农场</h1>
        <p class="hero__desc">已学 ${learned} 词 · 掌握 ${masteredCount(p)} 词</p>
        <div class="hero__bar"><i style="width:${Math.min(100, Math.round((lv.cur / lv.need) * 100))}%"></i></div>
      </div>
    </section>

    <div class="statgrid">
      <div class="stat"><b>${learned}</b><span>已学</span></div>
      <div class="stat"><b>${masteredCount(p)}</b><span>已掌握</span></div>
      <div class="stat"><b>${p.streak}</b><span>连续天数</span></div>
    </div>

    <div class="sign">
      <span class="sign__ico">${spr(TILE.frame, 16)}</span><b>成长记录</b><em>总进度 ${pct}%</em>
    </div>
    <div class="panel">
      <div class="fieldbar" style="margin-bottom:10px">
        <span>${spr(TILE.sprout, 16)}</span>
        <span class="progressline"><i style="width:${pct}%"></i></span>
        <b>${learned} / ${WORDS.length}</b>
      </div>
      <div class="wordlist">
        <div class="wordrow">
          <span class="wordrow__body">
            <span class="wordrow__w">词库总量</span>
            <span class="wordrow__cn">按自然拼读难度分 L1–L8</span>
          </span>
          <span class="badge badge--soft">${WORDS.length} 词</span>
        </div>
        <div class="wordrow">
          <span class="wordrow__body">
            <span class="wordrow__w">错词本</span>
            <span class="wordrow__cn">拼错过的词</span>
          </span>
          <button class="btn btn--sm" data-act="openWrong">打开</button>
        </div>
        <div class="wordrow">
          <span class="wordrow__body">
            <span class="wordrow__w">今日完成</span>
            <span class="wordrow__cn">新词 ${todayDone(p).newN}　复习 ${todayDone(p).revN}</span>
          </span>
        </div>
      </div>
      <button class="btn btn--block btn--sm" style="margin-top:10px" data-act="switchProfile">切换小朋友</button>
    </div>

    <section class="panel" style="margin-top:12px">
      <div class="panel__head">${ICONS.lock} 家长中心</div>
      <p class="panel__hint">管理每日词量、商品与价格、兑换发放和密码。</p>
      <button class="btn btn--block btn--sm" data-act="openParent">进入家长中心</button>
    </section>
    ${farmFoot()}
  </main>
  ${tabbar()}`;
}

/* ============================================================
   两台设备同步（不依赖服务器的方案）

   两个孩子各用一台平板时，学习记录分别存在各自机器的 localStorage 里，
   天然不相通。这里提供一串「同步码」：一台生成、另一台粘贴导入。

   编码思路：体积大头是 states（247 条 × 4 个数字）。
   把到期日改存「距今天几天」，一条从 30 字节压到 10 字节左右，
   两个人的完整记录约 5-6KB，微信一条消息发得下。
   ============================================================ */

const SYNC_PREFIX = 'XC1:';

function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function daysFromToday(s) {
  const a = new Date(todayStr() + 'T00:00:00');
  const b = new Date(String(s) + 'T00:00:00');
  const n = Math.round((b - a) / 86400000);
  return isNaN(n) ? 0 : n;
}

/* 一条记录压成 "索引,盒子,距今天几天,错几次" */
function packStates(states) {
  return Object.keys(states || {}).map(Number).sort((a, b) => a - b).map(function (i) {
    const st = states[i] || {};
    return i + ',' + (st.box || 0) + ',' + daysFromToday(st.due || todayStr()) + ',' + (st.wrong || 0);
  }).join(';');
}

function unpackStates(str) {
  const out = {};
  if (!str) return out;
  String(str).split(';').forEach(function (seg) {
    if (!seg) return;
    const a = seg.split(',').map(Number);
    if (a.length < 4 || a.some(function (n) { return isNaN(n); })) return;
    if (!WORDS[a[0]]) return;                     // 词库换过、这个词没了就跳过
    out[a[0]] = {
      box: Math.min(MASTER_BOX, Math.max(0, a[1])),
      due: addDays(todayStr(), Math.max(-3650, Math.min(3650, a[2]))),
      wrong: Math.max(0, a[3])
    };
  });
  return out;
}

function packSync() {
  const out = {
    v: 1,
    p: {},
    s: db.shop,
    o: db.orders.slice(-60),
    c: { perDay: db.cfg.perDay }
  };
  Object.keys(db.profiles).forEach(function (k) {
    const pr = db.profiles[k];
    out.p[k] = {
      n: pr.name, t: pr.tile, b: pr.book,
      x: pr.xp, co: pr.coins, st: pr.streak, ld: pr.lastDay,
      lg: [pr.log.date || '', pr.log.newN || 0, pr.log.revN || 0, pr.log.gameN || 0],
      s: packStates(pr.states)
    };
  });
  return SYNC_PREFIX + b64enc(JSON.stringify(out));
}

function applySync(raw) {
  const code = String(raw || '').replace(/\s+/g, '');
  if (!code) return { ok: false, msg: '先把同步码粘贴到框里' };
  if (code.indexOf(SYNC_PREFIX) !== 0) return { ok: false, msg: '这串码不对，开头应该是 ' + SYNC_PREFIX };
  let body = null;
  try { body = JSON.parse(b64dec(code.slice(SYNC_PREFIX.length))); }
  catch (e) { return { ok: false, msg: '这串码不完整，可能复制时被截断了' }; }
  if (!body || !body.p) return { ok: false, msg: '这串码里没有学习记录' };

  let n = 0;
  Object.keys(body.p).forEach(function (k) {
    const src = body.p[k];
    const pr = db.profiles[k];
    if (!src || !pr) return;
    pr.name = String(src.n || pr.name).slice(0, 8);
    pr.tile = Number(src.t) || pr.tile;
    pr.book = (src.b === '4A' || src.b === '6A') ? src.b : pr.book;
    pr.xp = Number(src.x) || 0;
    pr.coins = Number(src.co) || 0;
    pr.streak = Number(src.st) || 0;
    pr.lastDay = src.ld || '';
    if (Object.prototype.toString.call(src.lg) === '[object Array]') {
      pr.log = {
        date: src.lg[0] || '',
        newN: Number(src.lg[1]) || 0,
        revN: Number(src.lg[2]) || 0,
        gameN: Number(src.lg[3]) || 0
      };
    }
    pr.states = unpackStates(src.s);
    pr.statesV3 = true;                            // 迁过来的已是新索引
    n++;
  });
  if (!n) return { ok: false, msg: '这串码里的档案对不上，可能来自别的版本' };

  if (Object.prototype.toString.call(body.s) === '[object Array]' && body.s.length) db.shop = body.s;
  if (Object.prototype.toString.call(body.o) === '[object Array]') db.orders = body.o;
  if (body.c && body.c.perDay) {
    db.cfg.perDay = Math.min(30, Math.max(1, Number(body.c.perDay) || 5));
  }
  saveDB();
  return { ok: true, msg: '已同步 ' + n + ' 个小朋友的记录' };
}

/* ---------- 家长中心 ---------- */
function viewParentGate() {
  return `
  ${topbar('家长中心', '需要密码', true)}
  <main class="page">
    <div class="card">
      <div class="card__title">${ICONS.lock} 请输入家长密码</div>
      <p class="card__hint">默认密码 1234，进入后可修改。</p>
      <div class="field" style="margin-top:12px">
        <input class="input" id="pwdInput" type="password" inputmode="numeric" placeholder="4 位数字" maxlength="8">
      </div>
      <button class="btn btn--block btn--primary" data-act="pwdSubmit">确认</button>
    </div>
    ${farmFoot()}
  </main>`;
}

function viewParent() {
  const p = P();
  const orders = db.orders.slice().reverse();
  return `
  ${topbar('家长中心', '', true)}
  <main class="page">
    <div class="card">
      <div class="card__title">学习设置</div>
      <div class="field">
        <label>每天新词数量</label>
        <div class="row">
          <input class="input input--sm" id="perDayInput" type="number" min="1" max="30" value="${db.cfg.perDay}">
          <button class="btn btn--sm" data-act="savePerDay" style="flex:0 0 90px">保存</button>
        </div>
      </div>
      <p class="card__hint">当前：每天 ${db.cfg.perDay} 个新词。词库共 ${WORDS.length} 个词，按此速度约 ${Math.ceil(WORDS.length / db.cfg.perDay)} 天走完。</p>
    </div>

    <div class="card">
      <div class="card__title">小朋友档案</div>
      ${Object.keys(db.profiles).map((k, n) => {
        const pf = db.profiles[k];
        return `
        <div class="field">
          <label>小朋友 ${n + 1}${k === db.active ? '（正在用）' : ''}</label>
          <div class="row">
            <input class="input input--sm" id="pname_${k}" value="${esc(pf.name)}" maxlength="8" placeholder="昵称">
            <button class="btn btn--sm" data-act="saveProfileName" data-k="${k}" style="flex:0 0 76px">改名</button>
          </div>
          <div class="avatar-pick">
            ${AVATARS.map((t) => `<button class="avatarbtn ${avatarOf(pf) === t ? 'is-on' : ''}" data-act="pickAvatar" data-k="${k}" data-t="${t}" aria-label="选这个头像">${spr(t, 32)}</button>`).join('')}
          </div>
        </div>`;
      }).join('')}
      <p class="card__hint">两个孩子各自记金币和学习进度，互不影响。在「对决」页可以互相看到对方的成绩。</p>
    </div>

    <div class="card">
      <div class="card__title">商品管理</div>
      <div class="wordlist">
        ${db.shop.map((s) => `
          <div class="wordrow">
            <span style="font-size:22px">${s.emoji || '🎁'}</span>
            <span class="wordrow__body">
              <span class="wordrow__w">${esc(s.name)}</span>
              <span class="wordrow__cn">${s.price} 金币</span>
            </span>
            <button class="btn btn--sm" data-act="editItem" data-id="${s.id}">改</button>
            <button class="btn btn--sm btn--danger" data-act="delItem" data-id="${s.id}">删</button>
          </div>`).join('') || '<p class="card__hint">还没有商品</p>'}
      </div>
      <button class="btn btn--block btn--sm" style="margin-top:10px" data-act="addItem">+ 添加商品</button>
    </div>

    <div class="card">
      <div class="card__title">兑换记录（${orders.length}）</div>
      ${orders.length ? `<div class="wordlist">
        ${orders.map((o) => `
          <div class="wordrow">
            <span class="wordrow__body">
              <span class="wordrow__w">${esc(o.name)}</span>
              <span class="wordrow__cn">${esc(o.pname)}　${esc(o.date)}　${o.price} 金币</span>
            </span>
            ${o.status === 'done'
              ? '<span class="badge badge--soft">已发放</span>'
              : `<button class="btn btn--sm btn--primary" data-act="finishOrder" data-id="${o.id}">标记已给</button>`}
          </div>`).join('')}
      </div>` : '<p class="card__hint">还没有兑换记录</p>'}
    </div>

    <div class="card">
      <div class="card__title">两台设备同步</div>
      <p class="card__hint">两人各用一台平板时，学习记录存在各自的机器上，不会自动互通。想让另一台看到最新进度：在这台点「生成同步码」，用微信发过去，对方粘贴后点「导入」。</p>
      <div class="row" style="gap:8px">
        <button class="btn btn--sm btn--primary" data-act="syncMake" style="flex:1">生成同步码</button>
        <button class="btn btn--sm" data-act="syncCopy" style="flex:1">复制</button>
      </div>
      <textarea class="input input--sync" id="syncBox" rows="4" placeholder="同步码会自动填到这里；收到对方的码，粘进来点下面的导入"></textarea>
      <button class="btn btn--block btn--sm" style="margin-top:8px" data-act="syncApply">导入这串码</button>
      <p class="card__hint" id="syncHint"></p>
    </div>

    <div class="card">
      <div class="card__title">账号与安全</div>
      <div class="field">
        <label>修改家长密码</label>
        <div class="row">
          <input class="input input--sm" id="newPwd" type="password" inputmode="numeric" placeholder="新的 4-8 位密码">
          <button class="btn btn--sm" data-act="savePwd" style="flex:0 0 90px">修改</button>
        </div>
      </div>
      <hr class="hr">
      <p class="card__hint">学习数据保存在本机浏览器。清理浏览器数据会丢失进度。</p>
      <button class="btn btn--block btn--sm btn--danger" style="margin-top:10px" data-act="resetAll">清空全部数据</button>
    </div>
    ${farmFoot()}
  </main>`;
}

/* ---------- 弹层：编辑商品 / 切换档案 ---------- */
function sheetEditItem(item) {
  ui.sheet = { type: 'item', item: item };
  render();
}
function viewSheet() {
  const s = ui.sheet;
  if (!s) return '';
  if (s.type === 'item') {
    const it = s.item;
    return `
    <div class="sheet-mask" data-act="closeSheet">
      <div class="sheet" data-stop="1">
        <div class="sheet__title">${it.id ? '编辑商品' : '添加商品'}</div>
        <div class="field">
          <label>奖励名称</label>
          <input class="input" id="itemName" value="${esc(it.name || '')}" placeholder="例如：看动画 30 分钟">
        </div>
        <div class="field">
          <label>需要的金币</label>
          <input class="input" id="itemPrice" type="number" min="1" value="${it.price || 20}">
        </div>
        <div class="field">
          <label>图标（一个表情）</label>
          <input class="input" id="itemEmoji" value="${esc(it.emoji || '🎁')}" maxlength="4">
        </div>
        <div class="sheet__foot">
          <button class="btn" data-act="closeSheet" style="flex:1">取消</button>
          <button class="btn btn--primary" data-act="saveItem" style="flex:1">保存</button>
        </div>
      </div>
    </div>`;
  }
  if (s.type === 'profile') {
    return `
    <div class="sheet-mask" data-act="closeSheet">
      <div class="sheet" data-stop="1">
        <div class="sheet__title">今天是谁在种地？</div>
        ${Object.keys(db.profiles).map((k) => {
          const pf = db.profiles[k];
          return `<button class="whorow ${k === db.active ? 'is-on' : ''}" data-act="pickProfile" data-k="${k}">
            <span class="whorow__av">${spr(avatarOf(pf), 48)}</span>
            <span class="whorow__body">
              <b>${esc(pf.name)}</b>
              <em>${ICONS.coin}${pf.coins}　已学 ${learnedCount(pf)} 词　Lv.${levelOf(pf).lv}　连续 ${pf.streak} 天</em>
            </span>
            ${k === db.active ? '<span class="badge badge--soft">当前</span>' : '<span class="badge">换 TA</span>'}
          </button>`;
        }).join('')}
        <p class="card__hint" style="margin-top:12px">两个人的金币、学过的词各记各的，互不影响。改名字和头像在家长中心。</p>
        <div class="sheet__foot">
          <button class="btn" data-act="closeSheet" style="flex:1">关闭</button>
        </div>
      </div>
    </div>`;
  }
  return '';
}

/* ---------- 主渲染 ---------- */
const VIEWS = {
  today: viewToday, learn: viewLearn, review: viewReview, wrong: viewWrong,
  game: viewGame, versus: viewVersus, shop: viewShop, me: viewMe,
  parentGate: viewParentGate, parent: viewParent
};

function render() {
  const app = $('#app');
  const v = VIEWS[ui.view] || viewToday;
  app.innerHTML = v() + viewSheet();
  if (ui.view === 'parentGate') {
    const inp = $('#pwdInput');
    if (inp) setTimeout(() => inp.focus(), 50);
  }
}

/* ==========================================================================
   交互层
   ========================================================================== */
function checkSpell() {
  const sp = ui.spell;
  if (!sp || sp.settled) return;                 // 已经结算过，不重复计
  const w = WORDS[sp.wi];
  if (sp.filled.some((x) => x === null)) return;
  const built = sp.filled.map((id) => sp.pool.find((x) => x.id === id).ch).join('');

  if (built.toLowerCase() === w.w.toLowerCase()) {
    sp.ok = true;
    sp.bad = false;
    speak(w.w);
    render();
    const fb = $('#fb');
    if (fb) { fb.textContent = '✓ 拼对了！' + w.w; fb.className = 'feedback feedback--ok'; }
    setTimeout(() => onSpellOK(sp), 900);        // 把这一题传过去，避免结算到别的题
    return;
  }

  sp.bad = true;
  gradeWord(sp.wi, false);                       // 拼错即记入错词本

  if (sp.ctx === 'game') {                       // 闯关：拼错直接结束本题
    const g = ui.game;
    if (g && g.pos < g.qs.length) {
      g.bad++;
      P().xp += 1;
      saveDB();
    }
    render();
    const fb0 = $('#fb');
    if (fb0) { fb0.textContent = '正确答案：' + w.w; fb0.className = 'feedback feedback--bad'; }
    setTimeout(() => { if (g && ui.game === g) nextGameQ(); }, 1100);
    return;
  }

  render();
  const fb = $('#fb');
  if (fb) { fb.textContent = '拼错了，看看字母顺序，再试一次'; fb.className = 'feedback feedback--bad'; }
  setTimeout(() => {
    if (ui.spell !== sp) return;                 // 已经换题或离开，不再处理
    sp.bad = false;
    sp.filled = new Array(w.w.length).fill(null);
    render();
  }, 1000);
}

function onSpellOK(sp) {
  if (!sp || sp.settled) return;
  if (sp !== ui.spell) { sp.settled = true; return; }   // 题已经换掉，这一题作废
  sp.settled = true;
  const i = sp.wi;

  if (sp.ctx === 'game') {
    const g = ui.game;
    if (!g || g.pos >= g.qs.length) { render(); return; }  // 已经离开闯关，不再结算
    g.ok++;
    P().xp += REWARD.gamePerRight.xp;
    P().coins += REWARD.gamePerRight.coin;
    gradeWord(i, true);
    saveDB();
    nextGameQ();
    return;
  }

  // 学习 / 复习
  const s = ui.learn;
  if (!s) { render(); return; }                  // 会话已结束，不再发奖
  gradeWord(i, true);
  s.results.ok++;

  if (s.mode === 'review') {
    P().log.revN = (P().log.date === todayStr() ? P().log.revN : 0) + 1;
    addReward('reviewOk');
  } else {
    P().log.newN = (P().log.date === todayStr() ? P().log.newN : 0) + 1;
    addReward('learnNew');
  }

  s.pos++;
  if (s.pos < s.list.length) {
    prepSpell(s.list[s.pos], s.mode === 'review' ? 'review' : 'learn');
    if (s.mode !== 'review') {
      s.phase = 'show';
      resetRec();
      clearLit();
    }
    render();
    if (s.mode !== 'review') speak(WORDS[s.list[s.pos]].w);
  } else {
    resetRec();
    clearLit();
    confetti();
    render();
  }
}

function nextGameQ() {
  const g = ui.game;
  if (!g) return;                                // 本局已经结束
  g.pos++;
  ui.quiz = null;
  ui.spell = null;
  if (g.pos >= g.qs.length) {
    const rate = Math.round((g.ok / g.qs.length) * 100);
    if (rate >= 80) {
      P().xp += REWARD.gameBonus.xp;
      P().coins += REWARD.gameBonus.coin;
    }
    P().log.gameN = (P().log.date === todayStr() ? P().log.gameN : 0) + 1;
    P().lastDay = todayStr();
    saveDB();
    confetti();
  } else {
    const q = g.qs[g.pos];
    if (q.type === 'spell') prepSpell(q.i, 'game');
  }
  render();
  if (g.pos < g.qs.length && g.qs[g.pos].type === 'pick') speak(WORDS[g.qs[g.pos].i].w);
}

/* ---------- 事件分发 ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  const stopped = e.target.closest('[data-stop]');

  // 弹层遮罩关闭（点内部不关）
  if (t && t.classList.contains('sheet-mask') && !stopped) {
    if (e.target === t) { ui.sheet = null; render(); }
    return;
  }
  if (!t) return;
  const act = t.dataset.act;

  switch (act) {
    /* 导航 */
    case 'tab': tab(t.dataset.v); break;
    case 'back': back(); break;

    case 'task': {
      const id = t.dataset.id;
      if (id === 'learn') startLearn();
      else if (id === 'review') startReview();
      else if (id === 'game') { ui.game = null; tab('game'); }
      break;
    }

    /* 发音 */
    case 'say': speak(WORDS[Number(t.dataset.w)].w); break;
    case 'seg': {
      const w = WORDS[Number(t.dataset.w)];
      speak(w.w);
      break;
    }

    /* 学习流程 */
    case 'toRead':
      if (!ui.learn) break;
      ui.learn.phase = 'read';
      resetRec();
      render();
      readSlow(ui.spell.wi);          // 进这一步先自己读一遍给孩子听
      break;

    case 'readSlow': readSlow(Number(t.dataset.w)); break;
    case 'readFull': readFull(Number(t.dataset.w)); break;

    case 'toMeaning':
      if (!ui.learn) break;
      ui.learn.phase = 'meaning';
      prepMeaning(ui.spell.wi);
      render();
      speak(WORDS[ui.spell.wi].w);
      break;

    /* 三选一：点错只划掉那一个，可以继续选，直到选对 */
    case 'meaningPick': {
      const m = ui.meaning;
      if (!m || m.ok) return;
      const w = WORDS[m.wi];
      const cn = t.dataset.o;
      if (m.tried.indexOf(cn) !== -1) return;

      if (cn === w.cn) {
        m.ok = true;
        render();
        const fb = $('#fb');
        if (fb) { fb.textContent = '✓ 就是「' + w.cn + '」'; fb.className = 'feedback feedback--ok'; }
        setTimeout(function () {
          if (ui.meaning !== m || !ui.learn) return;      // 已经换题或走了
          ui.learn.phase = 'spell';
          prepSpell(m.wi, 'learn');
          render();
        }, 850);
        return;
      }

      m.tried.push(cn);
      if (!m.missed) { m.missed = true; gradeWord(m.wi, false); }   // 同一题只记一次错
      render();
      const fb = $('#fb');
      if (fb) { fb.textContent = '不对，「' + cn + '」不是这个词'; fb.className = 'feedback feedback--bad'; }
      break;
    }

    /* 跟读录音 */
    case 'recStart': recStart(); break;
    case 'recStop': recStop(); break;
    case 'recPlay': recPlay(); break;
    case 'recCompare': recCompare(); break;

    case 'toSpell':
      ui.learn.phase = 'spell';
      prepSpell(ui.spell.wi, 'learn');   // 重新出这道题：洗选项、清掉划掉的、清空字母格
      render();
      break;

    case 'forget': {
      ui.learn.phase = 'show';
      resetRec();
      clearLit();
      render();
      break;
    }

    /* 词组四选一：点错只划掉那一个，可以继续选，直到选对 */
    case 'phrasePick': {
      const sp = ui.spell;
      if (!sp || sp.type !== 'pick' || sp.ok || sp.settled) return;
      const w = WORDS[sp.wi];
      const o = t.dataset.o;
      if (sp.tried.indexOf(o) !== -1) return;

      if (o === w.w) {
        sp.ok = true;
        speak(w.w);
        render();
        const fb = $('#fb');
        if (fb) { fb.textContent = '✓ 选对了！' + w.w; fb.className = 'feedback feedback--ok'; }
        setTimeout(() => onSpellOK(sp), 900);
        return;
      }

      sp.tried.push(o);
      if (!sp.missed) { sp.missed = true; gradeWord(sp.wi, false); }   // 同一题只记一次错

      if (sp.ctx === 'game') {                       // 闯关：选错直接结束本题
        const g = ui.game;
        if (g && g.pos < g.qs.length) { g.bad++; P().xp += 1; saveDB(); }
        sp.ok = true;                                // 借 ok 把正确答案标绿
        render();
        const fb0 = $('#fb');
        if (fb0) { fb0.textContent = '正确答案：' + w.w; fb0.className = 'feedback feedback--bad'; }
        setTimeout(() => { if (g && ui.game === g) nextGameQ(); }, 1100);
        return;
      }

      render();
      const fb = $('#fb');
      if (fb) { fb.textContent = '不对，这个划掉了，再选一个'; fb.className = 'feedback feedback--bad'; }
      break;
    }

    case 'letter': {
      const sp = ui.spell;
      if (!sp || sp.ok || sp.bad) return;
      const id = Number(t.dataset.id);
      if (sp.filled.includes(id)) return;
      const empty = sp.filled.indexOf(null);
      if (empty === -1) return;
      sp.filled[empty] = id;
      render();
      checkSpell();
      break;
    }

    case 'slot': {
      const sp = ui.spell;
      if (!sp || sp.ok || sp.bad) return;
      const idx = Number(t.dataset.i);
      if (sp.filled[idx] === null) return;
      sp.filled[idx] = null;
      render();
      break;
    }

    /* 复习 / 错词 */
    case 'toReview': { ui.learn = null; startReview(); break; }
    case 'openWrong': go('wrong'); break;
    case 'practiceWrong': practiceWrong(); break;

    /* 闯关 */
    case 'startGame': { ui.game = null; startGame(); break; }
    case 'quizPick': {
      const z = ui.quiz;
      if (!z || z.done) return;
      const g = ui.game;
      const w = WORDS[z.wi];
      z.picked = t.dataset.o;
      z.done = true;
      if (z.picked === w.w) {
        g.ok++;
        P().xp += REWARD.gamePerRight.xp;
        P().coins += REWARD.gamePerRight.coin;
        gradeWord(z.wi, true);
        speak(w.w);
      } else {
        g.bad++;
        P().xp += 1;
        gradeWord(z.wi, false);
      }
      saveDB();
      render();
      const g0 = ui.game;
      setTimeout(() => { if (g0 && ui.game === g0) nextGameQ(); }, 900);
      break;
    }

    /* 商店 */
    case 'redeem': {
      const item = db.shop.find((x) => x.id === t.dataset.id);
      const p = P();
      if (!item || p.coins < item.price) { toast('金币不够'); return; }
      if (!confirm(`用 ${item.price} 金币兑换「${item.name}」？`)) return;
      p.coins -= item.price;
      db.orders.push({
        id: 'o' + Date.now(),
        pid: db.active,
        pname: p.name,
        name: item.name,
        price: item.price,
        date: todayStr(),
        status: 'pending'
      });
      saveDB();
      render();
      toast('兑换成功，等爸爸妈妈发放吧');
      break;
    }

    /* 我的 */
    case 'switchProfile': ui.sheet = { type: 'profile' }; render(); break;
    case 'pickProfile':
      db.active = t.dataset.k;
      saveDB();
      ui.sheet = null;
      ui.learn = null; ui.spell = null; ui.game = null; ui.quiz = null;  // 换人不带着上一个人的题走
      if (ui.view === 'versus') render();      // 在对决页切人：视角直接调换，对比不打断
      else tab('today');
      break;
    case 'closeSheet': ui.sheet = null; render(); break;

    /* 家长 */
    case 'openParent': go(ui.parentOK ? 'parent' : 'parentGate'); break;
    case 'pwdSubmit': {
      const v = ($('#pwdInput') || {}).value || '';
      if (v === db.cfg.pwd) { ui.parentOK = true; ui.stack = ['me']; ui.view = 'parent'; render(); }
      else { toast('密码不对'); }
      break;
    }
    case 'savePerDay': {
      const v = Number(($('#perDayInput') || {}).value || 0);
      if (!v || v < 1 || v > 30) { toast('请输入 1-30 之间的数字'); break; }
      db.cfg.perDay = v;
      saveDB();
      render();
      toast('已保存：每天 ' + v + ' 个新词');
      break;
    }

    /* 档案 */
    case 'saveProfileName': {
      const pf = db.profiles[t.dataset.k];
      if (!pf) break;
      const inp = $('#pname_' + t.dataset.k);
      const v = ((inp || {}).value || '').trim();
      if (!v) { toast('名字不能是空的'); break; }
      if (v.length > 8) { toast('名字最多 8 个字'); break; }
      pf.name = v;
      saveDB();
      render();
      toast('改好了：' + v);
      break;
    }
    case 'pickAvatar': {
      const pf = db.profiles[t.dataset.k];
      if (!pf) break;
      pf.tile = Number(t.dataset.t) || 108;
      saveDB();
      render();
      break;
    }
    /* 设备间同步 */
    case 'syncMake': {
      const code = packSync();
      const box = $('#syncBox');
      if (box) box.value = code;
      const hint = $('#syncHint');
      if (hint) hint.textContent = '已生成 ' + code.length + ' 个字符，长按上面框里的内容全选复制。';
      break;
    }
    case 'syncCopy': {
      const box = $('#syncBox');
      const val = (box && box.value || '').trim();
      const hint = $('#syncHint');
      if (!val) { toast('先点「生成同步码」'); break; }
      const done = function (ok) {
        if (hint) hint.textContent = ok ? '已复制，去微信粘给对方' : '这台设备不让自动复制，请长按框里的内容手动全选复制';
        if (ok) toast('已复制');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(function () { done(true); }, function () { done(false); });
      } else {
        if (box) { box.focus(); box.select(); }
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        done(ok);
      }
      break;
    }
    case 'syncApply': {
      const box = $('#syncBox');
      const r = applySync(box && box.value);
      const hint = $('#syncHint');
      if (hint) hint.textContent = r.msg;
      if (!r.ok) { toast(r.msg); break; }
      ui.learn = null; ui.spell = null; ui.game = null; ui.quiz = null;
      render();
      toast(r.msg);
      break;
    }
    case 'addItem': sheetEditItem({ id: '', name: '', price: 20, emoji: '🎁' }); break;    case 'editItem': {
      const it = db.shop.find((x) => x.id === t.dataset.id);
      if (it) sheetEditItem(Object.assign({}, it));
      break;
    }
    case 'saveItem': {
      const name = (($('#itemName') || {}).value || '').trim();
      const price = Number((($('#itemPrice') || {}).value || 0));
      const emoji = (($('#itemEmoji') || {}).value || '🎁').trim();
      if (!name) { toast('请填写奖励名称'); break; }
      if (!price || price < 1) { toast('金币数要不小于 1'); break; }
      const it = ui.sheet.item;
      if (it.id) {
        const target = db.shop.find((x) => x.id === it.id);
        if (target) { target.name = name; target.price = price; target.emoji = emoji; }
      } else {
        db.shop.push({ id: 's' + Date.now(), name: name, price: price, emoji: emoji });
      }
      saveDB();
      ui.sheet = null;
      render();
      toast('已保存');
      break;
    }
    case 'delItem': {
      if (!confirm('确定删除这个商品吗？')) break;
      db.shop = db.shop.filter((x) => x.id !== t.dataset.id);
      saveDB();
      render();
      break;
    }
    case 'finishOrder': {
      const o = db.orders.find((x) => x.id === t.dataset.id);
      if (o) { o.status = 'done'; saveDB(); render(); toast('已标记发放'); }
      break;
    }
    case 'savePwd': {
      const v = (($('#newPwd') || {}).value || '').trim();
      if (v.length < 4) { toast('密码至少 4 位'); break; }
      db.cfg.pwd = v;
      saveDB();
      toast('密码已修改');
      break;
    }
    case 'resetAll': {
      if (!confirm('会清空两个小朋友的全部学习记录，确定吗？')) break;
      localStorage.removeItem(STORE_KEY);
      db = defaultDB();
      ui.parentOK = false;
      saveDB();
      tab('today');
      break;
    }
  }
});

/* 回车提交密码 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (ui.view === 'parentGate') {
    const btn = document.querySelector('[data-act="pwdSubmit"]');
    if (btn) btn.click();
  }
});

/* ---------- 启动 ---------- */
render();
