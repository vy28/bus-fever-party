import * as THREE from './vendor/three.module.min.js';
import { generateLevel, levelKind, COLORS, TYPES, MAX_LEVEL } from './levels.js';
import { makeOBB, sweepDistance, roundedPath, makePath, samplePath, lerpAngle, dirVec } from './geom.js';
import { buildVehicle, setVehicleColor, buildPassenger, makeLabel, buildWorld, computeLayout, MYSTERY_HEX } from './models.js';
import { sfx, unlockAudio, setSoundEnabled, setMusicEnabled } from './audio.js';

// ---------------- Save data ----------------
// Economy: coins come only from winning levels (no ads, no purchases). Each level starts with
// 4 regular spots; the 4 extra spots cost coins and reset when the level ends.
const ECON = {
  startCoins: 100,
  reward: { normal: 20, hard: 40, super: 60 },
  replayReward: 5,
  price: { spot: 50, shuffle: 80, vip: 120 },
  unlockLevel: { shuffle: 6, vip: 11 },
  freeOnUnlock: 2,
};
const SAVE_KEY = 'busparty-save-v2';
const save = loadSave();
function loadSave() {
  const def = {
    level: 1, coins: ECON.startCoins, boosters: { shuffle: 0, vip: 0 }, unlocked: { shuffle: false, vip: false },
    cleared: {}, sound: true, music: true, vibrate: true, seenTips: {},
  };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object') {
      return { ...def, ...s, boosters: { ...def.boosters, ...s.boosters }, unlocked: { ...def.unlocked, ...s.unlocked },
        cleared: { ...s.cleared }, seenTips: { ...s.seenTips } };
    }
    // Carry level and coins over from the first version of the game.
    const old = JSON.parse(localStorage.getItem('busparty-save-v1'));
    if (old && typeof old === 'object') {
      def.level = Math.max(1, Math.min(MAX_LEVEL, old.level | 0 || 1));
      def.coins = Math.max(0, old.coins | 0);
      for (let i = 1; i < def.level; i++) def.cleared[i] = true;
    }
  } catch (e) { /* ignore */ }
  return def;
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}
function addCoins(n) {
  save.coins = Math.max(0, save.coins + n);
  persist();
  ui.coinCount.textContent = save.coins;
  ui.homeCoins.textContent = save.coins;
}
setSoundEnabled(save.sound);
setMusicEnabled(save.music);

const EXTRA_SLOTS = 4;
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
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fdcff);
scene.fog = new THREE.Fog(0x9fdcff, 40, 75);

const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 200);
const hemi = new THREE.HemisphereLight(0xdff3ff, 0x6c8f4a, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun);
scene.add(sun.target);

// ---------------- Game state ----------------
let G = null; // current level runtime
const raycaster = new THREE.Raycaster();
const ui = {};
for (const id of ['hud', 'levelLabel', 'levelBadge', 'coinCount', 'progressFill', 'boosters', 'toast', 'vipBanner',
  'home', 'homeLevel', 'playBtn', 'levelsBtn', 'levels', 'levelGrid', 'levelsClose', 'win', 'winCoins', 'winNote',
  'winNext', 'winTitle', 'lose', 'loseSpot', 'loseRetry', 'loseSpotPrice', 'loseVip', 'loseVipPrice', 'settings', 'settingsBtn',
  'soundToggle', 'musicToggle', 'vibeToggle', 'settingsClose', 'restartBtn', 'homeBtn', 'resetBtn', 'tutorial', 'tutText', 'hand',
  'homeCoins', 'confetti', 'tip', 'tipTitle', 'tipText', 'tipOk', 'buy', 'buyTitle', 'buyText', 'buyOk', 'buyCancel', 'homeSettings']) {
  ui[id] = document.getElementById(id);
}

function fitCamera() {
  if (!G) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const L = G.layout;
  const pts = [];
  const xs = Math.max(L.ring.x1 + 0.8, L.queueHalfW + 0.4, (L.slotsX.length * L.bayW) / 2 + 0.2);
  for (const x of [-xs, xs]) {
    pts.push(new THREE.Vector3(x, 0, L.ring.z1 + 0.75));
    pts.push(new THREE.Vector3(x, 1.0, L.ring.z1 + 0.75));
    pts.push(new THREE.Vector3(x, 0, L.queueHeadZ - 2.25));
    pts.push(new THREE.Vector3(x, 0.8, L.queueHeadZ - 2.25));
  }
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
  const safeBot = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
  const topPx = 96 + safeTop, botPx = 118 + safeBot;
  const yTop = 1 - (2 * topPx) / h, yBot = -1 + (2 * botPx) / h;
  const elev = THREE.MathUtils.degToRad(w / h > 0.8 ? 50 : 55);
  const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
  const target = new THREE.Vector3(0, 0, (L.ring.z1 + L.queueHeadZ - 2.2) / 2);
  const fits = (dist) => {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let minY = Infinity, maxY = -Infinity, ok = true;
    for (const p of pts) {
      const q = p.clone().project(camera);
      if (Math.abs(q.x) > 0.97) ok = false;
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    if (maxY - minY > yTop - yBot) ok = false;
    return { ok, minY, maxY };
  };
  const fitDist = () => {
    let lo = 5, hi = 120;
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
    // Pan along the ground so the content sits between the HUD bars.
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    target.z -= ((have - want) * halfH) / Math.sin(elev);
  }
  fits(fitDist());
  // Shadow camera covers the play area.
  const ext = Math.max(xs, (L.ring.z1 - L.queueHeadZ) / 2 + 3) + 2;
  sun.position.set(target.x - 8, 18, target.z + 6);
  sun.target.position.copy(target);
  const sc = sun.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 50;
  sc.updateProjectionMatrix();
}
window.addEventListener('resize', () => setTimeout(fitCamera, 50));

// ---------------- Level setup ----------------
function clearLevel() {
  if (!G) return;
  scene.remove(G.root);
  G.root.traverse((o) => {
    if (o.material && o.material.map && o.isSprite) o.material.map.dispose();
  });
  G = null;
}

function loadLevel(n) {
  clearLevel();
  const level = generateLevel(n);
  const maxSlots = level.slots + EXTRA_SLOTS;
  const layout = computeLayout(level, maxSlots);
  const root = new THREE.Group();
  scene.add(root);
  root.add(buildWorld(level, layout, maxSlots, n * 977 + 13));

  G = {
    n, level, layout, root, maxSlots,
    unlocked: level.slots,
    slots: new Array(maxSlots + 1).fill(null), // last entry is the VIP spot
    vehicles: [],
    queue: [],
    walkers: [],
    boarded: 0,
    total: level.queue.length,
    tapCounter: 0,
    state: 'playing',
    stuckT: 0,
    winT: 0,
    vip: false,
    time: 0,
    lockTiles: [],
    hintRing: null,
  };

  for (const d of level.vehicles) {
    const t = TYPES[d.type];
    const a = (d.dir * Math.PI) / 4;
    const hex = d.mystery ? MYSTERY_HEX : COLORS[d.color].hex;
    const m = buildVehicle(d.type, hex);
    m.root.position.set(d.x, 0.11, d.z);
    m.root.rotation.y = -a;
    root.add(m.root);
    const v = {
      id: d.id, type: d.type, seats: t.seats, color: d.color, mystery: d.mystery,
      x: d.x, z: d.z, a, obb: makeOBB(d.x, d.z, a, t.len / 2, t.wid / 2),
      state: 'lot', slot: -1, tapOrder: 0, filled: 0, incoming: 0,
      m, shake: 0, label: null, q: null, y: 0.11, rollV: 0,
    };
    m.hit.userData.vehicle = v;
    if (d.mystery) {
      v.q = makeLabel('?', { w: 1.2, bg: 'rgba(255,255,255,0.97)', fg: '#4a5163', size: 96, border: '#8b93a5' });
      v.q.position.set(0, m.roofY + 0.5, 0);
      m.root.add(v.q);
    }
    G.vehicles.push(v);
  }

  for (let i = 0; i < level.queue.length; i++) G.queue.push({ color: level.queue[i], mesh: null, walk: 0 });
  G.moreLabel = makeLabel('', { w: 1.5, bg: 'rgba(255,255,255,0.95)', fg: '#2a3142', size: 64 });
  G.moreLabel.visible = false;
  root.add(G.moreLabel);

  buildLockTiles();
  revealFreeMysteries(true);
  syncQueueMeshes(true);
  fitCamera();
  updateHud();
  showTutorial();
}

function buildLockTiles() {
  for (const t of G.lockTiles) G.root.remove(t);
  G.lockTiles = [];
  const L = G.layout;
  for (let i = G.unlocked; i < G.maxSlots; i++) {
    const tile = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(L.bayW - 0.22, 0.05, L.bayLen - 0.3),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 0.8, transparent: true, opacity: 0.85 }));
    plate.position.y = 0.04;
    tile.add(plate);
    const lbl = makeLabel(`+ 🪙${ECON.price.spot}`, { w: 1.25, bg: 'rgba(255,200,40,0.97)', fg: '#5a3a00', size: 58, border: '#fff' });
    lbl.position.y = 0.7;
    tile.add(lbl);
    tile.position.set(L.slotsX[i], 0, (L.bayTop + L.bayBottom) / 2);
    plate.userData.lockedSlot = i;
    tile.userData.plate = plate;
    G.root.add(tile);
    G.lockTiles.push(tile);
  }
}

// ---------------- Queue ----------------
const SP = 0.43;
const ROW_DZ = 0.62;
const VISIBLE_ROWS = 4;
function queuePos(i) {
  const L = G.layout;
  const half = L.queueHalfW - 0.3;
  const k0 = Math.floor(half / SP) + 1;
  if (i < k0) return { x: -i * SP, z: L.queueHeadZ, row: 0 };
  i -= k0;
  const kr = Math.floor((2 * half) / SP) + 1;
  const row = 1 + Math.floor(i / kr);
  const j = i % kr;
  const x = row % 2 === 1 ? -half + j * SP : half - j * SP;
  return { x, z: L.queueHeadZ - row * ROW_DZ, row };
}

function syncQueueMeshes(instant) {
  let visibleCount = 0;
  for (let i = 0; i < G.queue.length; i++) {
    const p = queuePos(i);
    const pas = G.queue[i];
    if (p.row >= VISIBLE_ROWS) break;
    visibleCount++;
    if (!pas.mesh) {
      pas.mesh = buildPassenger(COLORS[pas.color].hex);
      const spawn = instant ? p : queuePos(i + 1);
      pas.mesh.position.set(spawn.x, 0.12, spawn.z);
      if (!instant) pas.mesh.scale.setScalar(0.01);
      G.root.add(pas.mesh);
    }
  }
  const more = G.queue.length - visibleCount;
  if (more > 0) {
    const p = queuePos(visibleCount - 1);
    G.moreLabel.userData.draw(`+${more}`);
    G.moreLabel.position.set(p.x + (p.row % 2 === 1 ? 0.95 : -0.95), 0.9, p.z);
    G.moreLabel.visible = true;
  } else G.moreLabel.visible = false;
}

function updateQueue(dt) {
  for (let i = 0; i < G.queue.length; i++) {
    const pas = G.queue[i];
    if (!pas.mesh) break;
    const p = queuePos(i);
    const m = pas.mesh;
    const dx = p.x - m.position.x, dz = p.z - m.position.z;
    const d = Math.hypot(dx, dz);
    const step = 7 * dt;
    if (d > 0.001) {
      if (d <= step) m.position.set(p.x, 0.12, p.z);
      else { m.position.x += (dx / d) * step; m.position.z += (dz / d) * step; }
      pas.walk += dt * 18;
      m.rotation.y = Math.atan2(dx, dz);
    } else {
      pas.walk = 0;
      m.rotation.y = lerpAngle(m.rotation.y, 0, Math.min(1, dt * 8));
    }
    animatePerson(m, pas.walk, dt);
  }
}

function animatePerson(m, walk, dt) {
  const s = m.scale.x;
  if (s < 1) m.scale.setScalar(Math.min(1, s + dt * 5));
  const inner = m.userData.inner;
  inner.position.y = walk ? Math.abs(Math.sin(walk)) * 0.05 : 0;
  const [l1, l2] = m.userData.legs;
  l1.rotation.x = walk ? Math.sin(walk) * 0.6 : 0;
  l2.rotation.x = -l1.rotation.x;
}

// ---------------- Vehicles ----------------
function lotVehicles() {
  return G.vehicles.filter((v) => v.state === 'lot' || v.state === 'bump');
}

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
  return G.layout.bayTop + 0.3 + TYPES[v.type].len / 2;
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
  const goCW = cw <= P - cw;
  const pts = [{ x: v.x, z: v.z }, H];
  if (goCW) {
    // Walk corners clockwise from H until reaching T.
    let s = sH;
    for (let guard = 0; guard < 5; guard++) {
      const nextCorner = cornerS.map((c, i) => ({ c: c <= s + 1e-6 ? c + P : c, i })).sort((a, b) => a.c - b.c)[0];
      const target = sT < s - 1e-6 ? sT + P : sT;
      if (target <= nextCorner.c + 1e-6) break;
      pts.push(corners[nextCorner.i]);
      s = nextCorner.c % P;
    }
  } else {
    let s = sH;
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
  return roundedPath(dedupe(pts), 0.85);
}

function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    if (Math.hypot(pts[i].x - p.x, pts[i].z - p.z) > 0.02) out.push(pts[i]);
  }
  // Drop collinear middle points.
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
  return roundedPath([{ x: sx, z: parkZ(v) }, { x: sx, z: L.exitZ }, { x: 40, z: L.exitZ }], 0.75);
}

function tapVehicle(v) {
  if (G.state !== 'playing') return;
  if (v.state !== 'lot') return;
  hideTutorialHand();
  const slot = freeSlot();
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

function arrive(v) {
  v.state = 'parked';
  v.m.root.position.set(G.layout.slotsX[v.slot], 0.02, parkZ(v));
  v.m.root.rotation.y = 0;
  v.a = 0;
  v.label = makeLabel(`${v.filled}/${v.seats}`, { w: 1.05 });
  v.label.position.set(0, v.m.roofY + 0.55, 0);
  v.m.root.add(v.label);
  v.bounce = 1;
  sfx.park();
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
      m.root.position.set(v.x + f.x * d, 0.11, v.z + f.z * d);
      m.body.rotation.x = b.phase === 'back' ? Math.sin(b.t * Math.PI) * 0.08 : 0;
    } else if (v.state === 'drive') {
      const rem = v.path.total - v.s;
      v.speed = Math.min(14, v.speed + dt * 32, Math.sqrt(2 * 26 * Math.max(rem, 0)) + 1.2);
      v.s += v.speed * dt;
      const p = samplePath(v.path, v.s);
      const inLot = Math.abs(p.x) < G.layout.hw && Math.abs(p.z) < G.layout.hh;
      m.root.position.set(p.x, inLot ? 0.11 : 0.02, p.z);
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
      m.root.position.set(F.from.x + (F.to.x - F.from.x) * e, 0.11 + Math.sin(F.t * Math.PI) * 3.2, F.from.z + (F.to.z - F.from.z) * e);
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
      m.root.position.set(p.x, 0.02, p.z);
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
}

// ---------------- Boarding ----------------
let boardTimer = 0;
function updateBoarding(dt) {
  boardTimer -= dt;
  while (boardTimer <= 0 && G.queue.length) {
    const front = G.queue[0];
    let target = null;
    for (const v of G.vehicles) {
      if (v.state !== 'parked' || v.color !== front.color) continue;
      if (v.filled + v.incoming >= v.seats) continue;
      if (!target || v.tapOrder < target.tapOrder) target = v;
    }
    if (!target) { boardTimer = 0; break; }
    G.queue.shift();
    target.incoming++;
    if (!front.mesh) {
      front.mesh = buildPassenger(COLORS[front.color].hex);
      const p = queuePos(0);
      front.mesh.position.set(p.x, 0.12, p.z);
      G.root.add(front.mesh);
    }
    G.walkers.push({ p: front, v: target, walk: 0 });
    boardTimer += 0.075;
    syncQueueMeshes(false);
  }
  if (boardTimer < 0) boardTimer = 0;

  for (let i = G.walkers.length - 1; i >= 0; i--) {
    const w = G.walkers[i];
    const m = w.p.mesh;
    const tx = G.layout.slotsX[w.v.slot];
    const tz = parkZ(w.v) - TYPES[w.v.type].len / 2 + 0.25;
    const dx = tx - m.position.x, dz = tz - m.position.z;
    const d = Math.hypot(dx, dz);
    const step = 11 * dt;
    w.walk += dt * 22;
    if (d <= step) {
      G.root.remove(m);
      G.walkers.splice(i, 1);
      w.v.incoming--;
      w.v.filled++;
      G.boarded++;
      if (w.v.label) w.v.label.userData.draw(`${w.v.filled}/${w.v.seats}`);
      w.v.bounce = Math.max(w.v.bounce || 0, 0.5);
      sfx.board(w.v.filled);
      updateProgress();
    } else {
      m.position.x += (dx / d) * step;
      m.position.z += (dz / d) * step;
      m.rotation.y = Math.atan2(dx, dz);
      if (d < 0.6) m.scale.setScalar(Math.max(0.3, d / 0.6));
      animatePerson(m, w.walk, dt);
    }
  }
}

// ---------------- Win / lose ----------------
function checkEnd(dt) {
  if (G.state !== 'playing') return;
  const busy = G.vehicles.some((v) => v.state === 'drive' || v.state === 'fly' || v.state === 'bump' ||
    (v.state === 'parked' && v.filled >= v.seats)) || G.walkers.length > 0;
  if (!G.queue.length && !G.walkers.length && G.vehicles.every((v) => v.state === 'leave' || v.state === 'gone')) {
    G.winT += dt;
    if (G.winT > 0.9) win();
    return;
  }
  if (busy || !G.queue.length || G.vip) { G.stuckT = 0; return; }
  if (freeSlot() >= 0) { G.stuckT = 0; return; }
  const c = G.queue[0].color;
  const canBoard = G.vehicles.some((v) => v.state === 'parked' && v.color === c && v.filled + v.incoming < v.seats);
  if (canBoard) { G.stuckT = 0; return; }
  G.stuckT += dt;
  if (G.stuckT > 0.7) lose();
}

function win() {
  if (G.state === 'won') return;
  G.state = 'won';
  const kind = levelKind(G.n);
  const first = !save.cleared[G.n];
  const reward = first ? ECON.reward[kind] : ECON.replayReward;
  save.cleared[G.n] = true;
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
  const canSpot = G.unlocked < G.maxSlots;
  ui.loseSpot.style.display = canSpot ? '' : 'none';
  ui.loseSpotPrice.textContent = `🪙 ${ECON.price.spot}`;
  const canVip = save.unlocked.vip && !G.slots[G.layout.vipSlot];
  ui.loseVip.style.display = canVip ? '' : 'none';
  ui.loseVipPrice.textContent = save.boosters.vip > 0 ? `Free (${save.boosters.vip} left)` : `🪙 ${ECON.price.vip}`;
  show(ui.lose);
}

// ---------------- Boosters & purchases ----------------
// Uses a free booster if there is one, otherwise takes coins. Returns false if neither.
function payFor(kind) {
  if (kind !== 'spot' && save.boosters[kind] > 0) { save.boosters[kind]--; persist(); return true; }
  const price = ECON.price[kind];
  if (save.coins < price) return false;
  addCoins(-price);
  sfx.coin();
  return true;
}
function costText(kind) {
  if (kind !== 'spot' && save.boosters[kind] > 0) return `free (${save.boosters[kind]} left)`;
  return `🪙 ${ECON.price[kind]}`;
}
function canAfford(kind) {
  return (kind !== 'spot' && save.boosters[kind] > 0) || save.coins >= ECON.price[kind];
}

let buyAction = null;
function askToBuy(title, text, action) {
  ui.buyTitle.textContent = title;
  ui.buyText.textContent = text;
  buyAction = action;
  show(ui.buy);
}
ui.buyOk.addEventListener('click', () => { hide(ui.buy); const a = buyAction; buyAction = null; if (a) a(); });
ui.buyCancel.addEventListener('click', () => { hide(ui.buy); buyAction = null; });
function notEnough(kind) {
  askToBuy('Not enough coins', `This costs 🪙 ${ECON.price[kind]} and you have 🪙 ${save.coins}. Win levels to earn more coins.`, null);
  ui.buyOk.textContent = 'OK';
}

const NAMES = { spot: 'Extra Spot', shuffle: 'Shuffle', vip: 'VIP' };
const INFO = {
  spot: 'Opens one more parking spot for this level.',
  shuffle: 'Mixes up the colors of every vehicle still in the parking lot.',
  vip: 'Lifts any vehicle, even a blocked one, into the VIP spot.',
};

function requestBooster(kind) {
  if (!G || G.state !== 'playing') return;
  hideTutorialHand();
  if (kind !== 'spot' && !save.unlocked[kind]) { toast(`Unlocks at level ${ECON.unlockLevel[kind]}`); return; }
  if (kind === 'vip' && G.vip) { cancelVip(); toast('VIP cancelled'); return; }
  if (kind === 'spot' && G.unlocked >= G.maxSlots) { toast('All extra spots are open'); return; }
  if (kind === 'shuffle' && G.vehicles.filter((v) => v.state === 'lot').length < 2) { toast('Nothing left to shuffle'); return; }
  if (kind === 'vip' && G.slots[G.layout.vipSlot]) { toast('The VIP spot is busy'); return; }
  if (!canAfford(kind)) { notEnough(kind); return; }
  const go = () => applyBooster(kind);
  if (kind !== 'spot' && save.boosters[kind] > 0) { go(); return; }
  ui.buyOk.textContent = `Buy 🪙 ${ECON.price[kind]}`;
  askToBuy(NAMES[kind], INFO[kind], go);
}

function applyBooster(kind) {
  if (!G || (G.state !== 'playing' && !(kind === 'spot' && G.state === 'lost'))) return;
  if (kind === 'spot') {
    if (G.unlocked >= G.maxSlots || !payFor('spot')) return;
    unlockSlot();
    if (G.state === 'lost') { G.state = 'playing'; hide(ui.lose); }
  } else if (kind === 'shuffle') {
    if (!payFor('shuffle')) return;
    shuffleLot();
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

function shuffleLot() {
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
      v.bounce = 1;
      v.shake = 0.6;
      if (v.color === cols[i]) return;
      const from = new THREE.Color(v.m.paint.color.getHex());
      v.color = cols[i];
      if (!v.mystery) { v.revealT = 0; v.revealFrom = from; }
    });
  }
}

function unlockSlot() {
  G.unlocked++;
  buildLockTiles();
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
  ui.coinCount.textContent = save.coins;
  ui.homeCoins.textContent = save.coins;
  for (const btn of ui.boosters.querySelectorAll('[data-booster]')) {
    const k = btn.dataset.booster;
    const count = btn.querySelector('.count');
    if (k === 'spot') {
      const full = G.unlocked >= G.maxSlots;
      count.textContent = full ? 'MAX' : `🪙${ECON.price.spot}`;
      count.className = full ? 'count lock' : 'count price';
      continue;
    }
    const locked = !save.unlocked[k];
    btn.classList.toggle('locked', locked);
    if (locked) { count.textContent = `Lv ${ECON.unlockLevel[k]}`; count.className = 'count lock'; continue; }
    const c = save.boosters[k];
    count.textContent = c > 0 ? c : `🪙${ECON.price[k]}`;
    count.className = c > 0 ? 'count' : 'count price';
  }
  updateProgress();
}
function updateProgress() {
  if (!G) return;
  ui.progressFill.style.width = `${(100 * G.boarded) / Math.max(1, G.total)}%`;
}

let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1600);
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
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    ui.confetti.appendChild(p);
  }
  setTimeout(() => { ui.confetti.innerHTML = ''; }, 3600);
}

// Tutorial hand on early levels: points at a good vehicle to tap.
function bestHintVehicle() {
  const front = G.queue[0];
  const free = G.vehicles.filter((v) => v.state === 'lot' && blockInfo(v).dist === Infinity);
  return (front && free.find((v) => v.color === front.color && !v.mystery)) || free[0] || null;
}
function showTutorial() {
  ui.tutorial.classList.remove('show');
  if (G.n === 1) {
    ui.tutText.textContent = 'Tap a bus that matches the passengers’ color. It drives to a parking spot and they hop on!';
    ui.tutorial.classList.add('show');
    G.hintOn = true;
  } else if (G.n === 2) {
    ui.tutText.textContent = 'Buses only drive the way their arrow points. Clear the way first!';
    ui.tutorial.classList.add('show');
    G.hintOn = true;
  } else if (G.n === 3) {
    ui.tutText.textContent = `Need more room? Tap a yellow locked spot to open it for 🪙${ECON.price.spot} (this level only).`;
    ui.tutorial.classList.add('show');
    G.hintOn = false;
  } else G.hintOn = false;
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
    ui.tipText.textContent = 'There is less room for mistakes. Watch the line of passengers and plan your moves.';
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
  const p = new THREE.Vector3(v.x, 0.9, v.z).project(camera);
  ui.hand.style.display = 'block';
  ui.hand.style.left = `${((p.x + 1) / 2) * window.innerWidth}px`;
  ui.hand.style.top = `${((1 - p.y) / 2) * window.innerHeight}px`;
}

// ---------------- Input ----------------
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || !G) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 20) return;
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = G.vehicles.filter((v) => v.state === 'lot').map((v) => v.m.hit);
  for (const t of G.lockTiles) targets.push(t.userData.plate);
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return;
  const o = hits[0].object;
  if (o.userData.vehicle) tapVehicle(o.userData.vehicle);
  else if (o.userData.lockedSlot !== undefined) requestBooster('spot');
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
  hide(ui.home);
  ui.hud.classList.add('show');
  startLevel(save.level);
});
ui.levelsBtn.addEventListener('click', () => { unlockAudio(); sfx.tap(); openLevels(); });
ui.levelsClose.addEventListener('click', () => hide(ui.levels));
ui.winNext.addEventListener('click', () => {
  sfx.tap();
  hide(ui.win);
  startLevel(Math.min(G.n + 1, MAX_LEVEL));
});
ui.loseRetry.addEventListener('click', () => { sfx.tap(); hide(ui.lose); startLevel(G.n); });
ui.loseSpot.addEventListener('click', () => {
  if (save.coins < ECON.price.spot) { notEnough('spot'); return; }
  applyBooster('spot');
});
ui.loseVip.addEventListener('click', () => {
  if (!canAfford('vip')) { notEnough('vip'); return; }
  hide(ui.lose);
  G.state = 'playing';
  G.stuckT = -2; // give the player time to pick a vehicle
  applyBooster('vip');
});
ui.settingsBtn.addEventListener('click', () => { sfx.tap(); renderSettings(); show(ui.settings); });
ui.settingsClose.addEventListener('click', () => hide(ui.settings));
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
ui.homeSettings.addEventListener('click', () => { unlockAudio(); sfx.tap(); renderSettings(); show(ui.settings); });
ui.restartBtn.addEventListener('click', () => { hide(ui.settings); startLevel(G.n); });
ui.homeBtn.addEventListener('click', () => { hide(ui.settings); goHome(); });
let resetArmed = false;
ui.resetBtn.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    ui.resetBtn.textContent = 'Tap again to erase all progress';
    setTimeout(() => { resetArmed = false; ui.resetBtn.textContent = 'Reset progress'; }, 3000);
    return;
  }
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  location.reload();
});
ui.tipOk.addEventListener('click', () => hide(ui.tip));

function renderSettings() {
  ui.soundToggle.textContent = save.sound ? 'Sound: On 🔊' : 'Sound: Off 🔇';
  ui.musicToggle.textContent = save.music ? 'Music: On 🎵' : 'Music: Off';
  ui.vibeToggle.textContent = save.vibrate ? 'Vibration: On 📳' : 'Vibration: Off';
  ui.vibeToggle.style.display = canVibrate ? '' : 'none';
  ui.restartBtn.style.display = ui.hud.classList.contains('show') ? '' : 'none';
  ui.homeBtn.style.display = ui.hud.classList.contains('show') ? '' : 'none';
}

function startLevel(n) {
  hide(ui.win); hide(ui.lose); hide(ui.levels); hide(ui.home); hide(ui.buy);
  ui.hud.classList.add('show');
  ui.vipBanner.classList.remove('show');
  ui.boosters.querySelector('[data-booster="vip"]').classList.remove('active');
  boardTimer = 0;
  loadLevel(n);
  checkBoosterUnlocks();
}

// New boosters unlock at set levels and come with free uses.
function checkBoosterUnlocks() {
  for (const k of ['shuffle', 'vip']) {
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
  ui.homeLevel.textContent = `Level ${save.level}`;
  ui.homeCoins.textContent = save.coins;
  loadLevel(save.level);
  G.state = 'menu';
  ui.tutorial.classList.remove('show');
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
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G) {
    G.time += dt;
    if (G.state === 'playing' || G.state === 'won') {
      updateVehicles(dt);
      updateBoarding(dt);
      updateQueue(dt);
      checkEnd(dt);
      updateHint();
    } else if (G.state === 'menu') {
      updateQueue(dt);
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

goHome();
requestAnimationFrame(frame);

// Test hooks used by the automated play-tester.
window.__bp = {
  get G() { return G; }, tapVehicle, requestBooster, applyBooster, startLevel, blockInfo, freeSlot, save, ECON,
  step(dt) { G.time += dt; updateVehicles(dt); updateBoarding(dt); updateQueue(dt); checkEnd(dt); },
};

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
