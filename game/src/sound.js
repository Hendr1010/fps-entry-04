// sound.js — all audio is synthesized with WebAudio. No audio files.
export function createSound() {
  let ctx = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, slideTo) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  }
  function noise(dur, vol, low) {
    const c = ac(); if (!c) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low || 1200;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  }
  return {
    unlock() { ac(); },
    shoot(kind) {
      if (kind === 'sniper') { noise(0.22, 0.5, 900); tone(160, 0.18, 'square', 0.25, 50); }
      else if (kind === 'smg') { noise(0.07, 0.28, 1800); tone(320, 0.05, 'square', 0.12, 180); }
      else { noise(0.12, 0.4, 1400); tone(220, 0.09, 'square', 0.2, 90); }
    },
    enemyShoot() { noise(0.1, 0.16, 1000); },
    hit() { tone(1200, 0.06, 'sine', 0.25, 900); },
    headshot() { tone(1600, 0.1, 'sine', 0.3, 700); tone(2200, 0.08, 'sine', 0.2, 1200); },
    kill() { tone(520, 0.12, 'triangle', 0.3, 780); tone(780, 0.16, 'triangle', 0.3, 1040); },
    hurt() { tone(140, 0.15, 'sawtooth', 0.25, 70); },
    reload() { tone(500, 0.05, 'square', 0.15); setTimeout(() => tone(700, 0.05, 'square', 0.15), 180); },
    dry() { tone(900, 0.04, 'square', 0.12); },
    pickup() { tone(660, 0.07, 'sine', 0.25, 990); },
    plant() { tone(440, 0.1, 'sine', 0.25, 660); },
    beep() { tone(880, 0.08, 'sine', 0.22); },
    explode() { noise(0.7, 0.7, 400); tone(90, 0.6, 'sine', 0.5, 30); },
    zoneWarn() { tone(330, 0.2, 'sawtooth', 0.2, 220); tone(330, 0.2, 'sawtooth', 0.2, 220); },
    roundWin() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.3), i * 120)); },
    roundLose() { [400, 350, 300, 200].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.25), i * 130)); },
  };
}
