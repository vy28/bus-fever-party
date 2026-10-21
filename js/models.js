import * as THREE from './vendor/three.module.min.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { TYPES, ROW_HALF_W } from './levels.js';
import { TRACK_W, laneOffset, PER_RANK } from './track.js';

export const MYSTERY_HEX = 0x9aa3b2;

// ---------- Geometry helpers ----------
const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
function rbox(w, h, d, r, seg = 3) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
}
// Bakes a transform and a vertex color into a geometry so parts can be merged.
function part(geo, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function arrowShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.11, -0.5);
  s.lineTo(0.11, -0.5);
  s.lineTo(0.11, 0.02);
  s.lineTo(0.3, 0.02);
  s.lineTo(0, 0.5);
  s.lineTo(-0.3, 0.02);
  s.lineTo(-0.11, 0.02);
  s.closePath();
  return s;
}
function arrowGeo(scaleX, scaleZ) {
  const g = new THREE.ExtrudeGeometry(arrowShape(), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.018, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.scale(scaleX, 1, scaleZ);
  return g;
}

// ---------- Vehicles ----------
// Each vehicle is two merged meshes: `paint` (tinted by a per-vehicle material, so colors can
// change) and `detail` (glass, wheels, lights and the roof arrow, shared material).
const paintGeoCache = new Map();
const detailGeoCache = new Map();
const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 });

function vehicleGeometries(type) {
  if (paintGeoCache.has(type)) return { paint: paintGeoCache.get(type), detail: detailGeoCache.get(type) };
  const { len: L, wid: W } = TYPES[type];
  const paint = [];
  const detail = [];
  const GLASS = 0xcfe3f5, TIRE = 0x2b2d35, HUB = 0xe9edf2, HEAD = 0xfff4c2, TAIL = 0xff5a5a, WHITE = 0xffffff;
  const shade = (f) => new THREE.Color(f, f, f);

  if (type === 'bus' || type === 'van') {
    const H = type === 'bus' ? 0.62 : 0.6;
    paint.push(part(rbox(W, H, L, 0.2), 0, 0.12 + H / 2, 0, shade(1)));
    // Window band, with the body color showing between windows.
    paint.push(part(rbox(W + 0.02, 0.07, L + 0.02, 0.03), 0, 0.22, 0, shade(0.82)));
    const winY = 0.12 + H * 0.66;
    detail.push(part(rbox(W + 0.025, 0.17, L - 0.32, 0.06), 0, winY, 0.06, GLASS));
    detail.push(part(rbox(W - 0.22, 0.2, 0.05, 0.02), 0, winY, -L / 2 + 0.005, GLASS));
    const nWin = type === 'bus' ? 5 : 3;
    for (let i = 1; i < nWin; i++) {
      const z = -L / 2 + 0.16 + 0.06 + (i * (L - 0.32)) / nWin;
      paint.push(part(new THREE.BoxGeometry(W + 0.04, 0.17, 0.05), 0, winY, z, shade(1)));
    }
    // Roof: same color, a touch lighter, with a raised rim.
    paint.push(part(rbox(W - 0.1, 0.06, L - 0.16, 0.03), 0, 0.12 + H + 0.02, 0, shade(1.12)));
    for (const sx of [-1, 1]) {
      detail.push(part(new THREE.BoxGeometry(0.16, 0.08, 0.03), sx * (W / 2 - 0.17), 0.3, -L / 2 - 0.005, HEAD));
      detail.push(part(new THREE.BoxGeometry(0.14, 0.08, 0.03), sx * (W / 2 - 0.16), 0.3, L / 2 + 0.005, TAIL));
    }
    detail.push(part(arrowGeo(0.95 * W, type === 'bus' ? 1.25 : 1.0), 0, 0.12 + H + 0.055, 0, WHITE));
  } else {
    paint.push(part(rbox(W, 0.36, L, 0.15), 0, 0.3, 0, shade(1)));
    paint.push(part(rbox(W + 0.02, 0.06, L + 0.02, 0.03), 0, 0.17, 0, shade(0.82)));
    detail.push(part(rbox(W - 0.12, 0.24, L * 0.58, 0.1), 0, 0.56, 0.04, GLASS));
    paint.push(part(rbox(W - 0.14, 0.06, L * 0.5, 0.03), 0, 0.69, 0.04, shade(1.12)));
    for (const sx of [-1, 1]) {
      detail.push(part(new THREE.BoxGeometry(0.15, 0.07, 0.03), sx * (W / 2 - 0.17), 0.33, -L / 2 - 0.005, HEAD));
      detail.push(part(new THREE.BoxGeometry(0.13, 0.07, 0.03), sx * (W / 2 - 0.16), 0.33, L / 2 + 0.005, TAIL));
    }
    detail.push(part(arrowGeo(0.72, 0.62), 0, 0.73, 0.04, WHITE));
  }
  const wheel = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14);
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.11, 10);
  const wz = L / 2 - (type === 'car' ? 0.3 : 0.42);
  for (const z of [-wz, wz]) {
    for (const sx of [-1, 1]) {
      detail.push(part(wheel, sx * (W / 2 - 0.04), 0.13, z, TIRE, 0, 0, Math.PI / 2));
      detail.push(part(hub, sx * (W / 2 - 0.035), 0.13, z, HUB, 0, 0, Math.PI / 2));
    }
  }
  const p = mergeGeometries(paint);
  const d = mergeGeometries(detail);
  paintGeoCache.set(type, p);
  detailGeoCache.set(type, d);
  return { paint: p, detail: d };
}

const blobMat = new THREE.MeshBasicMaterial({ color: 0x3a3550, transparent: true, opacity: 0.12, depthWrite: false });

// Root sits on the ground at the vehicle's centre and faces -z.
export function buildVehicle(type, hex) {
  const t = TYPES[type];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const geos = vehicleGeometries(type);
  const paintMat = new THREE.MeshStandardMaterial({ color: hex, vertexColors: true, roughness: 0.42, metalness: 0.02 });
  const paintMesh = new THREE.Mesh(geos.paint, paintMat);
  const detailMesh = new THREE.Mesh(geos.detail, detailMat);
  paintMesh.castShadow = true;
  detailMesh.castShadow = false;
  body.add(paintMesh, detailMesh);
  const blob = new THREE.Mesh(cached(`blob${type}`, () => {
    const g = new THREE.PlaneGeometry(t.wid + 0.2, t.len + 0.2);
    g.rotateX(-Math.PI / 2);
    return g;
  }), blobMat);
  blob.position.y = 0.01;
  root.add(blob);
  const hit = new THREE.Mesh(cached(`hit${type}`, () => new THREE.BoxGeometry(t.wid + 0.22, 1.2, t.len + 0.18)),
    cached('hitMat', () => new THREE.MeshBasicMaterial({ visible: false })));
  hit.position.y = 0.5;
  root.add(hit);
  const roofY = type === 'car' ? 0.75 : 0.82;
  return { root, body, paint: paintMat, hit, roofY };
}

export function setVehicleColor(v, hex) {
  v.paint.color.set(hex);
}

// ---------- Passengers (instanced crowd) ----------
// Round, friendly bean people: a soft body and a big round head in the same color.
export function buildCrowd(max) {
  const bodyGeo = new THREE.CapsuleGeometry(0.11, 0.1, 4, 10);
  bodyGeo.translate(0, 0.2, 0);
  const headGeo = new THREE.SphereGeometry(0.125, 14, 10);
  headGeo.translate(0, 0.45, 0);
  const eyeGeo = mergeGeometries([
    new THREE.SphereGeometry(0.026, 8, 6).translate(-0.05, 0.48, -0.108),
    new THREE.SphereGeometry(0.026, 8, 6).translate(0.05, 0.48, -0.108),
  ]);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({ roughness: 0.45 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a2433 });
  const body = new THREE.InstancedMesh(bodyGeo, mat, max);
  const head = new THREE.InstancedMesh(headGeo, headMat, max);
  const eyes = new THREE.InstancedMesh(eyeGeo, eyeMat, max);
  for (const m of [body, head, eyes]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
  }
  body.castShadow = true;
  head.castShadow = true;
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < max; i++) { body.setColorAt(i, white); head.setColorAt(i, white); }
  const group = new THREE.Group();
  group.add(body, head, eyes);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tmpC = new THREE.Color();
  return {
    group,
    max,
    setColor(i, hex) {
      tmpC.set(hex);
      body.setColorAt(i, tmpC);
      tmpC.lerp(white, 0.18);
      head.setColorAt(i, tmpC);
      body.instanceColor.needsUpdate = true;
      head.instanceColor.needsUpdate = true;
    },
    set(i, x, y, z, rotY, s, squash = 1) {
      pos.set(x, y, z);
      q.setFromAxisAngle(up, rotY);
      scl.set(s, s * squash, s);
      m4.compose(pos, q, scl);
      body.setMatrixAt(i, m4);
      head.setMatrixAt(i, m4);
      eyes.setMatrixAt(i, m4);
    },
    commit() {
      body.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
      eyes.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- Text sprites ----------
export function makeLabel(text, opts = {}) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.renderOrder = 10;
  sp.scale.set(opts.w ?? 1.1, (opts.w ?? 1.1) / 2, 1);
  sp.userData.draw = (t) => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = opts.bg ?? 'rgba(20,24,38,0.82)';
    roundRect(ctx, 14, 18, 228, 92, 46);
    ctx.fill();
    if (opts.border) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = opts.border;
      ctx.stroke();
    }
    ctx.fillStyle = opts.fg ?? '#fff';
    ctx.font = `800 ${opts.size ?? 64}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, 128, 68);
    tex.needsUpdate = true;
  };
  sp.userData.draw(text);
  return sp;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Flat text painted on the ground (bay markings).
function groundText(text, color, w, h, size) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = `900 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Rounded-rectangle outline lying on the ground.
function frame(w, h, t, r, color) {
  const outer = new THREE.Shape();
  const rr = (s, x0, y0, x1, y1, rad) => {
    s.moveTo(x0 + rad, y0);
    s.lineTo(x1 - rad, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rad);
    s.lineTo(x1, y1 - rad); s.quadraticCurveTo(x1, y1, x1 - rad, y1);
    s.lineTo(x0 + rad, y1); s.quadraticCurveTo(x0, y1, x0, y1 - rad);
    s.lineTo(x0, y0 + rad); s.quadraticCurveTo(x0, y0, x0 + rad, y0);
  };
  rr(outer, -w / 2, -h / 2, w / 2, h / 2, r);
  const hole = new THREE.Path();
  rr(hole, -w / 2 + t, -h / 2 + t, w / 2 - t, h / 2 - t, Math.max(0.02, r - t));
  outer.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outer, { depth: 0.03, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
}

// ---------- Layout ----------
export const N_BAYS = 8; // VIP + 4 regular + 3 locked extras
export function computeLayout(level, maxSlots) {
  const hw = level.lotW / 2, hh = level.lotH / 2;
  const bayW = (ROW_HALF_W * 2) / N_BAYS;
  const bayLen = 2.75;
  const rowBottom = -hh - 1.3;
  const rowTop = rowBottom - bayLen;
  const laneZ = -hh - 0.72;
  const ring = { x0: -Math.max(hw + 0.75, 2.5), x1: Math.max(hw + 0.75, 2.5), z0: laneZ, z1: hh + 0.75 };
  const bayX = (k) => (k - (N_BAYS - 1) / 2) * bayW;
  // slotsX[0..maxSlots-1] are the regular spots (4 open + extras); slotsX[maxSlots] is VIP.
  const slotsX = [];
  for (let i = 0; i < maxSlots; i++) slotsX.push(bayX(i + 1));
  slotsX.push(bayX(0));
  const gate = { x: 0, z: rowTop - 0.62 };
  return { hw, hh, bayW, bayLen, rowTop, rowBottom, laneZ, ring, slotsX, vipSlot: maxSlots, gate };
}

// ---------- World ----------
export const THEMES = [
  { name: 'blossom', sky: 0xf7dcd8, top: 0xf2c9c4, floor: 0xe4e2ec, lot: 0xeeedf4, leaf: [0xf7a8c0, 0xf5bfd0, 0xffd2df], trunk: 0x8a5a4a },
  { name: 'meadow', sky: 0xd6efd0, top: 0xbfe3b4, floor: 0xe2e6e8, lot: 0xedf0f1, leaf: [0x5cc46b, 0x7fd57a, 0x48b05a], trunk: 0x8a5a35 },
  { name: 'beach', sky: 0xd8eefa, top: 0xf6e3b8, floor: 0xe3e7ee, lot: 0xeef1f6, leaf: [0x3fbf7a, 0x5ad18e, 0x2ea86a], trunk: 0xa8763e },
  { name: 'snow', sky: 0xe6f0fb, top: 0xf2f6fc, floor: 0xdfe4ee, lot: 0xebeff6, leaf: [0x6fa58a, 0x7fb89c, 0x5d927a], trunk: 0x7a5a45 },
  { name: 'autumn', sky: 0xf8e2c8, top: 0xf0cfa2, floor: 0xe6e2e2, lot: 0xf0edec, leaf: [0xf09a3e, 0xe8763a, 0xf5c04a], trunk: 0x7a4a2e },
];
export function themeFor(n) {
  return THEMES[Math.floor((n - 1) / 10) % THEMES.length];
}

function ribbon(pts, closed, halfW, y, thick) {
  // Flat strip along a path, `thick` tall.
  const pos = [];
  const idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    const p = pts[i];
    pos.push(p.x + nx * halfW, y + thick, p.z + nz * halfW, p.x - nx * halfW, y + thick, p.z - nz * halfW);
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Raised wall along one side of a path; `skip(i)` leaves gaps (gate, merges).
function wall(pts, closed, side, offset, h, w, skip) {
  const geos = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    if (skip && skip(i)) continue;
    const p = pts[i], q = pts[(i + 1) % n];
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const nx = -tz * side, nz = tx * side;
    const mx = (p.x + q.x) / 2 + nx * offset, mz = (p.z + q.z) / 2 + nz * offset;
    const len = Math.hypot(q.x - p.x, q.z - p.z) + 0.04;
    const g = new THREE.BoxGeometry(w, h, len);
    g.rotateY(Math.atan2(q.x - p.x, q.z - p.z));
    g.translate(mx, h / 2, mz);
    geos.push(g.toNonIndexed());
  }
  return geos.length ? mergeGeometries(geos) : null;
}

function addTree(group, theme, x, z, s, rng) {
  const trunk = new THREE.Mesh(cached('trunk', () => new THREE.CylinderGeometry(0.07, 0.1, 0.5, 7)),
    cached('trunk' + theme.name, () => new THREE.MeshStandardMaterial({ color: theme.trunk, roughness: 0.9 })));
  trunk.position.set(x, 0.25 * s, z);
  trunk.scale.setScalar(s);
  trunk.castShadow = true;
  group.add(trunk);
  for (let i = 0; i < 3; i++) {
    const col = theme.leaf[Math.floor(rng() * theme.leaf.length)];
    const leaf = new THREE.Mesh(cached('crown', () => new THREE.IcosahedronGeometry(0.42, 1)),
      cached(`leaf${col}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, flatShading: true })));
    leaf.position.set(x + (rng() - 0.5) * 0.45 * s, (0.65 + rng() * 0.35) * s, z + (rng() - 0.5) * 0.4 * s);
    leaf.scale.setScalar(s * (0.75 + rng() * 0.35));
    leaf.castShadow = true;
    group.add(leaf);
  }
}

function addRock(group, x, z, s) {
  const r = new THREE.Mesh(cached('rock', () => new THREE.DodecahedronGeometry(0.22, 0)),
    cached('rockMat', () => new THREE.MeshStandardMaterial({ color: 0xb9b6c2, roughness: 0.9, flatShading: true })));
  r.position.set(x, 0.1 * s, z);
  r.scale.set(s, s * 0.7, s);
  r.castShadow = true;
  group.add(r);
}

function addLantern(group, x, z) {
  const mat = cached('stoneMat', () => new THREE.MeshStandardMaterial({ color: 0xd7d4dc, roughness: 0.85 }));
  const parts = [[0.18, 0.08, 0.18, 0.04], [0.06, 0.4, 0.06, 0.28], [0.24, 0.16, 0.24, 0.56], [0.3, 0.06, 0.3, 0.68]];
  for (const [w, h, d, y] of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
  }
}

export function buildWorld(level, layout, track, maxSlots, unlocked, seed) {
  let s = seed >>> 0;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const theme = themeFor(level.n);
  const g = new THREE.Group();
  const { hw, hh, bayW, bayLen, rowTop, rowBottom, slotsX } = layout;

  // Ground: themed garden at the top, light floor for the parking area.
  const topGround = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color: theme.top, roughness: 1 }));
  topGround.rotation.x = -Math.PI / 2;
  topGround.position.set(0, 0, rowTop - 20 + 0.4);
  topGround.receiveShadow = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color: theme.floor, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, rowBottom + 20 - 0.2);
  floor.receiveShadow = true;
  g.add(topGround, floor);

  // Parking lot pad.
  const lot = new THREE.Mesh(rbox(level.lotW + 0.5, 0.04, level.lotH + 0.5, 0.02, 1), new THREE.MeshStandardMaterial({ color: theme.lot, roughness: 0.95 }));
  lot.position.y = 0.0;
  lot.receiveShadow = true;
  g.add(lot);

  // Parking row: dark strip with rounded bays.
  const stripD = bayLen + 1.25;
  const strip = new THREE.Mesh(rbox(80, 0.06, stripD, 0.03, 1), new THREE.MeshStandardMaterial({ color: 0x5d6070, roughness: 0.9 }));
  strip.position.set(0, 0.0, rowTop + stripD / 2 - 0.45);
  strip.receiveShadow = true;
  g.add(strip);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(80, 0.08, 0.12), new THREE.MeshStandardMaterial({ color: 0xc9cbd6, roughness: 0.8 }));
  lip.position.set(0, 0.04, rowTop - 0.45);
  g.add(lip);
  const bayFill = new THREE.MeshStandardMaterial({ color: 0x6c7080, roughness: 0.9 });
  const bayCenterZ = (rowTop + rowBottom) / 2;
  const bays = [];
  for (let k = 0; k < N_BAYS; k++) {
    const x = (k - (N_BAYS - 1) / 2) * bayW;
    const isVip = k === 0;
    const slotIndex = isVip ? maxSlots : k - 1;
    const locked = !isVip && slotIndex >= unlocked;
    const color = isVip ? 0xffbf2e : locked ? 0x5fd17a : 0xa3a7b6;
    const f = frame(bayW - 0.16, bayLen - 0.1, 0.07, 0.2, color);
    f.position.set(x, 0.03, bayCenterZ);
    g.add(f);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(bayW - 0.26, bayLen - 0.2), bayFill);
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(x, 0.035, bayCenterZ);
    g.add(fill);
    let mark = null;
    if (isVip) {
      mark = groundText('VIP', '#ffbf2e', 1.1, 0.55, 84);
      mark.rotation.z = Math.PI / 2;
    } else if (locked) mark = groundText('+', '#5fd17a', 1.0, 0.5, 120);
    if (mark) {
      mark.position.set(x, 0.05, bayCenterZ);
      g.add(mark);
    }
    bays.push({ k, x, slotIndex, isVip, locked, frame: f, mark });
  }
  void slotsX;

  // Passenger track: a light floor with soft white walls; gaps at the gate and where arms join.
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x8e8c99, roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf4f2f7, roughness: 0.6 });
  const half = TRACK_W / 2;
  const loopFloor = new THREE.Mesh(ribbon(track.loop, true, half, 0.0, 0.02), trackMat);
  loopFloor.receiveShadow = true;
  g.add(loopFloor);
  let cx = 0, cz = 0;
  for (const p of track.loop) { cx += p.x; cz += p.z; }
  cx /= track.loop.length; cz /= track.loop.length;
  const n = track.loop.length;
  const near = (i, j, d) => Math.min((i - j + n) % n, (j - i + n) % n) <= d;
  // Work out which side of the path is the outside of the loop.
  const p0 = track.loop[0], p1 = track.loop[1];
  const nx = -(p1.z - p0.z), nz = p1.x - p0.x;
  const outerSide = (nx * (p0.x - cx) + nz * (p0.z - cz)) > 0 ? 1 : -1;
  const outer = wall(track.loop, true, outerSide, half + 0.06, 0.16, 0.12, (i) => near(i, track.gateIdx, 2) || track.merges.some((m) => near(i, m, 2)));
  const inner = wall(track.loop, true, -outerSide, half + 0.06, 0.16, 0.12, null);
  for (const w of [outer, inner]) {
    if (!w) continue;
    const m = new THREE.Mesh(w, wallMat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  // Inner island.
  const islandShape = new THREE.Shape(track.loop.map((p) => new THREE.Vector2(p.x, -p.z)));
  const island = new THREE.Mesh(new THREE.ShapeGeometry(islandShape), new THREE.MeshStandardMaterial({ color: theme.top, roughness: 1 }));
  island.rotation.x = -Math.PI / 2;
  island.position.y = 0.005;
  g.add(island);
  for (const arm of track.arms) {
    const pts = arm.pts.slice(1);
    const fl = new THREE.Mesh(ribbon(pts, false, half, 0.0, 0.021), trackMat);
    fl.receiveShadow = true;
    g.add(fl);
    for (const side of [1, -1]) {
      const w = wall(pts, false, side, half + 0.06, 0.16, 0.12, (i) => i < 2);
      if (!w) continue;
      const m = new THREE.Mesh(w, wallMat);
      m.castShadow = true;
      g.add(m);
    }
  }
  // Gate path from the loop down to the parking row.
  const gatePad = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), trackMat);
  gatePad.rotation.x = -Math.PI / 2;
  gatePad.position.set(layout.gate.x, 0.012, layout.gate.z + 0.35);
  g.add(gatePad);

  // Garden decorations around the track and down the sides.
  const L = Math.max(hw + 1.2, ROW_HALF_W + 0.9);
  const spots = [
    [-ROW_HALF_W - 0.2, rowTop - 1.2], [ROW_HALF_W + 0.2, rowTop - 1.0], [-ROW_HALF_W + 0.4, rowTop - 3.6], [ROW_HALF_W - 0.3, rowTop - 3.9],
    [cx, cz - 0.1],
  ];
  spots.forEach(([x, z], i) => {
    if (i === 4) addLantern(g, x, z);
    else addTree(g, theme, x, z, 0.9 + rng() * 0.4, rng);
  });
  for (let i = 0; i < 6; i++) addRock(g, (rng() - 0.5) * 2 * (ROW_HALF_W + 0.5), rowTop - 0.9 - rng() * 4, 0.6 + rng() * 0.6);
  for (const side of [-1, 1]) {
    for (let z = rowBottom + 0.8; z < hh + 2; z += 1.8 + rng()) {
      if (rng() < 0.6) addTree(g, theme, side * (L + 0.6 + rng() * 0.6), z, 0.8 + rng() * 0.3, rng);
    }
  }
  return { group: g, bays, theme };
}

export { PER_RANK, laneOffset };
