// All sound is synthesized with WebAudio and pushed through a clipping, compressed
// "small microphone" chain so it sounds recorded rather than mixed.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.lx = 0; this.ly = 0; this.lz = 0; this.rx = 1; this.rz = 0; // listener position and right vector
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.25;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * 2.6) / Math.tanh(2.6); }
    shaper.curve = curve;
    const band = ctx.createBiquadFilter();
    band.type = 'highshelf'; band.frequency.value = 5200; band.gain.value = -9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 90;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.master.connect(hp); hp.connect(shaper); shaper.connect(band); band.connect(comp); comp.connect(ctx.destination);

    // noise source
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // concrete-room reverb
    const rl = Math.floor(ctx.sampleRate * 1.7);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const b = ir.getChannelData(ch);
      for (let i = 0; i < rl; i++) {
        const t = i / rl;
        b[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 600 ? i / 600 : 1);
      }
      for (let k = 0; k < 9; k++) { const at = Math.floor(Math.random() * rl * 0.12); b[at] += (Math.random() - 0.5) * 1.6; }
    }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.5;
    this.reverb.connect(rg); rg.connect(this.master);

    // room tone: wind through broken windows
    const amb = ctx.createBufferSource(); amb.buffer = this.noise; amb.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.4;
    const ag = ctx.createGain(); ag.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 140;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    amb.connect(lp); lp.connect(ag); ag.connect(this.master); amb.start();
  }

  setListener(pos, right) { this.lx = pos.x; this.ly = pos.y; this.lz = pos.z; this.rx = right.x; this.rz = right.z; }

  // distance attenuation and stereo placement for a world position
  place(p) {
    if (!p) return { gain: 1, pan: 0, dist: 0 };
    const dx = p.x - this.lx, dy = p.y - this.ly, dz = p.z - this.lz;
    const dist = Math.hypot(dx, dy, dz);
    const pan = dist > 0.01 ? Math.max(-1, Math.min(1, (dx * this.rx + dz * this.rz) / dist)) : 0;
    return { gain: 1 / (1 + dist * 0.16), pan: pan * 0.8, dist };
  }

  out(gain, pan, send) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    let tail = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); tail = p; }
    tail.connect(this.master);
    if (send > 0) { const s = ctx.createGain(); s.gain.value = send; tail.connect(s); s.connect(this.reverb); }
    return g;
  }

  burst(dest, t0, dur, type, f0, f1, q, peak, attack = 0.002) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.loopStart = Math.random(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }

  tone(dest, t0, dur, wave, f0, f1, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = wave;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  shot(p, kind = 'rifle') {
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, own = !p;
    const far = Math.min(1, pl.dist / 22);
    const o = this.out((own ? 1.0 : 0.85) * pl.gain, pl.pan, own ? 0.55 : 0.8);
    if (kind === 'pistol') {
      this.burst(o, t, 0.13, 'lowpass', 6200, 700, 0.7, 1.25);
      this.burst(o, t, 0.028, 'bandpass', 3600, 2200, 1.4, 1.2);
      this.tone(o, t, 0.08, 'sine', 220, 70, 0.9);
      this.burst(o, t + 0.035, 0.03, 'highpass', 5000, 3600, 0.8, 0.14);
    } else if (kind === 'shotgun') {
      this.burst(o, t, 0.36, 'lowpass', 5200, 260, 0.7, 1.9);
      this.burst(o, t, 0.05, 'bandpass', 1900, 900, 1.0, 1.4);
      this.tone(o, t, 0.22, 'sine', 115, 30, 1.9);
    } else if (kind === 'thump') {
      this.tone(o, t, 0.17, 'sine', 250, 62, 1.6);
      this.burst(o, t, 0.12, 'lowpass', 1000, 180, 1.2, 0.9);
      this.burst(o, t + 0.02, 0.05, 'bandpass', 2400, 1500, 2, 0.25);
    } else {
      this.burst(o, t, 0.2 + far * 0.1, 'lowpass', 7000 - far * 5200, 500, 0.7, 1.5);
      this.burst(o, t, 0.035, 'bandpass', 2800 - far * 1500, 1600, 1.2, own ? 1.3 : 0.6);
      this.tone(o, t, 0.13, 'sine', 150, 42, 1.4);
      if (own) this.burst(o, t + 0.03, 0.05, 'highpass', 4000, 3000, 0.8, 0.15); // action cycling
    }
  }

  boom(p) {
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(Math.min(1.4, 2.2 * pl.gain), pl.pan, 0.9);
    this.burst(o, t, 0.9, 'lowpass', 2600, 60, 0.7, 2.3);
    this.tone(o, t, 0.7, 'sine', 72, 24, 2.2);
    this.burst(o, t + 0.06, 0.5, 'bandpass', 1300, 300, 0.9, 0.6); // grit raining back down
  }

  // One object knocking against another. kind: wood, metal, tin, glass, hard or soft.
  knock(p, strength, kind) {
    if (!this.ctx || strength < 0.04) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(0.7 * strength * pl.gain, pl.pan, 0.35), r = 0.85 + Math.random() * 0.3;
    if (kind === 'metal') { this.tone(o, t, 0.28, 'triangle', 190 * r, 170 * r, 0.9); this.tone(o, t, 0.2, 'sine', 470 * r, 455 * r, 0.4); this.burst(o, t, 0.04, 'bandpass', 2400, 1200, 1.5, 0.7); }
    else if (kind === 'tin') { this.tone(o, t, 0.1, 'triangle', 900 * r, 820 * r, 0.6); this.burst(o, t, 0.05, 'bandpass', 3800 * r, 2200, 2.5, 0.8); }
    else if (kind === 'glass') { this.tone(o, t, 0.12, 'sine', 2300 * r, 2250 * r, 0.6); this.burst(o, t, 0.03, 'highpass', 4200, 3000, 1, 0.3); }
    else if (kind === 'wood') { this.burst(o, t, 0.09, 'lowpass', 950 * r, 180, 1.2, 1.0, 0.003); this.tone(o, t, 0.07, 'sine', 170 * r, 95, 0.7); }
    else if (kind === 'hard') { this.burst(o, t, 0.06, 'bandpass', 2600 * r, 1100, 1.4, 1.0); this.burst(o, t, 0.1, 'lowpass', 500, 140, 0.9, 0.6); }
    else this.burst(o, t, 0.11, 'lowpass', 520 * r, 110, 0.9, 0.9, 0.006);
  }

  glass(p) {
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(0.6 * pl.gain, pl.pan, 0.4);
    this.burst(o, t, 0.2, 'highpass', 5200, 2600, 0.8, 0.9);
    for (let i = 0; i < 5; i++) { const f = 2400 + Math.random() * 5200; this.tone(o, t + Math.random() * 0.12, 0.06 + Math.random() * 0.1, 'sine', f, f * 0.97, 0.3); }
  }

  hiss(p, dur) {
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(0.5 * pl.gain, pl.pan, 0.3);
    this.burst(o, t, dur, 'highpass', 5600, 3200, 0.7, 0.8, 0.04);
  }

  // The echo pulse: a sonar-like ping that everyone in the building can hear.
  ping() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(0.5, 0, 1.0);
    this.tone(o, t, 0.9, 'sine', 1480, 1465, 0.55);
    this.tone(o, t, 0.5, 'sine', 2960, 2940, 0.12);
    this.tone(o, t, 0.25, 'sine', 90, 40, 0.8);
    this.burst(o, t, 0.5, 'bandpass', 1480, 1400, 14, 0.35, 0.01);
  }

  dry() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(0.5, 0, 0.1);
    this.burst(o, t, 0.03, 'bandpass', 3200, 2400, 3, 0.7);
  }

  reload(stage) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(0.6, 0.15, 0.15);
    if (stage === 0) { this.burst(o, t, 0.06, 'bandpass', 1800, 900, 2.5, 0.8); this.burst(o, t + 0.08, 0.12, 'lowpass', 900, 300, 1, 0.35); }
    else if (stage === 1) { this.burst(o, t, 0.05, 'bandpass', 1400, 2400, 2.5, 0.9); this.tone(o, t, 0.05, 'square', 180, 90, 0.2); }
    else { this.burst(o, t, 0.04, 'bandpass', 2600, 1700, 3, 0.9); this.burst(o, t + 0.09, 0.05, 'bandpass', 3200, 2200, 3, 1.0); }
  }

  // a polymer-and-steel magazine hitting concrete: a dull knock with a short rattle of the rounds or spring
  magDrop(p, hard = 1) {
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(0.5 * pl.gain * (0.4 + hard * 0.6), pl.pan, 0.35);
    this.burst(o, t, 0.07, 'lowpass', 900, 220, 1.2, 1.0, 0.002);
    this.tone(o, t, 0.05, 'triangle', 320 + Math.random() * 80, 180, 0.35);
    this.burst(o, t + 0.015, 0.09, 'bandpass', 3000 + Math.random() * 900, 2000, 4, 0.35);
  }

  step(running) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(running ? 0.34 : 0.2, (Math.random() - 0.5) * 0.3, 0.25);
    this.burst(o, t, 0.09, 'lowpass', 700 + Math.random() * 500, 150, 0.8, 0.9, 0.004);
    this.burst(o, t + 0.01, 0.05, 'bandpass', 2600 + Math.random() * 1500, 1500, 1.5, 0.22); // grit under the boot
  }

  casing(p) {
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(0.22 * pl.gain, pl.pan, 0.3);
    const f = 4200 + Math.random() * 2200;
    this.tone(o, t, 0.09, 'sine', f, f * 0.98, 0.5);
    this.tone(o, t + 0.07, 0.07, 'sine', f * 1.12, f * 1.1, 0.25);
  }

  impact(p) {
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(0.5 * pl.gain, pl.pan, 0.4);
    this.burst(o, t, 0.07, 'bandpass', 3000 + Math.random() * 2500, 900, 1.2, 0.9);
    this.burst(o, t, 0.16, 'lowpass', 500, 120, 0.8, 0.5);
  }

  thump(p) { // bullet into a body, or a body into the floor
    if (!this.ctx) return;
    const pl = this.place(p), t = this.ctx.currentTime, o = this.out(0.7 * pl.gain, pl.pan, 0.3);
    this.burst(o, t, 0.12, 'lowpass', 420, 80, 0.9, 1.0, 0.004);
    this.tone(o, t, 0.1, 'sine', 95, 45, 0.6);
  }

  whiz(pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(0.5, pan, 0.2);
    this.burst(o, t, 0.11, 'bandpass', 5200, 1300, 6, 0.9, 0.02);
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(0.9, 0, 0.2);
    this.burst(o, t, 0.22, 'lowpass', 900, 120, 1, 1.2);
    this.tone(o, t, 0.25, 'sawtooth', 190, 70, 0.35);
    this.tone(o, t + 0.05, 0.9, 'sine', 3100, 3000, 0.07); // ringing ear
  }

  beep(f = 1100, dur = 0.09, gain = 0.12) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(gain, 0, 0);
    this.tone(o, t, dur, 'square', f, f, 0.5);
  }

  radio() { // squelch burst at the start and end of a run
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out(0.25, -0.2, 0.05);
    this.burst(o, t, 0.35, 'bandpass', 2200, 1800, 1.5, 0.5, 0.01);
    this.tone(o, t + 0.36, 0.07, 'square', 1250, 1250, 0.3);
  }
}
