// CONCRETE ECHO: an original body-camera style building-clearance shooter.
import * as THREE from 'three';
import { Level, SPAWNS, PLAYER_START } from './level.js';
import { loadPhotos } from './textures.js';
import { loadSoldier } from './soldier.js';
import { Post } from './post.js';
import { Fx } from './fx.js';
import { Sfx } from './audio.js';
import { Enemy } from './enemy.js';
import { Player } from './player.js';
import { Props, initPhysics, loadScans } from './props.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');       // start without pointer lock (used for automated checks)
const NOAI = params.has('noai');

const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.12, 0.13, 0.15), 0.008);
const camera = new THREE.PerspectiveCamera(95, 1, 0.04, 220);
const post = new Post(renderer);
if (params.get('q') === 'low') post.quality = 'low';

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, post.quality === 'high' ? 1.25 : 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(Math.floor(w * pr), Math.floor(h * pr));
}
window.addEventListener('resize', resize);
resize();

const input = { fwd: 0, right: 0, sprint: false, crouch: false, jump: false, fire: false, ads: false, leanL: false, leanR: false, mx: 0, my: 0, reload: false, torch: false, laser: false, weapon: -1, next: 0, echo: false };
const keys = new Set();
let level, fx, sfx, player, props, enemies = [];
let echoCd = 0, echoT = -1, ring = null;
const ECHO_CD = 14, ECHO_RANGE = 26, ECHO_HEARD = 14, ECHO_SPEED = 42;
let state = 'loading', paused = false, time = 0, acc = 0, last = performance.now(), runTime = 0, kills = 0, endT = 0, feedT = 0;

const g = {
  get player() { return player; }, get fx() { return fx; }, get sfx() { return sfx; }, get level() { return level; },
  get enemies() { return enemies; }, get props() { return props; }, time: 0, dt: 0.016,
  noise(p) {
    if (NOAI) return;
    for (const e of enemies) {
      const d = e.pos.distanceTo(p);
      if (d < 19 && Math.abs(e.pos.y - p.y) < 4.6) e.hear(p);
    }
  },
  onKill() {
    kills++;
    $('feed').textContent = `HOSTILE DOWN  ${kills}/${enemies.length}`;
    $('feed').style.opacity = 1; feedT = 2.6;
    if (kills === enemies.length) { endT = 2.2; }
  },
};

// The echo pulse: a ping that sweeps the building and shows every hostile it reaches through
// the walls for a few seconds. The nearer ones hear it, so it also tells them where you are.
function echoPulse() {
  if (echoCd > 0 || player.dead) { sfx.beep(420, 0.05, 0.06); return; }
  echoCd = ECHO_CD; echoT = 0;
  ring.position.set(player.feet.x, player.feet.y + 1.1, player.feet.z);
  sfx.ping();
  player.glitch = Math.max(player.glitch, 0.45);
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.pos.distanceTo(player.feet);
    if (d > ECHO_RANGE) continue;
    e.reveal(d / ECHO_SPEED, 4.5);
    if (!NOAI && d < ECHO_HEARD) e.hear(player.feet);
  }
}

function spawnEnemies() {
  for (const e of enemies) scene.remove(e.group);
  enemies = SPAWNS.map((s, i) => new Enemy(scene, level, s, i));
}

function startRun() {
  for (const p of fx.pools) scene.remove(p.m);
  fx.pools.length = 0;
  spawnEnemies();
  player.reset(PLAYER_START);
  props.reset();
  echoCd = 0; echoT = -1; ring.visible = false;
  if (params.get('pos')) {
    const v = params.get('pos').split(',').map(Number);
    player.feet.set(v[0], v[1], v[2]); player.viewY = v[1];
    player.aimYaw = player.camYaw = v[3] || 0; player.aimPitch = player.camPitch = v[4] || 0;
  }
  kills = 0; runTime = 0; endT = 0; time = 0;
  state = 'playing'; paused = false;
  $('menu').style.display = 'none'; $('end').style.display = 'none'; $('pause').style.display = 'none';
  $('hud').style.display = 'block';
  $('feed').textContent = `CLEAR THE BUILDING  ·  ${enemies.length} HOSTILES`; $('feed').style.opacity = 1; feedT = 4;
  $('keys').style.opacity = 1;
  clearTimeout(startRun.t);
  startRun.t = setTimeout(() => { $('keys').style.opacity = 0; }, 14000);
  sfx.radio();
}

function lock() { if (!AUTO && canvas.requestPointerLock) { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } }

function endRun(win) {
  state = win ? 'clear' : 'dead';
  if (document.pointerLockElement) document.exitPointerLock();
  const acc = player.shots ? Math.round((player.hits / player.shots) * 100) : 0;
  const m = Math.floor(runTime / 60), s = Math.floor(runTime % 60);
  $('endTitle').textContent = win ? 'BUILDING CLEAR' : 'SIGNAL LOST';
  $('endTitle').className = win ? 'ok' : 'bad';
  $('endStats').innerHTML = `HOSTILES DOWN <b>${kills}/${enemies.length}</b><br>TIME <b>${m}:${String(s).padStart(2, '0')}</b><br>ROUNDS FIRED <b>${player.shots}</b><br>ACCURACY <b>${acc}%</b>`;
  $('end').style.display = 'flex';
  sfx.radio();
}

// ---------- input ----------
const bind = () => {
  input.fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  input.right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.crouch = keys.has('KeyC') || keys.has('ControlLeft');
  input.leanL = keys.has('KeyQ'); input.leanR = keys.has('KeyE');
};
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code); bind();
  if (state === 'playing' && !paused) {
    if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
    if (e.code === 'KeyR') input.reload = true;
    if (e.code === 'KeyF') input.torch = true;
    if (e.code === 'KeyL') input.laser = true;
    if (e.code === 'KeyV') input.echo = true;
    if (/^Digit[1-9]$/.test(e.code)) input.weapon = Number(e.code.slice(5)) - 1;
    if (e.code === 'KeyP') { post.quality = post.quality === 'high' ? 'low' : 'high'; resize(); }
  } else if ((state === 'dead' || state === 'clear') && e.code === 'Enter') { startRun(); lock(); }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); bind(); });
window.addEventListener('blur', () => { keys.clear(); bind(); input.fire = input.ads = false; });
canvas.addEventListener('mousedown', (e) => {
  if (state !== 'playing' || paused) return;
  if (e.button === 0) input.fire = true;
  if (e.button === 2) input.ads = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; if (e.button === 2) input.ads = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => { if (state === 'playing' && !paused && e.deltaY) input.next = e.deltaY > 0 ? 1 : -1; }, { passive: true });
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || state !== 'playing' || paused) return;
  input.mx += e.movementX; input.my += e.movementY;
});
document.addEventListener('pointerlockchange', () => {
  if (AUTO) return;
  if (document.pointerLockElement === canvas) { paused = false; $('pause').style.display = 'none'; last = performance.now(); }
  else if (state === 'playing') { paused = true; $('pause').style.display = 'flex'; input.fire = input.ads = false; keys.clear(); bind(); }
});
$('startBtn').addEventListener('click', () => { sfx.init(); startRun(); lock(); });
$('pause').addEventListener('click', () => { sfx.init(); lock(); });
$('againBtn').addEventListener('click', () => { startRun(); lock(); });

// ---------- frame ----------
const pad = (n) => String(n).padStart(2, '0');
let hudT = 0;
function hud(dt) {
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.25;
    const d = new Date();
    $('stamp').textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    $('rec').style.opacity = d.getMilliseconds() < 500 || Math.floor(time * 2) % 2 ? 1 : 0.25;
  }
  const wp = WEAPONS[player.wi];
  $('ammo').textContent = `${player.wi + 1} ${wp.name}  ` + (player.reloading ? 'RELOADING' : `${pad(player.ammo)} / ${player.reserve}`);
  $('ammo').className = player.ammo <= wp.mag * 0.2 && !player.reloading ? 'low' : '';
  $('echo').textContent = echoCd > 0 ? `ECHO ${pad(Math.ceil(echoCd))}s` : 'ECHO READY  [V]';
  $('echo').className = echoCd > 0 ? '' : 'ready';
  if (feedT > 0) { feedT -= dt; if (feedT <= 0) $('feed').style.opacity = 0; }
}

const right = new THREE.Vector3();
function update(dt) {
  time += dt; g.time = time; g.dt = dt;
  if (state === 'playing') runTime += dt;
  if (input.echo) { input.echo = false; if (state === 'playing') echoPulse(); }
  if (echoCd > 0) echoCd = Math.max(0, echoCd - dt);
  if (echoT >= 0) {
    echoT += dt;
    const r = echoT * ECHO_SPEED;
    ring.visible = r < ECHO_RANGE;
    ring.scale.set(r, 1, r);
    ring.material.opacity = 0.5 * Math.max(0, 1 - r / ECHO_RANGE);
    if (r >= ECHO_RANGE) echoT = -1;
  }
  player.update(dt, input, g);
  acc += dt;
  let sub = Math.floor(acc * 120);
  acc -= sub / 120;
  if (sub > 5) sub = 5;
  for (const e of enemies) {
    if (NOAI && !e.dead) { e.senseT = 1; e.sees = false; }
    e.update(dt, g, sub);
  }
  props.step(dt, g);
  fx.update(dt, camera, post.h);
  level.update(time);
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  sfx.setListener(player.eye, right);
  hud(dt);
  if (state === 'playing') {
    if (player.dead && player.deadT > 3.2) endRun(false);
    if (endT > 0) { endT -= dt; if (endT <= 0 && !player.dead) endRun(true); }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
  last = now;
  if (state === 'loading') return;
  const live = (state === 'playing' && !paused) || state === 'dead' || state === 'clear';
  if (live) update(dt);
  camera.updateMatrixWorld(true);
  post.render(scene, camera, dt, {
    time: performance.now() / 1000,
    hurt: player.hurt,
    dead: player.dead ? Math.min(0.92, Math.max(0, (player.deadT - 2.2) * 1.2)) : 0,
    glitch: player.glitch,
  });
}

async function boot() {
  const bar = $('bar'), note = $('note');
  const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
  note.textContent = 'Loading surfaces';
  await tick();
  let photos = null;
  try { photos = await loadPhotos(); } catch (err) { console.warn('Photo textures unavailable, using generated ones:', err.message); }
  try { await loadSoldier(); } catch (err) { console.warn('Soldier model unavailable, using simple figures:', err.message); }
  note.textContent = 'Painting walls';
  await tick(); await tick();
  level = new Level(scene, photos);
  note.textContent = 'Letting daylight in';
  await tick();
  let t0 = performance.now();
  for (const p of level.bake()) {
    if (performance.now() - t0 > 40) { bar.style.width = `${Math.round(p * 100)}%`; await tick(); t0 = performance.now(); }
  }
  bar.style.width = '100%';
  note.textContent = 'Loading physics';
  await tick();
  try { await initPhysics(); } catch (err) { console.warn('Physics engine unavailable, loose objects are disabled:', err.message); }
  note.textContent = 'Bringing in the scanned props';
  await tick();
  try { await loadScans(); } catch (err) { console.warn('Scanned props unavailable, using simple ones:', err.message); }
  sfx = new Sfx();
  fx = new Fx(scene, level, sfx);
  props = new Props(scene, level, fx, sfx);
  ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 0.7, 0.14), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ring.visible = false; ring.frustumCulled = false; ring.renderOrder = 8;
  scene.add(ring);
  player = new Player(scene, camera, level, fx, sfx, renderer);
  spawnEnemies();
  player.reset(PLAYER_START);
  state = 'menu';
  note.textContent = '';
  $('loading').style.display = 'none';
  $('startBtn').style.display = 'inline-block';
  window.__game = { get player() { return player; }, get props() { return props; }, echo: echoPulse, get enemies() { return enemies; }, level, post, fx, renderer, scene, camera, input, g, start: startRun, get state() { return state; } };
  if (AUTO) startRun();
}

requestAnimationFrame(frame);
boot().catch((err) => {
  console.error(err);
  $('note').textContent = 'Failed to start: ' + err.message;
});
