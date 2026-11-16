// Body-camera look: ambient occlusion, camera motion blur, bloom, auto exposure,
// fisheye distortion, chromatic aberration, sharpening halo, sensor grain, vignette.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const HASH = /* glsl */ `
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
`;

const AO_FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj, uProjInv;
uniform float uRadius;
varying vec2 vUv;
${HASH}
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
void main() {
  vec3 p = viewPos(vUv);
  if (-p.z > 45.0) { gl_FragColor = vec4(1.0); return; }
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  float rnd = hash(gl_FragCoord.xy);
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = fi * 2.399963 + rnd * 6.2831;
    float z = (fi + 0.5) / 12.0;
    float r = sqrt(1.0 - z * z);
    vec3 dir = t * (cos(a) * r) + b * (sin(a) * r) + n * z;
    float rad = uRadius * (0.25 + 0.75 * fract(fi * 0.618 + rnd));
    vec3 sp = p + n * 0.02 + dir * rad;
    vec4 q = uProj * vec4(sp, 1.0);
    vec2 suv = q.xy / q.w * 0.5 + 0.5;
    float sz = viewPos(suv).z;
    float rc = smoothstep(0.0, 1.0, uRadius / max(abs(p.z - sz), 0.0001));
    occ += step(sp.z + 0.025, sz) * rc;
  }
  float ao = pow(1.0 - occ / 12.0, 1.6);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

const COMP_FRAG = /* glsl */ `
uniform sampler2D tColor, tDepth, tAO;
uniform mat4 uProjInv, uCamWorld, uPrevVP;
uniform float uBlur, uAO;
uniform vec2 uRes;
varying vec2 vUv;
${HASH}
void main() {
  float d = texture2D(tDepth, vUv).x;
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  v /= v.w;
  vec4 pc = uPrevVP * (uCamWorld * vec4(v.xyz, 1.0));
  vec2 vel = vec2(0.0);
  if (pc.w > 0.0) vel = (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * uBlur;
  vel *= mix(0.08, 1.0, smoothstep(0.7, 1.5, -v.z)); // keep the weapon sharp
  float len = length(vel);
  if (len > 0.045) vel *= 0.045 / len;
  float j = hash(gl_FragCoord.xy);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float t = (float(i) + j) / 8.0 - 0.5;
    col += texture2D(tColor, vUv + vel * t).rgb;
  }
  col /= 8.0;
  vec2 ap = 1.0 / uRes;
  float ao = (texture2D(tAO, vUv + ap * vec2(1.0, 1.0)).r + texture2D(tAO, vUv + ap * vec2(-1.0, 1.0)).r +
              texture2D(tAO, vUv + ap * vec2(1.0, -1.0)).r + texture2D(tAO, vUv + ap * vec2(-1.0, -1.0)).r) * 0.25;
  col *= mix(1.0, ao, uAO);
  gl_FragColor = vec4(col, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform float uExposure;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb * uExposure;
  float l = max(c.r, max(c.g, c.b));
  c *= smoothstep(1.0, 2.6, l);
  gl_FragColor = vec4(min(c, vec3(12.0)), 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb * 0.227;
  c += (texture2D(tColor, vUv + uDir * 1.385).rgb + texture2D(tColor, vUv - uDir * 1.385).rgb) * 0.316;
  c += (texture2D(tColor, vUv + uDir * 3.231).rgb + texture2D(tColor, vUv - uDir * 3.231).rgb) * 0.0703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const LUM_FRAG = /* glsl */ `
uniform sampler2D tColor;
varying vec2 vUv;
void main() {
  vec2 cell = floor(vUv * 8.0);
  float l = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    vec2 uv = (cell + (vec2(float(i), float(j)) + 0.5) / 4.0) / 8.0;
    l += dot(texture2D(tColor, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
  }
  l /= 16.0;
  float e = clamp(log2(l + 0.0001) / 16.0 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(e, e, e, 1.0);
}
`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tColor, tBloom;
uniform vec2 uRes;
uniform float uTime, uExposure, uAspect, uHurt, uDead, uGlitch;
varying vec2 vUv;
${HASH}
const float K1 = 0.36;
const float K2 = 0.2;
vec2 distort(vec2 uv, float k) {
  vec2 d = uv - 0.5;
  d.x *= uAspect;
  float r2 = dot(d, d);
  float a2 = 0.25 * (uAspect * uAspect + 1.0); // corners map to corners: barrel distortion with no black frame
  float f = (1.0 + K1 * r2 + K2 * r2 * r2) / (1.0 + K1 * a2 + K2 * a2 * a2);
  d *= f * k;
  d.x /= uAspect;
  return d + 0.5;
}
void main() {
  vec2 uv = vUv;
  if (uGlitch > 0.0) {
    float row = floor(uv.y * 36.0);
    float g = hash(vec2(row, floor(uTime * 30.0)));
    if (g > 1.0 - uGlitch * 0.45) uv.x += (g - 0.5) * 0.16 * uGlitch;
  }
  float ca = 0.0055;
  vec2 uvR = distort(uv, 1.0 + ca), uvG = distort(uv, 1.0), uvB = distort(uv, 1.0 - ca);
  vec3 col = vec3(texture2D(tColor, uvR).r, texture2D(tColor, uvG).g, texture2D(tColor, uvB).b);
  // body cameras sharpen hard in-camera, leaving bright halos on edges
  vec2 px = 1.5 / uRes;
  vec3 blur = (texture2D(tColor, uvG + vec2(px.x, 0.0)).rgb + texture2D(tColor, uvG - vec2(px.x, 0.0)).rgb +
               texture2D(tColor, uvG + vec2(0.0, px.y)).rgb + texture2D(tColor, uvG - vec2(0.0, px.y)).rgb) * 0.25;
  col = max(col + (col - blur) * 0.6, 0.0);
  // 4:2:0 video: colour is stored on a coarser grid than brightness, so it smears across edges
  vec3 cc = texture2D(tColor, distort((floor(uv * uRes / 4.0) + 0.5) * 4.0 / uRes, 1.0)).rgb;
  float ly = dot(col, vec3(0.299, 0.587, 0.114)), lc = dot(cc, vec3(0.299, 0.587, 0.114));
  col = mix(col, cc * min(ly / max(lc, 1e-4), 4.0), 0.65);
  col = col * uExposure + texture2D(tBloom, uvG).rgb * 0.3;
  float inb = smoothstep(0.0, 0.004, uvG.x) * smoothstep(1.0, 0.996, uvG.x) * smoothstep(0.0, 0.004, uvG.y) * smoothstep(1.0, 0.996, uvG.y);
  col *= inb;
  // small-sensor response: hard highlight clip, crushed shadows, punchy contrast, warm cast
  col = 1.0 - exp(-col * 1.5);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 0.8);
  col *= vec3(1.05, 1.0, 0.88);
  col = max(col - 0.03, 0.0) / 0.97;
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.6);
  vec2 d = vUv - 0.5;
  float vig = smoothstep(0.9, 0.3, length(d * vec2(1.0, 0.92)));
  col *= mix(0.6, 1.0, vig);
  col = mix(col, vec3(l * 0.75, l * 0.12, l * 0.1), uHurt * 0.6 * smoothstep(0.08, 0.62, length(d)));
  float n = hash(gl_FragCoord.xy + mod(floor(uTime * 60.0), 97.0) * vec2(13.0, 29.0)) - 0.5;
  col += n * mix(0.06, 0.022, l);
  vec2 blk = floor(vUv * uRes / 8.0);
  col += (hash(blk + floor(uTime * 12.0)) - 0.5) * 0.02 * (1.0 - l);
  float st = hash(floor(gl_FragCoord.xy * 0.5) + mod(floor(uTime * 60.0), 89.0) * vec2(31.0, 17.0));
  col = mix(col, vec3(st * 0.55), uDead);
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.quality = 'high';
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.exposure = 1;
    this.prevVP = new THREE.Matrix4();
    this.vp = new THREE.Matrix4();
    this.lumBuf = new Uint8Array(8 * 8 * 4);
    this.frame = 0;
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.mAO = mat(AO_FRAG, { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uRadius: { value: 0.5 } });
    this.mComp = mat(COMP_FRAG, { tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uBlur: { value: 0.6 }, uAO: { value: 0.9 }, uRes: { value: new THREE.Vector2() } });
    this.mBright = mat(BRIGHT_FRAG, { tColor: { value: null }, uExposure: { value: 1 } });
    this.mBlur = mat(BLUR_FRAG, { tColor: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mLum = mat(LUM_FRAG, { tColor: { value: null } });
    this.mFinal = mat(FINAL_FRAG, { tColor: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uExposure: { value: 1 }, uAspect: { value: 1 }, uHurt: { value: 0 }, uDead: { value: 0 }, uGlitch: { value: 0 } });
    this.lumRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  }

  setSize(w, h) {
    const scale = this.quality === 'high' ? 0.9 : 0.65;
    const W = Math.max(8, Math.floor(w * scale)), H = Math.max(8, Math.floor(h * scale));
    this.w = W; this.h = H;
    for (const rt of [this.sceneRT, this.aoRT, this.compRT, this.bA, this.bB]) if (rt) rt.dispose();
    if (this.sceneRT && this.sceneRT.depthTexture) this.sceneRT.depthTexture.dispose();
    const hdr = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.sceneRT = new THREE.WebGLRenderTarget(W, H, { ...hdr, depthBuffer: true });
    this.sceneRT.depthTexture = new THREE.DepthTexture(W, H);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;
    this.aoRT = new THREE.WebGLRenderTarget(W >> 1, H >> 1, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.compRT = new THREE.WebGLRenderTarget(W, H, { ...hdr, depthBuffer: false });
    this.bA = new THREE.WebGLRenderTarget(W >> 2, H >> 2, { ...hdr, depthBuffer: false });
    this.bB = new THREE.WebGLRenderTarget(W >> 2, H >> 2, { ...hdr, depthBuffer: false });
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  render(scene, camera, dt, fx) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);

    const depth = this.sceneRT.depthTexture;
    const ao = this.quality === 'high';
    if (ao) {
      const u = this.mAO.uniforms;
      u.tDepth.value = depth;
      u.uProj.value.copy(camera.projectionMatrix);
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      this.pass(this.mAO, this.aoRT);
    }

    let u = this.mComp.uniforms;
    u.tColor.value = this.sceneRT.texture; u.tDepth.value = depth; u.tAO.value = this.aoRT.texture;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uPrevVP.value.copy(this.prevVP);
    u.uBlur.value = 1.0 * Math.min(1.6, Math.max(0.25, (1 / 60) / Math.max(dt, 0.001)));
    u.uAO.value = ao ? 0.9 : 0;
    u.uRes.value.set(this.w, this.h);
    this.pass(this.mComp, this.compRT);
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevVP.copy(this.vp);

    // auto exposure from an 8x8 log-luminance thumbnail
    if (this.frame++ % 3 === 0) {
      this.mLum.uniforms.tColor.value = this.compRT.texture;
      this.pass(this.mLum, this.lumRT);
      r.readRenderTargetPixels(this.lumRT, 0, 0, 8, 8, this.lumBuf);
      let sum = 0, ws = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const wgt = 1 + 2 * Math.max(0, 1 - Math.hypot(x - 3.5, y - 3.5) / 4);
        sum += (this.lumBuf[(y * 8 + x) * 4] / 255 - 0.5) * 16 * wgt; ws += wgt;
      }
      const avg = Math.pow(2, sum / ws);
      this.targetExposure = Math.min(9, Math.max(0.22, 0.18 / Math.max(avg, 1e-4)));
    }
    if (this.targetExposure !== undefined) {
      const rate = this.targetExposure < this.exposure ? 5 : 1.6;
      this.exposure += (this.targetExposure - this.exposure) * (1 - Math.exp(-dt * rate));
    }

    this.mBright.uniforms.tColor.value = this.compRT.texture;
    this.mBright.uniforms.uExposure.value = this.exposure;
    this.pass(this.mBright, this.bA);
    const bw = 1 / (this.w >> 2), bh = 1 / (this.h >> 2);
    for (const s of [1, 2.2]) {
      this.mBlur.uniforms.tColor.value = this.bA.texture; this.mBlur.uniforms.uDir.value.set(bw * s, 0);
      this.pass(this.mBlur, this.bB);
      this.mBlur.uniforms.tColor.value = this.bB.texture; this.mBlur.uniforms.uDir.value.set(0, bh * s);
      this.pass(this.mBlur, this.bA);
    }

    u = this.mFinal.uniforms;
    u.tColor.value = this.compRT.texture; u.tBloom.value = this.bA.texture;
    u.uRes.value.set(this.w, this.h);
    u.uTime.value = fx.time; u.uExposure.value = this.exposure; u.uAspect.value = this.w / this.h;
    u.uHurt.value = fx.hurt; u.uDead.value = fx.dead; u.uGlitch.value = fx.glitch;
    this.pass(this.mFinal, null);
  }
}
