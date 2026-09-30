import { vnoise } from './noise.js';

/**
 * The tuber surface, as plain numbers — no GFX, so it can be checked
 * without a renderer. Drawn life size (a russet about 156 mm end to end) and
 * scaled once here to the units the rig is written in.
 */
export const SCALE = 8.75;
export const HALF = {
  x: 0.064 * SCALE,
  y: 0.042 * SCALE,
  z: 0.038 * SCALE,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Seven octaves: the first three are the lobes, the rest are the grain. */
export function bumps(x, y, z) {
  return (
    0.140 * vnoise(x * 1.5 + 63.9, y * 1.5 + 27.4, z * 1.5 + 82.6) +
    0.070 * vnoise(x * 2.1 + 11.3, y * 2.1 + 4.7, z * 2.1 + 19.1) +
    0.018 * vnoise(x * 4.6 + 31.7, y * 4.6 + 2.3, z * 4.6 + 5.9) +
    0.005 * vnoise(x * 9.3 + 47.1, y * 9.3 + 61.5, z * 9.3 + 8.2) +
    0.0055 * vnoise(x * 30.0 + 12.5, y * 30.0 + 71.2, z * 30.0 + 5.4) +
    0.0032 * vnoise(x * 62.0 + 55.1, y * 62.0 + 18.9, z * 62.0 + 91.3) +
    0.0018 * vnoise(x * 118.0 + 7.7, y * 118.0 + 44.4, z * 118.0 + 66.6)
  );
}

/** Unit direction → the point it hits. Writes into `out`; the geometry pass
 *  runs this a hundred thousand times. */
export function surf(x, y, z, out = [0, 0, 0]) {
  const u = clamp(x, -1, 1);
  const r = Math.max(1e-6, Math.sqrt(Math.max(0, 1 - u * u)));
  // Blunt, barrel-like ends rather than a tapered log.
  const profile = (1 - Math.abs(u) ** 2.7) ** (1 / 2.9);
  const lean = 1 + 0.05 * u - 0.05 * u * u;        // one end slightly fatter
  const belly = 1 - 0.09 * Math.max(0, -y) ** 2;   // flat resting side
  const b = 1 + bumps(x, y, z);
  const k = b * lean * belly;

  out[0] = u * HALF.x * b * lean;
  out[1] = (y / r) * profile * HALF.y * k;
  out[2] = (z / r) * profile * HALF.z * k;
  return out;
}

/** Outward normal, by crossing two small steps across the surface. Only the
 *  eyes need it, so it can afford to be the obvious version. */
export function surfNormal(x, y, z) {
  const up = Math.abs(y) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = normalize(cross([x, y, z], up));
  const t2 = normalize(cross([x, y, z], t1));

  const e = 0.02;
  const p0 = surf(x, y, z);
  const a = sub(surf(...step([x, y, z], t1, e)), p0);
  const b = sub(surf(...step([x, y, z], t2, e)), p0);

  const n = cross(a, b);
  return normalize(dot(n, [x, y, z]) < 0 ? [-n[0], -n[1], -n[2]] : n);
}

/** Where the eyes sit: unit directions, spread around the whole tuber. */
export const EYE_DIRS = Object.freeze([
  [0.62, 0.55, 0.56], [-0.48, 0.44, -0.76], [0.12, 0.86, -0.49],
  [-0.80, 0.30, 0.52], [0.44, -0.32, 0.84], [-0.10, -0.58, -0.81],
  [0.86, -0.18, -0.48], [-0.66, -0.52, 0.54], [0.28, 0.30, -0.91],
  [-0.30, 0.82, 0.49], [0.72, 0.62, -0.31], [-0.90, -0.14, -0.41],
  [0.05, -0.86, 0.51], [0.52, 0.10, 0.85],
]);

/**
 * Each eye as the skin is cut to it: where it sits, which way is out, a frame
 * in the skin turned a little further for every eye so they do not all lie the
 * same way, and how big it is — a few millimetres across, life size.
 */
export const EYES = Object.freeze(EYE_DIRS.map((d, i) => {
  const dir = normalize(d);
  const normal = surfNormal(...dir);
  const helper = Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const a = normalize(cross(normal, helper));
  const b = cross(normal, a);
  const turn = i * 1.13;
  const c = Math.cos(turn), s = Math.sin(turn);
  return Object.freeze({
    at: surf(...dir),
    normal,
    along: [a[0] * c + b[0] * s, a[1] * c + b[1] * s, a[2] * c + b[2] * s],
    across: [b[0] * c - a[0] * s, b[1] * c - a[1] * s, b[2] * c - a[2] * s],
    size: (0.0013 + (i % 3) * 0.0004) * SCALE,
  });
}));

const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * What the eyes do to a point on the skin: an oval hollow sunk into it, and a
 * crescent of brow raised round one end of the hollow.
 *
 * They are relief in the skin itself rather than pieces stuck on or under it.
 * Pieces were what they used to be — a dark blob and a torus for the brow,
 * mostly buried — and the one thing hiding them was the skin, so from inside
 * the potato they were all there was to see.
 *
 * Writes the offset into out[0..2] and how deep in a hollow the point is, 0 to
 * 1, into out[3], which is what the skin darkens by.
 */
export function eyeRelief(p, out = [0, 0, 0, 0]) {
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
  for (const eye of EYES) {
    const qx = p[0] - eye.at[0], qy = p[1] - eye.at[1], qz = p[2] - eye.at[2];
    const reach = eye.size * 3;
    if (qx * qx + qy * qy + qz * qz > reach * reach) continue;

    const { along: a, across: c } = eye;
    const u = (qx * a[0] + qy * a[1] + qz * a[2]) / (eye.size * 1.7);
    const v = (qx * c[0] + qy * c[1] + qz * c[2]) / (eye.size * 0.9);
    const r = Math.hypot(u, v);

    const hollow = r < 1 ? (1 - r * r) ** 2 : 0;
    const end = smoothstep(-0.2, 0.75, -u / (r || 1));
    const brow = Math.exp(-(((r - 1.35) / 0.3) ** 2)) * end;

    const lift = eye.size * (0.5 * brow - 0.85 * hollow);
    out[0] += eye.normal[0] * lift;
    out[1] += eye.normal[1] * lift;
    out[2] += eye.normal[2] * lift;
    out[3] = Math.max(out[3], hollow);
  }
  return out;
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** A step of `e` along `t` from `v`, back on the unit sphere. */
function step(v, t, e) {
  return normalize([v[0] + t[0] * e, v[1] + t[1] * e, v[2] + t[2] * e]);
}
