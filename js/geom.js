// 2D oriented-box math on the ground plane (x, z). Heading angle a: forward = (sin a, -cos a),
// so a = 0 points "up" the screen (toward -z).

export function dirVec(a) {
  return { x: Math.sin(a), z: -Math.cos(a) };
}

export function headingOf(dx, dz) {
  return Math.atan2(dx, -dz);
}

export function makeOBB(x, z, a, hl, hw) {
  const f = dirVec(a);
  return { x, z, f, r: { x: -f.z, z: f.x }, hl, hw };
}

function project(o, ax) {
  const c = o.x * ax.x + o.z * ax.z;
  const e = o.hl * Math.abs(o.f.x * ax.x + o.f.z * ax.z) + o.hw * Math.abs(o.r.x * ax.x + o.r.z * ax.z);
  return [c - e, c + e];
}

// True if boxes overlap. A negative gap requires at least |gap| clearance between them.
export function overlaps(a, b, gap = 0) {
  for (const ax of [a.f, a.r, b.f, b.r]) {
    const [a0, a1] = project(a, ax);
    const [b0, b1] = project(b, ax);
    if (a1 <= b0 - gap || b1 <= a0 - gap) return false;
  }
  return true;
}

// Distance box `a` can travel along its own forward axis before touching `b` (Infinity if never).
export function sweepDistance(a, b, pad = 0.01) {
  let enter = -Infinity;
  let exit = Infinity;
  for (const ax of [a.f, a.r, b.f, b.r]) {
    const [a0, a1] = project(a, ax);
    let [b0, b1] = project(b, ax);
    b0 += pad;
    b1 -= pad;
    const v = a.f.x * ax.x + a.f.z * ax.z;
    if (Math.abs(v) < 1e-9) {
      if (a1 <= b0 || b1 <= a0) return Infinity;
      continue;
    }
    let t0 = (b0 - a1) / v;
    let t1 = (b1 - a0) / v;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > enter) enter = t0;
    if (t1 < exit) exit = t1;
    if (enter >= exit) return Infinity;
  }
  if (exit <= 0) return Infinity;
  return Math.max(enter, 0);
}

// Axis-aligned half extents of an OBB.
export function extents(o) {
  return {
    ex: o.hl * Math.abs(o.f.x) + o.hw * Math.abs(o.r.x),
    ez: o.hl * Math.abs(o.f.z) + o.hw * Math.abs(o.r.z),
  };
}

// Smooth a polyline by rounding each interior corner with a circular-ish arc.
export function roundedPath(points, radius = 0.9, step = 0.12) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
    const d1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const d2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    if (d1 < 1e-6 || d2 < 1e-6) continue;
    const r = Math.min(radius, d1 * 0.5, d2 * 0.5);
    const a = { x: p1.x - (p1.x - p0.x) / d1 * r, z: p1.z - (p1.z - p0.z) / d1 * r };
    const b = { x: p1.x + (p2.x - p1.x) / d2 * r, z: p1.z + (p2.z - p1.z) / d2 * r };
    out.push(a);
    const n = Math.max(2, Math.ceil((r * 2) / step));
    for (let k = 1; k < n; k++) {
      const t = k / n, u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * p1.x + t * t * b.x,
        z: u * u * a.z + 2 * u * t * p1.z + t * t * b.z,
      });
    }
    out.push(b);
  }
  out.push(points[points.length - 1]);
  return makePath(out);
}

export function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

// Position and heading at arc length s.
export function samplePath(path, s) {
  const { pts, cum, total } = path;
  if (pts.length === 1) return { x: pts[0].x, z: pts[0].z, a: null };
  s = Math.max(0, Math.min(total, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  const p = pts[lo], q = pts[hi];
  return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, a: headingOf(q.x - p.x, q.z - p.z) };
}

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
