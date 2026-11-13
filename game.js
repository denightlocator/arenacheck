/* Dead Hollow — a top-down zombie survival game.
 * Everything (sprites, lighting, sound) is generated in code: no external assets. */
(() => {
'use strict';

/* ============================== CONSTANTS ============================== */
const T = 48;                 // tile size (world px)
const WW = 100, WH = 100;     // world size in tiles
const Z = 1.25;               // camera zoom
const DAY_SEC = 240;          // real seconds per in-game day
const SS = 2;                 // sprite supersampling

const G = { GRASS: 0, DIRT: 1, SAND: 2, WATER: 3 };
const O = { NONE: 0, TREE: 1, ROCK: 2, HWALL: 3, PWALL: 4, FLOOR: 5, BUSH: 6, DOOR: 7, CHEST: 8 };
const SOLIDOBS = [0, 1, 1, 1, 1, 0, 0, 0, 1];

const WEAPONS = [
  { id: 'knife', name: 'Hunting Knife', melee: true, cd: 0.42, range: 44, arc: 1.25, dmg: 34 },
  { id: 'pistol', name: '9mm Pistol', mag: 12, ammo: 'ammo', cd: 0.24, reload: 1.1, speed: 900, life: 0.55, pellets: 1, spread: 0.025, dmg: 15, loud: 0.5 },
  { id: 'shotgun', name: 'Pump Shotgun', mag: 6, ammo: 'shells', cd: 0.85, reload: 1.7, speed: 720, life: 0.36, pellets: 7, spread: 0.22, dmg: 9, loud: 1 },
];

const ZTYPES = {
  walker: { hp: 60, sp: 58, dmg: 10, cd: 1.0, r: 13, col: '#5d7d4b' },
  runner: { hp: 32, sp: 132, dmg: 7, cd: 0.7, r: 12, col: '#86644a' },
  brute:  { hp: 190, sp: 44, dmg: 22, cd: 1.4, r: 19, col: '#4a5866' },
};

const RECIPES = [
  { name: 'Medkit', need: { cloth: 3, scrap: 1 }, give: { medkit: 1 }, desc: 'Heals 45 HP when used (J)' },
  { name: '9mm Rounds x12', need: { scrap: 2, stone: 1 }, give: { ammo: 12 }, desc: 'Pistol ammunition' },
  { name: 'Shotgun Shells x6', need: { scrap: 2, wood: 1 }, give: { shells: 6 }, desc: 'Shotgun ammunition' },
];

const ITEM_COL = {
  ammo: '#f2c14e', shells: '#e4572e', food: '#8fd16b', water: '#4fa3e0', medkit: '#ff5c7a',
  scrap: '#b8bec6', cloth: '#f4f1e8', wood: '#b07a3f', stone: '#8d949e',
};
const ITEM_NAME = {
  ammo: '9mm', shells: 'Shells', food: 'Food', water: 'Water', medkit: 'Medkit',
  scrap: 'Scrap', cloth: 'Cloth', wood: 'Wood', stone: 'Stone',
};

/* ============================== DOM / CANVAS ============================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const lc = document.createElement('canvas');
const lctx = lc.getContext('2d');
let dpr = 1, cssW = 0, cssH = 0, viewW = 0, viewH = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = window.innerWidth; cssH = window.innerHeight;
  canvas.width = Math.floor(cssW * dpr); canvas.height = Math.floor(cssH * dpr);
  lc.width = canvas.width; lc.height = canvas.height;
  viewW = cssW / Z; viewH = cssH / Z;
}
window.addEventListener('resize', resize);
resize();

/* ============================== UTIL ============================== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RI = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const idx = (x, y) => y * WW + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < WW && y < WH;
const smooth = (t) => t * t * (3 - 2 * t);

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ============================== SOUND ============================== */
let actx = null, muted = false;
function ac() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  return actx;
}
function tone(freq, dur, vol, type = 'sine', slideTo = null) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0005, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}
function noise(dur, vol, lp) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination); s.start();
}
const sfx = {
  gun(loud) { noise(0.22, 0.5 * loud, 2600); tone(140, 0.25, 0.25 * loud, 'sine', 40); },
  click() { tone(220, 0.05, 0.05, 'square'); },
  swing() { noise(0.12, 0.15, 1800); },
  hit() { tone(180, 0.08, 0.12, 'triangle', 90); },
  hurt() { tone(120, 0.25, 0.25, 'sawtooth', 60); },
  groan() { tone(90 + Math.random() * 30, 0.7, 0.07, 'sawtooth', 55); },
  pick() { tone(660, 0.08, 0.08, 'sine', 990); },
  build() { noise(0.1, 0.3, 900); },
};

/* ============================== SPRITES ============================== */
const SPR = {};
function sprite(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SS); c.height = Math.ceil(h * SS);
  const g = c.getContext('2d');
  g.scale(SS, SS);
  fn(g, w, h);
  return { c, w, h };
}
function blit(s, x, y) { ctx.drawImage(s.c, x, y, s.w, s.h); }
function shadowEl(g, cx, cy, rx, ry, a) {
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
}
function speckle(g, w, h, n, colA, colB, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? colA : colB;
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

function makeSprites() {
  // Ground tiles
  const grassCols = ['#4d7d39', '#52843d', '#467334'];
  SPR.grass = grassCols.map((col) => sprite(T, T, (g) => {
    g.fillStyle = col; g.fillRect(0, 0, T, T);
    speckle(g, T, T, 90, 'rgba(130,190,90,.35)', 'rgba(20,50,20,.35)', 2);
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * T, y = Math.random() * T;
      g.strokeStyle = 'rgba(160,210,110,.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 4, y - 4 - Math.random() * 3); g.stroke();
    }
  }));
  SPR.dirt = [0, 1].map(() => sprite(T, T, (g) => {
    g.fillStyle = '#7b5b3b'; g.fillRect(0, 0, T, T);
    speckle(g, T, T, 110, 'rgba(60,40,20,.5)', 'rgba(160,120,80,.35)', 2);
    speckle(g, T, T, 12, 'rgba(120,120,110,.6)', 'rgba(90,90,80,.6)', 3);
  }));
  SPR.sand = sprite(T, T, (g) => {
    g.fillStyle = '#cdb67e'; g.fillRect(0, 0, T, T);
    speckle(g, T, T, 120, 'rgba(150,130,80,.4)', 'rgba(240,225,170,.5)', 2);
  });
  SPR.floor = sprite(T, T, (g) => {
    g.fillStyle = '#8c6b45'; g.fillRect(0, 0, T, T);
    for (let y = 0; y < T; y += 12) {
      g.fillStyle = 'rgba(40,25,10,.35)'; g.fillRect(0, y, T, 1.5);
      g.fillStyle = 'rgba(255,220,170,.08)'; g.fillRect(0, y + 2, T, 2);
    }
    g.fillStyle = 'rgba(30,20,10,.5)';
    for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(6 + (k % 2) * 36, 6 + Math.floor(k / 2) * 36, 1.2, 0, 7); g.fill(); }
  });
  SPR.door = sprite(T, T, (g) => {
    g.drawImage(SPR.floor.c, 0, 0, T, T);
    g.fillStyle = '#4a2f1a'; g.fillRect(4, 4, T - 8, T - 8);
    g.fillStyle = '#6e4628'; g.fillRect(8, 8, T - 16, T - 16);
    g.fillStyle = '#e0b84a'; g.beginPath(); g.arc(T - 14, T / 2, 2.6, 0, 7); g.fill();
  });
  SPR.water = [0, 1].map((frame) => sprite(T, T, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, T);
    grd.addColorStop(0, '#2c6e9c'); grd.addColorStop(1, '#1d4f78');
    g.fillStyle = grd; g.fillRect(0, 0, T, T);
    g.strokeStyle = 'rgba(190,230,255,.35)'; g.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) {
      const y = 8 + k * 12 + frame * 3;
      g.beginPath();
      for (let x = 0; x <= T; x += 4) {
        const yy = y + Math.sin((x + frame * 6 + k * 9) / 5) * 1.6;
        x === 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
    }
  }));

  // Obstacles
  SPR.trees = [0, 1, 2].map((v) => sprite(80, 96, (g) => {
    shadowEl(g, 40, 88, 30, 9, 0.38);
    g.fillStyle = '#5a3b22'; g.fillRect(36, 58, 8, 30);
    g.fillStyle = '#3f2a18'; g.fillRect(40, 58, 4, 30);
    const cols = [['#245a2a', '#2f7535', '#3f8a40'], ['#1f4f26', '#2a6a32', '#3a7d3c'], ['#2c5f2a', '#3a7a36', '#4c9147']][v];
    const blobs = [[40, 42, 28], [24, 52, 20], [56, 52, 21], [40, 26, 20], [30, 36, 16], [52, 34, 16]];
    for (const [x, y, r] of blobs) { g.fillStyle = cols[0]; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    for (const [x, y, r] of blobs) { g.fillStyle = cols[1]; g.beginPath(); g.arc(x - 3, y - 4, r * 0.7, 0, 7); g.fill(); }
    for (let k = 0; k < 8; k++) {
      g.fillStyle = cols[2]; g.beginPath(); g.arc(28 + Math.random() * 26, 22 + Math.random() * 22, 2 + Math.random() * 2.5, 0, 7); g.fill();
    }
  }));
  SPR.rocks = [0, 1].map((v) => sprite(52, 42, (g) => {
    shadowEl(g, 26, 37, 22, 6, 0.4);
    const pts = v === 0
      ? [[6, 34], [4, 18], [14, 6], [30, 2], [44, 10], [48, 26], [40, 36]]
      : [[8, 34], [2, 22], [12, 10], [26, 4], [42, 8], [50, 20], [44, 34]];
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    const grd = g.createLinearGradient(0, 0, 0, 40);
    grd.addColorStop(0, '#9aa0a8'); grd.addColorStop(1, '#5d636b');
    g.fillStyle = grd; g.fill();
    g.strokeStyle = 'rgba(30,30,35,.6)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(18, 12, 7, 3, -0.3, 0, 7); g.fill();
    g.fillStyle = 'rgba(40,40,45,.35)'; g.fillRect(8, 30, 30, 3);
  }));
  SPR.bush = sprite(46, 38, (g) => {
    shadowEl(g, 23, 33, 19, 5, 0.35);
    const cols = ['#3c6a2c', '#4b7d36', '#2f5a24'];
    for (let k = 0; k < 9; k++) {
      g.fillStyle = cols[k % 3];
      g.beginPath(); g.arc(12 + Math.random() * 22, 16 + Math.random() * 12, 7 + Math.random() * 4, 0, 7); g.fill();
    }
    // cloth rags
    for (let k = 0; k < 5; k++) {
      g.fillStyle = Math.random() < 0.5 ? '#ece8dc' : '#cfc9b6';
      g.fillRect(10 + Math.random() * 26, 12 + Math.random() * 14, 4, 2);
    }
  });
  SPR.hwall = sprite(T, T, (g) => {
    g.fillStyle = '#a58f74'; g.fillRect(0, 0, T, T);
    g.fillStyle = 'rgba(60,45,30,.35)';
    for (let r = 0; r < 4; r++) {
      g.fillRect(0, r * 12 + 11, T, 1.5);
      const off = r % 2 ? 12 : 0;
      for (let c = 0; c <= 2; c++) g.fillRect(off + c * 24, r * 12, 1.5, 12);
    }
    g.fillStyle = '#6e5a46'; g.fillRect(0, 0, T, 9);
    g.fillStyle = '#8a7358'; g.fillRect(0, 9, T, 2);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, T - 3, T, 3);
  });
  SPR.pwall = sprite(T, T, (g) => {
    g.fillStyle = '#9a7044'; g.fillRect(0, 0, T, T);
    for (let y = 0; y < T; y += 8) {
      g.fillStyle = 'rgba(40,25,10,.35)'; g.fillRect(0, y + 7, T, 1.5);
      g.fillStyle = 'rgba(255,220,170,.1)'; g.fillRect(0, y, T, 1.5);
    }
    g.fillStyle = '#5c3d1e'; g.fillRect(0, 0, 4, T); g.fillRect(T - 4, 0, 4, T);
    g.fillStyle = '#c9a66b';
    for (const [x, y] of [[10, 10], [38, 10], [10, 38], [38, 38]]) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, T - 3, T, 3);
  });
  const chestSprite = (open) => sprite(42, 34, (g) => {
    shadowEl(g, 21, 30, 18, 4, 0.35);
    g.fillStyle = open ? '#4b2e18' : '#7a4e2a';
    rr(g, 4, 12, 34, 18, 3); g.fill();
    g.fillStyle = open ? '#3a2412' : '#8f5d33';
    if (open) { rr(g, 4, 0, 34, 10, 3); g.fill(); }
    else { rr(g, 4, 8, 34, 10, 3); g.fill(); }
    g.strokeStyle = '#3b2412'; g.lineWidth = 1.5; g.strokeRect(4.5, 12.5, 33, 17);
    g.fillStyle = open ? '#6b5a30' : '#e0b84a';
    g.fillRect(18, open ? 14 : 16, 6, 6);
  });
  SPR.chest = chestSprite(false);
  SPR.chestOpen = chestSprite(true);
}

/* ============================== WORLD ============================== */
function makeNoise(scale) {
  const gw = Math.ceil(WW / scale) + 3;
  const grid = new Float32Array(gw * gw);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  return (x, y) => {
    const gx = x / scale, gy = y / scale;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const u = smooth(fx), v = smooth(fy);
    const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
    const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
    const top = a + (b - a) * u, bot = c + (d - c) * u;
    return top + (bot - top) * v;
  };
}

function generate() {
  const W = { ground: new Uint8Array(WW * WH), obs: new Uint8Array(WW * WH), hp: new Map(), chests: new Map(), houses: [] };
  const nF = makeNoise(9), nL = makeNoise(13), nR = makeNoise(7), nD = makeNoise(6);
  const cx = WW / 2, cy = WH / 2;

  for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) {
    const i = idx(x, y);
    const dc = Math.hypot(x - cx, y - cy);
    const lk = nL(x, y);
    let g = G.GRASS;
    if (dc > 9 && lk > 0.7) g = G.WATER;
    else if (dc > 9 && lk > 0.65) g = G.SAND;
    else if (nD(x, y) > 0.68) g = G.DIRT;
    W.ground[i] = g;

    if ((g === G.GRASS || g === G.DIRT) && dc > 5) {
      if (nF(x, y) > 0.57 && Math.random() < 0.6) { W.obs[i] = O.TREE; W.hp.set(i, 4); }
      else if (nR(x, y) > 0.72 && Math.random() < 0.4) { W.obs[i] = O.ROCK; W.hp.set(i, 5); }
      else if (Math.random() < 0.025) { W.obs[i] = O.BUSH; W.hp.set(i, 3); }
    }
  }

  // Ruined houses with a door and lootable chests
  let tries = 0;
  while (W.houses.length < 7 && tries < 900) {
    tries++;
    const w = RI(5, 7), h = RI(4, 6);
    const x0 = RI(3, WW - w - 4), y0 = RI(3, WH - h - 4);
    if (Math.hypot(x0 + w / 2 - cx, y0 + h / 2 - cy) < 13) continue;
    let ok = true;
    for (let y = y0 - 2; y <= y0 + h + 1 && ok; y++) for (let x = x0 - 2; x <= x0 + w + 1; x++) {
      const i = idx(x, y);
      if (W.ground[i] === G.WATER || W.obs[i] !== O.NONE) { ok = false; break; }
    }
    if (!ok) continue;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = idx(x, y);
      W.ground[i] = G.DIRT;
      const edge = x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1;
      W.obs[i] = edge ? O.HWALL : O.FLOOR;
    }
    W.obs[idx(x0 + Math.floor(w / 2), y0 + h - 1)] = O.DOOR;
    const nC = Math.random() < 0.55 ? 1 : 2;
    for (let k = 0; k < nC; k++) {
      const x = RI(x0 + 1, x0 + w - 2), y = RI(y0 + 1, y0 + h - 2);
      const i = idx(x, y);
      if (W.obs[i] === O.FLOOR) { W.obs[i] = O.CHEST; W.chests.set(i, { looted: false }); }
    }
    W.houses.push({ x0, y0, w, h });
  }
  return W;
}

const tileSolid = (tx, ty) => {
  if (!inb(tx, ty)) return true;
  const i = idx(tx, ty);
  if (world.ground[i] === G.WATER) return true;
  return SOLIDOBS[world.obs[i]] === 1;
};
function blockedAt(px, py, r) {
  const x0 = Math.floor((px - r) / T), x1 = Math.floor((px + r) / T);
  const y0 = Math.floor((py - r) / T), y1 = Math.floor((py + r) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!tileSolid(tx, ty)) continue;
    const nx = clamp(px, tx * T, tx * T + T), ny = clamp(py, ty * T, ty * T + T);
    if ((px - nx) ** 2 + (py - ny) ** 2 < r * r) return true;
  }
  return false;
}
function moveEntity(e, dx, dy) {
  if (!blockedAt(e.x + dx, e.y, e.r)) e.x += dx;
  if (!blockedAt(e.x, e.y + dy, e.r)) e.y += dy;
}

/* ============================== GAME STATE ============================== */
let state = 'menu';
let world = null;
let hours = 8, day = 1, weather = 'clear';
let zombies = [], bullets = [], parts = [], decals = [], drops = [], toasts = [];
let spawnT = 0, kills = 0, shake = 0, groanT = 0, time = 0, building = false, gatherCD = 0;
const cam = { x: 0, y: 0 };
const mouse = { x: 0, y: 0, pressed: false };
const keys = {};

const player = {
  x: 0, y: 0, r: 12, hp: 100, hunger: 100, thirst: 100, stamina: 100,
  iframe: 0, flash: 0, lastHurt: 99, weapon: 1, cool: 0, reload: 0, reloadW: 1,
  swing: 0, muzzle: 0, aim: 0, moving: false, bob: 0,
  mags: { pistol: 12, shotgun: 6 },
  inv: { wood: 0, stone: 0, cloth: 0, scrap: 0, food: 2, water: 2, medkit: 1, ammo: 24, shells: 6 },
};

function isNight() { return hours < 6 || hours >= 19.5; }
function nightAmt() {
  const d = 0.5 + 0.5 * Math.cos((2 * Math.PI * (hours - 12)) / 24);
  return clamp(1 - (d - 0.15) / 0.3, 0, 1);
}
function sunsetAmt() {
  return Math.max(Math.exp(-((hours - 6.5) ** 2) / 1.2), Math.exp(-((hours - 19) ** 2) / 1.2));
}
const isBlood = () => day % 5 === 0;

function toast(msg) {
  toasts.push({ text: msg, t: 4.5 });
  if (toasts.length > 6) toasts.shift();
}

function newGame() {
  world = generate();
  Object.assign(player, {
    x: WW * T / 2, y: WH * T / 2, hp: 100, hunger: 100, thirst: 100, stamina: 100,
    iframe: 0, flash: 0, lastHurt: 99, cool: 0, reload: 0, swing: 0, muzzle: 0, weapon: 1,
    mags: { pistol: 12, shotgun: 6 },
    inv: { wood: 0, stone: 0, cloth: 0, scrap: 0, food: 2, water: 2, medkit: 1, ammo: 24, shells: 6 },
  });
  zombies = []; bullets = []; parts = []; decals = []; drops = []; toasts = [];
  hours = 8; day = 1; kills = 0; spawnT = 4; building = false; gatherCD = 0;
  cam.x = player.x; cam.y = player.y;
  weather = Math.random() < 0.3 ? 'rain' : 'clear';
  toast('You wake in the woods. Find a house and barricade before nightfall.');
  toast('E: chop, mine, loot, drink  ·  C: craft  ·  B: build wall');
}

/* ============================== PARTICLES ============================== */
function burst(x, y, color, n, speed = 90, size = 2.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.5, max: 0.9, color, s: size * (0.6 + Math.random() * 0.8) });
  }
  if (parts.length > 500) parts.splice(0, parts.length - 500);
}

/* ============================== ZOMBIES ============================== */
function pickType() {
  const r = Math.random();
  if (day >= 3 && r < 0.14) return 'brute';
  if (day >= 2 && r < 0.4) return 'runner';
  return 'walker';
}
function spawnZombie() {
  const a = Math.random() * Math.PI * 2, d = 560 + Math.random() * 180;
  const x = clamp(player.x + Math.cos(a) * d, 40, WW * T - 40);
  const y = clamp(player.y + Math.sin(a) * d, 40, WH * T - 40);
  const type = pickType();
  const b = ZTYPES[type];
  if (blockedAt(x, y, b.r + 2)) return;
  const k = 1 + 0.06 * (day - 1);
  zombies.push({
    type, x, y, r: b.r, sp: b.sp * (1 + 0.02 * (day - 1)), dmg: b.dmg, cd: b.cd, col: b.col,
    hp: b.hp * k, maxHp: b.hp * k, attackCD: 0.3 + Math.random() * 0.5, flash: 0, lunge: 0,
    wob: Math.random() * 6, seed: Math.random() * 1000,
  });
}

function hurt(dmg) {
  if (state !== 'play' || player.iframe > 0) return;
  player.hp -= dmg;
  player.iframe = 0.3;
  player.flash = 0.25;
  player.lastHurt = 0;
  shake = Math.max(shake, 5);
  burst(player.x, player.y, '#8b0000', 6, 60);
  sfx.hurt();
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
}

function damageWall(tx, ty, dmg) {
  const i = idx(tx, ty);
  const hp = (world.hp.get(i) ?? 100) - dmg;
  if (hp <= 0) {
    world.obs[i] = O.NONE; world.hp.delete(i);
    burst(tx * T + T / 2, ty * T + T / 2, '#c9a66b', 14, 120);
    toast('A barricade gave way!');
  } else {
    world.hp.set(i, hp);
    burst(tx * T + T / 2, ty * T + T / 2, '#d9b47a', 3, 80);
  }
}

function moveZombie(z, mx, my, ux, uy, dt) {
  let blocked = false;
  const nx = z.x + mx, ny = z.y + my;
  if (!blockedAt(nx, z.y, z.r)) z.x = nx; else blocked = true;
  if (!blockedAt(z.x, ny, z.r)) z.y = ny; else blocked = true;
  if (!blocked) return;
  // sidestep around obstacles
  for (const s of [0.9, -0.9]) {
    const c = Math.cos(s), sn = Math.sin(s);
    const ax = (ux * c - uy * sn) * z.sp * dt, ay = (ux * sn + uy * c) * z.sp * dt;
    if (!blockedAt(z.x + ax, z.y + ay, z.r)) { z.x += ax; z.y += ay; break; }
  }
  // bang on player-built walls in the way
  if (z.attackCD <= 0) {
    const tx = Math.floor((z.x + ux * (z.r + 10)) / T), ty = Math.floor((z.y + uy * (z.r + 10)) / T);
    if (inb(tx, ty) && world.obs[idx(tx, ty)] === O.PWALL) {
      damageWall(tx, ty, z.dmg * 1.5);
      z.attackCD = z.cd; z.lunge = 1;
    }
  }
}

function updateZombies(dt) {
  for (const z of zombies) {
    z.attackCD -= dt; z.flash -= dt;
    z.wob += dt * (z.type === 'runner' ? 14 : 8);
    z.lunge = Math.max(0, z.lunge - dt * 3);
    const dx = player.x - z.x, dy = player.y - z.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;

    // separation from other zombies
    let sx = 0, sy = 0;
    for (const o of zombies) {
      if (o === z) continue;
      const ex = z.x - o.x, ey = z.y - o.y, ed2 = ex * ex + ey * ey;
      const min = (z.r + o.r) * 1.1;
      if (ed2 < min * min && ed2 > 0.01) {
        const e = Math.sqrt(ed2), k = (min - e) / min;
        sx += (ex / e) * k; sy += (ey / e) * k;
      }
    }
    let vx = ux + sx * 1.4, vy = uy + sy * 1.4;
    const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;

    if (d > z.r + player.r + 4) moveZombie(z, vx * z.sp * dt, vy * z.sp * dt, ux, uy, dt);

    if (d < z.r + player.r + 6 && z.attackCD <= 0) {
      z.attackCD = z.cd; z.lunge = 1;
      hurt(z.dmg);
    }
  }
}

function killZombie(z) {
  const i = zombies.indexOf(z);
  if (i >= 0) zombies.splice(i, 1);
  kills++;
  burst(z.x, z.y, '#7d0c0c', 18, 130, 3);
  decals.push({ x: z.x, y: z.y, r: 14 + Math.random() * 12, rot: Math.random() * 6 });
  if (decals.length > 160) decals.shift();
  if (Math.random() < 0.3) dropRandom(z.x, z.y);
  tone(90, 0.3, 0.12, 'sawtooth', 40);
}

function hitZombie(z, dmg, ang) {
  z.hp -= dmg; z.flash = 0.12;
  const nx = z.x + Math.cos(ang) * 4, ny = z.y + Math.sin(ang) * 4;
  if (!blockedAt(nx, ny, z.r)) { z.x = nx; z.y = ny; }
  burst(z.x, z.y, '#7a1010', 6, 90);
  sfx.hit();
  if (z.hp <= 0) killZombie(z);
}

/* ============================== DROPS ============================== */
function dropRandom(x, y) {
  const r = Math.random();
  const item = r < 0.35 ? 'ammo' : r < 0.5 ? 'shells' : r < 0.65 ? 'food' : r < 0.8 ? 'water' : r < 0.92 ? 'scrap' : 'medkit';
  const amt = item === 'ammo' ? RI(6, 12) : item === 'shells' ? RI(2, 4) : 1;
  drops.push({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 14, item, amt, t: Math.random() * 6 });
}
function chestLoot() {
  const out = [];
  const n = RI(2, 4);
  for (let k = 0; k < n; k++) {
    const r = Math.random();
    if (r < 0.22) out.push(['food', RI(1, 2)]);
    else if (r < 0.42) out.push(['water', RI(1, 2)]);
    else if (r < 0.6) out.push(['ammo', RI(8, 16)]);
    else if (r < 0.72) out.push(['shells', RI(2, 5)]);
    else if (r < 0.84) out.push(['scrap', RI(1, 3)]);
    else if (r < 0.94) out.push(['cloth', RI(1, 3)]);
    else out.push(['medkit', 1]);
  }
  return out;
}

/* ============================== ACTIONS ============================== */
function fire() {
  const w = WEAPONS[player.weapon];
  if (player.cool > 0 || player.reload > 0) return;
  if (w.melee) { meleeSwing(w); return; }
  if (player.mags[w.id] <= 0) {
    toast('Click. Empty. Press R to reload.');
    sfx.click(); player.cool = 0.3; return;
  }
  player.mags[w.id]--;
  player.cool = w.cd;
  player.muzzle = 0.07;
  shake = Math.max(shake, w.pellets > 1 ? 6 : 2.5);
  const ox = player.x + Math.cos(player.aim) * 22, oy = player.y + Math.sin(player.aim) * 22;
  for (let i = 0; i < w.pellets; i++) {
    const a = player.aim + (Math.random() - 0.5) * 2 * w.spread;
    bullets.push({ x: ox, y: oy, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, life: w.life, dmg: w.dmg });
  }
  // casing
  parts.push({ x: ox, y: oy, vx: -Math.sin(player.aim) * 60 + 20, vy: Math.cos(player.aim) * 60, life: 0.5, max: 0.5, color: '#e0b040', s: 1.8 });
  sfx.gun(w.loud);
}

function meleeSwing(w) {
  player.cool = w.cd; player.swing = 0.2;
  sfx.swing();
  const a0 = player.aim;
  for (const z of [...zombies]) {
    const dx = z.x - player.x, dy = z.y - player.y;
    if (Math.hypot(dx, dy) < w.range + z.r) {
      let da = Math.atan2(dy, dx) - a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < w.arc) hitZombie(z, w.dmg, a0);
    }
  }
}

function reload() {
  const w = WEAPONS[player.weapon];
  if (w.melee || player.reload > 0) return;
  const need = w.mag - player.mags[w.id];
  if (need <= 0) { toast('Magazine already full.'); return; }
  if (player.inv[w.ammo] <= 0) { toast(`No ${w.ammo === 'ammo' ? '9mm rounds' : 'shells'} left.`); return; }
  player.reload = w.reload; player.reloadW = player.weapon;
  sfx.click();
}

function finishReload() {
  const w = WEAPONS[player.reloadW];
  const need = w.mag - player.mags[w.id];
  const take = Math.min(need, player.inv[w.ammo]);
  player.mags[w.id] += take;
  player.inv[w.ammo] -= take;
}

function tileInFront(dist = 0.9) {
  return [Math.floor((player.x + Math.cos(player.aim) * T * dist) / T),
          Math.floor((player.y + Math.sin(player.aim) * T * dist) / T)];
}

function interact() {
  if (gatherCD > 0) return;
  const [fx, fy] = tileInFront();
  const cands = [[fx, fy]];
  const ptx = Math.floor(player.x / T), pty = Math.floor(player.y / T);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tx = ptx + dx, ty = pty + dy;
    if (tx === fx && ty === fy) continue;
    cands.push([tx, ty]);
  }
  for (const [tx, ty] of cands) {
    if (!inb(tx, ty)) continue;
    const i = idx(tx, ty), o = world.obs[i];
    if (o === O.TREE) {
      gatherCD = 0.3;
      let hp = (world.hp.get(i) ?? 4) - 1;
      player.inv.wood++;
      burst(tx * T + T / 2, ty * T + T / 2, '#c8a070', 5, 80);
      sfx.hit();
      if (hp <= 0) { world.obs[i] = O.NONE; world.hp.delete(i); player.inv.wood += 2; toast('Tree felled. +3 wood'); }
      else world.hp.set(i, hp);
      return;
    }
    if (o === O.ROCK) {
      gatherCD = 0.3;
      let hp = (world.hp.get(i) ?? 5) - 1;
      player.inv.stone++;
      if (Math.random() < 0.3) player.inv.scrap++;
      burst(tx * T + T / 2, ty * T + T / 2, '#c0c6cc', 6, 100);
      sfx.hit();
      if (hp <= 0) { world.obs[i] = O.NONE; world.hp.delete(i); player.inv.stone += 2; toast('Rock broken. +2 stone'); }
      else world.hp.set(i, hp);
      return;
    }
    if (o === O.BUSH) {
      gatherCD = 0.3;
      let hp = (world.hp.get(i) ?? 3) - 1;
      player.inv.cloth += RI(1, 2);
      burst(tx * T + T / 2, ty * T + T / 2, '#e8e4d8', 5, 70);
      if (hp <= 0) { world.obs[i] = O.NONE; world.hp.delete(i); }
      else world.hp.set(i, hp);
      return;
    }
    if (o === O.CHEST) {
      const c = world.chests.get(i);
      if (!c || c.looted) { toast('The chest is empty.'); return; }
      c.looted = true;
      const items = chestLoot();
      const names = [];
      for (const [k, n] of items) { player.inv[k] += n; names.push(`${n} ${ITEM_NAME[k]}`); }
      sfx.pick();
      toast(`Chest: ${names.join(', ')}`);
      return;
    }
    if (world.ground[i] === G.WATER) {
      player.thirst = Math.min(100, player.thirst + 22);
      burst(tx * T + T / 2, ty * T + T / 2, '#8fd0ff', 6, 60);
      toast('You drink from the lake. Tastes muddy. (+thirst)');
      gatherCD = 0.5;
      return;
    }
  }
  toast('Nothing to interact with here.');
}

function tryBuild() {
  const [tx, ty] = tileInFront(1.0);
  if (!inb(tx, ty)) return;
  const i = idx(tx, ty);
  const cx = tx * T + T / 2, cy = ty * T + T / 2;
  if (world.obs[i] !== O.NONE || world.ground[i] === G.WATER) { toast('Can\'t build there.'); sfx.click(); return; }
  if (Math.hypot(cx - player.x, cy - player.y) < T * 0.9) { toast('Too close to build here.'); return; }
  for (const z of zombies) if (Math.hypot(z.x - cx, z.y - cy) < z.r + T / 2) { toast('Zombie in the way!'); return; }
  if (player.inv.wood < 4) { toast('A wall costs 4 wood.'); sfx.click(); return; }
  player.inv.wood -= 4;
  world.obs[i] = O.PWALL;
  world.hp.set(i, 100);
  burst(cx, cy, '#c9a66b', 10, 100);
  sfx.build();
  toast('Barricade placed.');
}

function consume(kind) {
  if (kind === 'food') {
    if (player.inv.food <= 0) return toast('No food.');
    player.inv.food--; player.hunger = Math.min(100, player.hunger + 35); toast('Ate some canned beans. (+hunger)');
  } else if (kind === 'water') {
    if (player.inv.water <= 0) return toast('No water bottles.');
    player.inv.water--; player.thirst = Math.min(100, player.thirst + 40); toast('Drank a water bottle. (+thirst)');
  } else if (kind === 'medkit') {
    if (player.inv.medkit <= 0) return toast('No medkits.');
    player.inv.medkit--; player.hp = Math.min(100, player.hp + 45); toast('Used a medkit. (+45 HP)');
  }
  sfx.pick();
}

function craft(index) {
  const r = RECIPES[index];
  for (const k in r.need) if ((player.inv[k] || 0) < r.need[k]) { toast('Missing materials.'); return; }
  for (const k in r.need) player.inv[k] -= r.need[k];
  for (const k in r.give) player.inv[k] += r.give[k];
  sfx.pick();
  toast(`Crafted ${r.name}.`);
  renderRecipes();
}

function gameOver() {
  if (state !== 'play') return;
  state = 'over';
  const best = Math.max(day, parseInt(localStorage.getItem('deadhollow_best') || '0', 10));
  localStorage.setItem('deadhollow_best', String(best));
  document.getElementById('over-stats').innerHTML =
    `You survived <b>${day}</b> day${day === 1 ? '' : 's'} and killed <b>${kills}</b> zombies.<br>` +
    `Best run: <b>${best}</b> day${best === 1 ? '' : 's'}.`;
  showPanel('over');
}

/* ============================== UPDATE ============================== */
function update(dt) {
  if (state !== 'play') return;
  time += dt;

  // Clock & days
  hours += dt * 24 / DAY_SEC;
  if (hours >= 24) {
    hours -= 24; day++;
    weather = Math.random() < 0.3 ? 'rain' : 'clear';
    toast(`Day ${day}.${isBlood() ? ' BLOOD MOON tonight!' : ''}`);
  }

  // Movement
  let mx = 0, my = 0;
  if (keys.w || keys.arrowup) my -= 1;
  if (keys.s || keys.arrowdown) my += 1;
  if (keys.a || keys.arrowleft) mx -= 1;
  if (keys.d || keys.arrowright) mx += 1;
  const moving = mx || my;
  if (moving) { const l = Math.hypot(mx, my); mx /= l; my /= l; }
  const sprint = keys.shift && moving && player.stamina > 0;
  const sp = sprint ? 230 : 150;
  player.stamina = clamp(player.stamina + (sprint ? -35 : 22) * dt, 0, 100);
  player.moving = !!moving;
  player.bob += dt * (sprint ? 16 : 10) * (moving ? 1 : 0);
  moveEntity(player, mx * sp * dt, my * sp * dt);

  // Aim toward mouse
  const psx = (player.x - cam.x + viewW / 2) * Z, psy = (player.y - cam.y + viewH / 2) * Z;
  player.aim = Math.atan2(mouse.y - psy, mouse.x - psx);

  // Vitals
  player.hunger = clamp(player.hunger - dt * (sprint ? 0.7 : 0.45), 0, 100);
  player.thirst = clamp(player.thirst - dt * (sprint ? 0.9 : 0.6), 0, 100);
  if (player.hunger <= 0 || player.thirst <= 0) {
    player.hp -= dt * 1.5;
    if (player.hp <= 0) { player.hp = 0; gameOver(); return; }
  } else if (player.lastHurt > 5 && player.hunger > 40 && player.thirst > 40 && player.hp < 100) {
    player.hp = Math.min(100, player.hp + dt * 1.5);
  }
  player.lastHurt += dt;

  // Timers
  player.iframe -= dt; player.flash -= dt; player.cool -= dt; player.swing -= dt;
  player.muzzle -= dt; gatherCD -= dt;
  if (player.reload > 0) {
    player.reload -= dt;
    if (player.reload <= 0) { player.reload = 0; finishReload(); toast('Reloaded.'); }
  }

  // Input-driven actions
  if (mouse.pressed) {
    mouse.pressed = false;
    if (building) tryBuild(); else fire();
  }

  // Pickup drops
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.t += dt;
    if (Math.hypot(d.x - player.x, d.y - player.y) < 28) {
      player.inv[d.item] += d.amt;
      burst(d.x, d.y, ITEM_COL[d.item], 6, 60);
      toast(`+${d.amt} ${ITEM_NAME[d.item]}`);
      sfx.pick();
      drops.splice(i, 1);
    }
  }

  // Spawning
  const night = isNight();
  if (!night) {
    // stragglers wander off at dawn
    zombies = zombies.filter((z) => Math.hypot(z.x - player.x, z.y - player.y) < 900);
  }
  const blood = night && isBlood();
  const cap = night ? Math.min(60, 10 + day * 4 + (blood ? 12 : 0)) : 3;
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = (night ? (blood ? 0.9 : 1.8) : 14) * (0.6 + Math.random() * 0.8);
    if (zombies.length < cap) {
      spawnZombie();
      if (blood && Math.random() < 0.5) spawnZombie();
    }
  }

  // Zombies & growls
  updateZombies(dt);
  groanT -= dt;
  if (zombies.length && groanT <= 0 && Math.random() < 0.5) {
    sfx.groan(); groanT = 1.2 + Math.random() * 2.5;
  }

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    let dead = b.life <= 0;
    const steps = 3;
    for (let s = 0; s < steps && !dead; s++) {
      b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
      if (tileSolid(Math.floor(b.x / T), Math.floor(b.y / T))) {
        dead = true;
        burst(b.x, b.y, '#d8d0c0', 3, 60, 1.5);
        break;
      }
      for (const z of zombies) {
        if (Math.hypot(z.x - b.x, z.y - b.y) < z.r + 2) {
          hitZombie(z, b.dmg, Math.atan2(b.vy, b.vx));
          dead = true; break;
        }
      }
    }
    if (dead) bullets.splice(i, 1);
  }

  // Particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.9; p.vy *= 0.9;
    if (p.life <= 0) parts.splice(i, 1);
  }

  // Toasts
  for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].t -= dt; if (toasts[i].t <= 0) toasts.splice(i, 1); }

  // Camera
  const k = Math.min(1, dt * 9);
  cam.x += (player.x - cam.x) * k;
  cam.y += (player.y - cam.y) * k;
  shake = Math.max(0, shake - dt * 30);
}

/* ============================== RENDER ============================== */
function renderWorld() {
  const shx = (Math.random() - 0.5) * shake, shy = (Math.random() - 0.5) * shake;
  ctx.setTransform(dpr * Z, 0, 0, dpr * Z, 0, 0);
  ctx.translate(viewW / 2 - cam.x + shx, viewH / 2 - cam.y + shy);

  const L = cam.x - viewW / 2 - T, R = cam.x + viewW / 2 + T;
  const Tp = cam.y - viewH / 2 - T, B = cam.y + viewH / 2 + T;
  const tx0 = clamp(Math.floor(L / T), 0, WW - 1), tx1 = clamp(Math.floor(R / T), 0, WW - 1);
  const ty0 = clamp(Math.floor(Tp / T), 0, WH - 1), ty1 = clamp(Math.floor(B / T), 0, WH - 1);

  // Ground pass
  const frame = Math.floor(time * 2) % 2;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const i = idx(tx, ty), g = world.ground[i], o = world.obs[i];
    const x = tx * T, y = ty * T;
    let s;
    if (g === G.WATER) s = SPR.water[frame];
    else if (g === G.SAND) s = SPR.sand;
    else if (g === G.DIRT) s = SPR.dirt[(tx * 7 + ty * 3) % 2];
    else s = SPR.grass[(tx * 13 + ty * 7) % 3];
    blit(s, x, y);
    if (o === O.FLOOR) blit(SPR.floor, x, y);
    else if (o === O.DOOR) blit(SPR.door, x, y);
  }

  // Decals
  for (const d of decals) {
    ctx.save();
    ctx.translate(d.x, d.y); ctx.rotate(d.rot);
    ctx.fillStyle = 'rgba(90,6,6,.55)';
    ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(120,10,10,.35)';
    ctx.beginPath(); ctx.ellipse(d.r * 0.3, -d.r * 0.2, d.r * 0.5, d.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Ground drops (glowing)
  for (const d of drops) {
    const bob = Math.sin(d.t * 4) * 2;
    const col = ITEM_COL[d.item];
    const grd = ctx.createRadialGradient(d.x, d.y + bob, 0, d.x, d.y + bob, 16);
    grd.addColorStop(0, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55; ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(d.x, d.y + bob, 16, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(d.x, d.y + bob, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  // Depth-sorted pass
  const items = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const i = idx(tx, ty), o = world.obs[i];
    if (o === O.NONE || o === O.FLOOR || o === O.DOOR) continue;
    items.push({ y: (ty + 1) * T, k: 0, tx, ty, o });
  }
  for (const z of zombies) if (z.x > L - 60 && z.x < R + 60 && z.y > Tp - 60 && z.y < B + 60) items.push({ y: z.y, k: 1, e: z });
  items.push({ y: player.y, k: 2 });
  items.sort((a, b) => a.y - b.y);

  for (const it of items) {
    if (it.k === 0) drawObstacle(it.tx, it.ty, it.o);
    else if (it.k === 1) drawZombie(it.e);
    else drawPlayer();
  }

  // Bullets (tracers)
  ctx.lineCap = 'round';
  for (const b of bullets) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const tl = 14;
    const grd = ctx.createLinearGradient(b.x, b.y, b.x - b.vx / sp * tl, b.y - b.vy / sp * tl);
    grd.addColorStop(0, 'rgba(255,240,190,.95)'); grd.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.strokeStyle = grd; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx / sp * tl, b.y - b.vy / sp * tl); ctx.stroke();
  }

  // Particles
  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
  }
  ctx.globalAlpha = 1;

  // Build ghost
  if (building && state === 'play') {
    const [tx, ty] = tileInFront(1.0);
    if (inb(tx, ty)) {
      const ok = world.obs[idx(tx, ty)] === O.NONE && world.ground[idx(tx, ty)] !== G.WATER && player.inv.wood >= 4;
      ctx.fillStyle = ok ? 'rgba(120,255,140,.28)' : 'rgba(255,80,80,.28)';
      ctx.strokeStyle = ok ? 'rgba(160,255,170,.9)' : 'rgba(255,110,110,.9)';
      ctx.lineWidth = 2;
      ctx.fillRect(tx * T + 2, ty * T + 2, T - 4, T - 4);
      ctx.strokeRect(tx * T + 2, ty * T + 2, T - 4, T - 4);
    }
  }
}

function drawObstacle(tx, ty, o) {
  const x = tx * T, y = ty * T, bottom = y + T;
  const v = (tx * 31 + ty * 17) % 3;
  switch (o) {
    case O.TREE: {
      const s = SPR.trees[v];
      blit(s, x + T / 2 - s.w / 2, bottom - s.h + 14);
      break;
    }
    case O.ROCK: {
      const s = SPR.rocks[v % 2];
      blit(s, x + T / 2 - s.w / 2, bottom - s.h + 8);
      break;
    }
    case O.BUSH: {
      const s = SPR.bush;
      blit(s, x + T / 2 - s.w / 2, bottom - s.h + 8);
      break;
    }
    case O.HWALL: blit(SPR.hwall, x, y); break;
    case O.PWALL: {
      blit(SPR.pwall, x, y);
      const hp = world.hp.get(idx(tx, ty)) ?? 100;
      if (hp < 100) {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x + 6, y - 6, T - 12, 4);
        ctx.fillStyle = '#e8b14a'; ctx.fillRect(x + 6, y - 6, (T - 12) * (hp / 100), 4);
      }
      break;
    }
    case O.CHEST: {
      const c = world.chests.get(idx(tx, ty));
      const s = c && c.looted ? SPR.chestOpen : SPR.chest;
      blit(s, x + 3, bottom - s.h + 6);
      break;
    }
  }
}

function drawZombie(z) {
  const ang = Math.atan2(player.y - z.y, player.x - z.x);
  const dark = nightAmt() > 0.5;
  ctx.save();
  ctx.translate(z.x, z.y);
  shadowEl(ctx, 2, 6, z.r * 1.05, z.r * 0.55, 0.32);
  ctx.rotate(ang);
  const wob = Math.sin(z.wob) * 1.2;
  const lunge = z.lunge * 5;
  // arms
  ctx.strokeStyle = z.col; ctx.lineWidth = z.r * 0.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -z.r * 0.55); ctx.lineTo(z.r * 1.25 + lunge, -z.r * 0.35 + wob); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, z.r * 0.55); ctx.lineTo(z.r * 1.25 + lunge, z.r * 0.35 - wob); ctx.stroke();
  // torso
  ctx.fillStyle = z.col;
  ctx.beginPath(); ctx.ellipse(0, 0, z.r * 0.95, z.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  // tattered shirt detail
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(-z.r * 0.2, z.r * 0.25, z.r * 0.35, z.r * 0.18, 0.4, 0, 7); ctx.fill();
  // blood stains
  ctx.fillStyle = 'rgba(110,10,10,.7)';
  ctx.beginPath(); ctx.arc(((z.seed % 7) - 3) * 1.3, ((z.seed % 5) - 2) * 2, z.r * 0.22, 0, 7); ctx.fill();
  // head
  const hx = z.r * 0.45 + lunge * 0.4;
  ctx.fillStyle = '#7a8d6a';
  ctx.beginPath(); ctx.arc(hx, 0, z.r * 0.6, 0, Math.PI * 2); ctx.fill();
  // eyes
  ctx.fillStyle = dark ? '#ff3b30' : '#2b1010';
  ctx.beginPath(); ctx.arc(hx + z.r * 0.25, -z.r * 0.25, z.r * 0.13, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + z.r * 0.25, z.r * 0.25, z.r * 0.13, 0, 7); ctx.fill();
  if (dark) { // eye glow
    ctx.fillStyle = 'rgba(255,60,50,.35)';
    ctx.beginPath(); ctx.arc(hx + z.r * 0.25, 0, z.r * 0.5, 0, 7); ctx.fill();
  }
  if (z.flash > 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath(); ctx.ellipse(0, 0, z.r, z.r, 0, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  // health bar
  if (z.hp < z.maxHp) {
    const w = z.r * 2.2;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(z.x - w / 2, z.y - z.r - 12, w, 4);
    ctx.fillStyle = '#d33'; ctx.fillRect(z.x - w / 2, z.y - z.r - 12, w * clamp(z.hp / z.maxHp, 0, 1), 4);
  }
}

function drawPlayer() {
  const a = player.aim;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.scale(1.3, 1.3);
  shadowEl(ctx, 2, 6, 14, 7, 0.4);
  ctx.rotate(a);
  const bob = player.moving ? Math.sin(player.bob) * 1.3 : 0;
  // backpack
  ctx.fillStyle = '#4a3b26';
  ctx.beginPath(); ctx.ellipse(-6, 0, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b5636';
  ctx.beginPath(); ctx.ellipse(-7, 0, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
  // weapon
  const w = WEAPONS[player.weapon];
  if (w.melee) {
    const sw = player.swing > 0 ? Math.sin((player.swing / 0.2) * Math.PI) : 0;
    ctx.save();
    ctx.rotate(-0.8 + sw * 1.6);
    ctx.fillStyle = '#5a3d25'; ctx.fillRect(8, -2, 6, 4);
    ctx.fillStyle = '#c8ced6'; ctx.beginPath(); ctx.moveTo(14, -2); ctx.lineTo(28, -1); ctx.lineTo(14, 2); ctx.fill();
    ctx.restore();
    if (player.swing > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, 40, -1.2 + (1 - player.swing / 0.2) * 1.2, -1.2 + (1 - player.swing / 0.2) * 1.2 + 0.4); ctx.stroke();
    }
  } else if (w.id === 'pistol') {
    ctx.fillStyle = '#2b2f36'; ctx.fillRect(6, -3, 18, 6);
    ctx.fillStyle = '#1a1c20'; ctx.fillRect(22, -2, 4, 4);
    ctx.fillStyle = '#4b3523'; ctx.fillRect(8, 2, 4, 5);
  } else {
    ctx.fillStyle = '#5a3d25'; ctx.fillRect(4, -3, 26, 6);
    ctx.fillStyle = '#2b2f36'; ctx.fillRect(14, -2.5, 20, 5);
    ctx.fillStyle = '#8a6a44'; ctx.fillRect(0, -3.5, 6, 7);
  }
  // hands
  ctx.fillStyle = '#e0b08a';
  ctx.beginPath(); ctx.arc(8, -7 + bob * 0.3, 3.2, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(8, 7 - bob * 0.3, 3.2, 0, 7); ctx.fill();
  // body (jacket)
  const grd = ctx.createRadialGradient(-2, -3, 2, 0, 0, 13);
  grd.addColorStop(0, '#4f6d86'); grd.addColorStop(1, '#2a3e52');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 9.5, 0, 0, Math.PI * 2); ctx.fill();
  // head
  ctx.fillStyle = '#e0b08a';
  ctx.beginPath(); ctx.arc(2, 0, 6.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2d2016';
  ctx.beginPath(); ctx.arc(1, 0, 6.8, Math.PI * 0.6, Math.PI * 1.6); ctx.fill();
  // muzzle flash
  if (player.muzzle > 0) {
    ctx.fillStyle = 'rgba(255,220,120,.95)';
    ctx.beginPath(); ctx.moveTo(w.id === 'shotgun' ? 46 : 30, 0);
    ctx.lineTo(w.id === 'shotgun' ? 58 : 40, -6); ctx.lineTo(w.id === 'shotgun' ? 58 : 40, 6); ctx.fill();
  }
  ctx.restore();
  if (player.flash > 0) {
    ctx.save(); ctx.translate(player.x, player.y);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(255,30,30,${player.flash * 1.4})`;
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill();
    ctx.restore();
  }
}

function renderLight() {
  const na = nightAmt();
  const px = (player.x - cam.x + viewW / 2) * Z * dpr, py = (player.y - cam.y + viewH / 2) * Z * dpr;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, lc.width, lc.height);
  if (na > 0.01) {
    lctx.fillStyle = isBlood() ? `rgba(70,8,12,${0.9 * na})` : `rgba(6,10,30,${0.88 * na})`;
    lctx.fillRect(0, 0, lc.width, lc.height);
    lctx.globalCompositeOperation = 'destination-out';
    const R = 240 * Z * dpr;
    const grd = lctx.createRadialGradient(px, py, 0, px, py, R);
    grd.addColorStop(0, `rgba(0,0,0,${na})`);
    grd.addColorStop(0.45, `rgba(0,0,0,${0.85 * na})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = grd;
    lctx.beginPath(); lctx.arc(px, py, R, 0, Math.PI * 2); lctx.fill();
    // small inner ambient around player
    const r2 = 70 * Z * dpr;
    const g2 = lctx.createRadialGradient(px, py, 0, px, py, r2);
    g2.addColorStop(0, `rgba(0,0,0,${0.6 * na})`); g2.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = g2; lctx.beginPath(); lctx.arc(px, py, r2, 0, Math.PI * 2); lctx.fill();
  }
  lctx.globalCompositeOperation = 'lighter';
  if (player.muzzle > 0) {
    const mx = px + Math.cos(player.aim) * 40 * Z * dpr, my = py + Math.sin(player.aim) * 40 * Z * dpr;
    const g = lctx.createRadialGradient(mx, my, 0, mx, my, 150 * Z * dpr);
    g.addColorStop(0, 'rgba(255,170,80,.9)'); g.addColorStop(1, 'rgba(255,170,80,0)');
    lctx.fillStyle = g; lctx.beginPath(); lctx.arc(mx, my, 150 * Z * dpr, 0, 7); lctx.fill();
  }
  lctx.globalCompositeOperation = 'source-over';

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lc, 0, 0);

  // dawn/dusk warmth
  const sun = sunsetAmt();
  if (sun > 0.01) {
    ctx.fillStyle = `rgba(255,150,70,${0.12 * sun})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function renderScreenFX() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // rain
  if (weather === 'rain') {
    ctx.strokeStyle = 'rgba(190,210,255,.35)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 160; i++) {
      const x = (i * 97.3 + time * 180 * (0.8 + (i % 5) * 0.06)) % (cssW + 40) - 20;
      const y = (i * 53.7 + time * 900 * (0.9 + (i % 3) * 0.05)) % (cssH + 40) - 20;
      ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 12);
    }
    ctx.stroke();
  }
  // vignette
  const low = player.hp < 35 ? (0.5 + 0.5 * Math.sin(time * 6)) * (1 - player.hp / 35) : 0;
  const vg = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${0.5 + low * 0.3})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, cssW, cssH);
  if (low > 0) {
    const rg = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.3, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.7);
    rg.addColorStop(0, 'rgba(160,0,0,0)'); rg.addColorStop(1, `rgba(160,0,0,${low * 0.45})`);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, cssW, cssH);
  }
  if (player.flash > 0) {
    ctx.fillStyle = `rgba(200,0,0,${player.flash * 0.35})`;
    ctx.fillRect(0, 0, cssW, cssH);
  }
}

function drawBar(x, y, w, h, v, max, col, label) {
  ctx.fillStyle = 'rgba(0,0,0,.55)'; rr(ctx, x, y, w, h, 6); ctx.fill();
  ctx.fillStyle = col; rr(ctx, x + 2, y + 2, Math.max(0, (w - 4) * clamp(v / max, 0, 1)), h - 4, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 8, y + h / 2);
  ctx.textAlign = 'right';
  ctx.fillText(Math.ceil(v), x + w - 8, y + h / 2);
  ctx.textAlign = 'left';
}

function renderHUD() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;
  ctx.textBaseline = 'middle';

  // Vitals
  const bx = 20, bw = 210, bh = 22;
  let by = H - 20 - bh * 4 - 12 * 3;
  drawBar(bx, by, bw, bh, player.hp, 100, '#d93a3f', 'HEALTH'); by += bh + 6;
  drawBar(bx, by, bw, bh, player.hunger, 100, '#e8922d', 'FOOD'); by += bh + 6;
  drawBar(bx, by, bw, bh, player.thirst, 100, '#3c9de0', 'WATER'); by += bh + 6;
  drawBar(bx, by, bw, bh, player.stamina, 100, '#e7cf45', 'STAMINA');

  // Hotbar
  const slots = WEAPONS.map((w, i) => {
    let sub;
    if (w.melee) sub = 'Melee';
    else sub = `${player.mags[w.id]} / ${player.inv[w.ammo]}`;
    return { name: w.name, sub, sel: i === player.weapon, key: i + 1 };
  });
  const sw = 150, sh = 52, gap = 10;
  const total = slots.length * sw + (slots.length - 1) * gap;
  let sx = W / 2 - total / 2;
  const sy = H - sh - 22;
  for (const s of slots) {
    ctx.fillStyle = s.sel ? 'rgba(232,71,63,.35)' : 'rgba(0,0,0,.55)';
    rr(ctx, sx, sy, sw, sh, 8); ctx.fill();
    ctx.strokeStyle = s.sel ? '#e8473f' : 'rgba(255,255,255,.15)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(`${s.key}  ${s.name}`, sx + 10, sy + 16);
    ctx.fillStyle = '#c9d0da'; ctx.font = '600 13px ui-monospace, Menlo, monospace';
    ctx.fillText(s.sub, sx + 10, sy + 37);
    sx += sw + gap;
  }
  if (player.reload > 0) {
    const w = WEAPONS[player.reloadW];
    const pct = 1 - player.reload / w.reload;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; rr(ctx, W / 2 - total / 2, sy - 12, total, 6, 3); ctx.fill();
    ctx.fillStyle = '#e7cf45'; rr(ctx, W / 2 - total / 2 + 1, sy - 11, (total - 2) * pct, 4, 2); ctx.fill();
  }

  // Items row
  const items = ['wood', 'stone', 'cloth', 'scrap', 'food', 'water', 'medkit'];
  ctx.font = '600 13px system-ui, sans-serif';
  const parts2 = items.map((k) => `${ITEM_NAME[k]} ${player.inv[k]}`);
  const rowText = parts2.join('   ·   ');
  const rw = ctx.measureText(rowText).width + 28;
  const rx = W / 2 - rw / 2, ry = sy - 36;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; rr(ctx, rx, ry, rw, 26, 8); ctx.fill();
  ctx.textAlign = 'left';
  let tx = rx + 14;
  items.forEach((k, idx2) => {
    ctx.fillStyle = ITEM_COL[k]; ctx.beginPath(); ctx.arc(tx + 4, ry + 13, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#e6eaf0';
    const t = `${ITEM_NAME[k]} ${player.inv[k]}`;
    ctx.fillText(t, tx + 12, ry + 13);
    tx += ctx.measureText(t).width + 12 + (idx2 < items.length - 1 ? 18 : 0);
    if (idx2 < items.length - 1) { ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(tx - 9, ry + 6, 1, 14); }
  });

  // Top-right status
  const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
  const lines = [
    `DAY ${day}`,
    `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}  ${isNight() ? 'NIGHT' : 'DAYLIGHT'}`,
    `${weather === 'rain' ? 'Rain' : 'Clear'}${isBlood() && isNight() ? ' · BLOOD MOON' : ''}`,
    `Kills ${kills}   Zombies ${zombies.length}`,
  ];
  ctx.textAlign = 'right';
  lines.forEach((ln, i) => {
    ctx.font = i === 0 ? '800 22px system-ui, sans-serif' : '600 13px system-ui, sans-serif';
    const w = ctx.measureText(ln).width + 20;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    rr(ctx, W - 20 - w, 18 + i * (i === 0 ? 34 : 22), w, i === 0 ? 30 : 20, 6); ctx.fill();
    ctx.fillStyle = (i === 2 && isBlood() && isNight()) ? '#ff6b5a' : '#f2f4f8';
    ctx.fillText(ln, W - 30, 18 + i * (i === 0 ? 34 : 22) + (i === 0 ? 15 : 10));
  });
  ctx.textAlign = 'left';

  // Toasts (top-left)
  let ty = 18;
  ctx.font = '600 14px system-ui, sans-serif';
  for (const t of toasts) {
    const a = clamp(t.t, 0, 1);
    const w = ctx.measureText(t.text).width + 24;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; rr(ctx, 18, ty, w, 28, 6); ctx.fill();
    ctx.fillStyle = '#f2f4f8'; ctx.fillText(t.text, 30, ty + 14);
    ctx.globalAlpha = 1;
    ty += 34;
  }

  // Hints
  const hint = building ? 'BUILD MODE — click to place a barricade (4 wood) · B to exit'
    : (isNight() ? 'Night. Get inside and barricade. The dead are hungry.' : 'E interact · C craft · B build · G/H/J use items');
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillText(hint, W / 2, H - 8);
  ctx.textAlign = 'left';

  // Crosshair
  if (state === 'play') {
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
    const cx = mouse.x, cy = mouse.y, g = 7;
    ctx.beginPath();
    ctx.moveTo(cx - g - 4, cy); ctx.lineTo(cx - g, cy);
    ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + 4, cy);
    ctx.moveTo(cx, cy - g - 4); ctx.lineTo(cx, cy - g);
    ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + 4);
    ctx.stroke();
  }
}

/* ============================== MINIMAP ============================== */
const mmCanvas = document.createElement('canvas');
mmCanvas.width = WW; mmCanvas.height = WH;
const mmCtx = mmCanvas.getContext('2d');
let mmLast = -99;
const MM_COL = { grass: [77, 125, 57], dirt: [123, 91, 59], sand: [205, 182, 126], water: [36, 96, 140] };
const OBS_COL = { 1: [30, 72, 36], 2: [125, 130, 138], 3: [110, 90, 70], 4: [200, 160, 110], 5: [140, 105, 70], 6: [70, 110, 50], 7: [160, 120, 80], 8: [230, 184, 74] };

function buildMinimap() {
  const img = mmCtx.createImageData(WW, WH);
  for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) {
    const i = idx(x, y), g = world.ground[i], o = world.obs[i];
    let c;
    if (g === G.WATER) c = MM_COL.water;
    else if (g === G.SAND) c = MM_COL.sand;
    else if (g === G.DIRT) c = MM_COL.dirt;
    else c = MM_COL.grass;
    if (o !== O.NONE && OBS_COL[o]) c = OBS_COL[o];
    const p = i * 4;
    img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
  }
  mmCtx.putImageData(img, 0, 0);
}

function renderMinimap() {
  if (time - mmLast > 0.5) { buildMinimap(); mmLast = time; }
  const size = 170, W = cssW, H = cssH;
  const x0 = W - size - 20, y0 = H - size - 20;
  ctx.fillStyle = 'rgba(0,0,0,.6)'; rr(ctx, x0 - 6, y0 - 6, size + 12, size + 12, 10); ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mmCanvas, x0, y0, size, size);
  ctx.imageSmoothingEnabled = true;
  const s = size / WW;   // minimap px per tile
  const toMM = (px) => x0 + (px / T) * s, toMMy = (py) => y0 + (py / T) * s;
  ctx.fillStyle = '#ff4a3d';
  for (const z of zombies) { ctx.beginPath(); ctx.arc(toMM(z.x), toMMy(z.y), 2, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(toMM(player.x), toMMy(player.y), 3.5, 0, 7); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(toMM(player.x), toMMy(player.y));
  ctx.lineTo(toMM(player.x) + Math.cos(player.aim) * 8, toMMy(player.y) + Math.sin(player.aim) * 8); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.strokeRect(x0, y0, size, size);
}

function render() {
  if (!world) return;
  renderWorld();
  renderLight();
  renderScreenFX();
  renderHUD();
  renderMinimap();
}

/* ============================== UI / INPUT ============================== */
function showPanel(id) {
  for (const p of document.querySelectorAll('#ui .panel')) p.classList.remove('show');
  if (id) document.getElementById(id).classList.add('show');
  document.getElementById('ui').style.pointerEvents = id ? 'auto' : 'none';
}

function renderRecipes() {
  const box = document.getElementById('recipes');
  box.innerHTML = '';
  RECIPES.forEach((r, i) => {
    const can = Object.keys(r.need).every((k) => player.inv[k] >= r.need[k]);
    const cost = Object.keys(r.need).map((k) => `${r.need[k]} ${ITEM_NAME[k]}`).join(', ') || 'free';
    const row = document.createElement('div');
    row.className = 'recipe';
    row.innerHTML = `<div><div class="name">${r.name}</div><div class="meta">${r.desc} · needs ${cost}</div></div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Craft';
    btn.disabled = !can;
    btn.addEventListener('click', () => craft(i));
    row.appendChild(btn);
    box.appendChild(row);
  });
}

function openCraft() { renderRecipes(); state = 'craft'; showPanel('craft'); }
function closeCraft() { state = 'play'; showPanel(null); }
function startPlay() {
  ac();
  state = 'play';
  showPanel(null);
}
function restart() {
  newGame();
  startPlay();
}

document.getElementById('btn-start').addEventListener('click', () => { restart(); });
document.getElementById('btn-resume').addEventListener('click', () => { startPlay(); });
document.getElementById('btn-restart2').addEventListener('click', () => { restart(); });
document.getElementById('btn-restart').addEventListener('click', () => { restart(); });
document.getElementById('btn-craftclose').addEventListener('click', () => { closeCraft(); });

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
  keys[k] = true;
  keys.shift = e.shiftKey;
  if (e.repeat) return;

  if (state === 'menu' && (k === 'enter' || k === ' ')) { restart(); return; }
  if (state === 'over' && (k === 'enter' || k === 'r')) { restart(); return; }
  if (k === 'm') { muted = !muted; toast(muted ? 'Sound muted' : 'Sound on'); return; }

  if (state === 'play') {
    switch (k) {
      case 'escape': state = 'pause'; showPanel('pause'); return;
      case 'c': openCraft(); return;
      case 'b': building = !building; toast(building ? 'Build mode: click to place barricades.' : 'Build mode off.'); return;
      case 'e': interact(); return;
      case 'r': reload(); return;
      case '1': case '2': case '3': selectWeapon(parseInt(k, 10) - 1); return;
      case 'g': consume('food'); return;
      case 'h': consume('water'); return;
      case 'j': consume('medkit'); return;
    }
  } else if (state === 'craft') {
    if (k === 'c' || k === 'escape') { closeCraft(); return; }
  } else if (state === 'pause') {
    if (k === 'escape') startPlay();
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  keys.shift = e.shiftKey;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function selectWeapon(i) {
  if (i === player.weapon) return;
  player.weapon = i; player.reload = 0; player.cool = 0.15;
  sfx.click();
}

canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  ac();
  if (e.button === 0 && state === 'play') mouse.pressed = true;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  const n = WEAPONS.length;
  selectWeapon((player.weapon + (e.deltaY > 0 ? 1 : n - 1)) % n);
}, { passive: true });

/* ============================== LOOP ============================== */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try { update(dt); } catch (err) { console.error(err); }
  try { render(); } catch (err) { console.error(err); }
  requestAnimationFrame(frame);
}

makeSprites();
newGame();
state = 'menu';
showPanel('menu');
mouse.x = cssW / 2; mouse.y = cssH / 2;
requestAnimationFrame((t) => { last = t; frame(t); });
})();
