// The passenger track: a closed loop that keeps rotating, fed by one or two arms.
// Passengers ride the loop in ranks of PER_RANK; whoever passes the gate (the bottom of
// the loop) boards a parked vehicle of their color.

export const PER_RANK = 4;
export const LANE_SP = 0.27; // sideways spacing inside a rank
export const RANK_SP = 0.3; // target spacing between ranks along the track
export const TRACK_W = PER_RANK * LANE_SP + 0.3;

// Later levels get a smaller loop, so fewer people circle at once and more wait in the arms.
export function trackStyle(n) {
  if (n <= 3) return { shape: 'oval', arms: 1, scale: 1 };
  const shapes = ['oval', 'stadium', 'peanut', 'heart'];
  const scale = n < 10 ? 0.9 : n < 20 ? 0.66 : 0.42;
  return { shape: shapes[n % shapes.length], arms: n % 3 === 0 ? 1 : 2, scale };
}

function shapePoint(shape, t, rx, rz) {
  // t runs clockwise on screen starting at the bottom (gate). z grows toward the bays.
  const a = Math.PI / 2 + t;
  let x = Math.cos(a) * rx;
  let z = Math.sin(a) * rz;
  if (shape === 'stadium') {
    // Squarer loop with rounded corners (superellipse).
    const c = Math.cos(a), s = Math.sin(a);
    x = Math.sign(c) * Math.pow(Math.abs(c), 0.55) * rx;
    z = Math.sign(s) * Math.pow(Math.abs(s), 0.55) * rz;
  } else if (shape === 'peanut') {
    // Pinched in the middle like a peanut shell.
    x *= 1.05;
    z = Math.sin(a) * rz * (0.7 + 0.42 * Math.abs(Math.cos(a)));
  } else if (shape === 'heart') {
    // A dip at the top centre gives a soft heart/U look.
    const dip = Math.exp(-Math.pow((x / rx) / 0.35, 2)) * (Math.sin(a) < 0 ? 0.45 * rz : 0);
    z += dip;
  }
  return { x, z };
}

function resample(raw, closed, count) {
  const cum = [0];
  const n = raw.length;
  const segs = closed ? n : n - 1;
  for (let i = 1; i <= segs; i++) {
    const p = raw[i - 1], q = raw[i % n];
    cum.push(cum[i - 1] + Math.hypot(q.x - p.x, q.z - p.z));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / (closed ? count : count - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const p = raw[j], q = raw[(j + 1) % n];
    const t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
  }
  return { pts: out, total };
}

function tangents(pts, closed) {
  return pts.map((p, i) => {
    const a = pts[closed ? (i - 1 + pts.length) % pts.length : Math.max(0, i - 1)];
    const b = pts[closed ? (i + 1) % pts.length : Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  });
}

// Builds the track for a level. `gate` is where the loop's bottom sits; `halfW` limits width.
export function buildTrack(style, gate, halfW, topZ) {
  const sc = style.scale ?? 1;
  const rx = Math.min(halfW - TRACK_W, 3.6) * sc + 0.4 * (1 - sc);
  const rz = 1.85 * (0.75 + 0.25 * sc);
  const raw = [];
  for (let i = 0; i < 480; i++) {
    const p = shapePoint(style.shape, (i / 480) * Math.PI * 2, rx, rz);
    raw.push({ x: gate.x + p.x, z: gate.z - rz + p.z });
  }
  // Shift so the lowest point is exactly at the gate.
  let maxZ = -Infinity;
  for (const p of raw) maxZ = Math.max(maxZ, p.z);
  for (const p of raw) p.z += gate.z - maxZ;
  let len = 0;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i], q = raw[(i + 1) % raw.length];
    len += Math.hypot(q.x - p.x, q.z - p.z);
  }
  const ranks = Math.max(24, Math.round(len / RANK_SP));
  const loop = resample(raw, true, ranks);
  const loopTan = tangents(loop.pts, true);

  // Gate: the rank nearest the bottom centre.
  let gateIdx = 0, best = -Infinity;
  loop.pts.forEach((p, i) => { const sc = p.z - Math.abs(p.x - gate.x) * 0.5; if (sc > best) { best = sc; gateIdx = i; } });

  // Merge points: top-left (and top-right), where arms join.
  const mergeTargets = style.arms === 2 ? [-0.62, 0.62] : [-0.62];
  const merges = mergeTargets.map((fx) => {
    let bi = 0, bd = Infinity;
    loop.pts.forEach((p, i) => {
      const d = Math.hypot(p.x - (gate.x + fx * rx), p.z - (gate.z - 2 * rz));
      if (d < bd) { bd = d; bi = i; }
    });
    return bi;
  });

  // Arms run from each merge point up and off the top of the screen.
  const arms = merges.map((mi, k) => {
    const m = loop.pts[mi];
    const side = style.arms === 2 ? (k === 0 ? -1 : 1) : -1;
    const ctrl = [
      { x: m.x, z: m.z },
      { x: m.x + side * 0.35, z: m.z - 0.9 },
      { x: m.x + side * 0.9, z: m.z - 1.9 },
      { x: m.x + side * 1.0, z: topZ - 2 },
      { x: m.x + side * 1.0, z: topZ - 14 },
    ];
    const smooth = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      for (let s = 0; s < 16; s++) {
        const t = s / 16, t2 = t * t, t3 = t2 * t;
        smooth.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        });
      }
    }
    smooth.push(ctrl[ctrl.length - 1]);
    let alen = 0;
    for (let i = 1; i < smooth.length; i++) alen += Math.hypot(smooth[i].x - smooth[i - 1].x, smooth[i].z - smooth[i - 1].z);
    const count = Math.round(alen / RANK_SP);
    const r = resample(smooth, false, count);
    // Arm direction of travel is toward the loop, so tangents point from index i+1 to i.
    const tan = tangents(r.pts, false).map((t) => ({ x: -t.x, z: -t.z }));
    return { pts: r.pts, tan, mergeIdx: mi };
  });

  return { loop: loop.pts, loopTan, ranks, gateIdx, merges, arms, rx, rz };
}

// Lateral offset of lane `l` across the track, from the track's tangent.
export function laneOffset(tan, l) {
  const off = (l - (PER_RANK - 1) / 2) * LANE_SP;
  return { x: -tan.z * off, z: tan.x * off };
}

// ---------- Pure ring logic (shared by the generator's solver check and the game) ----------
// ring.cells[c] is an array of PER_RANK colors (or null). Rank content c sits at loop position
// (c + offset) % ranks; every tick offset grows by one, moving every rank one step along.
export function makeRing(ranks) {
  return { ranks, offset: 0, cells: Array.from({ length: ranks }, () => new Array(PER_RANK).fill(null)) };
}
export function cellAt(ring, pos) {
  return ((pos - ring.offset) % ring.ranks + ring.ranks) % ring.ranks;
}
