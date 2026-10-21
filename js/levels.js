import { makeOBB, overlaps, sweepDistance, extents } from './geom.js';
import { buildTrack, trackStyle, makeRing, cellAt, PER_RANK } from './track.js';

export const COLORS = [
  { name: 'red', hex: 0xff4a4a },
  { name: 'blue', hex: 0x3b82f6 },
  { name: 'yellow', hex: 0xffcc1f },
  { name: 'green', hex: 0x2fc764 },
  { name: 'purple', hex: 0x9b5cf6 },
  { name: 'orange', hex: 0xff8a1f },
  { name: 'pink', hex: 0xff6fb1 },
  { name: 'cyan', hex: 0x1fd2ea },
];

export const TYPES = {
  car: { len: 1.36, wid: 0.9, seats: 4 },
  van: { len: 1.86, wid: 0.94, seats: 8 },
  bus: { len: 2.5, wid: 0.98, seats: 12 },
};
// Half the width of the parking row (VIP + 4 spots + 3 locked); the track shares it.
export const ROW_HALF_W = 5.0;

export const MAX_LEVEL = 500;
const GAP = 0.08;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Hard levels start at 9 and come every 5 levels; every 10th level from 20 is Super Hard.
export function levelKind(n) {
  if (n >= 20 && n % 10 === 0) return 'super';
  if (n >= 9 && n % 5 === 4) return 'hard';
  return 'normal';
}

// Every level starts with 4 regular parking spots (extra locked spots are opened in-game).
// `buffer` is how many spots the intended solution leaves spare.
export const BASE_SLOTS = 4;

export function levelParams(n) {
  const kind = levelKind(n);
  const slots = BASE_SLOTS;
  let vehicles, colors, buffer, stick, mystery, diag;
  if (n === 1) {
    vehicles = 4; colors = 2; buffer = 2; stick = 1; mystery = 0; diag = false;
  } else if (n === 2) {
    vehicles = 7; colors = 3; buffer = 2; stick = 0.9; mystery = 0; diag = false;
  } else if (n === 3) {
    vehicles = 10; colors = 3; buffer = 2; stick = 0.85; mystery = 0; diag = false;
  } else {
    vehicles = Math.round(Math.min(12 + n * 0.75, 58));
    colors = Math.min(3 + Math.floor(n / 6), 8);
    buffer = n < 15 ? 2 : n % 2 === 0 ? 1 : 2;
    stick = Math.max(0.45, 0.85 - n * 0.008);
    // "?" vehicles arrive at level 10.
    mystery = n < 10 ? 0 : Math.min(0.1 + n * 0.003, 0.3);
    diag = false;
  }
  if (kind === 'hard') { vehicles = Math.round(vehicles * 1.2); buffer = 1; stick -= 0.1; colors = Math.min(colors + 1, 8); }
  if (kind === 'super') { vehicles = Math.round(vehicles * 1.35); buffer = 1; stick -= 0.15; mystery += 0.1; colors = Math.min(colors + 1, 8); }
  vehicles = Math.min(vehicles, 64);
  const dig = n < 6 ? 0 : Math.min(0.85, (n < 15 ? 0.45 : 0.65) + (kind === 'normal' ? 0 : 0.15));
  return { n, kind, vehicles, colors, slots, buffer, stick, mystery, diag, dig };
}

function lotSize(target) {
  const area = target * 2.3 + 8;
  const w = Math.max(5.5, Math.min(9.8, Math.sqrt(area * 0.8)));
  const h = Math.max(5.5, Math.min(12.5, area / w));
  return { w: Math.round(w * 2) / 2, h: Math.round(h * 2) / 2 };
}

function pickType(rng, n) {
  const r = rng();
  if (n <= 2) return r < 0.5 ? 'bus' : r < 0.8 ? 'van' : 'car';
  return r < 0.36 ? 'bus' : r < 0.68 ? 'van' : 'car';
}

// Vehicles are placed one at a time and each new vehicle must have a clear path out
// past every vehicle already on the lot. Reversing the placement order therefore always
// gives a valid escape order, so every generated level is solvable.
export function generateLevel(n) {
  const p = levelParams(n);
  for (let attempt = 0; attempt < 6; attempt++) {
    const lvl = tryGenerate(n, p, attempt);
    if (lvl.vehicles.length >= Math.min(p.vehicles, 4) * 0.8) return lvl;
  }
  return tryGenerate(n, p, 99);
}

function tryGenerate(n, p, salt) {
  const rng = mulberry32(n * 7919 + 104729 + salt * 31337);
  const { w, h } = lotSize(p.vehicles);
  const dirs = p.diag ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 2, 4, 6];
  const margin = 0.18;
  const snap = 0.25;
  const placed = [];

  // Each new vehicle must fit and have a clear path out past every vehicle already on the
  // lot, so reversing the placement order is always a valid escape order: every level is
  // solvable. Candidates closest to the middle win, so the jam grows outward from the
  // centre and stays dense, with the outer ring naturally facing out.
  const valid = (type, x, z, d) => {
    const t = TYPES[type];
    const o = makeOBB(x, z, (d * Math.PI) / 4, t.len / 2, t.wid / 2);
    const { ex, ez } = extents(o);
    if (Math.abs(x) + ex > w / 2 - margin || Math.abs(z) + ez > h / 2 - margin) return null;
    for (const q of placed) if (overlaps(o, q.obb, -GAP)) return null;
    for (const q of placed) if (sweepDistance(o, q.obb) !== Infinity) return null;
    return o;
  };
  let misses = 0;
  while (placed.length < p.vehicles && misses < 6) {
    let best = null;
    let bestScore = Infinity;
    const first = pickType(rng, n);
    for (const type of [first, 'van', 'car']) {
      for (let k = 0; k < 700; k++) {
        const x = Math.round(((rng() - 0.5) * w) / snap) * snap;
        const z = Math.round(((rng() - 0.5) * h) / snap) * snap;
        let d = dirs[Math.floor(rng() * dirs.length)];
        if (p.diag && d % 2 === 1 && rng() < 0.6) d = (d + 1) % 8; // mostly straight
        const o = valid(type, x, z, d);
        if (!o) continue;
        const score = (x / w) ** 2 + (z / h) ** 2 + rng() * 0.04;
        if (score < bestScore) { bestScore = score; best = { type, x, z, dir: d, obb: o }; }
      }
      if (best) break;
    }
    if (best) { placed.push(best); misses = 0; } else misses++;
  }

  // Colors: vehicles that leave around the same time often share a color, which is what
  // gives the waiting crowd its long single-color blocks. Every color shows up at least once.
  const nColors = Math.min(p.colors, placed.length);
  const palette = shuffle(COLORS.map((_, i) => i), rng).slice(0, nColors);
  const colorIdx = new Array(placed.length);
  let unused = palette.slice();
  let prev = -1;
  for (let e = 0; e < placed.length;) {
    let c;
    if (unused.length && rng() < 0.6) c = unused.splice(Math.floor(rng() * unused.length), 1)[0];
    else { do { c = palette[Math.floor(rng() * nColors)]; } while (nColors > 1 && c === prev); }
    unused = unused.filter((u) => u !== c);
    const run = n < 10 ? 1 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 3);
    for (let k = 0; k < run && e < placed.length; k++, e++) colorIdx[placed.length - 1 - e] = c;
    prev = c;
  }

  const vehicles = placed.map((v, i) => ({
    id: i,
    type: v.type,
    x: v.x,
    z: v.z,
    dir: v.dir,
    color: colorIdx[i],
    mystery: false,
  }));

  // Only vehicles that start out blocked get hidden, so the "?" actually means something.
  if (p.mystery > 0) {
    vehicles.forEach((v, i) => {
      const blocked = placed.some((q, j) => j !== i && sweepDistance(placed[i].obb, q.obb) !== Infinity);
      if (blocked && rng() < p.mystery * 1.6) v.mystery = true;
    });
  }

  // Passenger stream: replay the escape order while keeping at most `open` vehicles
  // parked, which leaves `buffer` spare spots for the player's mistakes.
  const escape = vehicles.slice().reverse();
  const style = trackStyle(n);
  const track = buildTrack(style, { x: 0, z: 0 }, ROW_HALF_W, -4);
  // The loop starts packed and the rest of the crowd waits in the arms. If the check finds
  // a deadlock, leave gaps on the loop (so the arms keep flowing) and allow one more parked
  // vehicle, then try again.
  const total = escape.reduce((a, v) => a + TYPES[v.type].seats, 0);
  let setup = null;
  for (let tryNo = 0; tryNo < 8 && !setup; tryNo++) {
    const openLimit = Math.max(1, Math.min(p.slots, p.slots - p.buffer + (tryNo >= 4 ? 1 : 0)));
    const stream = makeStream(escape, openLimit, p.stick - (tryNo % 4) * 0.05, rng, p.dig);
    const onLoop = Math.round(track.ranks * PER_RANK * (1 - (tryNo % 4) * 0.15));
    const start = placeStream(stream, track, style.arms, onLoop);
    if (simulate(start, track, escape, openLimit)) { setup = start; setup.tries = tryNo; }
  }
  if (!setup) {
    const stream = makeStream(escape, p.slots, 0.5, rng);
    setup = placeStream(stream, track, style.arms, Math.round(track.ranks * PER_RANK * 0.5));
    setup.tries = 99;
  }

  // Shrink the lot to hug the jam so smaller levels don't float in empty asphalt.
  let mx = 0, mz = 0;
  for (const v of placed) {
    const { ex, ez } = extents(v.obb);
    mx = Math.max(mx, Math.abs(v.x) + ex);
    mz = Math.max(mz, Math.abs(v.z) + ez);
  }
  const lotW = Math.min(w, Math.max(5.5, Math.ceil((mx + 0.35) * 4) / 2));
  const lotH = Math.min(h, Math.max(5.5, Math.ceil((mz + 0.35) * 4) / 2));
  return { n, kind: p.kind, lotW, lotH, slots: p.slots, buffer: p.buffer, vehicles, style, ring: setup.ring, arms: setup.arms,
    total, tries: setup.tries };
}

// `dig` is how often the next passengers belong to the most recently freed vehicle: the deeper
// it is, the more the player has to park other vehicles first to reach it.
function makeStream(escape, openLimit, stick, rng, dig = 0) {
  const open = [];
  let next = 0;
  const stream = [];
  while (open.length < openLimit && next < escape.length) {
    const v = escape[next++];
    open.push({ v, rem: TYPES[v.type].seats });
  }
  // Passengers come in blocks of one color, a rank or more at a time.
  let last = -1;
  while (open.length) {
    let color;
    if (last >= 0 && open.some((o) => o.v.color === last) && rng() < stick) color = last;
    else if (rng() < dig) color = open[open.length - 1].v.color;
    else color = open[Math.floor(rng() * open.length)].v.color;
    let block = PER_RANK * (3 + Math.floor(rng() * 4));
    last = color;
    while (block-- > 0) {
      const target = open.find((o) => o.v.color === color);
      if (!target) break;
      target.rem--;
      stream.push(color);
      if (target.rem === 0) {
        open.splice(open.indexOf(target), 1);
        if (next < escape.length) {
          const v = escape[next++];
          open.push({ v, rem: TYPES[v.type].seats });
        }
      }
    }
  }
  return stream;
}

// Lays the stream out so the gate meets it in order: the loop first, then the arms.
function placeStream(stream, track, armCount, onLoop) {
  const ring = makeRing(track.ranks);
  const loopRanks = Math.min(track.ranks, Math.ceil(Math.min(onLoop, stream.length) / PER_RANK));
  let i = 0;
  for (let k = 0; k < loopRanks; k++) {
    const pos = ((track.gateIdx - 1 - k) % track.ranks + track.ranks) % track.ranks;
    for (let l = 0; l < PER_RANK && i < stream.length; l++) ring.cells[cellAt(ring, pos)][l] = stream[i++];
  }
  const arms = Array.from({ length: armCount }, () => []);
  let a = 0;
  while (i < stream.length) {
    for (let l = 0; l < PER_RANK && i < stream.length; l++) arms[a].push(stream[i++]);
    a = (a + 1) % armCount;
  }
  return { ring: { offset: ring.offset, cells: ring.cells.map((c) => c.slice()) }, arms };
}

// One tick of the loop: rotate, let the rank at the gate board, then refill from the arms.
export function ringTick(ring, track, arms, tryBoard) {
  ring.offset++;
  const g = ring.cells[cellAt(ring, track.gateIdx)];
  for (let l = 0; l < PER_RANK; l++) {
    if (g[l] !== null && tryBoard(g[l], l)) g[l] = null;
  }
  track.merges.forEach((m, k) => {
    const arm = arms[k];
    if (!arm || !arm.length) return;
    const cell = ring.cells[cellAt(ring, m)];
    for (let l = 0; l < PER_RANK && arm.length; l++) {
      if (cell[l] === null) cell[l] = arm.shift();
    }
  });
}

// Plays the level the intended way (tap in escape order, keep `openLimit` parked) with the
// rotating loop, to make sure the passenger layout can't deadlock.
function simulate(start, track, escape, openLimit) {
  const ring = { ranks: track.ranks, offset: start.ring.offset, cells: start.ring.cells.map((c) => c.slice()) };
  const arms = start.arms.map((a) => a.slice());
  const total = escape.reduce((a, v) => a + TYPES[v.type].seats, 0);
  const open = [];
  let next = 0, boarded = 0, idle = 0;
  const refill = () => {
    while (open.length < openLimit && next < escape.length) {
      const v = escape[next++];
      open.push({ color: v.color, rem: TYPES[v.type].seats });
    }
  };
  refill();
  while (boarded < total) {
    let got = false;
    ringTick(ring, track, arms, (color) => {
      const o = open.find((x) => x.color === color && x.rem > 0);
      if (!o) return false;
      o.rem--;
      boarded++;
      got = true;
      if (o.rem === 0) { open.splice(open.indexOf(o), 1); refill(); }
      return true;
    });
    idle = got ? 0 : idle + 1;
    if (idle > track.ranks * 2 + 10) return false;
  }
  return true;
}
