import * as THREE from 'three';
import { createPost } from './post.js';
import { loadAssets, analyseSky } from './assets.js';
import { buildCity, cityUniforms, road, N, HALF, CURB, CITY_MIN, CITY_MAX, RIM, BRIDGE, HEAD, PIERS, districtAt } from './city.js';
import { createCarFactory, Car } from './vehicle.js';
import { buildProps } from './props.js';
import { createCharFactory, GRIP, CURL } from './chars.js';
import { Fx } from './fx.js';
import { Sfx } from './audio.js';
import { Sim } from './sim.js';
import { Decals } from './decals.js';
import { Transit } from './transit.js';
import { buildLandmarks } from './landmarks.js';
import { buildScreens } from './screens.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const rnd = (a, b) => a + Math.random() * (b - a);
const params = new URLSearchParams(location.search);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const angLerp = (a, b, t) => a + wrap(b - a) * t;

// ---------------------------------------------------------------------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.25, 9000);
scene.add(camera);
const post = createPost(renderer, scene, camera);

function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(s.x, s.y);
}
addEventListener('resize', resize);

const WEAPONS = [
  { name: 'Pistol', mag: 12, ammo: 12, reserve: 120, rate: 0.2, dmg: 36, auto: false, kind: 0, spread: 0.004, long: false },
  { name: 'SMG', mag: 30, ammo: 30, reserve: 240, rate: 0.082, dmg: 21, auto: true, kind: 1, spread: 0.013, long: true },
];
const G = {
  mode: 'loading', time: 0, cars: [], chars: [], scene, camera, cash: 0, trafficCount: 11, fps: 0,
  input: { keys: new Set(), dx: 0, dy: 0, lmb: false, rmb: false, fired: false },
  focus: { x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, onFoot: true },
  player: { ch: null, car: null, health: 100, armor: 0, wi: 0, fireT: 0, reloadT: 0, vy: 0, aimT: 0, stepT: 0, weapons: WEAPONS.map((w) => ({ ...w })) },
};
window.__g = G;
const P1 = G.player;

// ---------------------------------------------------------------------------
// HUD plumbing
const cache = {};
const setText = (id, v) => { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } };
let zoneT = 0, promptText = '';
function showZone(title, sub, dur = 4) { $('zoneN').textContent = title; $('zoneS').textContent = sub; $('zone').classList.add('show'); zoneT = dur; }
G.toast = (t) => showZone(t, '', 3.2);
G.mission = (html) => { $('mission').innerHTML = html; $('mission').classList.add('show'); };
G.addCash = (n) => { G.cash = Math.max(0, G.cash + n); };
function setPrompt(html) { if (html === promptText) return; promptText = html; const p = $('prompt'); if (html) { p.innerHTML = html; p.classList.add('show'); } else p.classList.remove('show'); }
let dmgFlash = 0;
G.hurtPlayer = (d) => {
  if (G.mode !== 'play') return;
  if (P1.armor > 0) { const a = Math.min(P1.armor, d * 0.7); P1.armor -= a; d -= a; }
  P1.health -= d; dmgFlash = Math.min(1, dmgFlash + 0.35 + d * 0.02);
  G.sfx.hurt(); G.fx.shake = Math.min(1, G.fx.shake + 0.25);
  if (P1.health <= 0) endRun('WIPED OUT', 'Patched up at Marlin General');
};
G.busted = () => endRun('BUSTED', 'Released on bail');
let deadT = 0;
function endRun(title, sub) {
  if (G.mode !== 'play') return;
  G.mode = 'dead'; deadT = 4.2;
  const fee = Math.min(G.cash, Math.max(50, Math.round(G.cash * 0.1)));
  G.cash -= fee;
  if (P1.car) leaveCar(true);
  if (title !== 'BUSTED') P1.ch.kill(0, 0, 1);
  $('bigH').textContent = title; $('bigH').style.color = title === 'BUSTED' ? '#58b7ff' : '';
  $('bigP').textContent = `${sub}  ·  −$${fee}`;
  $('big').classList.add('show');
  setPrompt('');
  G.sfx.siren(false); G.sfx.drive(false, 0, 0, 0, 0);
}
function respawn() {
  $('big').classList.remove('show');
  const ch = P1.ch;
  ch.revive();
  P1.health = 100; P1.armor = 0; P1.vy = 0;
  ch.place(road(3) + 38, road(N) - HALF - 2.4, Math.PI, CURB); ch.root.visible = true;
  G.sim.clearWanted(); for (const u of G.sim.units) G.sim.retireUnit(u);
  cam.yaw = Math.PI; cam.pitch = 0.12;
  G.mode = 'play';
}

// ---------------------------------------------------------------------------
// roll the equirect sky so the sun sits where we want it (pure column shift = rotation about Y)
function rollSky(tex, targetPhi) {
  const info = analyseSky(tex);
  const { data, width, height } = tex.image, ch = data.length / (width * height);
  const phi = Math.atan2(info.sunDir.z, info.sunDir.x);
  let k = Math.round(((targetPhi - phi) / (Math.PI * 2)) * width) % width; if (k < 0) k += width;
  if (k) {
    const row = width * ch, tmp = new data.constructor(row);
    for (let y = 0; y < height; y++) {
      const r = data.subarray(y * row, (y + 1) * row);
      tmp.set(r); r.set(tmp.subarray(0, (width - k) * ch), k * ch); r.set(tmp.subarray((width - k) * ch), 0);
    }
    tex.needsUpdate = true;
  }
  return analyseSky(tex);
}

async function boot() {
  const skyName = params.get('sky') === 'sunset' ? 'sunset' : 'day';
  const LOOK = skyName === 'sunset' ? { exposure: 0.62, sun: 0xffb878, sunI: 2.6, fog: 0.0009, fogMul: 0.5, env: 1.0, night: 0.4 } : { exposure: 0.58, sun: 0xfff0dc, sunI: 3.8, fog: 0.00085, fogMul: 0.7, env: 0.85, night: 0.08 };
  const A = await loadAssets(renderer, (p) => { $('loadbar').style.transform = `scaleX(${p})`; }, skyName);
  G.A = A;
  renderer.toneMappingExposure = LOOK.exposure;
  cityUniforms.uNight.value = LOOK.night;

  const sky = rollSky(A.sky, Math.atan2(0.80, -0.60));
  G.sky = sky;
  cityUniforms.uSunDir.value.copy(sky.sunDir);
  A.sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = A.sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(A.sky).texture;
  pmrem.dispose();
  scene.environmentIntensity = LOOK.env;
  scene.fog = new THREE.FogExp2(sky.horizon.clone().multiplyScalar(LOOK.fogMul), LOOK.fog);

  const sun = new THREE.DirectionalLight(LOOK.sun, LOOK.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 1; sc.far = 1700;
  sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.09;
  scene.add(sun, sun.target);
  G.sun = sun;

  G.city = buildCity(A, scene);
  G.props = buildProps(A, scene, G.city);
  buildLandmarks(A, scene, G.city);
  buildScreens(A, scene, G.city);
  G.fx = new Fx(scene);
  G.decals = new Decals(scene);
  G.sfx = new Sfx();
  G.makeCar = createCarFactory(A);
  G.makeChar = createCharFactory(A);

  // the player's own car, parked on the beach boulevard
  const car = new Car(G.makeCar(0xb0121b), road(3) + 30, road(N) - 3.3, -Math.PI / 2);
  car.origColor = 0xb0121b;
  scene.add(car.root); G.cars.push(car); G.homeCar = car;
  // parked cars around town
  for (const s of G.props.parking) {
    if (G.cars.length > 34) break;
    if (Math.random() > 0.45) continue;
    const pc = new Car(G.makeCar(), s.x, s.z, s.h); pc.origColor = pc.paint.color.getHex(); pc.y = s.y; pc.sync(0, G.city);
    scene.add(pc.root); G.cars.push(pc);
  }

  const ch = G.makeChar('player'); ch.kind = 'player'; ch.giveGun(false);
  ch.place(road(3) + 30.4, road(N) - 5.6, 0, 0);
  scene.add(ch.root); G.chars.push(ch); P1.ch = ch;
  updateFocus();

  G.sim = new Sim(G);
  G.sim.initTraffic(G.trafficCount);
  G.sim.initPeds(16);
  G.transit = new Transit(G);

  renderer.compile(scene, camera);
  $('play').disabled = false; $('play').textContent = 'Play';
  $('fade').style.opacity = 0;
  G.mode = 'title';
  if (params.has('auto')) start();
}

function start() {
  if (G.mode !== 'title') return;
  G.sfx.init(); G.sfx.ui();
  G.mode = 'play';
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  cam.yaw = -Math.PI / 2; cam.pitch = 0.12;
  showZone(districtAt(P1.ch.x, P1.ch.z).name, 'San Francisco', 5);
  canvas.requestPointerLock?.();
}
$('play').addEventListener('click', start);

// ---------------------------------------------------------------------------
// input
let paused = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  G.input.keys.add(e.code);
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (G.mode !== 'play') { if (e.code === 'Enter' && G.mode === 'title') start(); return; }
  if (e.code === 'KeyF') useKey();
  if (e.code === 'KeyR') reload();
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'KeyQ') switchWeapon((P1.wi + 1) % P1.weapons.length);
  if (e.code === 'KeyM') G.sfx.toggleMute();
  if (e.code === 'KeyH' && P1.car) G.sfx.horn();
});
addEventListener('keyup', (e) => G.input.keys.delete(e.code));
addEventListener('blur', () => { G.input.keys.clear(); G.input.lmb = G.input.rmb = false; });
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { G.input.dx += e.movementX; G.input.dy += e.movementY; } });
addEventListener('mousedown', (e) => {
  if (G.mode !== 'play') return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
  if (e.button === 0) { G.input.lmb = true; G.input.fired = true; } else if (e.button === 2) G.input.rmb = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) G.input.lmb = false; else if (e.button === 2) G.input.rmb = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', () => { if (G.mode === 'play' && !P1.car) switchWeapon((P1.wi + 1) % P1.weapons.length); }, { passive: true });
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) { hadLock = true; paused = false; $('paused').classList.add('hidden'); }
  else if (hadLock && G.mode === 'play' && !params.has('auto')) { paused = true; $('paused').classList.remove('hidden'); G.sfx.drive(false, 0, 0, 0, 0); G.sfx.siren(false); }
});
$('paused').style.pointerEvents = 'auto';
$('paused').addEventListener('click', () => canvas.requestPointerLock?.());

// ---------------------------------------------------------------------------
// player actions
function switchWeapon(i) { if (P1.car || i === P1.wi) return; P1.wi = i; P1.reloadT = 0; P1.ch.giveGun(P1.weapons[i].long); G.sfx.click(); }
function reload() {
  const w = P1.weapons[P1.wi];
  if (P1.car || P1.reloadT > 0 || w.ammo === w.mag || w.reserve <= 0) return;
  P1.reloadT = 1.15; G.sfx.reload();
}
function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const c of G.cars) { if (c.wreck || !c.root.visible) continue; const d = Math.hypot(c.x - P1.ch.x, c.z - P1.ch.z); if (d < bd) { bd = d; best = c; } }
  return best;
}
function useKey() {
  if (P1.car) { if (P1.car.speed < 7) leaveCar(false); return; }
  const c = nearestCar(3.8);
  if (!c) return;
  // taking someone's car is a crime if anyone is around to see it
  if (c.driver === 'ai') { G.sim.crime(0, Math.random() < 0.6 ? 1 : 0); G.sim.alertPeds(c.x, c.z, 16); c.vx *= 0.2; c.vz *= 0.2; }
  if (c.driver === 'police') { const u = G.sim.units.find((q) => q.car === c); if (u) { if (u.state === 'pursue') return; u.dead = true; } G.sim.crime(0, 2); }
  c.driver = 'player';
  P1.car = c; P1.ch.root.visible = false; P1.ch.aiming = false;
  cam.yaw = c.h; cam.offYaw = 0; cam.pitch = 0.16;
  G.sfx.door();
  $('carName').textContent = c.bar ? 'Police Interceptor' : 'Vesper GT';
}
function leaveCar(force) {
  const c = P1.car; if (!c) return;
  const rx = -Math.cos(c.h), rz = Math.sin(c.h);
  let ok = false;
  for (const s of [-1.75, 1.75]) {                    // driver's side first, then the other
    const x = c.x + rx * s, z = c.z + rz * s;
    const wall = G.city.collidersNear(x, z).some((b) => x > b.x0 - 0.4 && x < b.x1 + 0.4 && z > b.z0 - 0.4 && z < b.z1 + 0.4);
    if (!wall) { P1.ch.place(x, z, c.h, G.city.groundY(x, z)); ok = true; break; }
  }
  if (!ok) { if (!force) return; P1.ch.place(c.x, c.z, c.h, c.y + 1.3); }
  c.driver = null; P1.car = null; P1.ch.root.visible = true; P1.vy = 0;
  cam.yaw = c.h; cam.pitch = 0.14;
  G.sfx.door(); G.sfx.drive(false, 0, 0, 0, 0);
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _hp = new THREE.Vector3();
function fire() {
  const w = P1.weapons[P1.wi], ch = P1.ch;
  if (w.ammo <= 0) { G.sfx.click(); P1.fireT = 0.25; reload(); return; }
  w.ammo--; P1.fireT = w.rate; P1.aimT = 0.9;
  camera.getWorldDirection(_d);
  const sp = w.spread * (G.input.rmb ? 0.45 : 1) * (1 + ch.speed * 0.25);
  _d.x += rnd(-sp, sp); _d.y += rnd(-sp, sp); _d.z += rnd(-sp, sp); _d.normalize();
  _o.copy(camera.position);
  const hit = G.sim.hitscan(_o, _d, 220, ch);
  _hp.copy(hit.point);
  ch.aiming = true; ch.aim.set(_hp.x - ch.x, _hp.y - (ch.y + 1.4), _hp.z - ch.z);
  ch.h = Math.atan2(_d.x, _d.z);
  ch.update(0, ch.y);
  ch.root.updateMatrixWorld(true);
  ch.muzzle(_m);
  G.fx.muzzle(_m); G.fx.tracer(_m, _hp);
  G.sfx.gun(w.kind);
  ch.kick();
  { // spent case flips out to the right
    const rx = -Math.cos(ch.h), rz = Math.sin(ch.h);
    ch.ejectPort(_o);
    G.fx.shell(_o, rx * rnd(1.6, 2.6), rnd(1.6, 2.6), rz * rnd(1.6, 2.6));
  }
  cam.pitch -= w.kind ? 0.006 : 0.012; cam.yaw += rnd(-0.004, 0.004);
  G.fx.shake = Math.min(1, G.fx.shake + 0.06);
  if (hit.kind === 'char') {
    G.fx.blood(_hp);
    G.sim.damageChar(hit.obj, hit.head ? 150 : w.dmg, true, _d.x, _d.z);
    G.sfx.hit(); $('cross').classList.add('hit'); setTimeout(() => $('cross').classList.remove('hit'), 90);
  } else if (hit.kind === 'car') { G.fx.impact(_hp, hit.n, 0.3, 0.3, 0.3); G.sim.damageCar(hit.obj, w.dmg * 0.4, true); }
  else if (hit.kind) { G.fx.impact(_hp, hit.n); G.decals.hole(_hp, hit.n); }
  G.sim.alertPeds(ch.x, ch.z, 48);
  // gunfire near anyone draws a response
  if (G.sim.peds.some((p) => !p.ch.dead && Math.hypot(p.ch.x - ch.x, p.ch.z - ch.z) < 45)) G.sim.crime(0, 1);
}

function updateFoot(dt) {
  const ch = P1.ch, I = G.input, k = I.keys;
  if (I.dx || I.dy) { cam.yaw -= I.dx * 0.0026; cam.pitch = clamp(cam.pitch + I.dy * 0.0022, -1.15, 1.25); }
  const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  const aiming = I.rmb;
  const sprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && !aiming;
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -fz, rz = fx;
  let mx = fx * fwd + rx * str, mz = fz * fwd + rz * str;
  const ml = Math.hypot(mx, mz);
  const sp = ml > 0 ? (aiming ? 2.3 : sprint ? 6.9 : 4.1) : 0;
  ch.speed += (sp - ch.speed) * Math.min(1, dt * 10);
  if (ml > 0) { mx /= ml; mz /= ml; G.sim.moveChar(ch, mx * ch.speed * dt, mz * ch.speed * dt); }
  P1.aimT -= dt;
  if (aiming || P1.aimT > 0) ch.h = angLerp(ch.h, cam.yaw, Math.min(1, dt * 16));
  else if (ml > 0) ch.h = angLerp(ch.h, Math.atan2(mx, mz), Math.min(1, dt * 11));
  // jump + gravity
  const gy = G.city.groundY(ch.x, ch.z);
  if (k.has('Space') && ch.y <= gy + 0.02 && P1.vy <= 0) P1.vy = 5.4;
  P1.vy -= 17 * dt; ch.y += P1.vy * dt;
  if (ch.y <= gy) { ch.y = gy; P1.vy = 0; }
  if (ch.speed > 1 && ch.y <= gy + 0.02) { P1.stepT -= dt * ch.speed; if (P1.stepT <= 0) { P1.stepT = 2.3; G.sfx.step(); } }

  // weapon
  const w = P1.weapons[P1.wi];
  P1.fireT -= dt;
  if (P1.reloadT > 0) { P1.reloadT -= dt; if (P1.reloadT <= 0) { const n = Math.min(w.mag - w.ammo, w.reserve); w.ammo += n; w.reserve -= n; } }
  ch.aiming = aiming || P1.aimT > 0;
  if (ch.aiming) { if (G.debugAim) ch.aim.copy(G.debugAim); else { camera.getWorldDirection(_d); ch.aim.copy(_d); } }   // debugAim: fixed aim for test captures
  const want = w.auto ? I.lmb : I.fired;
  if (want && P1.fireT <= 0 && P1.reloadT <= 0) fire();
  I.fired = false;
  ch.update(dt, gy);

  const c = nearestCar(3.8);
  setPrompt(c ? `<kbd>F</kbd>${c.driver === 'ai' ? 'Take this car' : c.driver === 'police' ? 'Steal the police car' : 'Get in'}` : '');
}

function updateDrive(dt) {
  const car = P1.car, k = G.input.keys;
  const thr = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  const st = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  const hb = k.has('Space');
  const deadEngine = car.wreck || car.health <= 0;
  car.update(dt, { throttle: deadEngine ? 0 : thr, steer: st, handbrake: deadEngine ? false : hb }, G.city, G.cars);
  // slender obstacles
  for (const p of G.props.poles) {
    const ex = car.x - p.x, ez = car.z - p.z; if (Math.abs(ex) > 2.5 || Math.abs(ez) > 2.5) continue;
    const d = Math.hypot(ex, ez), rr = 1.15 + p.r;
    if (d < rr && d > 1e-3) { const nx = ex / d, nz = ez / d, vn = car.vx * nx + car.vz * nz; car.x += nx * (rr - d); car.z += nz * (rr - d); if (vn < 0) { car.vx -= vn * nx * 1.3; car.vz -= vn * nz * 1.3; car.lastImpact = Math.max(car.lastImpact, -vn); } }
  }
  P1.ch.x = car.x; P1.ch.z = car.z; P1.ch.y = car.y;
  // tyre smoke + sound
  const slip = clamp((car.slip - 2.5) / 6, 0, 1) + (hb && car.speed > 8 ? 0.5 : 0);
  if (slip > 0.1) {
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    const prev = car.skidPrev || (car.skidPrev = [null, null]);
    [-0.8, 0.8].forEach((s, i) => {
      const wx = car.x - fx * 1.3 - fz * s, wz = car.z - fz * 1.3 + fx * s;
      G.fx.tyreSmoke(wx, car.y, wz, slip);
      // rubber left on the road: each piece joins the last wheel position to this one, so the line has no gaps
      const p = prev[i];
      if (p) {
        const dx = wx - p.x, dz = wz - p.z, len = Math.hypot(dx, dz);
        if (len > 0.02 && len < 3) G.decals.skid((wx + p.x) / 2, G.city.groundY(wx, wz), (wz + p.z) / 2, Math.atan2(dx, dz), len + 0.03, Math.min(1, slip * 1.2));
        p.x = wx; p.z = wz;
      } else prev[i] = { x: wx, z: wz };
    });
  } else if (car.skidPrev) car.skidPrev[0] = car.skidPrev[1] = null;
  const gearSpan = 15, g = Math.min(4, Math.floor(car.speed / gearSpan));
  const revs = clamp(0.18 + ((car.speed - g * gearSpan) / gearSpan) * 0.75 + (g === 4 ? (car.speed - 60) * 0.02 : 0), 0, 1);
  G.sfx.drive(true, car.speed < 0.5 && !thr ? 0.08 : revs, Math.abs(thr), car.speed, slip);
  setText('speed', String(Math.round(car.speed * 2.237)));
  setPrompt(car.speed < 7 ? '<kbd>F</kbd>Get out' : '');
}

function updateFocus() {
  const f = G.focus, c = P1.car, ch = P1.ch;
  if (c) { f.x = c.x; f.y = c.y; f.z = c.z; f.vx = c.vx; f.vz = c.vz; f.speed = c.speed; f.onFoot = false; }
  else { f.x = ch.x; f.y = ch.y; f.z = ch.z; f.vx = Math.sin(ch.h) * ch.speed; f.vz = Math.cos(ch.h) * ch.speed; f.speed = ch.speed; f.onFoot = true; }
}

// ---------------------------------------------------------------------------
// camera
const cam = { yaw: Math.PI, pitch: 0.16, offYaw: 0, idle: 9, pos: new THREE.Vector3(0, 5, 0), dist: 3.3, side: 0.5 };
const _t = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();
function segBoxT(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0, t1 = 1;
  const slab = (o, d, mn, mx) => {
    if (Math.abs(d) < 1e-6) return o >= mn && o <= mx;
    let a = (mn - o) / d, c = (mx - o) / d; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c); return t0 <= t1;
  };
  if (!slab(ox, dx, b.x0 - 0.3, b.x1 + 0.3) || !slab(oz, dz, b.z0 - 0.3, b.z1 + 0.3) || !slab(oy, dy, b.gy - 2, b.top)) return 1;
  return t0;
}
function camClip(target, offset) {
  let tHit = 1;
  for (const b of G.city.collidersNear(target.x, target.z)) tHit = Math.min(tHit, segBoxT(target.x, target.y, target.z, offset.x, offset.y, offset.z, b));
  return Math.max(0.12, tHit * 0.95);
}

function updateCamera(dt) {
  const I = G.input, car = P1.car, ch = P1.ch;
  if (G.debugCam) {
    camera.position.fromArray(G.debugCam.pos); camera.lookAt(...G.debugCam.look); camera.fov = G.debugCam.fov || 50;
  } else if (G.mode === 'title') {
    const t = G.time * 0.1, c = G.homeCar;
    _t.set(c.x, c.y + 0.85, c.z);
    camera.position.set(c.x + Math.sin(t + 2.4) * 7.4, 1.2 + Math.sin(t * 0.7) * 0.45, c.z + Math.cos(t + 2.4) * 7.4);
    camera.lookAt(_t); camera.fov = 36;
  } else if (car) {
    if (I.dx || I.dy) { cam.offYaw -= I.dx * 0.0032; cam.pitch = clamp(cam.pitch + I.dy * 0.0026, -0.08, 1.1); cam.idle = 0; }
    cam.idle += dt;
    if (cam.idle > 1.4 && car.speed > 3) { cam.offYaw *= Math.exp(-dt * 2.5); cam.pitch += (0.15 - cam.pitch) * Math.min(1, dt * 1.5); }
    // lean toward the direction of travel so drifts show the side of the car
    const travel = car.speed > 4 ? Math.atan2(car.vx, car.vz) : car.h;
    const base = car.vF < -1 ? car.h : angLerp(car.h, travel, 0.35);
    cam.yaw = angLerp(cam.yaw, base, 1 - Math.exp(-dt * 5.5));
    const yaw = cam.yaw + cam.offYaw, dist = 6.4 + car.speed * 0.022;
    _t.set(car.x, car.y + 1.15, car.z);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    _p.set(-Math.sin(yaw) * cp * dist, sp * dist + 0.55, -Math.cos(yaw) * cp * dist);
    _p.multiplyScalar(camClip(_t, _p)).add(_t);
    _p.y = Math.max(_p.y, G.city.groundY(_p.x, _p.z) + 0.35);
    cam.pos.lerp(_p, 1 - Math.exp(-dt * 14));
    camera.position.copy(cam.pos);
    camera.lookAt(_t.x, _t.y + 0.25, _t.z);
    camera.fov += (52 + Math.min(26, car.speed * 0.42) - camera.fov) * Math.min(1, dt * 3);
  } else {
    const aiming = I.rmb && G.mode === 'play';
    cam.dist += ((aiming ? 1.75 : 3.3) - cam.dist) * Math.min(1, dt * 10);
    cam.side += ((aiming ? 0.62 : 0.5) - cam.side) * Math.min(1, dt * 10);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -fz, rz = fx;
    _t.set(ch.x + rx * cam.side, ch.y + 1.58, ch.z + rz * cam.side);
    _p.set(-fx * cp * cam.dist, sp * cam.dist, -fz * cp * cam.dist);
    _p.multiplyScalar(camClip(_t, _p)).add(_t);
    _p.y = Math.max(_p.y, G.city.groundY(_p.x, _p.z) + 0.25);
    cam.pos.lerp(_p, 1 - Math.exp(-dt * 28));
    camera.position.copy(cam.pos);
    _l.set(_t.x + fx * cp * 20, _t.y - sp * 20, _t.z + fz * cp * 20);
    camera.lookAt(_l);
    camera.fov += ((aiming ? 40 : 56) - camera.fov) * Math.min(1, dt * 9);
  }
  const sh = G.fx ? G.fx.shake : 0;
  if (sh > 0 && !G.debugCam) { const s = sh * sh; camera.position.x += (Math.random() - 0.5) * s * 0.5; camera.position.y += (Math.random() - 0.5) * s * 0.5; camera.rotateZ((Math.random() - 0.5) * s * 0.03); }
  I.dx = 0; I.dy = 0;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function updateSun(focus) {
  // snap the shadow frustum to texel-sized steps so shadows don't crawl
  const sun = G.sun, d = G.sky.sunDir, texel = 260 / 4096;
  const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx + d.x * 800, d.y * 800, fz + d.z * 800);
  sun.target.updateMatrixWorld();
}

// ---------------------------------------------------------------------------
// minimap: rotates with the camera, world drawn straight from the city layout
const map = $('map'), mctx = map.getContext('2d');
function drawMap() {
  const W = map.width, H = map.height, cx = W / 2, cy = H * 0.62, s = 1.15;
  const f = G.focus, yaw = P1.car ? cam.yaw + cam.offYaw : cam.yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.fillStyle = '#0c2a33'; mctx.fillRect(0, 0, W, H);
  mctx.setTransform(s * rx, -s * fx, s * rz, -s * fz, cx - s * (f.x * rx + f.z * rz), cy + s * (f.x * fx + f.z * fz));
  const a = CITY_MIN - RIM, b = CITY_MAX + RIM;
  mctx.fillStyle = '#c9b48a'; mctx.fillRect(a - 60, b, (b - a) + 120, 60);
  mctx.fillStyle = '#6b757e'; mctx.fillRect(a, a, b - a, b - a);
  // bridge, headland and piers
  mctx.fillStyle = '#7a8a5c'; mctx.beginPath(); mctx.arc(HEAD.x, HEAD.z, HEAD.r, 0, 6.283); mctx.fill();
  mctx.fillStyle = '#c0452f'; mctx.fillRect(BRIDGE.x - BRIDGE.w, BRIDGE.z1, BRIDGE.w * 2, BRIDGE.z0 - BRIDGE.z1);
  mctx.fillStyle = '#8a7a62'; for (const p of PIERS) mctx.fillRect(p.x0, p.z0, p.x1 - p.x0, p.z1 - p.z0);
  for (const blk of G.city.blocks) {
    mctx.fillStyle = blk.kind === 'park' ? '#3d6b46' : blk.kind === 'lot' ? '#4a5158' : '#232a31';
    mctx.fillRect(blk.x0, blk.z0, blk.x1 - blk.x0, blk.z1 - blk.z0);
  }
  mctx.fillStyle = '#39424b';
  for (const bd of G.city.buildings) if (!bd.base) mctx.fillRect(bd.x0, bd.z0, bd.x1 - bd.x0, bd.z1 - bd.z0);
  const dot = (x, z, r, col) => { mctx.fillStyle = col; mctx.beginPath(); mctx.arc(x, z, r, 0, 6.283); mctx.fill(); };
  for (const p of G.sim.pickups) dot(p.x, p.z, 2.6, '#6ee787');
  const fl = Math.floor(G.time * 4) % 2;
  for (const u of G.sim.units) if (u.state !== 'idle' && !u.dead) dot(u.car.x, u.car.z, 5, fl ? '#ff3b4e' : '#3b7bff');
  for (const c of G.sim.cops) if (c.ch.root.visible && !c.ch.dead) dot(c.ch.x, c.ch.z, 3.2, fl ? '#3b7bff' : '#ff3b4e');
  for (const t of G.transit.vehicles) dot(t.x, t.z, 4, '#f5c542');
  if (G.sim.job) {
    // clamp the destination blip to the edge of the map
    const j = G.sim.job, dx = j.x - f.x, dz = j.z - f.z;
    const mxp = dx * rx + dz * rz, myp = dx * fx + dz * fz;
    const lim = Math.min((cx - 14) / s / Math.max(Math.abs(mxp), 1e-3), (myp > 0 ? cy - 14 : H - cy - 14) / s / Math.max(Math.abs(myp), 1e-3), 1);
    dot(f.x + dx * lim, f.z + dz * lim, 7, '#ffd166');
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  const ph = (P1.car ? P1.car.h : P1.ch.h) - yaw;
  mctx.translate(cx, cy); mctx.rotate(-ph);
  mctx.fillStyle = '#fff'; mctx.strokeStyle = 'rgba(0,0,0,.7)'; mctx.lineWidth = 3;
  mctx.beginPath(); mctx.moveTo(0, -13); mctx.lineTo(9, 10); mctx.lineTo(0, 5); mctx.lineTo(-9, 10); mctx.closePath(); mctx.stroke(); mctx.fill();
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  // north marker: world north is -Z
  const nxp = -rz, nyp = -fz, nl = Math.max(Math.abs(nxp) / (cx - 16), Math.abs(nyp) / (nyp > 0 ? cy - 16 : H - cy - 16));
  mctx.fillStyle = '#fff'; mctx.font = '700 22px sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  mctx.fillText('N', cx + nxp / nl, cy - nyp / nl);
}

let lastZone = null, lastWanted = 0;
function updateHud(dt) {
  const w = P1.weapons[P1.wi], sim = G.sim;
  setText('cash', '$' + G.cash.toLocaleString());
  const wk = `${P1.wi}:${w.ammo}:${w.reserve}:${!!P1.car}`;
  if (cache.wpn !== wk) { cache.wpn = wk; $('weapon').innerHTML = P1.car ? 'Driving' : `${w.name}<b>${w.ammo} / ${w.reserve}</b>`; }
  $('hp').style.transform = `scaleX(${clamp(P1.health / 100, 0, 1)})`;
  $('armor').style.transform = `scaleX(${clamp(P1.armor / 100, 0, 1)})`;
  if (sim.wanted !== lastWanted) { if (sim.wanted > lastWanted) G.sfx.stars(); lastWanted = sim.wanted; [...$('stars').children].forEach((el, i) => el.classList.toggle('on', i < sim.wanted)); }
  $('stars').classList.toggle('flash', sim.wanted > 0 && !sim.seen);
  $('br').style.opacity = P1.car ? 1 : 0;
  $('cross').classList.toggle('show', !P1.car);
  const z = districtAt(G.focus.x, G.focus.z);
  if (z.name !== lastZone) { lastZone = z.name; showZone(z.name, 'San Francisco'); }
  if (zoneT > 0) { zoneT -= dt; if (zoneT <= 0) $('zone').classList.remove('show'); }
  dmgFlash = Math.max(0, dmgFlash - dt * 1.6);
  $('dmg').style.opacity = Math.max(dmgFlash, P1.health < 30 ? 0.25 + 0.15 * Math.sin(G.time * 6) : 0);
  drawMap();
}

// ---------------------------------------------------------------------------
const sunUv = new THREE.Vector2(), _s = new THREE.Vector3();
let last = performance.now(), fpsAcc = 0, fpsN = 0, slow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (G.mode === 'loading') return;
  fpsAcc += dt; fpsN++;
  if (fpsN >= 60) {
    G.fps = Math.round(fpsN / fpsAcc);
    // adaptive resolution keeps the frame rate up on weaker GPUs
    if (fpsAcc / fpsN > 1 / 40 && pixelRatio > 1) { if (++slow >= 2) { pixelRatio = Math.max(1, pixelRatio - 0.25); resize(); slow = 0; } } else slow = 0;
    fpsAcc = 0; fpsN = 0;
  }
  if (paused) { post.composer.render(); return; }
  G.time += dt;
  cityUniforms.uTime.value = G.time;

  if (G.mode === 'play') {
    if (P1.car) updateDrive(dt); else updateFoot(dt);
    updateFocus();
    G.transit.update(dt);
    G.sim.update(dt);
  } else if (G.mode === 'dead') {
    P1.ch.update(dt, G.city.groundY(P1.ch.x, P1.ch.z));
    G.transit.update(dt);
    G.sim.updateTraffic(dt); G.sim.updatePeds(dt); G.sim.updateCars(dt);
    deadT -= dt; if (deadT <= 0) respawn();
  } else if (G.mode === 'title') {
    P1.ch.update(dt, P1.ch.y);
    G.transit.update(dt);
    G.sim.updateTraffic(dt); G.sim.updatePeds(dt);
  }
  // driverless cars keep rolling after a shove
  for (const c of G.cars) if (!c.driver && !c.wreck && Math.abs(c.vx) + Math.abs(c.vz) > 0.05) c.update(dt, { throttle: 0, steer: 0, handbrake: true }, G.city, null);

  G.props.update(G.time);
  G.fx.update(dt, camera, renderer, G.city.groundY);
  updateCamera(dt);
  updateSun(camera.position);
  for (const c of G.cars) { const d2 = (c.x - camera.position.x) ** 2 + (c.z - camera.position.z) ** 2; c.setLod(d2 < 30 * 30 ? 0 : d2 < 140 * 140 ? 1 : 2); }
  if (G.mode !== 'title') updateHud(dt);

  const L = post.lens.uniforms;
  L.uTime.value = G.time;
  L.uBoost.value = P1.car ? clamp((P1.car.speed - 36) / 40, 0, 0.5) : 0;
  _s.copy(G.sky.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
  sunUv.set(_s.x * 0.5 + 0.5, _s.y * 0.5 + 0.5);
  L.uSun.value.copy(sunUv);
  const vis = _s.z < 1 ? clamp((1.2 - Math.max(Math.abs(_s.x), Math.abs(_s.y))) / 0.4, 0, 1) : 0;
  L.uSunVis.value += (vis * 0.3 - L.uSunVis.value) * Math.min(1, dt * 6);
  L.uDesat.value += ((G.mode === 'dead' ? 0.8 : 0) - L.uDesat.value) * Math.min(1, dt * 2);
  post.composer.render();
}

G.test = { useKey, fire, start, leaveCar, GRIP, CURL };
boot().catch((e) => { console.error(e); $('play').textContent = 'Failed to load'; });
requestAnimationFrame(frame);
