// Fully synthesised audio: no asset files.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.sirenOn = false; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // echo bus: gives gunshots and sirens a street-canyon tail
    this.echo = ctx.createGain(); this.echo.gain.value = 0.3;
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.19;
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.echo.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(this.master);

    const loopNoise = (type, freq, q) => {
      const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(f); f.connect(g); g.connect(this.master); n.start();
      return { f, g };
    };
    // engine: two detuned saws + a sub, through a low-pass that opens with revs
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400; this.engFilter.Q.value = 2;
    this.engOsc = [0, 1, 2].map((k) => { const o = ctx.createOscillator(); o.type = k === 2 ? 'square' : 'sawtooth'; const g = ctx.createGain(); g.gain.value = k === 2 ? 0.35 : 0.5; o.connect(g); g.connect(this.engFilter); o.start(); return o; });
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.skid = loopNoise('bandpass', 1900, 5);
    this.wind = loopNoise('lowpass', 500, 0.5);
    this.city = loopNoise('lowpass', 260, 0.3); this.city.g.gain.value = 0.05;
    // siren
    this.sirOsc = ctx.createOscillator(); this.sirOsc.type = 'square';
    this.sirGain = ctx.createGain(); this.sirGain.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1100; sf.Q.value = 0.8;
    this.sirOsc.connect(sf); sf.connect(this.sirGain); this.sirGain.connect(this.master); this.sirGain.connect(this.echo);
    this.sirOsc.start();
    this.sirTimer = setInterval(() => {
      if (!this.sirenOn) return;
      const t = ctx.currentTime;
      this.sirOsc.frequency.cancelScheduledValues(t);
      this.sirOsc.frequency.setValueAtTime(620, t);
      this.sirOsc.frequency.linearRampToValueAtTime(1280, t + 0.42);
      this.sirOsc.frequency.linearRampToValueAtTime(620, t + 0.84);
    }, 850);
  }
  toggleMute() { this.muted = !this.muted; if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05); return this.muted; }

  noiseHit(dur, vol, freq, type = 'lowpass', sweepTo = null, dest = null) {
    const ctx = this.ctx, t = ctx.currentTime, n = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    n.buffer = this.noise; n.loop = true;
    f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(f); f.connect(g); g.connect(dest || this.master);
    n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }
  tone(type, f0, f1, dur, vol, dest = null) {
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  // kind 0 pistol, 1 smg
  gun(kind, vol = 1) {
    if (!this.ctx) return;
    this.noiseHit(kind ? 0.13 : 0.2, 0.75 * vol, kind ? 3600 : 2600, 'lowpass', 300);
    this.noiseHit(0.5, 0.3 * vol, 900, 'lowpass', 120, this.echo);
    this.tone('square', kind ? 210 : 150, 45, 0.11, 0.45 * vol);
  }
  click() { if (this.ctx) this.noiseHit(0.03, 0.2, 4200, 'highpass'); }
  reload() { if (!this.ctx) return; this.noiseHit(0.05, 0.3, 2400, 'bandpass'); setTimeout(() => this.ctx && this.noiseHit(0.06, 0.35, 1500, 'bandpass'), 420); }
  hit() { if (this.ctx) this.tone('triangle', 1500, 700, 0.06, 0.25); }
  thud() { if (!this.ctx) return; this.tone('sine', 130, 40, 0.22, 0.7); this.noiseHit(0.14, 0.4, 700, 'lowpass', 150); }
  crash(v) {
    if (!this.ctx) return;
    const a = Math.min(1, v / 26);
    this.noiseHit(0.32, 0.25 + 0.6 * a, 2400, 'lowpass', 180); this.tone('sawtooth', 160, 38, 0.26, 0.2 + 0.4 * a);
    this.noiseHit(0.5, 0.2 * a, 5200, 'highpass', 2500);
  }
  explosion(vol = 1) {
    if (!this.ctx) return;
    this.noiseHit(1.5, 0.95 * vol, 2600, 'lowpass', 50); this.noiseHit(2.4, 0.5 * vol, 420, 'lowpass', 40, this.echo);
    this.tone('sine', 115, 24, 1.1, 0.9 * vol);
  }
  hurt() { if (this.ctx) { this.noiseHit(0.18, 0.4, 800, 'lowpass', 150); this.tone('sawtooth', 170, 60, 0.18, 0.2); } }
  pickup() { if (!this.ctx) return; this.tone('sine', 880, 1320, 0.1, 0.22); setTimeout(() => this.ctx && this.tone('sine', 1320, 1980, 0.16, 0.2), 80); }
  ui() { if (this.ctx) this.tone('sine', 520, 1040, 0.16, 0.2); }
  door() { if (this.ctx) { this.noiseHit(0.09, 0.45, 520, 'lowpass', 120); this.tone('sine', 95, 50, 0.1, 0.4); } }
  horn() { if (this.ctx) { this.tone('square', 392, 392, 0.4, 0.08); this.tone('square', 494, 494, 0.4, 0.08); } }
  step() { if (this.ctx) this.noiseHit(0.05, 0.07, 900, 'bandpass'); }
  stars() { if (this.ctx) { this.tone('square', 660, 660, 0.09, 0.1); setTimeout(() => this.ctx && this.tone('square', 880, 880, 0.14, 0.1), 110); } }

  siren(on) {
    this.sirenOn = on;
    if (this.ctx) this.sirGain.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.3);
  }
  // revs 0..1, load 0..1, speed in m/s, slip 0..1
  drive(active, revs, load, speed, slip) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const hz = 46 + revs * 150;
    this.engOsc[0].frequency.setTargetAtTime(hz, t, 0.05);
    this.engOsc[1].frequency.setTargetAtTime(hz * 1.503, t, 0.05);
    this.engOsc[2].frequency.setTargetAtTime(hz * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(280 + revs * 1500 + load * 1200, t, 0.08);
    this.engGain.gain.setTargetAtTime(active ? 0.07 + load * 0.08 + revs * 0.03 : 0, t, 0.1);
    this.skid.g.gain.setTargetAtTime(active ? Math.min(0.2, slip * 0.22) : 0, t, 0.06);
    this.wind.g.gain.setTargetAtTime(active ? Math.min(0.16, speed * 0.0032) : 0, t, 0.2);
    this.wind.f.frequency.setTargetAtTime(300 + speed * 22, t, 0.2);
  }
}
