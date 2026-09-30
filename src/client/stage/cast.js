/**
 * Casting: a solid described by its signed distance — negative inside, zero on
 * the surface — poured into a box and turned out as one mesh.
 *
 * It is for the parts that have to be one piece and are no primitive: a handle
 * that runs out of a pan's rim with a fillet all the way round the joint, and
 * a hole through its end. Drawn from cylinders and rings, that was three parts
 * with gaps between them. Described by distance, a joint is one smooth minimum
 * and a hole is one subtraction.
 *
 * Naive surface nets. Every cell the surface passes through gets a vertex, at
 * the middle of where its edges cross the surface; every edge the surface
 * crosses gets a quad, from the four cells around it. Then each vertex is
 * walked onto the surface along the gradient and given the gradient as its
 * normal, so the mesh is as smooth as the field and not as the grid.
 */

const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * `distance(x, y, z)` is the field; `from` and `to` are opposite corners of the
 * box it is sampled in, and `step` the size of a cell. The surface must not
 * leave the box anywhere it can be seen: where it does, the mesh is left open.
 */
export function cast(GFX, { distance, from, to, step }) {
  const n = [0, 1, 2].map((a) => Math.max(1, Math.ceil((to[a] - from[a]) / step)));
  const [nx, ny, nz] = n;
  const sx = nx + 1, sxy = (nx + 1) * (ny + 1);

  /**
   * Sampled a row at a time, skipping what is plainly empty or plainly solid.
   * A point a distance d from the surface has nothing but its own side of it
   * within d, so the samples up to there are known without asking — and only
   * their sign is ever read, because no edge within a cell and a half of one
   * can cross the surface. The fields cast here are distances only roughly,
   * so the reach is taken at two-thirds.
   */
  const field = new Float32Array(sxy * (nz + 1));
  for (let k = 0; k <= nz; k++) {
    const z = from[2] + k * step;
    for (let j = 0; j <= ny; j++) {
      const y = from[1] + j * step;
      const row = sx * j + sxy * k;
      for (let i = 0; i <= nx;) {
        const d = distance(from[0] + i * step, y, z);
        field[row + i] = d;
        const known = Math.floor((Math.abs(d) / 1.5 - step * 1.5) / step);
        for (let m = 1; m <= known && i + m <= nx; m++) field[row + i + m] = d;
        i += Math.max(1, known + 1);
      }
    }
  }

  const cells = new Int32Array(nx * ny * nz).fill(-1);
  const cell = (i, j, k) => i + nx * (j + ny * k);
  const points = [];
  const corner = new Float32Array(8);

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          corner[c] = field[(i + (c & 1)) + sx * (j + ((c >> 1) & 1)) + sxy * (k + ((c >> 2) & 1))];
          if (corner[c] < 0) inside += 1;
        }
        if (inside === 0 || inside === 8) continue;

        let x = 0, y = 0, z = 0, count = 0;
        for (const [a, b] of EDGES) {
          const da = corner[a], db = corner[b];
          if ((da < 0) === (db < 0)) continue;
          const t = da / (da - db);
          x += (a & 1) + ((b & 1) - (a & 1)) * t;
          y += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          z += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          count += 1;
        }
        cells[cell(i, j, k)] = points.length / 3;
        points.push(
          from[0] + (i + x / count) * step,
          from[1] + (j + y / count) * step,
          from[2] + (k + z / count) * step,
        );
      }
    }
  }

  /** Central differences, `span` apart: the gradient times `span`. */
  const span = step * 0.5;
  const gradient = (x, y, z, out) => {
    const h = span / 2;
    out[0] = distance(x + h, y, z) - distance(x - h, y, z);
    out[1] = distance(x, y + h, z) - distance(x, y - h, z);
    out[2] = distance(x, y, z + h) - distance(x, y, z - h);
    return out;
  };

  /** Onto the surface, a few Newton steps down the field, never more than a cell. */
  const g = [0, 0, 0];
  const normals = new Float32Array(points.length);
  for (let v = 0; v < points.length; v += 3) {
    let x = points[v], y = points[v + 1], z = points[v + 2];
    for (let it = 0; it < 4; it++) {
      const d = distance(x, y, z);
      if (Math.abs(d) < step * 1e-3) break;
      gradient(x, y, z, g);
      const len2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (len2 < 1e-20) break;
      let k = (d * span) / len2;
      const reach = Math.abs(k) * Math.sqrt(len2);
      if (reach > step) k *= step / reach;
      x -= g[0] * k; y -= g[1] * k; z -= g[2] * k;
    }
    points[v] = x; points[v + 1] = y; points[v + 2] = z;
    gradient(x, y, z, g);
    const len = Math.hypot(g[0], g[1], g[2]) || 1;
    normals[v] = g[0] / len; normals[v + 1] = g[1] / len; normals[v + 2] = g[2] / len;
  }

  const index = [];
  const at = (v) => [points[v * 3], points[v * 3 + 1], points[v * 3 + 2]];

  /** Two triangles, split along the shorter diagonal and wound to face out. */
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const [pa, pb, pc, pd] = [a, b, c, d].map(at);
    const ac = (pa[0] - pc[0]) ** 2 + (pa[1] - pc[1]) ** 2 + (pa[2] - pc[2]) ** 2;
    const bd = (pb[0] - pd[0]) ** 2 + (pb[1] - pd[1]) ** 2 + (pb[2] - pd[2]) ** 2;
    const tris = ac <= bd ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
    for (const [p, q, r] of tris) {
      const P = at(p), Q = at(q), R = at(r);
      const ux = Q[0] - P[0], uy = Q[1] - P[1], uz = Q[2] - P[2];
      const vx = R[0] - P[0], vy = R[1] - P[1], vz = R[2] - P[2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const out = fx * (normals[p * 3] + normals[q * 3] + normals[r * 3])
        + fy * (normals[p * 3 + 1] + normals[q * 3 + 1] + normals[r * 3 + 1])
        + fz * (normals[p * 3 + 2] + normals[q * 3 + 2] + normals[r * 3 + 2]);
      if (out >= 0) index.push(p, q, r);
      else index.push(p, r, q);
    }
  };

  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const here = field[i + sx * j + sxy * k] < 0;
        if (i < nx && j > 0 && k > 0 && j < ny && k < nz && here !== (field[i + 1 + sx * j + sxy * k] < 0)) {
          quad(cells[cell(i, j - 1, k - 1)], cells[cell(i, j, k - 1)], cells[cell(i, j, k)], cells[cell(i, j - 1, k)]);
        }
        if (j < ny && i > 0 && k > 0 && i < nx && k < nz && here !== (field[i + sx * (j + 1) + sxy * k] < 0)) {
          quad(cells[cell(i - 1, j, k - 1)], cells[cell(i, j, k - 1)], cells[cell(i, j, k)], cells[cell(i - 1, j, k)]);
        }
        if (k < nz && i > 0 && j > 0 && i < nx && j < ny && here !== (field[i + sx * j + sxy * (k + 1)] < 0)) {
          quad(cells[cell(i - 1, j - 1, k)], cells[cell(i, j - 1, k)], cells[cell(i, j, k)], cells[cell(i - 1, j, k)]);
        }
      }
    }
  }

  const geometry = new GFX.BufferGeometry();
  geometry.setAttribute('position', new GFX.Float32BufferAttribute(points, 3));
  geometry.setAttribute('normal', new GFX.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}
