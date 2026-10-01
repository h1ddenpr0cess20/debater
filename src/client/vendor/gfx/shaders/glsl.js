/**
 * GLSL ES 3.00 for the WebGL 2 backend. The shaders are the files in `glsl/`;
 * this puts them together.
 *
 * Every program is assembled from a key the renderer derives per draw (see
 * `programKey` in renderer.js), as `#define`s in front of the program's file,
 * so a program only carries the terms its material actually uses. The shading
 * itself — the GGX specular, the multiple-scattering compensation, clearcoat,
 * sheen, thin-film iridescence, transmission, the cube-UV environment lookup
 * and the PCF shadow taps — is the physically based model of three.js r186
 * (MIT, © 2010-2025 three.js authors), term for term, so that nothing a scene
 * was tuned against moves. `wgsl/` is the same model for WebGPU; keep the two
 * in step.
 */

import { include } from './preprocess.js';

import PRELUDE from './glsl/prelude.glsl?raw';
import common from './glsl/chunks/common.glsl?raw';
import cube_uv from './glsl/chunks/cube_uv.glsl?raw';
import iridescence from './glsl/chunks/iridescence.glsl?raw';
import output from './glsl/chunks/output.glsl?raw';
import physical_lighting from './glsl/chunks/physical_lighting.glsl?raw';
import shadow_pars_fragment from './glsl/chunks/shadow_pars_fragment.glsl?raw';
import shadow_pars_vertex from './glsl/chunks/shadow_pars_vertex.glsl?raw';
import shadow_vertex from './glsl/chunks/shadow_vertex.glsl?raw';
import transmission from './glsl/chunks/transmission.glsl?raw';

import basicFragment from './glsl/basic.frag.glsl?raw';
import basicVertex from './glsl/basic.vert.glsl?raw';
import customFragment from './glsl/custom.frag.glsl?raw';
import customVertex from './glsl/custom.vert.glsl?raw';
import depthFragment from './glsl/depth.frag.glsl?raw';
import depthVertex from './glsl/depth.vert.glsl?raw';
import pmremEquirectFragment from './glsl/pmrem_equirect.frag.glsl?raw';
import pmremGGXFragment from './glsl/pmrem_ggx.frag.glsl?raw';
import pmremVertex from './glsl/pmrem.vert.glsl?raw';
import shadowFragment from './glsl/shadow.frag.glsl?raw';
import shadowVertex from './glsl/shadow.vert.glsl?raw';
import spriteFragment from './glsl/sprite.frag.glsl?raw';
import spriteVertex from './glsl/sprite.vert.glsl?raw';
import standardFragment from './glsl/standard.frag.glsl?raw';
import standardVertex from './glsl/standard.vert.glsl?raw';

const CHUNKS = {
  common, cube_uv, iridescence, output, physical_lighting,
  shadow_pars_fragment, shadow_pars_vertex, shadow_vertex, transmission,
};

/** The version line, then the program's defines, then the file. */
const program = (defines, source) => PRELUDE + defines + include(source, CHUNKS);

const defines = (flags) => Object.entries(flags).filter(([, on]) => on).map(([name]) => `#define ${name}\n`).join('');

const fragmentFlags = (key) => ({ OPAQUE: key.opaque, SRGB_OUTPUT: key.output === 'srgb' });

function cubeUVDefines(env) {
  return `#define CUBEUV_TEXEL_WIDTH ${env.texelWidth}\n#define CUBEUV_TEXEL_HEIGHT ${env.texelHeight}\n#define CUBEUV_MAX_MIP ${env.maxMip}.0\n`;
}

function standardDefines(key) {
  return defines({
    SRGB_OUTPUT: key.output === 'srgb',
    PHYSICAL: key.physical,
    USE_MAP: key.map,
    USE_BUMPMAP: key.bumpMap,
    USE_COLOR: key.vertexColors,
    FLAT_SHADED: key.flat,
    DOUBLE_SIDED: key.doubleSided,
    FLIP_SIDED: key.flipSided,
    USE_ENVMAP: key.envMap,
    USE_CLEARCOAT: key.clearcoat,
    USE_SHEEN: key.sheen,
    USE_IRIDESCENCE: key.iridescence,
    USE_TRANSMISSION: key.transmission,
    USE_SHADOWMAP: key.numDirShadows > 0,
    OPAQUE: key.opaque,
    HAS_NORMAL: key.hasNormal,
  }) + `#define NUM_DIR_LIGHTS ${key.numDir}\n#define NUM_POINT_LIGHTS ${key.numPoint}\n`
    + `#define NUM_HEMI_LIGHTS ${key.numHemi}\n#define NUM_DIR_LIGHT_SHADOWS ${key.numDirShadows}\n`
    + (key.envMap ? cubeUVDefines(key.env) : '');
}

export function programSources(key, material) {
  switch (key.kind) {
    case 'standard': {
      const flags = standardDefines(key);
      return [program(flags, standardVertex), program(flags, standardFragment)];
    }
    case 'basic': {
      const flags = { USE_MAP: key.map, USE_COLOR: key.vertexColors };
      return [program(defines(flags), basicVertex), program(defines({ ...flags, ...fragmentFlags(key) }), basicFragment)];
    }
    case 'sprite': {
      const flags = { USE_MAP: key.map };
      return [program(defines(flags), spriteVertex), program(defines({ ...flags, ...fragmentFlags(key) }), spriteFragment)];
    }
    case 'shadow': {
      const flags = standardDefines({ ...key, envMap: false });
      return [program(flags, shadowVertex), program(flags, shadowFragment)];
    }
    case 'depth': return [program('', depthVertex), program('', depthFragment)];
    // A hand-written ShaderMaterial: its own bodies, with the standard inputs declared.
    case 'custom': return [
      program('', customVertex) + material.glsl.vertex + '\n',
      program('', customFragment) + material.glsl.fragment + '\n',
    ];
    default: throw new Error(`gfx: no GLSL for ${key.kind}`);
  }
}

// ---------------------------------------------------------------- PMREM

/** The studio, sampled onto six cube faces laid out as the atlas wants them. */
export const pmremEquirect = () => [program('', pmremVertex), program('', pmremEquirectFragment)];

/** GGX importance-sampled prefilter of one level of the atlas into the next. */
export const pmremGGX = (env) => [program('', pmremVertex), program(cubeUVDefines(env), pmremGGXFragment)];
