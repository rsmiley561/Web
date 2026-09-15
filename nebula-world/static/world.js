// The cloud world. Built fresh in Three.js.
// Everything drawn here is navigation and atmosphere. Filaments are only ever
// drawn for printed recommendations. Nothing here encodes a score.
import * as THREE from 'three';
import {OrbitControls} from './vendor/three/controls/OrbitControls.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- procedural cloud atlas (4 tiles of radial falloff x value noise) --------
function makeAtlas() {
  const T = 128, tiles = 4, size = T * 2, c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
  const hash = (x, y, s) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
  const noise = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), cc = hash(xi, yi + 1, s), dd = hash(xi + 1, yi + 1, s); return a + (b - a) * u + (cc - a) * v + (a - b - cc + dd) * u * v; };
  for (let t = 0; t < tiles; t++) {
    const ox = (t % 2) * T, oy = Math.floor(t / 2) * T, seed = 11 + t * 17;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const nx = (x + .5) / T * 2 - 1, ny = (y + .5) / T * 2 - 1, r = Math.hypot(nx, ny);
      let f = 0, amp = .5, fr = 3.1; for (let o = 0; o < 4; o++) { f += amp * noise(x / T * fr + seed, y / T * fr + seed * .7, seed + o); amp *= .5; fr *= 2.03; }
      const fall = Math.max(0, 1 - r * r), soft = fall * fall, v = Math.max(0, Math.min(1, soft * (0.35 + 1.25 * f)));
      const i = ((oy + y) * size + ox + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  return tex;
}

const SPRITE_VERT = /* glsl */`
  attribute vec3 iCenter; attribute vec3 iLocal; attribute float iSize; attribute vec3 iColor;
  attribute float iPhase; attribute float iTile; attribute float iState; attribute float iCover;
  uniform float uTime; uniform float uDrift; uniform float uFarBoost;
  varying vec2 vUv; varying vec3 vColor; varying float vState; varying float vDist; varying float vCover;
  void main(){
    float ph = iPhase;
    vec3 local = iLocal * (1.0 + 0.12*sin(uTime*0.35+ph)*uDrift);
    vec3 center = iCenter + local + vec3(sin(uTime*0.11+ph), cos(uTime*0.09+ph*1.3), sin(uTime*0.07+ph*0.7))*0.6*uDrift;
    vec4 mv = modelViewMatrix * vec4(center, 1.0);
    float dist = -mv.z;
    float s = iSize * (1.0 + 0.06*sin(uTime*0.5+ph*1.7)*uDrift) * (1.0 + 0.22*step(1.5,iState));
    s *= 1.0 + smoothstep(250.0, 1700.0, dist) * uFarBoost;
    float rot = ph*6.283 + uTime*0.04*uDrift*(mod(ph*7.0,2.0)-1.0);
    mat2 R = mat2(cos(rot),-sin(rot),sin(rot),cos(rot));
    mv.xy += R * position.xy * s;
    gl_Position = projectionMatrix * mv;
    vec2 tile = vec2(mod(iTile,2.0), floor(iTile/2.0));
    vUv = (uv + tile) * 0.5;
    vColor = iColor; vState = iState; vDist = -mv.z; vCover = iCover;
  }`;
const SPRITE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uAtlas; uniform vec3 uFog; uniform float uFogD; uniform float uAlpha; uniform float uAdditive; uniform float uTime; uniform float uIdle;
  varying vec2 vUv; varying vec3 vColor; varying float vState; varying float vDist; varying float vCover;
  void main(){
    float a = texture2D(uAtlas, vUv).a;
    // idle 0 · partner 1 · in chain 2 · focus 3
    float lit = mix(uIdle, 1.0, smoothstep(0.0,1.0,vState)) * (1.0 + 0.4*smoothstep(1.0,3.0,vState) + 0.5*vCover);
    lit += 0.12*sin(uTime*1.6)*step(2.5,vState);
    vec3 col = vColor * lit;
    float fog = exp(-max(0.0, vDist - 60.0) * uFogD);
    if (uAdditive > 0.5) { gl_FragColor = vec4(col * a * uAlpha * fog, 1.0); }
    else { col = mix(uFog, col, fog); gl_FragColor = vec4(col, a * uAlpha * (0.35 + 0.65*fog)); }
  }`;

const FIL_VERT = /* glsl */`
  attribute vec3 tangent; attribute float side; attribute float u; attribute float aState; attribute float aStart; attribute float aSeed;
  uniform float uTime; uniform float uWidth;
  varying float vSide; varying float vU; varying float vState; varying float vStart; varying float vSeed; varying float vDist;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 t = normalize((modelViewMatrix * vec4(tangent, 0.0)).xyz);
    vec3 n = normalize(cross(vec3(0.0,0.0,1.0), t));
    float w = uWidth * (1.0 + 0.9*step(0.5,aState)) * (1.0 + 0.6*step(1.5,aState));
    mv.xyz += n * side * w;
    gl_Position = projectionMatrix * mv;
    vSide = side; vU = u; vState = aState; vStart = aStart; vSeed = aSeed; vDist = -mv.z;
  }`;
const FIL_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime; uniform float uFogD;
  varying float vSide; varying float vU; varying float vState; varying float vStart; varying float vSeed; varying float vDist;
  void main(){
    float edge = 1.0 - abs(vSide); edge *= edge;
    float ends = smoothstep(0.0,0.08,vU) * smoothstep(1.0,0.92,vU);
    float age = uTime - vStart;
    float fresh = step(1.5, vState) * exp(-age*0.9);
    float speed = 0.16 + 0.10*step(0.5,vState) + 0.9*fresh;
    float lp = fract(uTime*speed + vSeed);
    float band = exp(-pow((vU - lp)*14.0, 2.0)) + 0.35*exp(-pow((vU - fract(lp+0.5))*14.0, 2.0));
    float base = 0.12 + 0.48*step(0.5,vState) + 0.9*fresh;
    float i = base + band*(0.4 + 0.9*step(0.5,vState) + 1.8*fresh);
    vec3 warm = vec3(0.98,0.90,0.66), white = vec3(1.0,0.99,0.93);
    vec3 col = mix(warm, white, clamp(band + fresh,0.0,1.0)) * i;
    float fog = exp(-vDist*uFogD*0.7);
    gl_FragColor = vec4(col * edge * ends * fog, 1.0);
  }`;

export function createWorld(container, {onSelect, onState, families}) {
  const state = {moving: false, paused: REDUCED, reading: false, dpr: Math.min(devicePixelRatio || 1, ('ontouchstart' in globalThis) ? 1.5 : 2), fps: 0};
  let renderer;
  try { renderer = new THREE.WebGLRenderer({antialias: false, alpha: false, powerPreference: 'high-performance'}); }
  catch (e) { onState({error: 'This browser could not open the clouds. Search, pairings and recipes still work.'}); return null; }
  renderer.setPixelRatio(state.dpr); renderer.setClearColor(0x03090a, 1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const FOG = new THREE.Color(0x04100c), FOG_D = 0.0026;
  const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 4000);
  camera.position.set(0, 220, 1400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.9;
  controls.enablePan = false; controls.minDistance = 10; controls.maxDistance = 2400;
  controls.touches = {ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE};
  const atlas = makeAtlas();
  const clock = new THREE.Clock(); let time = 0;

  const quad = new THREE.PlaneGeometry(1, 1);
  function spriteMaterial(additive, alpha, idle = 1, farBoost = 0) {
    return new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {uTime: {value: 0}, uAtlas: {value: atlas}, uFog: {value: FOG}, uFogD: {value: FOG_D}, uAlpha: {value: alpha}, uAdditive: {value: additive ? 1 : 0}, uDrift: {value: REDUCED ? 0 : 1}, uIdle: {value: idle}, uFarBoost: {value: farBoost}},
    });
  }
  function instanced(count, material, order) {
    const g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.attributes.position = quad.attributes.position; g.attributes.uv = quad.attributes.uv;
    const A = {center: new Float32Array(count * 3), local: new Float32Array(count * 3), size: new Float32Array(count), color: new Float32Array(count * 3), phase: new Float32Array(count), tile: new Float32Array(count), state: new Float32Array(count), cover: new Float32Array(count)};
    g.setAttribute('iCenter', new THREE.InstancedBufferAttribute(A.center, 3)); g.setAttribute('iLocal', new THREE.InstancedBufferAttribute(A.local, 3));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(A.size, 1)); g.setAttribute('iColor', new THREE.InstancedBufferAttribute(A.color, 3));
    g.setAttribute('iPhase', new THREE.InstancedBufferAttribute(A.phase, 1)); g.setAttribute('iTile', new THREE.InstancedBufferAttribute(A.tile, 1));
    g.setAttribute('iState', new THREE.InstancedBufferAttribute(A.state, 1).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('iCover', new THREE.InstancedBufferAttribute(A.cover, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = count; const m = new THREE.Mesh(g, material); m.frustumCulled = false; m.renderOrder = order; scene.add(m); return {mesh: m, A, g};
  }
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const col = new THREE.Color();

  // ---- ambient nebula: big far sheets + mist you travel through -------------
  const AMB = 260, MIST = 1100, amb = instanced(AMB + MIST, spriteMaterial(true, 0.26, 1, 1.5), 1);
  for (let i = 0; i < AMB + MIST; i++) {
    const far = i < AMB, r = far ? 400 + rnd() * 900 : Math.pow(rnd(), 0.6) * 1000, th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
    amb.A.center.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.75, r * Math.cos(ph)], i * 3);
    amb.A.size[i] = far ? 120 + rnd() * 220 : 10 + rnd() * 30;
    col.setHSL(0.36 + rnd() * 0.12, 0.5, far ? 0.05 + rnd() * 0.06 : 0.09 + rnd() * 0.08); amb.A.color.set([col.r, col.g, col.b], i * 3);
    amb.A.phase[i] = rnd(); amb.A.tile[i] = Math.floor(rnd() * 4); amb.A.state[i] = 0;
  }

  // ---- ingredient formations ------------------------------------------------
  let places = [], placeIndex = new Map(), body, rim, spritesOf = [];
  function setPlaces(list) {
    places = list; placeIndex = new Map(list.map((n, i) => [n.id, i]));
    let total = 0; spritesOf = list.map(n => { const k = 9 + Math.min(7, Math.floor(n.deg / 90)); const s = total; total += k; return [s, k]; });
    body = instanced(total, spriteMaterial(false, 0.66, 0.5, 5.0), 2); rim = instanced(total, spriteMaterial(true, 0.5, 0.22, 6.0), 3);
    list.forEach((n, pi) => {
      const fam = families[n.family] || families.mist, deep = new THREE.Color(fam.deep), bright = new THREE.Color(fam.hex);
      const [s, k] = spritesOf[pi], R = 4 + Math.min(5, n.deg / 120);
      for (let j = 0; j < k; j++) {
        const i = s + j, t = j / k, r = (j === 0 ? 0 : 2 + rnd() * R), th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
        const local = [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)];
        for (const L of [body, rim]) { L.A.center.set(n.p, i * 3); L.A.local.set(local, i * 3); L.A.phase[i] = rnd(); L.A.tile[i] = Math.floor(rnd() * 4); }
        body.A.size[i] = (j === 0 ? 9 : 5) + rnd() * 5 + R * 0.5; rim.A.size[i] = (j === 0 ? 5 : 2.5) + rnd() * 3;
        const bc = deep.clone().lerp(bright, 0.10 + rnd() * 0.18), rc = bright.clone().lerp(new THREE.Color('#fff7dc'), 0.2 * rnd());
        body.A.color.set([bc.r, bc.g, bc.b], i * 3); rim.A.color.set([rc.r * 0.9, rc.g * 0.9, rc.b * 0.9], i * 3);
      }
    });
  }
  function setStates(stateOf, coverOf) {
    if (!body) return;
    places.forEach((n, pi) => { const [s, k] = spritesOf[pi], st = stateOf(n.id), cv = coverOf(n.id); for (let j = 0; j < k; j++) { body.A.state[s + j] = rim.A.state[s + j] = st; body.A.cover[s + j] = rim.A.cover[s + j] = cv; } });
    for (const L of [body, rim]) { L.g.attributes.iState.needsUpdate = true; L.g.attributes.iCover.needsUpdate = true; }
  }

  // ---- filaments --------------------------------------------------------------
  const filMat = new THREE.ShaderMaterial({vertexShader: FIL_VERT, fragmentShader: FIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {uTime: {value: 0}, uWidth: {value: 0.55}, uFogD: {value: FOG_D}}});
  let filMesh = null;
  const SEG = 22;
  function setFilaments(list) {   // [{a:[x,y,z], b:[x,y,z], state:0|1|2, start:number, seed:number}]
    if (filMesh) { scene.remove(filMesh); filMesh.geometry.dispose(); filMesh = null; }
    if (!list.length) return;
    const n = list.length, V = (SEG + 1) * 2, pos = new Float32Array(n * V * 3), tan = new Float32Array(n * V * 3), side = new Float32Array(n * V), u = new Float32Array(n * V), st = new Float32Array(n * V), start = new Float32Array(n * V), sd = new Float32Array(n * V), idx = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3(), P = new THREE.Vector3(), T = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), N = new THREE.Vector3();
    list.forEach((f, fi) => {
      A.fromArray(f.a); B.fromArray(f.b); M.addVectors(A, B).multiplyScalar(0.5); N.subVectors(B, A); const len = N.length(); N.cross(up).normalize();
      const bulge = Math.min(40, len * 0.12) * (f.seed > 0.5 ? 1 : -1); M.addScaledVector(N, bulge).addScaledVector(up, bulge * 0.4);
      const curve = new THREE.QuadraticBezierCurve3(A, M, B);
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG; curve.getPoint(t, P); curve.getTangent(t, T);
        for (let k = 0; k < 2; k++) { const v = fi * V + s * 2 + k; pos.set([P.x, P.y, P.z], v * 3); tan.set([T.x, T.y, T.z], v * 3); side[v] = k ? 1 : -1; u[v] = t; st[v] = f.state; start[v] = f.start; sd[v] = f.seed; }
        if (s < SEG) { const b = fi * V + s * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('tangent', new THREE.BufferAttribute(tan, 3)); g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    g.setAttribute('u', new THREE.BufferAttribute(u, 1)); g.setAttribute('aState', new THREE.BufferAttribute(st, 1)); g.setAttribute('aStart', new THREE.BufferAttribute(start, 1)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    g.setIndex(idx); filMesh = new THREE.Mesh(g, filMat); filMesh.frustumCulled = false; filMesh.renderOrder = 4; scene.add(filMesh);
  }

  // ---- labels (DOM, projected) -----------------------------------------------
  const labelLayer = document.createElement('div'); labelLayer.className = 'labels'; container.appendChild(labelLayer);
  let labelled = []; const labelEls = new Map(); const V = new THREE.Vector3();
  function setLabels(list) {   // [{id,label,p,role:'focus'|'chain'|'partner'|'beacon',family}]
    labelled = list; const keep = new Set(list.map(l => l.id));
    for (const [id, el] of labelEls) if (!keep.has(id)) { el.remove(); labelEls.delete(id); }
    for (const l of list) {
      let el = labelEls.get(l.id);
      if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'label'; el.dataset.id = l.id; el.onclick = () => onSelect(l.id); labelEls.set(l.id, el); labelLayer.appendChild(el); }
      el.dataset.role = l.role; el.style.setProperty('--fam', (families[l.family] || families.mist).hex); el.textContent = l.label; el.setAttribute('aria-label', l.aria || l.label);
    }
  }
  const PRIORITY = {focus: 0, chain: 1, beacon: 2, partner: 3};
  function projectLabels() {
    const w = container.clientWidth, h = container.clientHeight, placed = [];
    const order = [...labelled].sort((a, b) => PRIORITY[a.role] - PRIORITY[b.role]);
    for (const l of order) {
      const el = labelEls.get(l.id); if (!el) continue;
      V.fromArray(l.p).project(camera);
      const d = camera.position.distanceTo(new THREE.Vector3().fromArray(l.p));
      if (V.z > 1 || V.z < -1) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; continue; }
      let x = (V.x * 0.5 + 0.5) * w, y = (-V.y * 0.5 + 0.5) * h;
      const far = camera.position.distanceTo(controls.target) > 600;
      const near = l.role === 'focus' ? 1 : far ? 0.92 : Math.max(0.28, Math.min(1, 1 - (d - 90) / 520)), sc = far ? 0.9 : Math.max(0.72, Math.min(1.15, 140 / Math.max(60, d)));
      const bw = (el.textContent.length * 11 + 28) * sc, bh = 34 * sc;
      for (let tries = 0; tries < 4; tries++) { const hit = placed.find(r => Math.abs(r.x - x) < (r.w + bw) / 2 && Math.abs(r.y - y) < (r.h + bh) / 2); if (!hit) break; y = hit.y + (y >= hit.y ? 1 : -1) * ((hit.h + bh) / 2 + 2); }
      placed.push({x, y, w: bw, h: bh});
      el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      el.style.opacity = String(near); el.style.pointerEvents = near < 0.32 ? 'none' : 'auto'; el.style.zIndex = String(Math.round(2000 - d));
    }
  }

  // ---- camera travel -------------------------------------------------------------
  let travel = null;
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function flyTo(target, distance, duration = 1700) {
    const from = camera.position.clone(), lookFrom = controls.target.clone(), to = new THREE.Vector3().fromArray(target);
    const dir = from.clone().sub(to); if (dir.length() < 1) dir.set(0, 0.4, 1); dir.normalize();
    const dest = to.clone().addScaledVector(dir, distance).add(new THREE.Vector3(0, distance * 0.18, 0));
    const mid = from.clone().lerp(dest, 0.5); const perp = new THREE.Vector3().subVectors(dest, from).cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(Math.min(120, from.distanceTo(dest) * 0.18)); mid.add(perp);
    if (REDUCED) { camera.position.copy(dest); controls.target.copy(to); return Promise.resolve(); }
    controls.enabled = false; state.moving = true; onState({...state});
    return new Promise(resolve => { travel = {t0: performance.now(), duration, from, mid, dest, lookFrom, lookTo: to, resolve}; });
  }
  function stepTravel(now) {
    if (!travel) return;
    const t = Math.min(1, (now - travel.t0) / travel.duration), e = easeInOut(t);
    const a = travel.from.clone().lerp(travel.mid, e), b = travel.mid.clone().lerp(travel.dest, e); camera.position.copy(a.lerp(b, e));
    controls.target.copy(travel.lookFrom.clone().lerp(travel.lookTo, easeInOut(Math.min(1, t * 1.25))));
    if (t >= 1) { const r = travel.resolve; travel = null; controls.enabled = true; state.moving = false; onState({...state}); r(); }
  }
  function go(id) { const n = places[placeIndex.get(id)]; if (!n) return Promise.resolve(); return flyTo(n.p, 36 + Math.min(26, n.deg / 30)); }
  function frame(points, pad = 1.6) {
    if (!points.length) return flyTo([0, 0, 0], 1400, 1600);
    const c = new THREE.Vector3(); points.forEach(p => c.add(new THREE.Vector3().fromArray(p))); c.divideScalar(points.length);
    let r = 30; points.forEach(p => r = Math.max(r, c.distanceTo(new THREE.Vector3().fromArray(p))));
    const dist = Math.max(90, r * pad / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + 40);
    return flyTo(c.toArray(), dist, 1500);
  }

  // ---- tap to select (pointer up without a drag) ---------------------------------
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY}; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || state.moving) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null; if (moved > 7) return;
    const rect = container.getBoundingClientRect(); let best = null, bd = 44;
    for (const l of labelled) { V.fromArray(l.p).project(camera); if (V.z > 1) continue; const x = (V.x * .5 + .5) * rect.width, y = (-V.y * .5 + .5) * rect.height, d = Math.hypot(x - (e.clientX - rect.left), y - (e.clientY - rect.top)); if (d < bd) { bd = d; best = l; } }
    if (best) onSelect(best.id);
  });

  // ---- loop -------------------------------------------------------------------------
  let frames = 0, acc = 0, running = true;
  function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  function loop(now) {
    if (!running) return; requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta()); if (!state.paused && !REDUCED) time += dt * (state.reading ? 0.25 : 1);
    stepTravel(now); controls.update();
    const camD = camera.position.distanceTo(controls.target), fogD = FOG_D * (1 - 0.8 * THREE.MathUtils.smoothstep(camD, 200, 1400));
    for (const L of [amb, body, rim]) if (L) L.mesh.material.uniforms.uFogD.value = fogD; filMat.uniforms.uFogD.value = fogD;
    filMat.uniforms.uWidth.value = 0.5 + camD * 0.0075;
    for (const L of [amb, body, rim]) if (L) L.mesh.material.uniforms.uTime.value = time; filMat.uniforms.uTime.value = time;
    renderer.render(scene, camera); projectLabels();
    acc += dt; frames++; if (acc > 1) { state.fps = Math.round(frames / acc);
      if (state.fps < 34 && state.dpr > 1) { state.dpr = Math.max(1, state.dpr - 0.25); renderer.setPixelRatio(state.dpr); }
      else if (state.fps < 30 && state.dpr <= 1 && amb.g.instanceCount > AMB + MIST / 2) { amb.g.instanceCount = AMB + Math.floor(MIST / 2); state.quality = 'reduced-mist'; }
      acc = 0; frames = 0; onState({...state}); }
  }
  requestAnimationFrame(loop);

  return {
    setPlaces, setStates, setFilaments, setLabels, go, frame, now: () => time,
    pause() { state.paused = !state.paused; onState({...state}); },
    setReading(v) { state.reading = v; container.classList.toggle('reading', v); },
    metrics: () => ({fps: state.fps, dpr: state.dpr, moving: state.moving, paused: state.paused, time}),
    camera, controls,
    dispose() { running = false; renderer.dispose(); renderer.domElement.remove(); labelLayer.remove(); },
  };
}
