/** Value noise, hashed off the lattice: same lumps on every load, any order. */
export function hash3(i, j, k) {
  let n = i * 374761393 + j * 668265263 + k * 1274126177;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Trilinear blend of the eight surrounding lattice values, in −1..1. */
export function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = fade(x - i), fy = fade(y - j), fz = fade(z - k);
  let v = 0;
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        v += w * hash3(i + dx, j + dy, k + dz);
      }
    }
  }
  return v * 2 - 1;
}
