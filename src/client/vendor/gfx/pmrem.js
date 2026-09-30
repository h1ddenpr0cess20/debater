/**
 * The layout and schedule of the prefiltered radiance atlas ("cube UV"): six
 * cube faces per roughness level, packed into one texture, each level blurred
 * from the one before by GGX importance sampling. Both backends run exactly
 * this schedule with their own shaders; the numbers are three.js r186's
 * PMREMGenerator (MIT, © 2010-2025 three.js authors), which is what the
 * materials' environment lookup expects to find.
 */

const LOD_MIN = 4;
const EXTRA_LODS = 6;

/** Sizes of the atlas for a studio of the given width. */
export function pmremLayout(equirectWidth) {
  const lodMax = Math.floor(Math.log2(equirectWidth / 4));
  const cubeSize = Math.pow(2, lodMax);
  const width = 3 * Math.max(cubeSize, 16 * 7);
  const height = 4 * cubeSize;
  const maxMip = Math.log2(height) - 2;
  return {
    lodMax, cubeSize, width, height,
    texelWidth: 1.0 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)),
    texelHeight: 1.0 / height,
    maxMip,
  };
}

/**
 * One quad per face per level, in clip space, carrying the direction each
 * corner looks along. The UVs overshoot the face by one texel so the border
 * the bilinear lookup reads is baked from the neighbouring faces.
 */
export function pmremPlanes(lodMax) {
  const planes = [];
  let lod = lodMax;
  const totalLods = lodMax - LOD_MIN + 1 + EXTRA_LODS;
  for (let i = 0; i < totalLods; i++) {
    const sizeLod = Math.pow(2, lod);
    const texelSize = 1.0 / (sizeLod - 2);
    const min = -texelSize;
    const max = 1 + texelSize;
    const uv1 = [min, min, max, min, max, max, min, min, max, max, min, max];
    const position = new Float32Array(3 * 6 * 6);
    const outputDirection = new Float32Array(3 * 6 * 6);
    for (let face = 0; face < 6; face++) {
      const x = (face % 3) * 2 / 3 - 1;
      const y = face > 2 ? 0 : -1;
      position.set([x, y, 0, x + 2 / 3, y, 0, x + 2 / 3, y + 1, 0, x, y, 0, x + 2 / 3, y + 1, 0, x, y + 1, 0], 18 * face);
      for (let vertex = 0; vertex < 6; vertex++) {
        const u = uv1[vertex * 2] * 2 - 1;
        const v = uv1[vertex * 2 + 1] * 2 - 1;
        let d;
        if (face === 0) d = [1, v, u];
        else if (face === 1) d = [-u, 1, -v];
        else if (face === 2) d = [-u, v, 1];
        else if (face === 3) d = [-1, v, -u];
        else if (face === 4) d = [-u, -1, v];
        else d = [u, v, -1];
        outputDirection.set(d, (face * 6 + vertex) * 3);
      }
    }
    planes.push({ sizeLod, position, outputDirection });
    if (lod > LOD_MIN) lod--;
  }
  return planes;
}

/**
 * The GGX passes, level by level: blur the level below into the ping-pong
 * target, then copy it back into place. Viewports are OpenGL's, y up.
 */
export function pmremSchedule(layout, planes) {
  const { lodMax, cubeSize } = layout;
  const n = planes.length;
  const passes = [];
  for (let lodOut = 1; lodOut < n; lodOut++) {
    const lodIn = lodOut - 1;
    const targetRoughness = lodOut / (n - 1);
    const sourceRoughness = lodIn / (n - 1);
    const incrementalRoughness = Math.sqrt(targetRoughness * targetRoughness - sourceRoughness * sourceRoughness);
    const blurStrength = targetRoughness * 1.25;
    const outputSize = planes[lodOut].sizeLod;
    const x = 3 * outputSize * (lodOut > lodMax - LOD_MIN ? lodOut - lodMax + LOD_MIN : 0);
    const y = 4 * (cubeSize - outputSize);
    const viewport = [x, y, 3 * outputSize, 2 * outputSize];
    passes.push({ plane: lodOut, source: 'atlas', target: 'pingPong', roughness: incrementalRoughness * blurStrength, mipInt: lodMax - lodIn, viewport });
    passes.push({ plane: lodOut, source: 'pingPong', target: 'atlas', roughness: 0.0, mipInt: lodMax - lodOut, viewport });
  }
  return passes;
}
