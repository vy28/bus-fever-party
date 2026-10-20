import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { TYPES } from './levels.js';

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
function rbox(w, h, d, r, seg = 3) {
  return cached(`rb${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r));
}
function box(w, h, d) {
  return cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
}

const mats = {
  glass: new THREE.MeshStandardMaterial({ color: 0x1d2b40, roughness: 0.12, metalness: 0.55 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.85 }),
  hub: new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.35, metalness: 0.6 }),
  chassis: new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.7 }),
  white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  head: new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xfff1a8, emissiveIntensity: 0.6, roughness: 0.3 }),
  tail: new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 0.4, roughness: 0.3 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xffd3ad, roughness: 0.7 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 }),
  shadowBlob: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
};

export const MYSTERY_HEX = 0x9aa3b2;

function arrowGeometry() {
  return cached('arrow', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.13, -0.5);
    s.lineTo(0.13, -0.5);
    s.lineTo(0.13, 0.05);
    s.lineTo(0.32, 0.05);
    s.lineTo(0, 0.5);
    s.lineTo(-0.32, 0.05);
    s.lineTo(-0.13, 0.05);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.02, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    return g;
  });
}

function wheelGeometry() {
  return cached('wheel', () => {
    const g = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 18);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}
function hubGeometry() {
  return cached('hub', () => {
    const g = new THREE.CylinderGeometry(0.1, 0.1, 0.17, 12);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

function addWheels(group, wid, zs) {
  for (const z of zs) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeometry(), mats.tire);
      w.position.set(sx * (wid / 2 - 0.06), 0.2, z);
      w.castShadow = true;
      group.add(w);
      const h = new THREE.Mesh(hubGeometry(), mats.hub);
      h.position.copy(w.position);
      h.position.x += sx * 0.005;
      group.add(h);
    }
  }
}

function lights(group, wid, len, y) {
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(box(0.2, 0.1, 0.04), mats.head);
    hl.position.set(sx * (wid / 2 - 0.2), y, -len / 2 - 0.005);
    group.add(hl);
    const tl = new THREE.Mesh(box(0.18, 0.1, 0.04), mats.tail);
    tl.position.set(sx * (wid / 2 - 0.18), y, len / 2 + 0.005);
    group.add(tl);
  }
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f > 1) c.lerp(new THREE.Color(0xffffff), f - 1);
  else c.multiplyScalar(f);
  return c;
}

// Builds a vehicle. Root sits on the ground at its centre and faces -z.
// `body` is the sub-group that wobbles; `paint` holds the recolourable materials.
export function buildVehicle(type, hex) {
  const t = TYPES[type];
  const L = t.len, W = t.wid;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.38, metalness: 0.05 });
  const roofPaint = new THREE.MeshStandardMaterial({ color: shade(hex, 1.18), roughness: 0.42 });
  const trimPaint = new THREE.MeshStandardMaterial({ color: shade(hex, 0.72), roughness: 0.5 });

  const blob = new THREE.Mesh(cached(`blob${L}`, () => {
    const g = new THREE.PlaneGeometry(W + 0.35, L + 0.35);
    g.rotateX(-Math.PI / 2);
    return g;
  }), mats.shadowBlob);
  blob.position.y = 0.012;
  root.add(blob);

  const chassis = new THREE.Mesh(rbox(W - 0.06, 0.2, L - 0.1, 0.06), mats.chassis);
  chassis.position.y = 0.2;
  body.add(chassis);

  let roofY;
  if (type === 'bus') {
    const lower = new THREE.Mesh(rbox(W, 0.36, L, 0.12), paint);
    lower.position.y = 0.42;
    const glass = new THREE.Mesh(rbox(W + 0.025, 0.3, L + 0.025, 0.1), mats.glass);
    glass.position.y = 0.72;
    const upper = new THREE.Mesh(rbox(W, 0.14, L, 0.07), paint);
    upper.position.y = 0.92;
    const stripe = new THREE.Mesh(rbox(W + 0.03, 0.07, L + 0.03, 0.03), trimPaint);
    stripe.position.y = 0.36;
    body.add(lower, glass, upper, stripe);
    // Window pillars.
    const n = 5;
    for (let i = 0; i < n; i++) {
      const z = -L / 2 + 0.75 + (i * (L - 1.2)) / (n - 1);
      const pil = new THREE.Mesh(box(W + 0.04, 0.3, 0.07), paint);
      pil.position.set(0, 0.72, z);
      body.add(pil);
    }
    roofY = 0.99;
    const roof = new THREE.Mesh(rbox(W - 0.12, 0.07, L - 0.3, 0.03), roofPaint);
    roof.position.y = roofY + 0.02;
    body.add(roof);
    roofY += 0.055;
    addWheels(body, W, [-L / 2 + 0.6, L / 2 - 0.62]);
    lights(body, W, L, 0.36);
  } else if (type === 'van') {
    const lower = new THREE.Mesh(rbox(W, 0.36, L, 0.12), paint);
    lower.position.y = 0.42;
    const glass = new THREE.Mesh(rbox(W + 0.02, 0.28, L - 0.38, 0.1), mats.glass);
    glass.position.set(0, 0.72, 0.17);
    const upper = new THREE.Mesh(rbox(W, 0.14, L - 0.4, 0.07), paint);
    upper.position.set(0, 0.91, 0.18);
    const stripe = new THREE.Mesh(rbox(W + 0.03, 0.07, L + 0.03, 0.03), trimPaint);
    stripe.position.y = 0.36;
    body.add(lower, glass, upper, stripe);
    for (const z of [-0.1, 0.55]) {
      const pil = new THREE.Mesh(box(W + 0.03, 0.28, 0.08), paint);
      pil.position.set(0, 0.72, z);
      body.add(pil);
    }
    roofY = 0.98;
    const roof = new THREE.Mesh(rbox(W - 0.14, 0.06, L - 0.62, 0.03), roofPaint);
    roof.position.set(0, roofY + 0.01, 0.2);
    body.add(roof);
    roofY += 0.045;
    addWheels(body, W, [-L / 2 + 0.48, L / 2 - 0.48]);
    lights(body, W, L, 0.42);
  } else {
    const lower = new THREE.Mesh(rbox(W, 0.34, L, 0.14), paint);
    lower.position.y = 0.38;
    const cabin = new THREE.Mesh(rbox(W - 0.1, 0.3, L * 0.56, 0.12), mats.glass);
    cabin.position.set(0, 0.66, 0.06);
    const cap = new THREE.Mesh(rbox(W - 0.12, 0.07, L * 0.5, 0.04), roofPaint);
    cap.position.set(0, 0.83, 0.06);
    const stripe = new THREE.Mesh(rbox(W + 0.03, 0.06, L + 0.03, 0.03), trimPaint);
    stripe.position.y = 0.3;
    body.add(lower, cabin, cap, stripe);
    roofY = 0.865;
    addWheels(body, W, [-L / 2 + 0.38, L / 2 - 0.4]);
    lights(body, W, L, 0.42);
  }

  body.traverse((m) => {
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });

  // Direction arrow on the roof.
  const arrow = new THREE.Mesh(arrowGeometry(), mats.white);
  const s = type === 'car' ? 0.62 : type === 'van' ? 0.8 : 0.92;
  arrow.scale.set(s, 1, s * (type === 'bus' ? 1.45 : 1.1));
  arrow.position.set(0, roofY, type === 'car' ? 0.06 : type === 'van' ? 0.15 : 0);
  arrow.castShadow = false;
  body.add(arrow);

  // Invisible, slightly oversized hit box for easy tapping.
  const hit = new THREE.Mesh(box(W + 0.3, 1.4, L + 0.25), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.6;
  root.add(hit);

  return { root, body, paint, roofPaint, trimPaint, hit, roofY, arrow };
}

export function setVehicleColor(v, hex) {
  v.paint.color.set(hex);
  v.roofPaint.color.copy(shade(hex, 1.18));
  v.trimPaint.color.copy(shade(hex, 0.72));
}

// ---------- Passengers ----------
const personMats = new Map();
function personMat(hex) {
  if (!personMats.has(hex)) personMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55 }));
  return personMats.get(hex);
}
const bodyGeo = new THREE.CapsuleGeometry(0.105, 0.2, 4, 10);
const headGeo = new THREE.SphereGeometry(0.095, 14, 10);
const hairGeo = new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6);

export function buildPassenger(hex) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  g.add(inner);
  const torso = new THREE.Mesh(bodyGeo, personMat(hex));
  torso.position.y = 0.32;
  const head = new THREE.Mesh(headGeo, mats.skin);
  head.position.y = 0.57;
  const hair = new THREE.Mesh(hairGeo, mats.hair);
  hair.position.y = 0.585;
  hair.rotation.x = 0.25;
  const l1 = new THREE.Mesh(legGeo, mats.chassis);
  l1.position.set(-0.05, 0.09, 0);
  const l2 = l1.clone();
  l2.position.x = 0.05;
  inner.add(torso, head, hair, l1, l2);
  torso.castShadow = true;
  head.castShadow = true;
  g.userData.legs = [l1, l2];
  g.userData.inner = inner;
  return g;
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

// ---------- World ----------
function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function noiseFill(ctx, w, h, base, spread, n) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * spread;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

let grassTex, asphaltTex, lotTex;
function textures() {
  if (grassTex) return;
  grassTex = canvasTexture(256, 256, (ctx, w, h) => {
    noiseFill(ctx, w, h, '#79c95a', 0.08, 2600);
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = `rgba(40,110,30,${0.12 + Math.random() * 0.15})`;
      ctx.lineWidth = 1.5;
      const x = Math.random() * w, y = Math.random() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 4, y - 5 - Math.random() * 4);
      ctx.stroke();
    }
  }, [18, 18]);
  asphaltTex = canvasTexture(256, 256, (ctx, w, h) => noiseFill(ctx, w, h, '#4c5260', 0.07, 5000), [6, 6]);
  lotTex = canvasTexture(256, 256, (ctx, w, h) => noiseFill(ctx, w, h, '#646b7a', 0.06, 5000), [4, 4]);
}

function addTree(group, x, z, s, rng) {
  const trunk = new THREE.Mesh(cached('trunk', () => new THREE.CylinderGeometry(0.09, 0.13, 0.6, 7)),
    cached('trunkMat', () => new THREE.MeshStandardMaterial({ color: 0x8a5a35, roughness: 0.9 })));
  trunk.position.set(x, 0.3 * s, z);
  trunk.scale.setScalar(s);
  trunk.castShadow = true;
  group.add(trunk);
  const greens = [0x3fae4a, 0x4cc25a, 0x2f9a45, 0x5bc95e];
  const leafMat = cached('leaf' + Math.floor(rng() * 4), () =>
    new THREE.MeshStandardMaterial({ color: greens[Math.floor(Math.random() * 4)], roughness: 0.8, flatShading: true }));
  const crownGeo = cached('crown', () => new THREE.IcosahedronGeometry(0.55, 0));
  for (let i = 0; i < 2; i++) {
    const c = new THREE.Mesh(crownGeo, leafMat);
    c.position.set(x + (rng() - 0.5) * 0.2 * s, (0.85 + i * 0.4) * s, z + (rng() - 0.5) * 0.2 * s);
    c.scale.setScalar(s * (1 - i * 0.3));
    c.rotation.set(rng() * 3, rng() * 3, 0);
    c.castShadow = true;
    group.add(c);
  }
}

function addBush(group, x, z, s, rng) {
  const mat = cached('bushMat', () => new THREE.MeshStandardMaterial({ color: 0x46b750, roughness: 0.85, flatShading: true }));
  const geo = cached('bush', () => new THREE.IcosahedronGeometry(0.3, 1));
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(geo, mat);
    b.position.set(x + (i - 1) * 0.28 * s, 0.18 * s, z + (rng() - 0.5) * 0.15);
    b.scale.setScalar(s * (0.8 + rng() * 0.4));
    b.castShadow = true;
    group.add(b);
  }
}

function addFlowerBed(group, x, z, rng) {
  const cols = [0xff6b8b, 0xffd23d, 0xffffff, 0xb07cff];
  const geo = cached('flower', () => new THREE.SphereGeometry(0.06, 6, 5));
  for (let i = 0; i < 6; i++) {
    const m = cached('fl' + i % 4, () => new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.6 }));
    const f = new THREE.Mesh(geo, m);
    f.position.set(x + (rng() - 0.5) * 0.7, 0.07, z + (rng() - 0.5) * 0.7);
    group.add(f);
  }
}

function dash(group, mat, x, z, w, d) {
  const m = new THREE.Mesh(box(w, 0.012, d), mat);
  m.position.set(x, 0.048, z);
  m.receiveShadow = true;
  group.add(m);
}

// Layout geometry shared between world building and gameplay.
export function computeLayout(level, maxSlots) {
  const hw = level.lotW / 2, hh = level.lotH / 2;
  const ro = 0.95; // ring road centre offset from lot edge
  const bayW = 1.5;
  const bayLen = 3.7;
  const ring = { x0: -hw - ro, x1: hw + ro, z0: -hh - ro, z1: hh + ro };
  const bayBottom = ring.z0 - 0.85;
  const bayTop = bayBottom - bayLen;
  const slotsX = [];
  for (let i = 0; i < maxSlots; i++) slotsX.push((i - (maxSlots - 1) / 2) * bayW);
  const exitZ = bayTop - 0.72;
  const queueHeadZ = exitZ - 1.05;
  const queueHalfW = Math.max(hw + 0.4, (maxSlots * bayW) / 2 - 0.2);
  return { hw, hh, ro, bayW, bayLen, ring, bayBottom, bayTop, slotsX, exitZ, queueHeadZ, queueHalfW };
}

export function buildWorld(level, layout, maxSlots, seed) {
  textures();
  let s = seed >>> 0;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const g = new THREE.Group();
  const { hw, hh, ring, bayTop, bayBottom, slotsX, bayW, exitZ, queueHeadZ, queueHalfW } = layout;

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  g.add(grass);

  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffcf3a, roughness: 0.6 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.9 });

  // Ring road + bay apron as one slab.
  const rw = 1.35;
  const roadX0 = ring.x0 - rw / 2, roadX1 = ring.x1 + rw / 2;
  const padHalf = Math.max(roadX1, (maxSlots * bayW) / 2 + 0.3);
  const road = new THREE.Mesh(rbox(roadX1 - roadX0, 0.04, ring.z1 + rw / 2 - (ring.z0 - rw / 2), 0.4, 2), asphalt);
  road.position.set(0, 0.02, (ring.z1 + rw / 2 + ring.z0 - rw / 2) / 2);
  road.receiveShadow = true;
  g.add(road);
  const apronD = ring.z0 - rw / 2 - (exitZ - 0.7);
  const apron = new THREE.Mesh(box(padHalf * 2 + 30, 0.04, apronD), asphalt);
  apron.position.set(0, 0.021, exitZ - 0.7 + apronD / 2);
  apron.receiveShadow = true;
  g.add(apron);

  // Lot surface with a curb.
  const curb = new THREE.Mesh(rbox(level.lotW + 0.3, 0.1, level.lotH + 0.3, 0.12, 2), curbMat);
  curb.position.y = 0.05;
  curb.receiveShadow = true;
  g.add(curb);
  const lot = new THREE.Mesh(rbox(level.lotW, 0.1, level.lotH, 0.08, 2), new THREE.MeshStandardMaterial({ map: lotTex, roughness: 0.92 }));
  lot.position.y = 0.06;
  lot.receiveShadow = true;
  g.add(lot);
  // Faint parking grid on the lot.
  const gridMat = new THREE.MeshStandardMaterial({ color: 0x7c8494, roughness: 0.9 });
  for (let x = -hw + 1.5; x < hw - 0.5; x += 1.5) {
    const m = new THREE.Mesh(box(0.05, 0.005, level.lotH - 0.5), gridMat);
    m.position.set(x, 0.113, 0);
    m.receiveShadow = true;
    g.add(m);
  }

  // Lane dashes on the ring road centreline.
  const dashLen = 0.45, gap = 0.45;
  for (let x = ring.x0 + 0.8; x < ring.x1 - 0.8; x += dashLen + gap) {
    dash(g, lineMat, x + dashLen / 2, ring.z1, dashLen, 0.07);
  }
  for (let z = ring.z0 + 0.8; z < ring.z1 - 0.8; z += dashLen + gap) {
    dash(g, lineMat, ring.x0, z + dashLen / 2, 0.07, dashLen);
    dash(g, lineMat, ring.x1, z + dashLen / 2, 0.07, dashLen);
  }
  // Exit road centre line.
  for (let x = -padHalf - 12; x < padHalf + 12; x += dashLen + gap) dash(g, yellowMat, x, exitZ, dashLen, 0.07);

  // Parking bays.
  for (let i = 0; i <= maxSlots; i++) {
    const x = (slotsX[0] ?? 0) - bayW / 2 + i * bayW;
    dash(g, lineMat, x, (bayTop + bayBottom) / 2, 0.08, bayBottom - bayTop);
  }
  dash(g, lineMat, 0, bayBottom, maxSlots * bayW + 0.08, 0.08);

  // Sidewalk for the queue.
  const swDepth = 4.6;
  const sw = new THREE.Mesh(rbox(queueHalfW * 2 + 2.4, 0.12, swDepth, 0.1, 2), sidewalkMat);
  sw.position.set(0, 0.06, queueHeadZ + 0.6 - swDepth / 2);
  sw.receiveShadow = true;
  g.add(sw);
  const swCurb = new THREE.Mesh(box(queueHalfW * 2 + 2.4, 0.14, 0.14), curbMat);
  swCurb.position.set(0, 0.07, queueHeadZ + 0.6);
  g.add(swCurb);
  // Queue rails.
  const railMat = new THREE.MeshStandardMaterial({ color: 0xffb02e, roughness: 0.4, metalness: 0.3 });
  const postGeo = cached('post', () => new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8));
  for (let r = 0; r < 3; r++) {
    const z = queueHeadZ - 0.32 - r * 0.62;
    const x0 = r % 2 === 0 ? -queueHalfW + 0.6 : -queueHalfW;
    const x1 = r % 2 === 0 ? queueHalfW : queueHalfW - 0.6;
    const rail = new THREE.Mesh(box(x1 - x0, 0.04, 0.04), railMat);
    rail.position.set((x0 + x1) / 2, 0.42, z);
    rail.castShadow = true;
    g.add(rail);
    for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 6) {
      const p = new THREE.Mesh(postGeo, railMat);
      p.position.set(x, 0.33, z);
      p.castShadow = true;
      g.add(p);
    }
  }
  // Bus-stop shelter behind the queue head.
  const shelterMat = new THREE.MeshStandardMaterial({ color: 0x2f7cf6, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, transparent: true, opacity: 0.45 });
  const sx = queueHalfW + 0.25;
  const roof = new THREE.Mesh(rbox(1.3, 0.08, 0.8, 0.03), shelterMat);
  roof.position.set(sx, 1.05, queueHeadZ - 0.1);
  roof.castShadow = true;
  const back = new THREE.Mesh(box(1.2, 0.85, 0.04), glassMat);
  back.position.set(sx, 0.6, queueHeadZ - 0.45);
  const pole1 = new THREE.Mesh(box(0.06, 1.0, 0.06), shelterMat);
  pole1.position.set(sx - 0.6, 0.55, queueHeadZ - 0.45);
  const pole2 = pole1.clone();
  pole2.position.x = sx + 0.6;
  const sign = new THREE.Mesh(cached('signGeo', () => new THREE.CylinderGeometry(0.17, 0.17, 0.04, 20)), shelterMat);
  sign.rotation.x = Math.PI / 2;
  sign.position.set(-queueHalfW - 0.4, 1.2, queueHeadZ + 0.2);
  const signPole = new THREE.Mesh(box(0.05, 1.2, 0.05), curbMat);
  signPole.position.set(-queueHalfW - 0.4, 0.6, queueHeadZ + 0.2);
  g.add(roof, back, pole1, pole2, sign, signPole);

  // Scenery around the edges.
  const zTop = queueHeadZ - swDepth + 0.3;
  const zBot = ring.z1 + 1.4;
  const xEdge = Math.max(roadX1, padHalf) + 0.9;
  for (let z = zTop - 1.5; z < zBot + 6; z += 1.3 + rng() * 0.6) {
    for (const side of [-1, 1]) {
      const x = side * (xEdge + rng() * 1.6);
      if (z > exitZ - 1.3 && z < exitZ + 1.0) continue; // keep the exit road clear
      if (rng() < 0.62) addTree(g, x, z, 0.8 + rng() * 0.5, rng);
      else addBush(g, x, z, 0.9 + rng() * 0.4, rng);
    }
  }
  for (let x = -xEdge; x < xEdge; x += 1.4 + rng() * 0.8) {
    if (rng() < 0.55) addTree(g, x, zBot + 0.4 + rng() * 1.5, 0.8 + rng() * 0.5, rng);
    else addBush(g, x, zBot + 0.2 + rng() * 0.5, 1, rng);
    if (rng() < 0.5) addFlowerBed(g, x + 0.6, zBot + 1.6 + rng(), rng);
    if (rng() < 0.7) addTree(g, x + 0.3, zTop - 0.6 - rng() * 1.5, 0.9 + rng() * 0.5, rng);
  }

  return g;
}
