// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let master = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.2, freq = 800, delay = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
}

export const sfx = {
  tap() { tone({ freq: 660, to: 880, type: 'triangle', dur: 0.08, vol: 0.25 }); },
  go() {
    tone({ freq: 220, to: 330, type: 'sawtooth', dur: 0.25, vol: 0.06 });
    noise({ dur: 0.3, vol: 0.12, freq: 600 });
  },
  honk() {
    tone({ freq: 392, type: 'square', dur: 0.16, vol: 0.09 });
    tone({ freq: 494, type: 'square', dur: 0.16, vol: 0.07 });
    tone({ freq: 392, type: 'square', dur: 0.2, vol: 0.09, delay: 0.2 });
    tone({ freq: 494, type: 'square', dur: 0.2, vol: 0.07, delay: 0.2 });
  },
  bump() {
    tone({ freq: 140, to: 60, type: 'sine', dur: 0.18, vol: 0.45 });
    noise({ dur: 0.12, vol: 0.2, freq: 400 });
  },
  park() { tone({ freq: 520, to: 780, type: 'triangle', dur: 0.12, vol: 0.18 }); },
  board(i) {
    const f = 520 * Math.pow(2, (i % 12) / 12);
    tone({ freq: f, to: f * 1.5, type: 'sine', dur: 0.09, vol: 0.18 });
  },
  full() {
    tone({ freq: 660, type: 'triangle', dur: 0.1, vol: 0.2 });
    tone({ freq: 880, type: 'triangle', dur: 0.1, vol: 0.2, delay: 0.08 });
    tone({ freq: 1320, type: 'triangle', dur: 0.18, vol: 0.18, delay: 0.16 });
  },
  depart() { noise({ dur: 0.5, vol: 0.12, freq: 900 }); },
  win() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.22, delay: i * 0.11 }));
  },
  lose() {
    [392, 330, 262].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.22, delay: i * 0.18 }));
  },
  coin() {
    tone({ freq: 988, type: 'square', dur: 0.06, vol: 0.08 });
    tone({ freq: 1319, type: 'square', dur: 0.14, vol: 0.08, delay: 0.06 });
  },
  booster() {
    tone({ freq: 440, to: 1320, type: 'sine', dur: 0.35, vol: 0.2 });
  },
  whoosh() { noise({ dur: 0.45, vol: 0.18, freq: 1800 }); },
  error() { tone({ freq: 200, type: 'square', dur: 0.14, vol: 0.08 }); },
};
