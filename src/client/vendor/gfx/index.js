/**
 * The scene API the characters are built with — handed to them as `GFX` by
 * `<three-d-stage>`, and importable directly wherever a rig is measured
 * without a renderer (the tests).
 */

export * from './math.js';
export * from './core.js';
export * from './geometries.js';

/**
 * Prefilters an equirectangular studio into the radiance atlas the physical
 * materials read their reflections from. The work is the renderer's — this
 * is the handle the scenes call it through.
 */
export class PMREMGenerator {
  constructor(renderer) {
    this._renderer = renderer;
  }

  fromEquirectangular(texture) {
    return { texture: this._renderer.prefilterEquirectangular(texture) };
  }

  dispose() {}
}
