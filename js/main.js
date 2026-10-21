import * as THREE from './vendor/three.module.min.js';
import { generateLevel, levelKind, COLORS, TYPES, MAX_LEVEL, ROW_HALF_W } from './levels.js';
import { makeOBB, sweepDistance, roundedPath, samplePath, lerpAngle, dirVec } from './geom.js';
import { buildVehicle, setVehicleColor, buildCrowd, makeLabel, buildWorld, computeLayout, MYSTERY_HEX, themeFor } from './models.js';
import { buildTrack, laneOffset, PER_RANK, makeRing, cellAt } from './track.js';
import { sfx, unlockAudio, setSoundEnabled, setMusicEnabled } from './audio.js';

// ---------------- Save data ----------------
// Economy: coins come only from winning levels (no ads, no purchases). Each level starts with
// 4 regular spots; the 3 extra spots cost coins and reset when the level ends.
const ECON = {
  startCoins: 100,
  reward: { normal: 20, hard: 40, super: 60 },
  replayReward: 5,
  price: { spot: 50, vip: 120, arrange: 90, jumble: 80 },
  unlockLevel: { jumble: 6, arrange: 8, vip: 11 },
  freeOnUnlock: 2,
};
const SAVE_KEY = 'busparty-save-v2';
const RUN_KEY = 'busparty-run-v2';
const save = loadSave();
function loadSave() {
  const def = {
    level: 1, coins: ECON.startCoins, boosters: { vip: 0, arrange: 0, jumble: 0 }, unlocked: { vip: false, arrange: false, jumble: false },
    cleared: {}, sound: true, music: true, vibrate: true, seenTips: {},
  };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') {
      const out = { ...def, ...s, boosters: { ...def.boosters, ...s.boosters }, unlocked: { ...def.unlocked, ...s.unlocked },
        cleared: { ...s.cleared }, seenTips: { ...s.seenTips } };
      // Older saves called Jumble "shuffle".
      if (out.boosters.shuffle) { out.boosters.jumble += out.boosters.shuffle; }
      if (out.unlocked.shuffle) out.unlocked.jumble = true;
      delete out.boosters.shuffle;
      delete out.unlocked.shuffle;
      return out;
    }
    const old = JSON.parse(localStorage.getItem('busparty-save-v1'));
    if (old && typeof old === 'object') {
      def.level = Math.max(1, Math.min(MAX_LEVEL, old.level | 0 || 1));
      def.coins = Math.max(0, old.coins | 0);
      for (let i = 1; i < def.level; i++) def.cleared[i] = true;
    }
  } catch (e) { /* ignore */ }
  return def;
}
// Set just before a deliberate reload so save-on-close doesn't write old data back.
let reloading = false;
function persist() {
  if (reloading) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}
function askPersistentStorage() {
  try { navigator.storage?.persist?.(); } catch (e) { /* ignore */ }
}
function showCoins() {
  for (const el of document.querySelectorAll('.coinCount')) el.textContent = save.coins;
}
function addCoins(n) {
  save.coins = Math.max(0, save.coins + n);
  persist();
  showCoins();
}
setSoundEnabled(save.sound);
setMusicEnabled(save.music);

const EXTRA_SLOTS = 3;
const TICK = 0.12; // seconds per step of the rotating loop
const canVibrate = typeof navigator.vibrate === 'function';
function buzz(ms) {
  if (save.vibrate && canVibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

// ---------------- Renderer & scene ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf7dcd8);
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0c8, 1.5));
const sun = new THREE.DirectionalLight(0xfff6ea, 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun);
scene.add(sun.target);

// ---------------- Game state ----------------
let G = null;
const raycaster = new THREE.Raycaster();
const $ = (id) => document.getElementById(id);
const ui = {};
for (const id of ['hud', 'levelLabel', 'levelBadge', 'boosters', 'toast', 'vipBanner', 'mood', 'restartTop', 'pauseBtn',
  'home', 'homeLevel', 'playBtn', 'levelsBtn', 'levels', 'levelGrid', 'levelsClose', 'win', 'winCoins', 'winNote',
  'winNext', 'winTitle', 'lose', 'loseSpot', 'loseRetry', 'loseSpotPrice', 'loseVip', 'loseVipPrice', 'settings',
  'soundToggle', 'musicToggle', 'vibeToggle', 'settingsClose', 'homeBtn', 'resetBtn', 'tutorial', 'tutText', 'hand',
  'confetti', 'tip', 'tipTitle', 'tipText', 'tipOk', 'buy', 'buyTitle', 'buyText', 'buyOk', 'buyCancel', 'homeSettings']) {
  ui[id] = $(id);
}

function fitCamera() {
  if (!G) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const L = G.layout;
  const xs = Math.max(L.hw + 0.35, ROW_HALF_W + 0.15);
  const top = L.gate.z - G.track.rz * 2 - 0.55;
  const pts = [];
  for (const x of [-xs, xs]) {
    pts.push(new THREE.Vector3(x, 0, L.hh + 0.35), new THREE.Vector3(x, 0, top), new THREE.Vector3(x, 0.6, L.hh + 0.35));
  }
  const css = getComputedStyle(document.documentElement);
  const safeTop = parseFloat(css.getPropertyValue('--sat')) || 0;
  const safeBot = parseFloat(css.getPropertyValue('--sab')) || 0;
  const topPx = 18 + safeTop, botPx = 128 + safeBot;
  const yTop = 1 - (2 * topPx) / h, yBot = -1 + (2 * botPx) / h;
  const elev = THREE.MathUtils.degToRad(w / h > 0.8 ? 58 : 66);
  const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
  const target = new THREE.Vector3(0, 0, (L.hh + top) / 2);
  const fits = (dist) => {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let minY = Infinity, maxY = -Infinity, ok = true;
    for (const p of pts) {
      const q = p.clone().project(camera);
      if (Math.abs(q.x) > 0.985) ok = false;
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    if (maxY - minY > yTop - yBot) ok = false;
    return { ok, minY, maxY };
  };
  const fitDist = () => {
    let lo = 5, hi = 140;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid).ok) hi = mid; else lo = mid;
    }
    return hi;
  };
  for (let pass = 0; pass < 4; pass++) {
    const dist = fitDist();
    const r = fits(dist);
    const want = (yTop + yBot) / 2, have = (r.minY + r.maxY) / 2;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    target.z -= ((have - want) * halfH) / Math.sin(elev);
  }
  fits(fitDist());
  const ext = Math.max(xs, (L.hh - top) / 2) + 3;
  sun.position.set(target.x - 6, 20, target.z + 8);
  sun.target.position.copy(target);
  const sc = sun.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 60;
  sc.updateProjectionMatrix();
}
window.addEventListener('resize', () => setTimeout(fitCamera, 50));

// ---------------- Level setup ----------------
function clearLevel() {
  if (!G) return;
  scene.remove(G.root);
  G.root.traverse((o) => {
    if (o.isSprite && o.material.map) o.material.map.dispose();
  });
  G = null;
}

function loadLevel(n, run = null) {
  clearLevel();
  const level = generateLevel(n);
  const maxSlots = level.slots + EXTRA_SLOTS;
  const layout = computeLayout(level, maxSlots);
  const track = buildTrack(level.style, layout.gate, ROW_HALF_W, layout.gate.z - 4.5);
  scene.background = new THREE.Color(themeFor(n).sky);
  const root = new THREE.Group();
  scene.add(root);
  if (run && (run.n !== n || run.vs.length !== level.vehicles.length || run.ring.cells.length !== track.ranks)) run = null;

  G = {
    n, level, layout, track, root, maxSlots,
    unlocked: run ? Math.min(maxSlots, Math.max(level.slots, run.unlocked | 0)) : level.slots,
    slots: new Array(maxSlots + 1).fill(null), // last entry is the VIP spot
    vehicles: [],
    people: [],
    ring: makeRing(track.ranks),
    arms: [],
    walkers: [],
    boarded: 0,
    total: level.total,
    tapCounter: 0,
    state: 'playing',
    stuckT: 0,
    winT: 0,
    tickT: 0,
    vip: false,
    time: 0,
  };

  const world = buildWorld(level, layout, track, maxSlots, G.unlocked, n * 977 + 13);
  root.add(world.group);
  G.bays = world.bays;
  // Invisible tap targets for the locked spots.
  G.bayHits = world.bays.filter((b) => !b.isVip).map((b) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(layout.bayW - 0.1, 0.4, layout.bayLen), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(b.x, 0.2, (layout.rowTop + layout.rowBottom) / 2);
    hit.userData.slot = b.slotIndex;
    root.add(hit);
    return hit;
  });

  for (const d of level.vehicles) {
    const t = TYPES[d.type];
    const a = (d.dir * Math.PI) / 4;
    const m = buildVehicle(d.type, d.mystery ? MYSTERY_HEX : COLORS[d.color].hex);
    m.root.position.set(d.x, 0.04, d.z);
    m.root.rotation.y = -a;
    root.add(m.root);
    const v = {
      id: d.id, type: d.type, seats: t.seats, color: d.color, mystery: d.mystery,
      x: d.x, z: d.z, a, obb: makeOBB(d.x, d.z, a, t.len / 2, t.wid / 2),
      state: 'lot', slot: -1, tapOrder: 0, filled: 0, incoming: 0,
      m, shake: 0, label: null, q: null, rollV: 0,
    };
    m.hit.userData.vehicle = v;
    if (d.mystery) {
      v.q = makeLabel('?', { w: 0.9, bg: 'rgba(255,255,255,0.97)', fg: '#4a5163', size: 96, border: '#8b93a5' });
      v.q.position.set(0, m.roofY + 0.35, 0);
      m.root.add(v.q);
    }
    G.vehicles.push(v);
  }

  // Crowd: one instance per passenger still waiting.
  G.crowd = buildCrowd(level.total + 4);
  root.add(G.crowd.group);
  const ringColors = run ? run.ring : level.ring;
  const armColors = run ? run.arms : level.arms;
  G.ring.offset = ringColors.offset | 0;
  let idx = 0;
  const person = (color, mode) => {
    const p = { color, i: idx++, x: 0, z: 0, ry: 0, walk: Math.random() * 6, mode, s: 1 };
    G.crowd.setColor(p.i, COLORS[color].hex);
    G.people.push(p);
    return p;
  };
  ringColors.cells.forEach((cell, c) => cell.forEach((col, l) => {
    if (col !== null && col !== undefined) G.ring.cells[c][l] = person(col, 'ring');
  }));
  G.arms = armColors.map((arm) => arm.map((col) => person(col, 'arm')));
  for (let i = idx; i < G.crowd.max; i++) G.crowd.set(i, 0, -10, 0, 0, 0);
  G.boardedBase = G.total - G.people.length; // passengers already seated when resuming
  if (run) restoreRun(run);
  placePeople(true);

  revealFreeMysteries(true);
  fitCamera();
  updateHud();
  showTutorial();
}

// ---------------- Level in progress (resume after closing) ----------------
function readRun() {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY));
    return r && typeof r === 'object' && Array.isArray(r.vs) && r.ring && Array.isArray(r.ring.cells) ? r : null;
  } catch (e) { return null; }
}
function clearRun() {
  try { localStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ }
}
// Saves the level as if every moving vehicle and walking passenger had already arrived.
function saveRun() {
  if (reloading || !G || (G.state !== 'playing' && G.state !== 'lost' && G.state !== 'paused')) return;
  const vs = G.vehicles.map((v) => {
    let st = v.state;
    if (st === 'bump') st = 'lot';
    if (st === 'drive' || st === 'fly') st = 'parked';
    if (st === 'leave') st = 'gone';
    const f = v.filled + v.incoming;
    if (st === 'parked' && f >= v.seats) st = 'gone';
    return { s: st, slot: v.slot, f, c: v.color, m: v.mystery, t: v.tapOrder };
  });
  const run = {
    n: G.n, unlocked: G.unlocked, tap: G.tapCounter,
    ring: { offset: G.ring.offset, cells: G.ring.cells.map((cell) => cell.map((p) => (p ? p.color : null))) },
    arms: G.arms.map((arm) => arm.map((p) => p.color)),
    vs,
  };
  try { localStorage.setItem(RUN_KEY, JSON.stringify(run)); } catch (e) { /* ignore */ }
}
function restoreRun(run) {
  G.tapCounter = run.tap | 0;
  run.vs.forEach((r, i) => {
    const v = G.vehicles[i];
    v.color = r.c;
    if (v.mystery && !r.m) reveal(v, true);
    else if (!v.mystery) setVehicleColor(v.m, COLORS[v.color].hex);
    if (r.s === 'gone') {
      v.state = 'gone';
      G.root.remove(v.m.root);
    } else if (r.s === 'parked' && r.slot >= 0 && !G.slots[r.slot]) {
      v.slot = r.slot;
      v.filled = r.f;
      v.tapOrder = r.t;
      G.slots[r.slot] = v;
      if (v.mystery) reveal(v, true);
      arrive(v, true);
    }
  });
}
let runSaveT = 0;
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveRun(); persist(); } });
window.addEventListener('pagehide', () => { saveRun(); persist(); });

// Progress code: iPhone keeps Safari and Home Screen app data apart, so this moves it across.
function progressCode() {
  return 'BP-' + btoa(unescape(encodeURIComponent(JSON.stringify({ v: 3, save, run: readRun() }))));
}
function loadProgressCode(code) {
  const raw = code.trim().replace(/^BP-/, '').replace(/\s+/g, '');
  const data = JSON.parse(decodeURIComponent(escape(atob(raw))));
  if (!data || !data.save || typeof data.save.level !== 'number' || typeof data.save.coins !== 'number') throw new Error('bad code');
  localStorage.setItem(SAVE_KEY, JSON.stringify(data.save));
  if (data.run) localStorage.setItem(RUN_KEY, JSON.stringify(data.run)); else localStorage.removeItem(RUN_KEY);
}

// ---------------- Crowd ----------------
function ringTarget(c, l) {
  const T = G.track;
  const pos = (c + G.ring.offset) % T.ranks;
  const f = Math.min(1, G.tickT / TICK);
  const a = T.loop[pos], b = T.loop[(pos + 1) % T.ranks];
  const ta = T.loopTan[pos], tb = T.loopTan[(pos + 1) % T.ranks];
  const tan = { x: ta.x + (tb.x - ta.x) * f, z: ta.z + (tb.z - ta.z) * f };
  const off = laneOffset(tan, l);
  return { x: a.x + (b.x - a.x) * f + off.x, z: a.z + (b.z - a.z) * f + off.z, tx: tan.x, tz: tan.z };
}
function armTarget(k, i) {
  const arm = G.track.arms[k];
  const j = Math.min(Math.floor(i / PER_RANK) + 1, arm.pts.length - 1);
  const p = arm.pts[j], t = arm.tan[j];
  const off = laneOffset(t, i % PER_RANK);
  return { x: p.x + off.x, z: p.z + off.z, tx: t.x, tz: t.z };
}

function placePeople(instant, dt = 0) {
  const k = instant ? 1 : 1 - Math.exp(-dt * 14);
  const cr = G.crowd;
  const move = (p, t) => {
    p.x += (t.x - p.x) * k;
    p.z += (t.z - p.z) * k;
    p.ry = Math.atan2(-t.tx, -t.tz);
    p.walk += dt * 14;
    const bob = Math.abs(Math.sin(p.walk)) * 0.025;
    cr.set(p.i, p.x, bob, p.z, p.ry, p.s, 1 - bob);
  };
  G.ring.cells.forEach((cell, c) => cell.forEach((p, l) => { if (p) move(p, ringTarget(c, l)); }));
  G.arms.forEach((arm, a) => arm.forEach((p, i) => move(p, armTarget(a, i))));
  for (const w of G.walkers) {
    const p = w.p;
    p.walk += dt * 20;
    cr.set(p.i, p.x, Math.abs(Math.sin(p.walk)) * 0.05, p.z, p.ry, p.s);
  }
  cr.commit();
}

// One step of the loop: rotate, the rank at the gate boards, arms refill empty places.
function ringStep() {
  const ring = G.ring, T = G.track;
  ring.offset++;
  if (G.state === 'playing') {
    const gate = ring.cells[cellAt(ring, T.gateIdx)];
    for (let l = 0; l < PER_RANK; l++) {
      const p = gate[l];
      if (!p) continue;
      const v = boardTarget(p.color);
      if (v) { gate[l] = null; startWalk(p, v); }
    }
  }
  T.merges.forEach((m, k) => {
    const arm = G.arms[k];
    if (!arm || !arm.length) return;
    const cell = ring.cells[cellAt(ring, m)];
    for (let l = 0; l < PER_RANK && arm.length; l++) {
      if (!cell[l]) { const p = arm.shift(); p.mode = 'ring'; cell[l] = p; }
    }
  });
}

function boardTarget(color) {
  let target = null;
  for (const v of G.vehicles) {
    if (v.state !== 'parked' || v.color !== color || v.filled + v.incoming >= v.seats) continue;
    if (!target || v.tapOrder < target.tapOrder) target = v;
  }
  return target;
}

function startWalk(p, v) {
  v.incoming++;
  p.mode = 'walk';
  G.walkers.push({ p, v });
}

function updateWalkers(dt) {
  const L = G.layout;
  for (let i = G.walkers.length - 1; i >= 0; i--) {
    const w = G.walkers[i];
    const p = w.p;
    const tx = L.slotsX[w.v.slot];
    const tz = parkZ(w.v) - TYPES[w.v.type].len / 2 + 0.05;
    // Head down through the gate first, then across to the vehicle.
    const gx = L.gate.x, gz = L.gate.z + 0.45;
    const viaGate = p.z < gz - 0.1;
    const ax = viaGate ? gx + (tx - gx) * 0.15 : tx, az = viaGate ? gz : tz;
    const dx = ax - p.x, dz = az - p.z;
    const d = Math.hypot(dx, dz);
    const step = 7 * dt;
    if (d > 1e-4) p.ry = Math.atan2(-dx, -dz);
    if (!viaGate && d <= step) {
      p.s = 0;
      p.mode = 'done';
      G.crowd.set(p.i, 0, -10, 0, 0, 0);
      G.walkers.splice(i, 1);
      w.v.incoming--;
      w.v.filled++;
      G.boarded++;
      if (w.v.label) w.v.label.userData.draw(`${w.v.filled}/${w.v.seats}`);
      w.v.bounce = Math.max(w.v.bounce || 0, 0.5);
      sfx.board(w.v.filled);
    } else {
      p.x += (dx / Math.max(d, 1e-6)) * Math.min(step, d);
      p.z += (dz / Math.max(d, 1e-6)) * Math.min(step, d);
      if (!viaGate && d < 0.5) p.s = Math.max(0.35, d / 0.5);
    }
  }
}

function updateCrowd(dt) {
  G.tickT += dt;
  while (G.tickT >= TICK) {
    G.tickT -= TICK;
    ringStep();
  }
  updateWalkers(dt);
  placePeople(false, dt);
}

// ---------------- Vehicles ----------------
function blockInfo(v) {
  let best = Infinity, hit = null;
  for (const o of G.vehicles) {
    if (o === v || (o.state !== 'lot' && o.state !== 'bump')) continue;
    const d = sweepDistance(v.obb, o.obb);
    if (d < best) { best = d; hit = o; }
  }
  return { dist: best, hit };
}

function revealFreeMysteries(instant) {
  for (const v of G.vehicles) {
    if (!v.mystery || v.state !== 'lot') continue;
    if (blockInfo(v).dist === Infinity) reveal(v, instant);
  }
}

function reveal(v, instant) {
  v.mystery = false;
  if (v.q) {
    v.m.root.remove(v.q);
    v.q.material.map.dispose();
    v.q = null;
  }
  if (instant) setVehicleColor(v.m, COLORS[v.color].hex);
  else {
    v.revealT = 0;
    v.revealFrom = new THREE.Color(MYSTERY_HEX);
  }
}

function freeSlot() {
  for (let i = 0; i < G.unlocked; i++) if (!G.slots[i]) return i;
  return -1;
}

function parkZ(v) {
  return G.layout.rowTop + 0.2 + TYPES[v.type].len / 2;
}

function buildDrivePath(v, slot) {
  const L = G.layout;
  const R = L.ring;
  const f = dirVec(v.a);
  const tx = f.x > 1e-6 ? (R.x1 - v.x) / f.x : f.x < -1e-6 ? (R.x0 - v.x) / f.x : Infinity;
  const tz = f.z > 1e-6 ? (R.z1 - v.z) / f.z : f.z < -1e-6 ? (R.z0 - v.z) / f.z : Infinity;
  const t = Math.min(tx, tz);
  const H = { x: Math.min(R.x1, Math.max(R.x0, v.x + f.x * t)), z: Math.min(R.z1, Math.max(R.z0, v.z + f.z * t)) };
  const W = R.x1 - R.x0, D = R.z1 - R.z0, P = 2 * (W + D);
  const corners = [{ x: R.x0, z: R.z0 }, { x: R.x1, z: R.z0 }, { x: R.x1, z: R.z1 }, { x: R.x0, z: R.z1 }];
  const cornerS = [0, W, W + D, 2 * W + D];
  const param = (p) => {
    if (Math.abs(p.z - R.z0) < 1e-4) return p.x - R.x0;
    if (Math.abs(p.x - R.x1) < 1e-4) return W + (p.z - R.z0);
    if (Math.abs(p.z - R.z1) < 1e-4) return W + D + (R.x1 - p.x);
    return 2 * W + D + (R.z1 - p.z);
  };
  const sx = L.slotsX[slot];
  const Tc = { x: Math.min(R.x1, Math.max(R.x0, sx)), z: R.z0 };
  const sH = param(H), sT = param(Tc);
  const cw = (((sT - sH) % P) + P) % P;
  const pts = [{ x: v.x, z: v.z }, H];
  let s = sH;
  if (cw <= P - cw) {
    for (let guard = 0; guard < 5; guard++) {
      const nextCorner = cornerS.map((c, i) => ({ c: c <= s + 1e-6 ? c + P : c, i })).sort((a, b) => a.c - b.c)[0];
      const target = sT < s - 1e-6 ? sT + P : sT;
      if (target <= nextCorner.c + 1e-6) break;
      pts.push(corners[nextCorner.i]);
      s = nextCorner.c % P;
    }
  } else {
    for (let guard = 0; guard < 5; guard++) {
      const prevCorner = cornerS.map((c, i) => ({ c: c >= s - 1e-6 ? c - P : c, i })).sort((a, b) => b.c - a.c)[0];
      const target = sT > s + 1e-6 ? sT - P : sT;
      if (target >= prevCorner.c - 1e-6) break;
      pts.push(corners[prevCorner.i]);
      s = ((prevCorner.c % P) + P) % P;
    }
  }
  pts.push(Tc);
  if (Math.abs(Tc.x - sx) > 1e-4) pts.push({ x: sx, z: R.z0 });
  pts.push({ x: sx, z: parkZ(v) });
  return roundedPath(dedupe(pts), 0.7);
}

function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    if (Math.hypot(pts[i].x - p.x, pts[i].z - p.z) > 0.02) out.push(pts[i]);
  }
  const res = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = res[res.length - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z);
    if (Math.abs(cross) > 1e-4 || dot < 0) res.push(b);
  }
  if (out.length > 1) res.push(out[out.length - 1]);
  return res;
}

function buildLeavePath(v) {
  const L = G.layout;
  const sx = L.slotsX[v.slot];
  return roundedPath([{ x: sx, z: parkZ(v) }, { x: sx, z: L.laneZ }, { x: 40, z: L.laneZ }], 0.7);
}

function tapVehicle(v) {
  if (G.state !== 'playing' || v.state !== 'lot') return;
  hideTutorialHand();
  if (G.vip) {
    const vs = G.layout.vipSlot;
    if (G.slots[vs]) { toast('The VIP spot is busy'); sfx.error(); return; }
    if (!payFor('vip')) { cancelVip(); return; }
    cancelVip();
    flyToSlot(v, vs);
    updateHud();
    return;
  }
  const info = blockInfo(v);
  if (info.dist !== Infinity) {
    v.state = 'bump';
    v.bump = { phase: 'fwd', d: 0, max: Math.max(0.08, info.dist - 0.02), hit: info.hit, t: 0 };
    sfx.tap();
    return;
  }
  const slot = freeSlot();
  if (slot < 0) {
    toast('No spots available!');
    v.shake = 1;
    sfx.error();
    return;
  }
  sfx.go();
  v.state = 'drive';
  v.slot = slot;
  G.slots[slot] = v;
  v.tapOrder = ++G.tapCounter;
  v.path = buildDrivePath(v, slot);
  v.s = 0;
  v.speed = 2;
  if (v.mystery) reveal(v, false);
  revealFreeMysteries(false);
  updateMood();
}

function flyToSlot(v, slot) {
  sfx.whoosh();
  v.state = 'fly';
  v.slot = slot;
  G.slots[slot] = v;
  v.tapOrder = ++G.tapCounter;
  v.fly = { t: 0, from: { x: v.x, z: v.z, a: v.a }, to: { x: G.layout.slotsX[slot], z: parkZ(v), a: 0 } };
  if (v.mystery) reveal(v, false);
  revealFreeMysteries(false);
}

function arrive(v, quiet) {
  v.state = 'parked';
  v.m.root.position.set(G.layout.slotsX[v.slot], 0.05, parkZ(v));
  v.m.root.rotation.y = 0;
  v.a = 0;
  v.label = makeLabel(`${v.filled}/${v.seats}`, { w: 0.95 });
  v.label.position.set(0, v.m.roofY + 0.45, 0);
  v.m.root.add(v.label);
  v.bounce = 1;
  if (!quiet) sfx.park();
  updateMood();
}

function updateVehicles(dt) {
  for (const v of G.vehicles) {
    const m = v.m;
    if (v.revealT !== undefined) {
      v.revealT += dt * 3;
      const c = v.revealFrom.clone().lerp(new THREE.Color(COLORS[v.color].hex), Math.min(1, v.revealT));
      setVehicleColor(m, c.getHex());
      m.body.scale.setScalar(1 + Math.sin(Math.min(1, v.revealT) * Math.PI) * 0.12);
      if (v.revealT >= 1) { v.revealT = undefined; m.body.scale.setScalar(1); }
    }
    if (v.shake > 0) {
      v.shake = Math.max(0, v.shake - dt * 2.5);
      m.body.rotation.z = Math.sin(G.time * 45) * 0.07 * v.shake;
    } else if (v.state === 'lot') m.body.rotation.z = 0;

    if (v.state === 'bump') {
      const b = v.bump;
      const f = dirVec(v.a);
      if (b.phase === 'fwd') {
        b.d = Math.min(b.max, b.d + dt * 12);
        if (b.d >= b.max) {
          b.phase = 'back';
          b.t = 0;
          sfx.bump();
          buzz(30);
          if (b.hit) b.hit.shake = 1;
          v.shake = 0.6;
          if (!G.honked || G.time - G.honked > 0.6) { sfx.honk(); G.honked = G.time; }
        }
      } else {
        b.t += dt * 3.2;
        const e = 1 - Math.pow(1 - Math.min(1, b.t), 3);
        b.dd = b.max * (1 - e);
        if (b.t >= 1) { v.state = 'lot'; b.dd = 0; }
      }
      const d = b.phase === 'fwd' ? b.d : b.dd;
      m.root.position.set(v.x + f.x * d, 0.04, v.z + f.z * d);
      m.body.rotation.x = b.phase === 'back' ? Math.sin(b.t * Math.PI) * 0.08 : 0;
    } else if (v.state === 'drive') {
      const rem = v.path.total - v.s;
      v.speed = Math.min(14, v.speed + dt * 32, Math.sqrt(2 * 26 * Math.max(rem, 0)) + 1.2);
      v.s += v.speed * dt;
      const p = samplePath(v.path, v.s);
      m.root.position.set(p.x, 0.05, p.z);
      if (p.a !== null) {
        const prev = -m.root.rotation.y;
        const na = lerpAngle(prev, p.a, Math.min(1, dt * 14));
        const turn = (na - prev) / Math.max(dt, 1e-3);
        m.root.rotation.y = -na;
        v.rollV = THREE.MathUtils.lerp(v.rollV, THREE.MathUtils.clamp(turn * 0.018, -0.12, 0.12), Math.min(1, dt * 10));
        m.body.rotation.z = v.rollV;
      }
      if (v.s >= v.path.total) {
        m.body.rotation.z = 0;
        arrive(v);
      }
    } else if (v.state === 'fly') {
      const F = v.fly;
      F.t = Math.min(1, F.t + dt / 1.0);
      const e = F.t < 0.5 ? 4 * F.t ** 3 : 1 - Math.pow(-2 * F.t + 2, 3) / 2;
      m.root.position.set(F.from.x + (F.to.x - F.from.x) * e, 0.05 + Math.sin(F.t * Math.PI) * 3, F.from.z + (F.to.z - F.from.z) * e);
      m.root.rotation.y = -lerpAngle(F.from.a, F.to.a, e);
      m.body.rotation.z = Math.sin(F.t * Math.PI * 4) * 0.08;
      if (F.t >= 1) arrive(v);
    } else if (v.state === 'parked') {
      if (v.bounce > 0) {
        v.bounce = Math.max(0, v.bounce - dt * 4);
        m.body.scale.set(1 + Math.sin(v.bounce * Math.PI) * 0.06, 1 - Math.sin(v.bounce * Math.PI) * 0.08, 1);
      }
      if (v.filled >= v.seats && v.incoming === 0) {
        v.departT = (v.departT ?? 0) + dt;
        if (v.departT > 0.28) depart(v);
      }
    } else if (v.state === 'leave') {
      v.speed = Math.min(16, v.speed + dt * 22);
      v.s += v.speed * dt;
      const p = samplePath(v.path, v.s);
      m.root.position.set(p.x, 0.05, p.z);
      if (p.a !== null) m.root.rotation.y = -lerpAngle(-m.root.rotation.y, p.a, Math.min(1, dt * 12));
      if (v.s >= v.path.total) {
        v.state = 'gone';
        G.root.remove(m.root);
      }
    }
  }
}

function depart(v) {
  v.state = 'leave';
  G.slots[v.slot] = null;
  v.path = buildLeavePath(v);
  v.s = 0;
  v.speed = 1;
  if (v.label) { v.m.root.remove(v.label); v.label.material.map.dispose(); v.label = null; }
  v.m.body.scale.setScalar(1);
  sfx.full();
  setTimeout(() => sfx.depart(), 120);
  updateMood();
}

// ---------------- Win / lose ----------------
function peopleWaiting() {
  return G.people.some((p) => p.mode === 'ring' || p.mode === 'arm');
}

function checkEnd(dt) {
  if (G.state !== 'playing') return;
  const waiting = peopleWaiting();
  if (!waiting && !G.walkers.length && G.vehicles.every((v) => v.state === 'leave' || v.state === 'gone')) {
    G.winT += dt;
    if (G.winT > 0.9) win();
    return;
  }
  const busy = G.vehicles.some((v) => v.state === 'drive' || v.state === 'fly' || v.state === 'bump' ||
    (v.state === 'parked' && v.filled >= v.seats)) || G.walkers.length > 0;
  if (busy || !waiting || G.vip || freeSlot() >= 0) { G.stuckT = 0; return; }
  // Spots are full. Stuck if nobody on the loop can board and the arms can't bring anyone new.
  const canBoard = G.ring.cells.some((c) => c.some((p) => p && boardTarget(p.color)));
  const armsCanFeed = G.ring.cells.some((c) => c.some((p) => !p)) && G.arms.some((a) => a.length);
  if (canBoard || armsCanFeed) { G.stuckT = 0; return; }
  G.stuckT += dt;
  if (G.stuckT > 1.2) lose();
}

function win() {
  if (G.state === 'won') return;
  G.state = 'won';
  const kind = levelKind(G.n);
  const first = !save.cleared[G.n];
  const reward = first ? ECON.reward[kind] : ECON.replayReward;
  save.cleared[G.n] = true;
  clearRun();
  if (G.n === save.level && save.level < MAX_LEVEL) save.level = G.n + 1;
  addCoins(reward);
  sfx.win();
  buzz([40, 60, 40]);
  ui.winTitle.textContent = kind === 'normal' ? 'Level Complete!' : kind === 'hard' ? 'Hard Level Complete!' : 'Super Hard Complete!';
  ui.winCoins.textContent = `+${reward}`;
  ui.winNote.textContent = first ? '' : 'Replayed level';
  ui.winNext.textContent = G.n >= MAX_LEVEL ? 'Play Again' : `Level ${Math.min(G.n + 1, MAX_LEVEL)}`;
  setTimeout(() => { show(ui.win); confetti(); updateHud(); }, 250);
}

function lose() {
  G.state = 'lost';
  sfx.lose();
  buzz(200);
  ui.loseSpot.style.display = G.unlocked < G.maxSlots ? '' : 'none';
  ui.loseSpotPrice.textContent = `🪙 ${ECON.price.spot}`;
  ui.loseVip.style.display = save.unlocked.vip && !G.slots[G.layout.vipSlot] ? '' : 'none';
  ui.loseVipPrice.textContent = save.boosters.vip > 0 ? `Free (${save.boosters.vip} left)` : `🪙 ${ECON.price.vip}`;
  show(ui.lose);
}

// ---------------- Boosters & purchases ----------------
function payFor(kind) {
  if (kind !== 'spot' && save.boosters[kind] > 0) { save.boosters[kind]--; persist(); return true; }
  const price = ECON.price[kind];
  if (save.coins < price) return false;
  addCoins(-price);
  sfx.coin();
  return true;
}
function canAfford(kind) {
  return (kind !== 'spot' && save.boosters[kind] > 0) || save.coins >= ECON.price[kind];
}

let buyAction = null;
function askToBuy(title, text, okText, action) {
  ui.buyTitle.textContent = title;
  ui.buyText.textContent = text;
  ui.buyOk.textContent = okText;
  buyAction = action;
  show(ui.buy);
}
ui.buyOk.addEventListener('click', () => { hide(ui.buy); const a = buyAction; buyAction = null; if (a) a(); });
ui.buyCancel.addEventListener('click', () => { hide(ui.buy); buyAction = null; });
function notEnough(kind) {
  askToBuy('Not enough coins', `This costs 🪙 ${ECON.price[kind]} and you have 🪙 ${save.coins}. Win levels to earn more coins.`, 'OK', null);
}

const NAMES = { spot: 'Extra Spot', vip: 'VIP', arrange: 'Arrange', jumble: 'Jumble' };
const INFO = {
  spot: 'Opens one more parking spot for this level.',
  vip: 'Lifts any vehicle, even a blocked one, into the VIP spot.',
  arrange: 'Everyone who matches a parked vehicle hops straight on, wherever they are in line.',
  jumble: 'Mixes up the colors of every vehicle still in the parking lot.',
};

function requestBooster(kind) {
  if (!G || G.state !== 'playing') return;
  hideTutorialHand();
  if (kind !== 'spot' && !save.unlocked[kind]) { toast(`Unlocks at level ${ECON.unlockLevel[kind]}`); return; }
  if (kind === 'vip' && G.vip) { cancelVip(); toast('VIP cancelled'); return; }
  if (kind === 'spot' && G.unlocked >= G.maxSlots) { toast('All extra spots are open'); return; }
  if (kind === 'jumble' && G.vehicles.filter((v) => v.state === 'lot').length < 2) { toast('Nothing left to jumble'); return; }
  if (kind === 'vip' && G.slots[G.layout.vipSlot]) { toast('The VIP spot is busy'); return; }
  if (kind === 'arrange' && !arrangeTargets().length) { toast('Park a vehicle first, then Arrange'); return; }
  if (!canAfford(kind)) { notEnough(kind); return; }
  const go = () => applyBooster(kind);
  if (kind !== 'spot' && save.boosters[kind] > 0) { go(); return; }
  askToBuy(NAMES[kind], INFO[kind], `Buy 🪙 ${ECON.price[kind]}`, go);
}

function applyBooster(kind) {
  if (!G || (G.state !== 'playing' && !(kind === 'spot' && G.state === 'lost'))) return;
  if (kind === 'spot') {
    if (G.unlocked >= G.maxSlots || !payFor('spot')) return;
    unlockSlot();
    if (G.state === 'lost') { G.state = 'playing'; hide(ui.lose); }
  } else if (kind === 'jumble') {
    if (!payFor('jumble')) return;
    jumbleLot();
  } else if (kind === 'arrange') {
    if (!payFor('arrange')) return;
    arrange();
  } else if (kind === 'vip') {
    // Paid when the vehicle is picked, so cancelling costs nothing.
    G.vip = true;
    ui.vipBanner.classList.add('show');
    ui.boosters.querySelector('[data-booster="vip"]').classList.add('active');
  }
  sfx.booster();
  updateHud();
}

function cancelVip() {
  G.vip = false;
  ui.vipBanner.classList.remove('show');
  ui.boosters.querySelector('[data-booster="vip"]').classList.remove('active');
}

// Passengers anywhere in line who match a parked vehicle with room.
function arrangeTargets() {
  const room = new Map();
  for (const v of G.vehicles) {
    if (v.state === 'parked') room.set(v.color, (room.get(v.color) || 0) + v.seats - v.filled - v.incoming);
  }
  const out = [];
  const take = (p) => {
    const r = room.get(p.color) || 0;
    if (r > 0) { room.set(p.color, r - 1); out.push(p); }
  };
  G.ring.cells.forEach((c) => c.forEach((p) => p && take(p)));
  G.arms.forEach((a) => a.forEach(take));
  return out;
}

function arrange() {
  for (const p of arrangeTargets()) {
    if (p.mode === 'ring') {
      for (const cell of G.ring.cells) { const l = cell.indexOf(p); if (l >= 0) { cell[l] = null; break; } }
    } else {
      for (const arm of G.arms) { const i = arm.indexOf(p); if (i >= 0) { arm.splice(i, 1); break; } }
    }
    startWalk(p, boardTarget(p.color));
  }
}

function jumbleLot() {
  const lot = G.vehicles.filter((v) => v.state === 'lot');
  // Colors only swap between vehicles of the same size, so every color keeps its seat count.
  for (const type of Object.keys(TYPES)) {
    const group = lot.filter((v) => v.type === type);
    const cols = group.map((v) => v.color);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    group.forEach((v, i) => {
      v.shake = 0.6;
      if (v.color === cols[i]) return;
      const from = new THREE.Color(v.m.paint.color.getHex());
      v.color = cols[i];
      if (!v.mystery) { v.revealT = 0; v.revealFrom = from; }
    });
  }
}

function unlockSlot() {
  const slot = G.unlocked;
  G.unlocked++;
  const bay = G.bays.find((b) => b.slotIndex === slot && !b.isVip);
  if (bay) {
    bay.frame.material.color.set(0xa3a7b6);
    if (bay.mark) { bay.mark.parent.remove(bay.mark); bay.mark = null; }
    bay.locked = false;
  }
  G.stuckT = 0;
  updateHud();
}

// ---------------- HUD / UI ----------------
function updateHud() {
  if (!G) return;
  const kind = levelKind(G.n);
  ui.levelLabel.textContent = `Level ${G.n}`;
  ui.levelBadge.textContent = kind === 'hard' ? 'HARD' : kind === 'super' ? 'SUPER HARD' : '';
  ui.levelBadge.className = `badge ${kind}`;
  showCoins();
  for (const btn of ui.boosters.querySelectorAll('[data-booster]')) {
    const k = btn.dataset.booster;
    const count = btn.querySelector('.count');
    const locked = !save.unlocked[k];
    btn.classList.toggle('locked', locked);
    if (locked) { count.textContent = `Lv ${ECON.unlockLevel[k]}`; count.className = 'count lock'; continue; }
    const c = save.boosters[k];
    count.textContent = c > 0 ? c : `🪙${ECON.price[k]}`;
    count.className = c > 0 ? 'count' : 'count price';
  }
  updateMood();
}
// The face in the corner reacts to how full the parking spots are.
function updateMood() {
  if (!G) return;
  let used = 0;
  for (let i = 0; i < G.unlocked; i++) if (G.slots[i]) used++;
  const free = G.unlocked - used;
  ui.mood.textContent = free >= 3 ? '😄' : free === 2 ? '🙂' : free === 1 ? '😟' : '😰';
}

let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1700);
}
function show(el) { el.classList.add('show'); }
function hide(el) { el.classList.remove('show'); }

function confetti() {
  const colors = ['#ff4a4a', '#3b82f6', '#ffcc1f', '#2fc764', '#9b5cf6', '#ff8a1f', '#ff6fb1', '#1fd2ea'];
  ui.confetti.innerHTML = '';
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    p.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    ui.confetti.appendChild(p);
  }
  setTimeout(() => { ui.confetti.innerHTML = ''; }, 3600);
}

// Tutorial hand on early levels: points at a good vehicle to tap.
function bestHintVehicle() {
  const want = new Set();
  G.ring.cells.forEach((c) => c.forEach((p) => p && want.add(p.color)));
  const free = G.vehicles.filter((v) => v.state === 'lot' && blockInfo(v).dist === Infinity);
  return free.find((v) => want.has(v.color) && !v.mystery) || free[0] || null;
}
function showTutorial() {
  ui.tutorial.classList.remove('show');
  G.hintOn = false;
  if (G.n === 1) {
    ui.tutText.textContent = 'Tap a vehicle to send it to a parking spot. Passengers of the same color hop on as they pass the gate!';
    ui.tutorial.classList.add('show');
    G.hintOn = true;
  } else if (G.n === 2) {
    ui.tutText.textContent = 'Vehicles only drive the way their arrow points. Clear the way first!';
    ui.tutorial.classList.add('show');
    G.hintOn = true;
  } else if (G.n === 3) {
    ui.tutText.textContent = `Need more room? Tap a green + spot to open it for 🪙${ECON.price.spot} (this level only).`;
    ui.tutorial.classList.add('show');
  }
  if (G.level.vehicles.some((v) => v.mystery) && !save.seenTips.mystery) {
    save.seenTips.mystery = true;
    persist();
    ui.tipTitle.textContent = 'New: “?” vehicles';
    ui.tipText.textContent = 'Grey “?” vehicles hide their color until nothing is blocking their way out.';
    show(ui.tip);
  } else if (levelKind(G.n) !== 'normal' && !save.seenTips.hard) {
    save.seenTips.hard = true;
    persist();
    ui.tipTitle.textContent = 'Hard level!';
    ui.tipText.textContent = 'There is less room for mistakes. Watch the colors on the loop and plan your moves.';
    show(ui.tip);
  }
}
function hideTutorialHand() {
  ui.tutorial.classList.remove('show');
}
function updateHint() {
  if (!G.hintOn || G.state !== 'playing') { ui.hand.style.display = 'none'; return; }
  const busy = G.vehicles.some((v) => v.state === 'drive' || v.state === 'bump');
  const v = busy ? null : bestHintVehicle();
  if (!v || freeSlot() < 0) { ui.hand.style.display = 'none'; return; }
  const p = new THREE.Vector3(v.x, 0.6, v.z).project(camera);
  ui.hand.style.display = 'block';
  ui.hand.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
  ui.hand.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
}

// ---------------- Input ----------------
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  down = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || !G) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 20) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = G.vehicles.filter((v) => v.state === 'lot').map((v) => v.m.hit);
  for (const h of G.bayHits) if (h.userData.slot >= G.unlocked) targets.push(h);
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return;
  const o = hits[0].object;
  if (o.userData.vehicle) tapVehicle(o.userData.vehicle);
  else if (o.userData.slot !== undefined) requestBooster('spot');
});

ui.boosters.addEventListener('click', (e) => {
  const b = e.target.closest('[data-booster]');
  if (!b) return;
  unlockAudio();
  requestBooster(b.dataset.booster);
});

ui.playBtn.addEventListener('click', () => {
  unlockAudio();
  sfx.tap();
  askPersistentStorage();
  const run = readRun();
  startLevel(save.level, run && run.n === save.level ? run : null);
});
ui.levelsBtn.addEventListener('click', () => { unlockAudio(); sfx.tap(); openLevels(); });
ui.levelsClose.addEventListener('click', () => hide(ui.levels));
ui.winNext.addEventListener('click', () => { sfx.tap(); hide(ui.win); startLevel(Math.min(G.n + 1, MAX_LEVEL)); });
ui.loseRetry.addEventListener('click', () => { sfx.tap(); hide(ui.lose); clearRun(); startLevel(G.n); });
ui.loseSpot.addEventListener('click', () => {
  if (save.coins < ECON.price.spot) { notEnough('spot'); return; }
  applyBooster('spot');
});
ui.loseVip.addEventListener('click', () => {
  if (!canAfford('vip')) { notEnough('vip'); return; }
  hide(ui.lose);
  G.state = 'playing';
  applyBooster('vip');
});
ui.restartTop.addEventListener('click', () => {
  if (!G || G.state === 'menu') return;
  unlockAudio();
  sfx.tap();
  clearRun();
  startLevel(G.n);
});
function openPause() {
  if (G && G.state === 'playing') G.state = 'paused';
  renderSettings();
  show(ui.settings);
}
function closePause() {
  hide(ui.settings);
  if (G && G.state === 'paused') G.state = 'playing';
}
ui.pauseBtn.addEventListener('click', () => { unlockAudio(); sfx.tap(); openPause(); });
ui.homeSettings.addEventListener('click', () => { unlockAudio(); sfx.tap(); openPause(); });
ui.settingsClose.addEventListener('click', closePause);
ui.soundToggle.addEventListener('click', () => {
  save.sound = !save.sound;
  setSoundEnabled(save.sound);
  persist();
  renderSettings();
  sfx.tap();
});
ui.musicToggle.addEventListener('click', () => {
  unlockAudio();
  save.music = !save.music;
  setMusicEnabled(save.music);
  persist();
  renderSettings();
});
ui.vibeToggle.addEventListener('click', () => {
  save.vibrate = !save.vibrate;
  persist();
  renderSettings();
  buzz(30);
});
ui.homeBtn.addEventListener('click', () => {
  saveRun();
  hide(ui.settings);
  goHome();
});
let resetArmed = false;
ui.resetBtn.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    ui.resetBtn.textContent = 'Tap again to erase all progress';
    setTimeout(() => { resetArmed = false; ui.resetBtn.textContent = 'Reset progress'; }, 3000);
    return;
  }
  reloading = true;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  clearRun();
  location.reload();
});
ui.tipOk.addEventListener('click', () => hide(ui.tip));

$('transferBtn').addEventListener('click', () => {
  saveRun();
  persist();
  $('myCode').value = progressCode();
  $('pasteCode').value = '';
  show($('transfer'));
});
$('transferClose').addEventListener('click', () => hide($('transfer')));
$('copyCode').addEventListener('click', () => {
  const box = $('myCode');
  const fallback = () => { box.focus(); box.select(); box.setSelectionRange(0, box.value.length); toast('Code selected, tap Copy'); };
  try { navigator.clipboard.writeText(box.value).then(() => toast('Code copied'), fallback); } catch (e) { fallback(); }
});
$('loadCode').addEventListener('click', () => {
  try {
    loadProgressCode($('pasteCode').value);
    reloading = true;
    toast('Progress loaded!');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    toast('That code didn’t work. Copy it again and paste the whole thing.');
  }
});

function renderSettings() {
  ui.soundToggle.textContent = save.sound ? 'Sound: On 🔊' : 'Sound: Off 🔇';
  ui.musicToggle.textContent = save.music ? 'Music: On 🎵' : 'Music: Off';
  ui.vibeToggle.textContent = save.vibrate ? 'Vibration: On 📳' : 'Vibration: Off';
  ui.vibeToggle.style.display = canVibrate ? '' : 'none';
  const inGame = ui.hud.classList.contains('show');
  ui.homeBtn.style.display = inGame ? '' : 'none';
  ui.settingsClose.textContent = inGame ? 'Resume' : 'Done';
  showCoins();
}

function startLevel(n, run = null) {
  for (const el of [ui.win, ui.lose, ui.levels, ui.home, ui.buy, ui.settings]) hide(el);
  ui.hud.classList.add('show');
  ui.vipBanner.classList.remove('show');
  ui.boosters.querySelector('[data-booster="vip"]').classList.remove('active');
  runSaveT = 0;
  loadLevel(n, run);
  checkBoosterUnlocks();
}

function checkBoosterUnlocks() {
  for (const k of ['jumble', 'arrange', 'vip']) {
    if (!save.unlocked[k] && G.n >= ECON.unlockLevel[k]) {
      save.unlocked[k] = true;
      save.boosters[k] += ECON.freeOnUnlock;
      persist();
      ui.tipTitle.textContent = `New booster: ${NAMES[k]}!`;
      ui.tipText.textContent = `${INFO[k]} Here are ${ECON.freeOnUnlock} free ones to try.`;
      show(ui.tip);
      updateHud();
      return;
    }
  }
}

function goHome() {
  ui.hud.classList.remove('show');
  ui.tutorial.classList.remove('show');
  ui.hand.style.display = 'none';
  const run = readRun();
  const resume = run && run.n === save.level ? run : null;
  ui.homeLevel.textContent = resume ? `Continue Level ${save.level}` : `Level ${save.level}`;
  showCoins();
  loadLevel(save.level, resume);
  G.state = 'menu';
  ui.tutorial.classList.remove('show');
  hide(ui.tip);
  show(ui.home);
}

function openLevels() {
  const frag = document.createDocumentFragment();
  ui.levelGrid.innerHTML = '';
  for (let i = 1; i <= MAX_LEVEL; i++) {
    const b = document.createElement('button');
    const kind = levelKind(i);
    const locked = i > save.level;
    b.className = `lvl ${kind} ${locked ? 'locked' : ''} ${i === save.level ? 'current' : ''}`;
    const tag = kind === 'hard' ? 'HARD' : kind === 'super' ? 'SUPER' : save.cleared[i] ? '✓' : '';
    b.innerHTML = `<span class="num">${locked ? '🔒' : i}</span><span class="st">${locked ? '' : tag}</span>`;
    if (!locked) b.addEventListener('click', () => { sfx.tap(); startLevel(i); });
    frag.appendChild(b);
  }
  ui.levelGrid.appendChild(frag);
  show(ui.levels);
  const cur = ui.levelGrid.querySelector('.current');
  if (cur) cur.scrollIntoView({ block: 'center' });
}

// ---------------- Main loop ----------------
function step(dt) {
  G.time += dt;
  if (G.state === 'playing' || G.state === 'won') {
    if (G.state === 'playing') {
      runSaveT += dt;
      if (runSaveT > 0.5) { runSaveT = 0; saveRun(); }
    }
    updateVehicles(dt);
    updateCrowd(dt);
    checkEnd(dt);
    updateHint();
  } else if (G.state === 'menu') {
    updateCrowd(dt);
  }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G) step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

goHome();
requestAnimationFrame(frame);

// Test hooks used by the automated play-tester.
window.__bp = {
  get G() { return G; }, tapVehicle, requestBooster, applyBooster, startLevel, blockInfo, freeSlot, save, ECON,
  saveRun, readRun, step,
};

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
