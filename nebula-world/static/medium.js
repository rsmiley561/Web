// Phase 1 — the medium, alone.
// A raymarched volume: baked 3D noise (fBm + inverted Worley) carves cavities; Beer-Lambert
// extinction; dual-lobe Henyey-Greenstein scattering toward one warm light in a pocket; a short
// light-march for self-shadow; one dark, absorbing tangle in front of the light so the reference
// grammar can be judged. No data, no UI beyond tuning. Judged on the iPad, not here.
import * as THREE from 'three';

// ---------- baked periodic 3D noise --------------------------------------------------------
function bakeNoise(N = 64) {
  const data = new Uint8Array(N * N * N * 4);
  const hash = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1103515245) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sm = t => t * t * (3 - 2 * t);
  const value = (x, y, z, P, s) => {                      // periodic value noise, lattice period P
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    const H = (a, b, c) => hash(((xi + a) % P + P) % P, ((yi + b) % P + P) % P, ((zi + c) % P + P) % P, s);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(H(0,0,0), H(1,0,0), xf), l(H(0,1,0), H(1,1,0), xf), yf), l(l(H(0,0,1), H(1,0,1), xf), l(H(0,1,1), H(1,1,1), xf), yf), zf);
  };
  const fbm = (u, v, w, s, base) => { let a = 0.5, f = base, sum = 0, norm = 0; for (let o = 0; o < 4; o++) { sum += a * value(u * f, v * f, w * f, f, s + o * 7); norm += a; a *= 0.5; f *= 2; } return sum / norm; };
  const C = 4, feat = [];                                   // periodic Worley feature points, C cells per axis
  for (let z = 0; z < C; z++) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) feat.push([x + hash(x, y, z, 91), y + hash(x, y, z, 92), z + hash(x, y, z, 93)]);
  const worley = (u, v, w) => { const px = u * C, py = v * C, pz = w * C; let best = 9; const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const fx = ((cx + dx) % C + C) % C, fy = ((cy + dy) % C + C) % C, fz = ((cz + dz) % C + C) % C; const f = feat[(fz * C + fy) * C + fx];
      const ox = f[0] + (cx + dx - fx), oy = f[1] + (cy + dy - fy), oz = f[2] + (cz + dz - fz); const d = Math.hypot(px - ox, py - oy, pz - oz); if (d < best) best = d; }
    return 1 - Math.min(1, best * 1.15); };                  // inverted: 1 at feature points → cavities
  let i = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    data[i++] = fbm(u, v, w, 1, 4) * 255; data[i++] = worley(u, v, w) * 255; data[i++] = fbm(u, v, w, 31, 8) * 255; data[i++] = 255;
  }
  const tex = new THREE.Data3DTexture(data, N, N, N); tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}

// ---------- shaders --------------------------------------------------------------------------
const VERT = /* glsl */`out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MARCH = /* glsl */`
precision highp float; precision highp sampler3D;
in vec2 vUv; out vec4 outColor;
uniform sampler3D uNoise; uniform float uTime;
uniform vec3 uCamPos, uCamFwd, uCamRight, uCamUp; uniform float uTanHalfFov, uAspect;
uniform vec3 uLightPos, uLightColor, uAmbient, uBg, uAlbedo;
uniform float uScale, uDensity, uCarve, uThreshold, uDetail, uAbsorb, uLightI, uFalloff, uG1, uG2, uGmix, uDrift, uPocket, uTangle, uFar;
uniform int uSteps;

float hg(float c, float g){ float g2 = g*g; return (1.0 - g2) / (4.0*3.14159265 * pow(1.0 + g2 - 2.0*g*c, 1.5)); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }

// The cloud. fBm mass with cavities carved where inverted Worley is high; a spherical pocket
// carved around the light so there is somewhere to arrive.
float cloud(vec3 p){
  vec3 q = p * uScale + vec3(0.013, 0.007, 0.011) * uTime * uDrift;
  // low-frequency domain warp breaks the tile repetition into organic folds
  vec3 warp = (texture(uNoise, q * 0.31 + vec3(0.71, 0.13, 0.42)).rgb - 0.5) * 0.28;
  vec4 n = texture(uNoise, q + warp);
  float F = clamp((n.r - 0.5) * 3.0 + 0.5, 0.0, 1.0);                 // fBm with real dynamic range
  float W = 1.0 - clamp((1.0 - n.g / 1.15 - 0.05) / 0.8, 0.0, 1.0);    // cavity: 1 at Worley feature points
  float shape = F - uCarve * W - uThreshold;
  float detail = texture(uNoise, q * 2.7 + vec3(0.31, 0.17, 0.53)).b;
  shape += (detail - 0.5) * uDetail;
  float dl = length(p - uLightPos);
  shape -= uPocket * exp(-dl*dl / 2000.0);                             // the pocket you arrive in
  return smoothstep(0.02, 0.24, shape) * uDensity;                     // cavities empty, walls dense
}
// One dark, fibrous tangle just in front of the light: absorbing only, never emitting.
float tangle(vec3 p){
  vec3 c = p - (uLightPos + vec3(7.0, -3.0, 10.0));
  if (dot(c, c) > 400.0) return 0.0;
  vec3 warp = (texture(uNoise, c * 0.045 + vec3(0.5)).rgb - 0.5) * 4.5;
  vec3 q = (c + warp) * 1.6;
  float d = 1e9;
  d = smin(d, sdCapsule(q, vec3(0.0), vec3( 14.0,  8.0,  3.0), 0.9), 2.2);
  d = smin(d, sdCapsule(q, vec3(0.0), vec3(-12.0, 10.0, -4.0), 0.8), 2.2);
  d = smin(d, sdCapsule(q, vec3(0.0), vec3( -9.0,-13.0,  5.0), 0.8), 2.2);
  d = smin(d, sdCapsule(q, vec3(0.0), vec3( 11.0, -9.0, -6.0), 0.7), 2.2);
  d = smin(d, sdCapsule(q, vec3(0.0), vec3(  2.0, 15.0, -9.0), 0.6), 2.2);
  d = smin(d, sdCapsule(q, vec3(0.0), vec3( -3.0, -4.0, 16.0), 0.6), 2.2);
  d = smin(d, sdCapsule(q, vec3(2.0, 3.0, 1.0), vec3( 16.0, -2.0, 9.0), 0.5), 2.0);
  d = smin(d, sdCapsule(q, vec3(-1.0, -2.0, 0.0), vec3(-15.0, -3.0, -8.0), 0.5), 2.0);
  return uTangle * smoothstep(1.2, -0.6, d);
}
void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + uCamRight * ndc.x * uTanHalfFov * uAspect + uCamUp * ndc.y * uTanHalfFov);
  vec3 ro = uCamPos;
  float T = 1.0; vec3 col = vec3(0.0);
  float t = 0.4 + 0.3 * fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);   // small jitter hides banding
  for (int i = 0; i < 96; i++) {
    if (i >= uSteps || t > uFar) break;
    float dt = max(0.9, t * 0.05);
    vec3 p = ro + rd * t;
    float dc = cloud(p), dk = tangle(p), d = dc + dk;
    if (d > 0.002) {
      vec3 L = uLightPos - p; float dl = length(L); L /= dl;
      float sh = 0.0; float ls = 3.0;
      for (int j = 0; j < 4; j++) { vec3 lp = p + L * ls * (float(j) + 0.6); sh += cloud(lp) + tangle(lp); ls *= 1.35; }
      float lightT = exp(-sh * 2.4 * uAbsorb);
      float powder = 1.0 - exp(-dc * 3.0);
      float c = dot(rd, L);
      float phase = mix(hg(c, uG1), hg(c, uG2), uGmix);
      float atten = uLightI / (1.0 + dl * dl * uFalloff);
      vec3 S = (uLightColor * atten * lightT * phase * (0.6 + 0.4*powder) * uAlbedo + uAmbient) * dc;   // only the cloud scatters, in viridian
      float sigma = d * uAbsorb;
      float stepT = exp(-sigma * dt);
      col += T * (S - S * stepT) / max(sigma, 1e-4);
      T *= stepT;
      if (T < 0.02) break;
    }
    t += dt;
  }
  // what remains of the background and the light itself seen through the medium
  vec3 toL = normalize(uLightPos - ro); float glow = pow(max(dot(rd, toL), 0.0), 240.0) * uLightI * 0.12;
  col += T * (uBg + uLightColor * glow);
  outColor = vec4(col, 1.0);
}`;
const COMPOSITE = /* glsl */`
precision highp float; in vec2 vUv; out vec4 outColor; uniform sampler2D uTex; uniform float uExposure;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  vec3 c = texture(uTex, vUv).rgb * uExposure;
  c = aces(c);
  float v = smoothstep(1.6, 0.35, length(vUv - 0.5));  c *= 0.82 + 0.18 * v;
  outColor = vec4(pow(c, vec3(1.0/2.2)), 1.0);
}`;

// ---------- tunables (persisted in the URL hash so the owner can send back what looked right) ----
const P = {
  density: 1.0, carve: 1.2, threshold: 0.15, detail: 0.3, absorb: 0.8, scale: 0.0065, drift: 0.5,
  lightI: 9, falloff: 0.0022, g1: 0.62, g2: -0.28, gmix: 0.45, pocket: 1.8, tangle: 6.0, far: 280, steps: 60, exposure: 1.0,
  scale2: 0.5,          // render scale (fraction of framebuffer)
};
const hashParams = new URLSearchParams(location.hash.slice(1)); for (const k of Object.keys(P)) if (hashParams.has(k)) P[k] = Number(hashParams.get(k));
const writeHash = () => history.replaceState(null, '', '#' + Object.entries(P).filter(([k, v]) => k !== 'scale2').map(([k, v]) => k + '=' + (+v.toFixed(4))).join('&'));

// ---------- setup ------------------------------------------------------------------------------
const status = document.getElementById('status');
status.textContent = 'Condensing the medium…';
await new Promise(r => setTimeout(r, 30));
const noise = bakeNoise(64);
const renderer = new THREE.WebGLRenderer({antialias: false, alpha: false, powerPreference: 'high-performance'});
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
document.getElementById('stage').appendChild(renderer.domElement);
const cam = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);
const quad = new THREE.PlaneGeometry(2, 2), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const march = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: MARCH, depthTest: false, depthWrite: false, uniforms: {
  uNoise: {value: noise}, uTime: {value: 0}, uCamPos: {value: new THREE.Vector3()}, uCamFwd: {value: new THREE.Vector3()}, uCamRight: {value: new THREE.Vector3()}, uCamUp: {value: new THREE.Vector3()},
  uTanHalfFov: {value: Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))}, uAspect: {value: 1},
  uLightPos: {value: new THREE.Vector3(0, 4, -52)}, uLightColor: {value: new THREE.Color(1.0, 0.93, 0.78)}, uAmbient: {value: new THREE.Color(0.010, 0.026, 0.020)}, uBg: {value: new THREE.Color(0.004, 0.012, 0.010)}, uAlbedo: {value: new THREE.Color(0.40, 0.80, 0.62)},
  uScale: {value: P.scale}, uDensity: {value: P.density}, uCarve: {value: P.carve}, uThreshold: {value: P.threshold}, uDetail: {value: P.detail}, uAbsorb: {value: P.absorb}, uLightI: {value: P.lightI}, uFalloff: {value: P.falloff},
  uG1: {value: P.g1}, uG2: {value: P.g2}, uGmix: {value: P.gmix}, uDrift: {value: P.drift}, uPocket: {value: P.pocket}, uTangle: {value: P.tangle}, uFar: {value: P.far}, uSteps: {value: P.steps},
}});
const composite = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false, uniforms: {uTex: {value: null}, uExposure: {value: P.exposure}}});
const sceneA = new THREE.Scene(); sceneA.add(new THREE.Mesh(quad, march)); const sceneB = new THREE.Scene(); sceneB.add(new THREE.Mesh(quad, composite));
let target = null;
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  cam.aspect = w / h; march.uniforms.uAspect.value = w / h;
  const tw = Math.max(64, Math.round(w * P.scale2)), th = Math.max(64, Math.round(h * P.scale2));
  if (target) target.dispose(); target = new THREE.WebGLRenderTarget(tw, th, {type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false});
  composite.uniforms.uTex.value = target.texture;
}
addEventListener('resize', resize); resize();

// ---------- inertial fly camera ------------------------------------------------------------------
const fly = {yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, vel: new THREE.Vector3(), pos: new THREE.Vector3(0, 2, 14), lastInput: performance.now(), auto: true};
const el = renderer.domElement; let drag = null, pinch = null;
const touched = () => { fly.lastInput = performance.now(); };
el.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; drag = {x: e.clientX, y: e.clientY}; touched(); });
addEventListener('pointermove', e => { if (!drag) return; fly.vyaw -= (e.clientX - drag.x) * 0.0022; fly.vpitch -= (e.clientY - drag.y) * 0.0022; drag = {x: e.clientX, y: e.clientY}; touched(); });
addEventListener('pointerup', () => drag = null);
el.addEventListener('wheel', e => { e.preventDefault(); fly.vel.addScaledVector(forward(), -e.deltaY * 0.02); touched(); }, {passive: false});
el.addEventListener('touchstart', e => { touched(); if (e.touches.length === 1) drag = {x: e.touches[0].clientX, y: e.touches[0].clientY}; else if (e.touches.length === 2) { drag = null; pinch = dist(e.touches); } }, {passive: true});
el.addEventListener('touchmove', e => { e.preventDefault(); touched();
  if (e.touches.length === 1 && drag) { const t = e.touches[0]; fly.vyaw -= (t.clientX - drag.x) * 0.0028; fly.vpitch -= (t.clientY - drag.y) * 0.0028; drag = {x: t.clientX, y: t.clientY}; }
  else if (e.touches.length === 2 && pinch != null) { const d = dist(e.touches); fly.vel.addScaledVector(forward(), (d - pinch) * 0.06); pinch = d; } }, {passive: false});
el.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; if (!e.touches.length) drag = null; });
const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const keys = new Set(); addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); touched(); }); addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
function forward() { return new THREE.Vector3(-Math.sin(fly.yaw) * Math.cos(fly.pitch), Math.sin(fly.pitch), -Math.cos(fly.yaw) * Math.cos(fly.pitch)); }
function stepFly(dt) {
  const f = forward(), r = new THREE.Vector3(f.z, 0, -f.x).normalize(), u = new THREE.Vector3().crossVectors(r, f);
  const a = 22 * dt;
  if (keys.has('w') || keys.has('arrowup')) fly.vel.addScaledVector(f, a); if (keys.has('s') || keys.has('arrowdown')) fly.vel.addScaledVector(f, -a);
  if (keys.has('a')) fly.vel.addScaledVector(r, -a); if (keys.has('d')) fly.vel.addScaledVector(r, a); if (keys.has('q')) fly.vel.addScaledVector(u, -a); if (keys.has('e')) fly.vel.addScaledVector(u, a);
  if (keys.has('arrowleft')) fly.vyaw += 0.9 * dt; if (keys.has('arrowright')) fly.vyaw -= 0.9 * dt;
  // idle: a slow, breathing drift toward the light — the world keeps moving on its own
  if (fly.auto && performance.now() - fly.lastInput > 2500) {
    const toL = march.uniforms.uLightPos.value.clone().sub(fly.pos); const d = toL.length(); toL.normalize();
    if (d > 26) fly.vel.addScaledVector(toL, 1.6 * dt);
    const wantYaw = Math.atan2(-toL.x, -toL.z), wantPitch = Math.asin(THREE.MathUtils.clamp(toL.y, -1, 1));
    fly.vyaw += (wrapAngle(wantYaw - fly.yaw)) * 0.25 * dt; fly.vpitch += (wantPitch - fly.pitch) * 0.25 * dt;
  }
  fly.yaw += fly.vyaw; fly.pitch = THREE.MathUtils.clamp(fly.pitch + fly.vpitch, -1.3, 1.3); fly.vyaw *= Math.pow(0.05, dt); fly.vpitch *= Math.pow(0.05, dt);
  fly.pos.addScaledVector(fly.vel, dt); fly.vel.multiplyScalar(Math.pow(0.12, dt));
}
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- loop with adaptive render scale ------------------------------------------------------
const clock = new THREE.Clock(); let time = 0, frames = 0, acc = 0, fps = 0, paused = false;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta()); if (!paused) time += dt;
  stepFly(dt);
  const f = forward(), r = new THREE.Vector3(f.z, 0, -f.x).normalize(), u = new THREE.Vector3().crossVectors(r, f);
  march.uniforms.uCamPos.value.copy(fly.pos); march.uniforms.uCamFwd.value.copy(f); march.uniforms.uCamRight.value.copy(r); march.uniforms.uCamUp.value.copy(u); march.uniforms.uTime.value = time;
  renderer.setRenderTarget(target); renderer.render(sceneA, ortho); renderer.setRenderTarget(null); renderer.render(sceneB, ortho);
  acc += dt; frames++;
  if (acc >= 1) { fps = Math.round(frames / acc); frames = 0; acc = 0;
    if (fps < 26 && P.scale2 > 0.3) { P.scale2 = Math.max(0.3, P.scale2 - 0.08); resize(); } else if (fps > 52 && P.scale2 < 0.7) { P.scale2 = Math.min(0.7, P.scale2 + 0.05); resize(); }
    status.textContent = `${fps} fps · ${Math.round(P.scale2 * 100)}% · ${P.steps} steps`; }
}
requestAnimationFrame(loop);

// ---------- tuning panel ---------------------------------------------------------------------------
const SLIDERS = [['density', 0.3, 3, 0.05], ['carve', 0, 2, 0.05], ['threshold', 0, 0.6, 0.01], ['detail', 0, 1, 0.05], ['absorb', 0.2, 2.5, 0.05], ['scale', 0.004, 0.03, 0.0005], ['drift', 0, 2, 0.1],
  ['lightI', 2, 80, 1], ['falloff', 0.0001, 0.004, 0.0001], ['g1', 0, 0.9, 0.02], ['g2', -0.9, 0, 0.02], ['gmix', 0, 1, 0.05], ['pocket', 0, 3, 0.05], ['tangle', 0, 14, 0.5], ['steps', 24, 96, 4], ['exposure', 0.4, 2.5, 0.05]];
const U = {density: 'uDensity', carve: 'uCarve', threshold: 'uThreshold', detail: 'uDetail', absorb: 'uAbsorb', scale: 'uScale', drift: 'uDrift', lightI: 'uLightI', falloff: 'uFalloff', g1: 'uG1', g2: 'uG2', gmix: 'uGmix', pocket: 'uPocket', tangle: 'uTangle', steps: 'uSteps', far: 'uFar'};
const panel = document.getElementById('tune');
panel.innerHTML = SLIDERS.map(([k, a, b, s]) => `<label><span>${k}</span><input type="range" name="${k}" min="${a}" max="${b}" step="${s}" value="${P[k]}"><output>${P[k]}</output></label>`).join('') + `<button id="reset" type="button">Reset</button><button id="copy" type="button">Copy settings</button>`;
panel.oninput = e => { const k = e.target.name; if (!k) return; P[k] = Number(e.target.value); e.target.nextElementSibling.textContent = P[k]; if (U[k]) march.uniforms[U[k]].value = k === 'steps' ? Math.round(P[k]) : P[k]; if (k === 'exposure') composite.uniforms.uExposure.value = P[k]; writeHash(); };
document.getElementById('reset').onclick = () => { location.hash = ''; location.reload(); };
document.getElementById('copy').onclick = () => { navigator.clipboard?.writeText(location.href); status.textContent = 'Settings link copied'; };
document.getElementById('tune-toggle').onclick = () => panel.classList.toggle('open');
document.getElementById('pause').onclick = e => { paused = !paused; fly.auto = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; };
writeHash();
window.MEDIUM = {get fps() { return fps; }, get scale() { return P.scale2; }, P, pos: () => fly.pos.toArray(), renderer};
