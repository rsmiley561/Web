// CPU twin of the shader's density field. Run this BEFORE changing cloud() in medium.js:
// it reports how much of space is wall, whether the camera→light path is open, and writes a slice.
import fs from 'node:fs'; import zlib from 'node:zlib';
const N = 64;
const hash = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1103515245) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = t => t * t * (3 - 2 * t);
const value = (x, y, z, P, s) => { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
  const H = (a, b, c) => hash(((xi + a) % P + P) % P, ((yi + b) % P + P) % P, ((zi + c) % P + P) % P, s); const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(H(0,0,0), H(1,0,0), xf), l(H(0,1,0), H(1,1,0), xf), yf), l(l(H(0,0,1), H(1,0,1), xf), l(H(0,1,1), H(1,1,1), xf), yf), zf); };
const fbm = (u, v, w, s, base, oct) => { let a = 0.5, f = base, sum = 0, norm = 0; for (let o = 0; o < oct; o++) { sum += a * value(u * f, v * f, w * f, f, s + o * 7); norm += a; a *= 0.5; f *= 2; } return sum / norm; };
const featFor = (C, seed) => { const f = []; for (let z = 0; z < C; z++) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) f.push([x + hash(x, y, z, seed), y + hash(x, y, z, seed + 1), z + hash(x, y, z, seed + 2)]); return f; };
const worley = (u, v, w, C, feat) => { const px = u * C, py = v * C, pz = w * C; let best = 9; const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const fx = ((cx + dx) % C + C) % C, fy = ((cy + dy) % C + C) % C, fz = ((cz + dz) % C + C) % C; const f = feat[(fz * C + fy) * C + fx];
    const d = Math.hypot(px - (f[0] + (cx + dx - fx)), py - (f[1] + (cy + dy - fy)), pz - (f[2] + (cz + dz - fz))); if (d < best) best = d; } return best; };
const F3 = featFor(3, 91), F6 = featFor(4, 131), F12 = featFor(8, 171), F24 = featFor(16, 211);
const wrap = x => x - Math.floor(x);
const tex = (x, y, z) => { const u = wrap(x), v = wrap(y), w = wrap(z); return {r: fbm(u, v, w, 1, 2, 4), g: 1 - Math.min(1, worley(u, v, w, 3, F3) * 1.05), b: (1 - Math.min(1, worley(u, v, w, 4, F6))) * 0.625 + (1 - Math.min(1, worley(u, v, w, 8, F12))) * 0.25 + (1 - Math.min(1, worley(u, v, w, 16, F24))) * 0.125, a: fbm(u, v, w, 41, 8, 3)}; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const remap = (v, lo, hi, a, b) => a + (v - lo) / Math.max(hi - lo, 1e-4) * (b - a);
// --- the formula under test; keep in sync with medium.js cloud() -----------------------------------
const LIGHT = [0, 4, -52], CAM = [0, 2, 14];
function cloud(p, P) {
  const q = [p[0] * P.scale, p[1] * P.scale, p[2] * P.scale];
  const w1 = tex(q[0] * 0.45 + 0.71, q[1] * 0.45 + 0.13, q[2] * 0.45 + 0.42), W1 = [w1.r - .5, w1.g - .5, w1.a - .5];
  const w2 = tex(q[0] * 1.1 + W1[0] * .7 + .23, q[1] * 1.1 + W1[1] * .7 + .61, q[2] * 1.1 + W1[2] * .7 + .08), W2 = [w2.a - .5, w2.r - .5, w2.g - .5];
  const qq = q.map((c, i) => c + (W1[i] * .6 + W2[i] * .35) * P.warp);
  const n = tex(qq[0], qq[1], qq[2]);
  let base = clamp((n.r - 0.5) * 2.6 + 0.5, 0, 1);
  base = clamp(remap(base, (1 - n.b) * P.erode, 1, 0, 1), 0, 1);       // erode by worley-fbm (lo > 0 lowers base)
  const cav = smooth(0.15, 0.95, n.g);
  let shape = base - P.carve * cav - P.threshold;
  const dl = Math.hypot(p[0] - LIGHT[0], p[1] - LIGHT[1], p[2] - LIGHT[2]); shape -= P.pocket * Math.exp(-dl * dl / P.pocketR);
  const dn = tex(qq[0] * 4.3 + .31, qq[1] * 4.3 + .17, qq[2] * 4.3 + .53), det = dn.b * .7 + dn.a * .3, edge = 1 - smooth(0, 0.30, shape);
  shape -= det * edge * P.detail;
  return smooth(0, 0.16, shape) * P.density;
}
function report(name, P) {
  const S = 6000; let wall = 0, sum = 0; for (let i = 0; i < S; i++) { const d = cloud([(Math.random() - .5) * 600, (Math.random() - .5) * 600, (Math.random() - .5) * 600], P); if (d > 0.05) wall++; sum += d; }
  // optical depth along camera → light, and where the first wall is
  let od = 0, first = null; const L = Math.hypot(...LIGHT.map((c, i) => c - CAM[i])); for (let t = 0; t < L; t += 1) { const p = CAM.map((c, i) => c + (LIGHT[i] - c) * t / L); const d = cloud(p, P); od += d * P.absorb; if (first == null && d > 0.3) first = t; }
  console.log(`${name.padEnd(10)} wall ${(100 * wall / S).toFixed(0).padStart(3)}%  mean ${(sum / S).toFixed(3)}  cam→light optical depth ${od.toFixed(1)} (transmittance ${(Math.exp(-od) * 100).toFixed(0)}%), first wall at ${first ?? 'none'} of ${L.toFixed(0)}u`);
}
const base = {density: 1, carve: 1.2, threshold: 0.25, detail: 0.55, warp: 1.0, scale: 0.005, pocket: 1.8, pocketR: 3000, absorb: 0.8, erode: 0.5};
for (const [th, cv, er] of [[0.18, 1.2, 0.5], [0.22, 1.2, 0.5], [0.25, 1.2, 0.5], [0.28, 1.3, 0.5]]) report(`t${th} c${cv} e${er}`, {...base, threshold: th, carve: cv, erode: er});
// slice PNG for the candidate passed on the command line, e.g. node density-lab.mjs 0.35 1.2 0.6
const [th, cv, er] = process.argv.slice(2).map(Number); if (th) {
  const P = {...base, threshold: th, carve: cv, erode: er};
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const W = 320, H = 200, raw = Buffer.alloc((W + 1) * H);   // a vertical slice through camera and light: x across, z along the path
  for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; for (let x = 0; x < W; x++) { const p = [(x / W - .5) * 160, 3, 40 - (y / H) * 140]; raw[y * (W + 1) + 1 + x] = Math.round(255 * clamp(cloud(p, P), 0, 1)); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync('/home/user/world/validation/density-path.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('slice written: camera at top-centre (z=+14), light at z=-52 (about 66% down); white = wall');
}
