/**
 * What is drawn, in what order, with which lights — the part of rendering that
 * does not care which GPU API is underneath. It walks the scene, culls,
 * sorts, works out the lights and shadows, and hands each draw to a backend
 * (`webgpu.js` or `webgl.js`) as a program key plus plain uniform values.
 *
 * The order of operations is three.js r186's (MIT, © 2010-2025 three.js
 * authors), because it is visible: which transparent layer lands on top,
 * whether a mesh is culled, when `onBeforeRender` runs relative to the
 * shadow pass, all of it shows up in the picture.
 */

import {
  AdditiveBlending, BackSide, DoubleSide, FrontSide, NormalBlending, PCFShadowMap,
} from './core.js';
import { Frustum, Matrix4, Vector3, Vector4 } from './math.js';
import { pmremLayout } from './pmrem.js';

const _projScreenMatrix = new Matrix4();
const _frustum = new Frustum();
const _vector4 = new Vector4();
const _vector3 = new Vector3();

function painterSortStable(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.material.id !== b.material.id) return a.material.id - b.material.id;
  if (a.z !== b.z) return a.z - b.z;
  return a.id - b.id;
}

function reversePainterSortStable(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  return a.id - b.id;
}

/** Shadow casters first, so the shadow maps line up with the first lights. */
const shadowCastingLightsFirst = (a, b) => (b.castShadow ? 2 : 0) - (a.castShadow ? 2 : 0);

const SHADOW_SIDE = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };

const colorArray = (c, scale = 1) => [c.r * scale, c.g * scale, c.b * scale];

/**
 * The renderer the stage drives: `render(scene, camera)` once a frame, the
 * canvas at `domElement`. Build one with `createRenderer()`.
 */
export class Renderer {
  constructor(backend, canvas) {
    this.backend = backend;
    this.domElement = canvas;
    this.shadowMap = { enabled: false, type: PCFShadowMap };
    this.sortObjects = true;
    this._pixelRatio = 1;
    this._width = canvas.width;
    this._height = canvas.height;
    this._animation = null;
    this._frame = 0;
    this._environments = new WeakMap();
  }

  /**
   * Carry on drawing through a different backend and canvas — the stage uses
   * it to drop to WebGL 2 when a WebGPU device is lost. Everything on the GPU
   * is rebuilt from the scene on the next frame.
   */
  setBackend(backend, canvas) {
    this.backend = backend;
    this.domElement = canvas;
    this._environments = new WeakMap();
    this.setSize(this._width, this._height);
  }

  get isWebGPU() { return this.backend.isWebGPU === true; }

  getPixelRatio() { return this._pixelRatio; }

  setPixelRatio(value) {
    this._pixelRatio = value;
    this.setSize(this._width, this._height, false);
  }

  /** CSS size in pixels; the drawing buffer is that times the pixel ratio. */
  setSize(width, height, updateStyle = true) {
    this._width = width;
    this._height = height;
    this.domElement.width = Math.floor(width * this._pixelRatio);
    this.domElement.height = Math.floor(height * this._pixelRatio);
    if (updateStyle !== false) {
      this.domElement.style.width = width + 'px';
      this.domElement.style.height = height + 'px';
    }
    this.backend.setSize(this.domElement.width, this.domElement.height);
  }

  setAnimationLoop(callback) {
    if (this._animation !== null) cancelAnimationFrame(this._animation);
    this._animation = null;
    if (!callback) return;
    const loop = (time) => {
      this._animation = requestAnimationFrame(loop);
      callback(time);
    };
    this._animation = requestAnimationFrame(loop);
  }

  /**
   * An equirectangular texture as a prefiltered (PMREM) environment for
   * `scene.environment`. The prefiltering itself runs on whichever backend
   * draws with it, the first time it does.
   */
  prefilterEquirectangular(texture) {
    const layout = pmremLayout(texture.image.width);
    const environment = {
      isCubeUVTexture: true,
      source: texture,
      texelWidth: layout.texelWidth,
      texelHeight: layout.texelHeight,
      maxMip: layout.maxMip,
      dispose: () => {
        this._environments.get(environment)?.dispose();
        this._environments.delete(environment);
      },
    };
    return environment;
  }

  _environment(environment) {
    let prefiltered = this._environments.get(environment);
    if (!prefiltered) {
      prefiltered = this.backend.prefilterEquirectangular(environment.source);
      this._environments.set(environment, prefiltered);
    }
    return prefiltered;
  }

  render(scene, camera) {
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();

    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    const lists = { opaque: [], transmissive: [], transparent: [], lights: [], shadows: [] };
    this._project(scene, camera, 0, lists);
    if (this.sortObjects) {
      lists.opaque.sort(painterSortStable);
      lists.transmissive.sort(reversePainterSortStable);
      lists.transparent.sort(reversePainterSortStable);
    }

    const shadowsOn = this.shadowMap.enabled && lists.shadows.length > 0;
    lists.lights.sort(shadowCastingLightsFirst);
    const env = scene.environment ? this._environment(scene.environment) : null;
    this.backend.beginFrame();

    let shadow = null;
    if (shadowsOn) shadow = this._renderShadows(scene, camera, lists.shadows);

    const lighting = this._setupLights(lists.lights, shadowsOn);
    const context = { scene, camera, env, lighting, shadow };

    if (lists.transmissive.length > 0) {
      const size = [this.domElement.width, this.domElement.height];
      const frame = this._frame_(context, 'linear', null);
      // three clears this to white at half alpha, premultiplied by the context: where nothing opaque
      // is behind a transmissive surface, that grey is what it refracts.
      this.backend.beginPass({ target: 'transmission', clear: [0.5, 0.5, 0.5, 0.5], frame });
      this._renderItems(lists.opaque, context, frame);
      this.backend.endPass();
      context.transmission = { size };
    }

    const frame = this._frame_(context, 'srgb', context.transmission ?? null);
    this.backend.beginPass({ target: 'canvas', clear: [0, 0, 0, 0], frame });
    this._renderItems(lists.opaque, context, frame);
    this._renderItems(lists.transmissive, context, frame);
    this._renderItems(lists.transparent, context, frame);
    this.backend.endPass();
    this.backend.endFrame();
    this._frame++;
  }

  _project(object, camera, groupOrder, lists) {
    if (object.visible === false) return;
    if (object.layers.test(camera.layers)) {
      if (object.isGroup) {
        groupOrder = object.renderOrder;
      } else if (object.isLight) {
        lists.lights.push(object);
        if (object.castShadow && object.isDirectionalLight) lists.shadows.push(object);
      } else if (object.isSprite) {
        if (!object.frustumCulled || _frustum.intersectsSprite(object)) {
          this._sync(object.geometry);
          if (this.sortObjects) _vector4.setFromMatrixPosition(object.matrixWorld).applyMatrix4(_projScreenMatrix);
          if (object.material.visible) this._push(lists, object, object.geometry, object.material, groupOrder, _vector4.z, null);
        }
      } else if (object.isMesh || object.isLine) {
        if (!object.frustumCulled || _frustum.intersectsObject(object)) {
          const geometry = object.geometry;
          const material = object.material;
          this._sync(geometry);
          if (this.sortObjects) {
            if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
            _vector4.copy(geometry.boundingSphere.center).applyMatrix4(object.matrixWorld).applyMatrix4(_projScreenMatrix);
          }
          if (Array.isArray(material)) {
            for (const group of geometry.groups) {
              const groupMaterial = material[group.materialIndex];
              if (groupMaterial && groupMaterial.visible) this._push(lists, object, geometry, groupMaterial, groupOrder, _vector4.z, group);
            }
          } else if (material.visible) {
            this._push(lists, object, geometry, material, groupOrder, _vector4.z, null);
          }
        }
      }
    }
    const children = object.children;
    for (let i = 0, l = children.length; i < l; i++) this._project(children[i], camera, groupOrder, lists);
  }

  /**
   * Vertex data goes up once a frame, as objects are gathered — before any
   * `onBeforeRender` runs. A mesh that reshapes itself in its own
   * `onBeforeRender` is therefore drawn with last frame's shape, exactly as
   * it always was under three.js; the slime's wobble is timed to that.
   */
  _sync(geometry) {
    if (geometry._syncedFrame === this._frame) return;
    geometry._syncedFrame = this._frame;
    this.backend.syncGeometry(geometry);
  }

  _push(lists, object, geometry, material, groupOrder, z, group) {
    const item = { id: object.id, object, geometry, material, groupOrder, renderOrder: object.renderOrder, z, group };
    if (material.transmission > 0.0) lists.transmissive.push(item);
    else if (material.transparent === true) lists.transparent.push(item);
    else lists.opaque.push(item);
  }

  /** Intensities folded into colours; view-space directions are done per pass. */
  _setupLights(lights, shadowsOn) {
    const ambient = [0, 0, 0];
    const directional = [], point = [], hemi = [];
    for (const light of lights) {
      if (light.isAmbientLight) {
        ambient[0] += light.color.r * light.intensity;
        ambient[1] += light.color.g * light.intensity;
        ambient[2] += light.color.b * light.intensity;
      } else if (light.isDirectionalLight) {
        directional.push({ light, color: colorArray(light.color, light.intensity), castShadow: shadowsOn && light.castShadow });
      } else if (light.isPointLight) {
        point.push({ light, color: colorArray(light.color, light.intensity), distance: light.distance, decay: light.decay });
      } else if (light.isHemisphereLight) {
        hemi.push({ light, skyColor: colorArray(light.color, light.intensity), groundColor: colorArray(light.groundColor, light.intensity) });
      }
    }
    const numDirShadows = directional.filter((d) => d.castShadow).length;
    return { ambient, directional, point, hemi, numDirShadows };
  }

  /** Everything a pass shares: the camera, the lights seen from it, the maps. */
  _frame_(context, output, transmission) {
    const { camera, lighting, env, shadow } = context;
    const view = camera.matrixWorldInverse;
    const directional = lighting.directional.map((d) => {
      const direction = new Vector3().setFromMatrixPosition(d.light.matrixWorld);
      _vector3.setFromMatrixPosition(d.light.target.matrixWorld);
      direction.sub(_vector3).transformDirection(view);
      return { direction: direction.toArray(), color: d.color };
    });
    const point = lighting.point.map((p) => ({
      position: new Vector3().setFromMatrixPosition(p.light.matrixWorld).applyMatrix4(view).toArray(),
      color: p.color, distance: p.distance, decay: p.decay,
    }));
    const hemi = lighting.hemi.map((h) => ({
      direction: new Vector3().setFromMatrixPosition(h.light.matrixWorld).transformDirection(view).toArray(),
      skyColor: h.skyColor, groundColor: h.groundColor,
    }));
    return {
      output,
      camera: {
        viewMatrix: view.elements,
        projectionMatrix: camera.projectionMatrix.elements,
        position: new Vector3().setFromMatrixPosition(camera.matrixWorld).toArray(),
        isOrthographic: camera.isOrthographicCamera === true,
      },
      ambient: lighting.ambient,
      directional,
      point,
      hemi,
      numDirShadows: lighting.numDirShadows,
      shadow,
      env,
      transmission,
    };
  }

  _renderShadows(scene, camera, shadowLights) {
    let result = null;
    for (const light of shadowLights) {
      const shadow = light.shadow;
      shadow.updateMatrices(light);
      const items = [];
      const collect = (object) => {
        if (object.visible === false) return;
        if (object.layers.test(camera.layers) && (object.isMesh || object.isLine) && object.castShadow
          && (!object.frustumCulled || shadow.frustum.intersectsObject(object))) {
          this._sync(object.geometry);
          object.modelViewMatrix.multiplyMatrices(shadow.camera.matrixWorldInverse, object.matrixWorld);
          const material = object.material;
          if (Array.isArray(material)) {
            for (const group of object.geometry.groups) {
              const m = material[group.materialIndex];
              if (m && m.visible) items.push({ object, geometry: object.geometry, material: m, group });
            }
          } else if (material.visible) {
            items.push({ object, geometry: object.geometry, material, group: null });
          }
        }
        for (const child of object.children) collect(child);
      };
      collect(scene);

      const size = [shadow.mapSize.x, shadow.mapSize.y];
      const texture = this.backend.beginShadowPass(light, size);
      const projection = shadow.camera.projectionMatrix.elements;
      for (const item of items) {
        const side = SHADOW_SIDE[item.material.side];
        const draw = this._geometryRange(item.object, item.geometry, item.group);
        if (draw === null) continue;
        this.backend.drawDepth({
          geometry: item.geometry, ...draw,
          modelViewMatrix: item.object.modelViewMatrix.elements,
          projectionMatrix: projection,
          cull: cullMode(side, item.object),
        });
      }
      this.backend.endPass();
      // Only the first directional shadow is sampled; that is all the stage casts.
      if (result === null) {
        result = {
          texture, matrix: shadow.matrix.elements, normalBias: shadow.normalBias,
          intensity: shadow.intensity, bias: shadow.bias, radius: shadow.radius, mapSize: size,
        };
      }
    }
    return result;
  }

  _renderItems(items, context, frame) {
    for (const item of items) {
      const { object, geometry, group } = item;
      const material = item.material;
      object.onBeforeRender(this, context.scene, context.camera, geometry, material, group);
      object.modelViewMatrix.multiplyMatrices(context.camera.matrixWorldInverse, object.matrixWorld);
      object.normalMatrix.getNormalMatrix(object.modelViewMatrix);
      if (material.transparent === true && material.side === DoubleSide && material.forceSinglePass === false) {
        this._draw(object, geometry, material, group, context, frame, BackSide);
        this._draw(object, geometry, material, group, context, frame, FrontSide);
      } else {
        this._draw(object, geometry, material, group, context, frame, material.side);
      }
      object.onAfterRender(this, context.scene, context.camera, geometry, material, group);
    }
  }

  /** Which slice of the buffers a draw covers, as three works it out. */
  _geometryRange(object, geometry, group) {
    const index = geometry.index;
    const position = geometry.attributes.position;
    const drawRange = geometry.drawRange;
    let drawStart = drawRange.start;
    let drawEnd = drawRange.start + drawRange.count;
    if (group !== null) {
      drawStart = Math.max(drawStart, group.start);
      drawEnd = Math.min(drawEnd, group.start + group.count);
    }
    if (index !== null) {
      drawStart = Math.max(drawStart, 0);
      drawEnd = Math.min(drawEnd, index.count);
    } else if (position !== undefined) {
      drawStart = Math.max(drawStart, 0);
      drawEnd = Math.min(drawEnd, position.count);
    }
    const count = drawEnd - drawStart;
    if (count < 0 || count === Infinity) return null;
    const topology = object.isLineSegments ? 'lines' : object.isLine ? 'line-strip' : 'triangles';
    return { start: drawStart, count, topology };
  }

  _draw(object, geometry, material, group, context, frame, side) {
    const range = this._geometryRange(object, geometry, group);
    if (range === null || range.count === 0) return;
    const { key, params, textures } = describe(object, geometry, material, side, context, frame);
    this.backend.draw({
      key, params, textures, material, geometry, ...range,
      object: {
        modelMatrix: object.matrixWorld.elements,
        modelViewMatrix: object.modelViewMatrix.elements,
        normalMatrix: object.normalMatrix.elements,
      },
      state: {
        blending: material.blending === NormalBlending && material.transparent === false ? 'none'
          : material.blending === AdditiveBlending ? 'additive' : material.blending === NormalBlending ? 'normal' : 'none',
        depthTest: material.depthTest,
        depthWrite: material.depthWrite,
        colorWrite: material.colorWrite,
        cull: cullMode(side, object),
      },
    });
  }
}

/** Culling for a side, turned round for a mirrored object. */
function cullMode(side, object) {
  if (side === DoubleSide) return 'none';
  let flip = side === BackSide;
  if (object.isMesh && object.matrixWorld.determinant() < 0) flip = !flip;
  return flip ? 'front' : 'back';
}

const transformOf = (texture) => {
  if (!texture) return IDENTITY3;
  texture.updateMatrix();
  return texture.matrix.elements;
};

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * The program a draw needs and the values it reads — what three computes in
 * getProgram / refreshUniforms, for the materials the scenes use.
 */
function describe(object, geometry, material, side, context, frame) {
  const output = frame.output;
  const hasNormal = geometry.attributes.normal !== undefined;
  const opaque = material.transparent === false && material.blending === NormalBlending;
  const lights = { numDir: frame.directional.length, numPoint: frame.point.length, numHemi: frame.hemi.length };

  if (material.isMeshStandardMaterial) {
    const physical = material.isMeshPhysicalMaterial === true;
    const env = context.env;
    const key = {
      kind: 'standard', physical, output, opaque, hasNormal,
      map: !!material.map,
      bumpMap: !!material.bumpMap,
      vertexColors: material.vertexColors === true,
      flat: material.flatShading === true || !hasNormal,
      doubleSided: side === DoubleSide,
      flipSided: side === BackSide,
      envMap: !!env,
      env: env ? { texelWidth: env.texelWidth, texelHeight: env.texelHeight, maxMip: env.maxMip } : null,
      clearcoat: physical && material.clearcoat > 0,
      sheen: physical && material.sheen > 0,
      iridescence: physical && material.iridescence > 0,
      transmission: physical && material.transmission > 0,
      ...lights,
      numDirShadows: frame.numDirShadows,
    };
    const params = {
      diffuse: colorArray(material.color),
      opacity: material.opacity,
      emissive: colorArray(material.emissive, material.emissiveIntensity),
      roughness: material.roughness,
      metalness: material.metalness,
      envMapIntensity: context.scene.environmentIntensity ?? 1,
      receiveShadow: object.receiveShadow ? 1 : 0,
      mapTransform: transformOf(material.map),
      bumpMapTransform: transformOf(material.bumpMap),
      bumpScale: material.bumpMap ? (side === BackSide ? -material.bumpScale : material.bumpScale) : 1,
      ior: 1.5, specularIntensity: 1, specularColor: [1, 1, 1],
      clearcoat: 0, clearcoatRoughness: 0,
      iridescence: 0, iridescenceIOR: 1.3, iridescenceThicknessMaximum: 400,
      sheenColor: [0, 0, 0], sheenRoughness: 1,
      transmission: 0, thickness: 0, attenuationDistance: Infinity, attenuationColor: [1, 1, 1],
    };
    if (physical) {
      params.ior = material.ior;
      params.specularIntensity = material.specularIntensity;
      params.specularColor = colorArray(material.specularColor);
      if (material.sheen > 0) {
        params.sheenColor = colorArray(material.sheenColor, material.sheen);
        params.sheenRoughness = material.sheenRoughness;
      }
      if (material.clearcoat > 0) {
        params.clearcoat = material.clearcoat;
        params.clearcoatRoughness = material.clearcoatRoughness;
      }
      if (material.iridescence > 0) {
        params.iridescence = material.iridescence;
        params.iridescenceIOR = material.iridescenceIOR;
        params.iridescenceThicknessMaximum = material.iridescenceThicknessRange[1];
      }
      if (material.transmission > 0) {
        params.transmission = material.transmission;
        params.thickness = material.thickness;
        params.attenuationDistance = material.attenuationDistance;
        params.attenuationColor = colorArray(material.attenuationColor);
      }
    }
    return { key, params, textures: { map: material.map, bumpMap: material.bumpMap } };
  }

  if (material.isMeshBasicMaterial || material.isLineBasicMaterial) {
    const map = material.isMeshBasicMaterial ? material.map : null;
    return {
      key: { kind: 'basic', output, opaque, map: !!map, vertexColors: material.vertexColors === true },
      params: { diffuse: colorArray(material.color), opacity: material.opacity, mapTransform: transformOf(map) },
      textures: { map },
    };
  }

  if (material.isSpriteMaterial) {
    return {
      key: { kind: 'sprite', output, opaque, map: !!material.map },
      params: {
        diffuse: colorArray(material.color), opacity: material.opacity, rotation: material.rotation,
        center: [object.center.x, object.center.y], mapTransform: transformOf(material.map),
      },
      textures: { map: material.map },
    };
  }

  if (material.isShadowMaterial) {
    return {
      key: { kind: 'shadow', output, opaque, hasNormal, ...lights, numDirShadows: frame.numDirShadows },
      params: { color: colorArray(material.color), opacity: material.opacity, receiveShadow: object.receiveShadow ? 1 : 0 },
      textures: {},
    };
  }

  if (material.isShaderMaterial) {
    return { key: { kind: 'custom', output, material: material.id }, params: {}, textures: {} };
  }

  throw new Error(`gfx: cannot draw ${material.type}`);
}

/** A canonical string for a key, for program and pipeline caches. */
export function keyString(key) {
  return JSON.stringify(key);
}
