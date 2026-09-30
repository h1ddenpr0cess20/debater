/**
 * The WebGPU backend: builds a render pipeline per program key and draw
 * state from the WGSL in shaders/wgsl.js, keeps geometry and textures
 * resident, and records what the renderer hands it — one command buffer per
 * pass, so a pass sees exactly the uniforms written for it.
 *
 * Every pass is drawn with clip-space y negated, which stores it in OpenGL's
 * row order: the shadow map, the transmission buffer and the environment
 * atlas are then read with the same maths as the WebGL backend's, and the
 * frame itself is rasterised (multisample coverage included) exactly as
 * WebGL rasterises it, then turned the right way up as it is presented.
 */

import { LinearMipmapLinearFilter, SRGBColorSpace } from './core.js';
import { DFG_DATA, DFG_SIZE } from './dfg.js';
import { keyString } from './renderer.js';
import {
  MAX_DIR_LIGHTS, MAX_HEMI_LIGHTS, MAX_POINT_LIGHTS, customFields, depthWGSL, mipmapWGSL, moduleSource,
  pmremEquirectWGSL, pmremGGXWGSL, presentWGSL,
} from './shaders/wgsl.js';
import { pmremLayout, pmremPlanes, pmremSchedule } from './pmrem.js';

const SAMPLES = 4;
const DEPTH_FORMAT = 'depth24plus';
const FRAME_SIZE = 1040;
const DRAW_SIZE = 416;
const OBJECT_SIZE = 320;
const ARENA_SIZE = 4 << 20;
const ALIGN = 256;

const LOCATIONS = { position: 0, normal: 1, uv: 2, color: 3 };
const U = GPUBufferUsage;
const T = GPUTextureUsage;

/** OpenGL clip space (z in −1..1) to WebGPU's (z in 0..1), optionally upside down. */
function toWebGPUProjection(m, flipY) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    out[c * 4] = m[c * 4];
    out[c * 4 + 1] = flipY ? -m[c * 4 + 1] : m[c * 4 + 1];
    out[c * 4 + 2] = 0.5 * m[c * 4 + 2] + 0.5 * m[c * 4 + 3];
    out[c * 4 + 3] = m[c * 4 + 3];
  }
  return out;
}

const alignTo = (n, a) => Math.ceil(n / a) * a;

export class WebGPUBackend {
  static async create(canvas) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('no WebGPU canvas context');
    const backend = new WebGPUBackend(canvas, device, context);
    await backend._probe();
    return backend;
  }

  /**
   * Some browsers offer WebGPU and then lose the device the first time a
   * canvas is presented. Present one empty frame and give a loss a moment to
   * arrive, so the stage can fall back before anything has been built.
   */
  async _probe() {
    let lost = false;
    this.device.lost?.then(() => { lost = true; });
    const encoder = this.device.createCommandEncoder();
    encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    }).end();
    this.device.queue.submit([encoder.finish()]);
    await Promise.race([this.device.lost, new Promise((resolve) => setTimeout(resolve, 150))]);
    this._probing = false;
    if (lost) throw new Error('the WebGPU device was lost on its first frame');
  }

  constructor(canvas, device, context) {
    this.isWebGPU = true;
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: 'premultiplied' });
    /** Called when the device is gone for good (not by `dispose`); the stage falls back to WebGL 2. */
    this.onLost = null;
    this._probing = true;
    device.lost?.then((info) => {
      if (info.reason === 'destroyed' || this._probing) return;
      console.error('three-d-stage: WebGPU device lost', info.message);
      this.onLost?.(info);
    });
    device.addEventListener?.('uncapturederror', (event) => console.error('three-d-stage:', event.error.message));

    this.width = canvas.width;
    this.height = canvas.height;
    this.pipelines = new Map();
    this.modules = new Map();
    this.buffers = new WeakMap();
    this.textures = new WeakMap();
    this.drawGroups = new Map();
    this.zero = device.createBuffer({ size: 64, usage: U.VERTEX });

    this.arena = device.createBuffer({ size: ARENA_SIZE, usage: U.UNIFORM | U.COPY_DST });
    this.arenaData = new ArrayBuffer(ARENA_SIZE);
    this.arenaF32 = new Float32Array(this.arenaData);
    this.arenaUsed = 0;
    this.frameBuffers = [0, 1, 2].map(() => device.createBuffer({ size: FRAME_SIZE, usage: U.UNIFORM | U.COPY_DST }));

    this.linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.trilinear = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    this.comparison = device.createSampler({ magFilter: 'linear', minFilter: 'linear', compare: 'less-equal' });
    this.samplers = new Map();

    this.dfg = this._dfgTexture();
    this.dummy2D = this._solidTexture();
    this.dummyDepth = device.createTexture({ size: [1, 1], format: DEPTH_FORMAT, usage: T.TEXTURE_BINDING | T.RENDER_ATTACHMENT });
    this._clearDepth(this.dummyDepth);

    this._layouts();
    this.mipPipelines = new Map();
    this.pass = null;
  }

  _layouts() {
    const d = this.device;
    const F = GPUShaderStage.FRAGMENT, V = GPUShaderStage.VERTEX;
    this.frameLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, sampler: { type: 'filtering' } },
        { binding: 3, visibility: F, texture: { sampleType: 'float' } },
        { binding: 4, visibility: F, texture: { sampleType: 'depth' } },
        { binding: 5, visibility: F, sampler: { type: 'comparison' } },
        { binding: 6, visibility: F, texture: { sampleType: 'float' } },
        { binding: 7, visibility: F, sampler: { type: 'filtering' } },
      ],
    });
    this.drawLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: DRAW_SIZE } },
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, sampler: { type: 'filtering' } },
        { binding: 3, visibility: F, texture: { sampleType: 'float' } },
        { binding: 4, visibility: F, sampler: { type: 'filtering' } },
      ],
    });
    this.builtinLayout = d.createPipelineLayout({ bindGroupLayouts: [this.frameLayout, this.drawLayout] });
    this.customLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: V | F, buffer: { type: 'uniform', hasDynamicOffset: true } },
      ],
    });
    this.depthLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 128 } }],
    });
    this.depthGroup = d.createBindGroup({
      layout: this.depthLayout,
      entries: [{ binding: 0, resource: { buffer: this.arena, size: 128 } }],
    });
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
  }

  beginFrame() {}
  endFrame() {}

  // ------------------------------------------------------------ passes

  beginPass({ target, clear, frame }) {
    const d = this.device;
    // Every pass is drawn upside down, the canvas included: that is what
    // ANGLE does under WebGL, and it puts the multisample pattern — which
    // decides every anti-aliased edge — the same way up. The canvas pass is
    // flipped the right way round on its way to the screen (`_present`).
    const flipped = true;
    let colorView, resolveTarget, depthView, format, height;
    if (target === 'canvas') {
      const t = this._canvasTargets();
      colorView = t.msaa.createView();
      resolveTarget = t.resolve.createView();
      depthView = t.depth.createView();
      format = this.format;
      height = this.height;
    } else {
      const rt = this._transmissionTarget();
      colorView = rt.msaa.createView();
      resolveTarget = rt.texture.createView({ baseMipLevel: 0, mipLevelCount: 1 });
      depthView = rt.depth.createView();
      format = 'rgba16float';
      height = rt.height;
    }

    const frameBuffer = this.frameBuffers[target === 'canvas' ? 0 : 1];
    d.queue.writeBuffer(frameBuffer, 0, this._packFrame(frame, flipped, height));
    const frameGroup = d.createBindGroup({
      layout: this.frameLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: this.dfg.createView() },
        { binding: 2, resource: this.linear },
        { binding: 3, resource: (frame.env ? frame.env.gpu.texture : this.dummy2D).createView() },
        { binding: 4, resource: (frame.shadow ? frame.shadow.texture : this.dummyDepth).createView() },
        { binding: 5, resource: this.comparison },
        { binding: 6, resource: (target === 'canvas' && frame.transmission ? this.transmission.texture : this.dummy2D).createView() },
        { binding: 7, resource: this.trilinear },
      ],
    });

    const encoder = d.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: colorView, resolveTarget,
        clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] },
        loadOp: 'clear', storeOp: 'discard',
      }],
      depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    this.arenaUsed = 0;
    this.pass = { target, frame, flipped, encoder, pass, frameGroup, format, samples: SAMPLES, depth: true };
  }

  beginShadowPass(light, [width, height]) {
    const d = this.device;
    if (!this.shadowMap || this.shadowMap.width !== width || this.shadowMap.height !== height) {
      this.shadowMap?.destroy();
      this.shadowMap = d.createTexture({ size: [width, height], format: DEPTH_FORMAT, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    }
    const encoder = d.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowMap.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    this.arenaUsed = 0;
    this.pass = { target: 'shadow', flipped: true, encoder, pass, samples: 1 };
    return this.shadowMap;
  }

  endPass() {
    const { encoder, pass, target } = this.pass;
    pass.end();
    if (target === 'canvas') this._present(encoder);
    if (this.arenaUsed > 0) this.device.queue.writeBuffer(this.arena, 0, this.arenaData, 0, this.arenaUsed);
    this.device.queue.submit([encoder.finish()]);
    if (target === 'transmission') this._generateMipmaps(this.transmission.texture, 'rgba16float');
    this.pass = null;
  }

  // ------------------------------------------------------------ drawing

  draw(call) {
    const p = this.pass;
    const pipeline = this._pipeline(call);
    p.pass.setPipeline(pipeline);
    if (call.key.kind === 'custom') {
      const objectOffset = this._alloc(OBJECT_SIZE);
      this._packObject(objectOffset, call);
      const fields = customFields(call.material);
      const materialOffset = this._alloc(Math.max(16, structSize(fields)));
      this._packCustom(materialOffset, fields, call.material);
      p.pass.setBindGroup(0, this._customGroup(), [objectOffset, materialOffset]);
    } else {
      const offset = this._alloc(DRAW_SIZE);
      this._packDraw(offset, call);
      p.pass.setBindGroup(0, p.frameGroup);
      p.pass.setBindGroup(1, this._drawGroup(call.textures), [offset]);
    }
    this._geometry(pipeline.attributes, call.geometry);
    this._submit(call);
  }

  drawDepth(call) {
    const p = this.pass;
    const pipeline = this._depthPipeline(call.cull);
    p.pass.setPipeline(pipeline);
    const offset = this._alloc(128);
    this.arenaF32.set(call.modelViewMatrix, offset / 4);
    this.arenaF32.set(toWebGPUProjection(call.projectionMatrix, true), offset / 4 + 16);
    p.pass.setBindGroup(0, this.depthGroup, [offset]);
    this._geometry(['position'], call.geometry);
    this._submit(call);
  }

  _submit({ geometry, start, count }) {
    const pass = this.pass.pass;
    const index = geometry.index;
    if (index !== null) {
      const entry = this._buffer(index, U.INDEX, true);
      pass.setIndexBuffer(entry.buffer, index.array.BYTES_PER_ELEMENT === 4 ? 'uint32' : 'uint16');
      pass.drawIndexed(count, 1, start);
    } else {
      pass.draw(count, 1, start);
    }
  }

  _geometry(attributes, geometry) {
    const pass = this.pass.pass;
    attributes.forEach((name, slot) => {
      const attribute = geometry.attributes[name];
      if (attribute) pass.setVertexBuffer(slot, this._buffer(attribute, U.VERTEX, false).buffer);
      else pass.setVertexBuffer(slot, this.zero);
    });
  }

  _alloc(size) {
    const offset = this.arenaUsed;
    this.arenaUsed = alignTo(offset + size, ALIGN);
    if (this.arenaUsed > ARENA_SIZE) throw new Error('gfx: too many draws in one pass');
    return offset;
  }

  // ------------------------------------------------------------ uniforms

  _packFrame(frame, flipped, viewportHeight) {
    const f = new Float32Array(FRAME_SIZE / 4);
    const cam = frame.camera;
    f.set(cam.viewMatrix, 0);
    f.set(toWebGPUProjection(cam.projectionMatrix, flipped), 16);
    f.set(cam.projectionMatrix, 32);
    if (frame.shadow) f.set(frame.shadow.matrix, 48);
    f.set(cam.position, 64);
    f[67] = cam.isOrthographic ? 1 : 0;
    f.set(frame.ambient, 68);
    f[71] = flipped ? 1 : -1;
    if (frame.shadow) {
      f.set([frame.shadow.intensity, frame.shadow.bias, frame.shadow.radius, 0], 72);
      f.set(frame.shadow.mapSize, 76);
      f[82] = frame.shadow.normalBias;
    }
    if (frame.transmission) f.set(frame.transmission.size, 78);
    f[80] = viewportHeight;
    f[81] = flipped ? 1 : 0;
    if (frame.directional.length > MAX_DIR_LIGHTS || frame.point.length > MAX_POINT_LIGHTS || frame.hemi.length > MAX_HEMI_LIGHTS) {
      throw new Error('gfx: too many lights');
    }
    frame.directional.forEach((l, i) => { f.set(l.direction, 84 + i * 4); f.set(l.color, 116 + i * 4); });
    frame.point.forEach((l, i) => {
      f.set([...l.position, l.distance], 148 + i * 4);
      f.set([...l.color, l.decay], 180 + i * 4);
    });
    frame.hemi.forEach((l, i) => {
      f.set(l.direction, 212 + i * 4);
      f.set(l.skyColor, 228 + i * 4);
      f.set(l.groundColor, 244 + i * 4);
    });
    return f;
  }

  _packDraw(offset, { object, params: p }) {
    const f = this.arenaF32;
    const o = offset / 4;
    f.fill(0, o, o + DRAW_SIZE / 4);
    f.set(object.modelMatrix, o);
    f.set(object.modelViewMatrix, o + 16);
    setMat3(f, o + 32, object.normalMatrix);
    setMat3(f, o + 44, p.mapTransform ?? IDENTITY3);
    setMat3(f, o + 56, p.bumpMapTransform ?? IDENTITY3);
    f.set(p.diffuse ?? p.color, o + 68);
    f[o + 71] = p.opacity;
    if (p.emissive) f.set(p.emissive, o + 72);
    f[o + 75] = p.roughness ?? 1;
    f.set(p.specularColor ?? [1, 1, 1], o + 76);
    f[o + 79] = p.metalness ?? 0;
    f.set(p.sheenColor ?? [0, 0, 0], o + 80);
    f[o + 83] = p.sheenRoughness ?? 1;
    f.set(p.attenuationColor ?? [1, 1, 1], o + 84);
    const finite = Number.isFinite(p.attenuationDistance);
    f[o + 87] = finite ? p.attenuationDistance : 0;
    f[o + 88] = p.ior ?? 1.5;
    f[o + 89] = p.specularIntensity ?? 1;
    f[o + 90] = p.clearcoat ?? 0;
    f[o + 91] = p.clearcoatRoughness ?? 0;
    f[o + 92] = p.iridescence ?? 0;
    f[o + 93] = p.iridescenceIOR ?? 1.3;
    f[o + 94] = p.iridescenceThicknessMaximum ?? 400;
    f[o + 95] = p.transmission ?? 0;
    f[o + 96] = p.thickness ?? 0;
    f[o + 97] = p.bumpScale ?? 1;
    f[o + 98] = p.envMapIntensity ?? 1;
    f[o + 99] = p.receiveShadow ?? 0;
    f.set(p.center ?? [0.5, 0.5], o + 100);
    f[o + 102] = p.rotation ?? 0;
    f[o + 103] = finite ? 1 : 0;
  }

  _packObject(offset, call) {
    const f = this.arenaF32;
    const o = offset / 4;
    const frame = this.pass.frame;
    f.set(call.object.modelMatrix, o);
    f.set(call.object.modelViewMatrix, o + 16);
    f.set(toWebGPUProjection(frame.camera.projectionMatrix, this.pass.flipped), o + 32);
    f.set(frame.camera.viewMatrix, o + 48);
    setMat3(f, o + 64, call.object.normalMatrix);
    f.set(frame.camera.position, o + 76);
  }

  _packCustom(offset, fields, material) {
    const f = this.arenaF32;
    let o = offset;
    for (const [name, type] of fields) {
      const { value } = material.uniforms[name];
      o = alignTo(o, ALIGNMENT[type]);
      const i = o / 4;
      if (type === 'f32') f[i] = value;
      else if (type === 'vec2f') f.set([value.x, value.y], i);
      else if (type === 'vec3f') f.set(value.isColor ? [value.r, value.g, value.b] : [value.x, value.y, value.z], i);
      else if (type === 'mat4x4f') f.set(value.elements, i);
      o += SIZE[type];
    }
  }

  // ------------------------------------------------------------ pipelines

  _module(code) {
    let module = this.modules.get(code);
    if (!module) {
      module = this.device.createShaderModule({ code });
      this.modules.set(code, module);
    }
    return module;
  }

  _pipeline(call) {
    const { key, state, topology, geometry, material } = call;
    const p = this.pass;
    const frontFlip = (state.cull === 'front') !== p.flipped;
    const attributes = attributesFor(key);
    const layoutKey = attributes.map((name) => (geometry.attributes[name] ? geometry.attributes[name].itemSize : 0)).join(',');
    const id = `${keyString(key)}|${key.kind === 'custom' ? material.version : ''}|${state.blending}|${state.depthTest}|${state.depthWrite}`
      + `|${state.colorWrite}|${state.cull}|${frontFlip}|${topology}|${p.format}|${layoutKey}`;
    let pipeline = this.pipelines.get(id);
    if (pipeline) return pipeline;

    const module = this._module(moduleSource(key, material));
    const blend = state.blending === 'normal'
      ? { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
      : state.blending === 'additive'
        ? { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } }
        : undefined;
    pipeline = this.device.createRenderPipeline({
      layout: key.kind === 'custom'
        ? this.device.createPipelineLayout({ bindGroupLayouts: [this.customLayout] })
        : this.builtinLayout,
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: attributes.map((name) => {
          const attribute = geometry.attributes[name];
          const size = attribute ? attribute.itemSize : (name === 'uv' ? 2 : 3);
          return {
            arrayStride: attribute ? size * 4 : 0,
            attributes: [{ shaderLocation: LOCATIONS[name], offset: 0, format: size === 2 ? 'float32x2' : size === 4 ? 'float32x4' : 'float32x3' }],
          };
        }),
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [{ format: p.format, blend, writeMask: state.colorWrite ? GPUColorWrite.ALL : 0 }],
      },
      primitive: {
        topology: topology === 'lines' ? 'line-list' : topology === 'line-strip' ? 'line-strip' : 'triangle-list',
        cullMode: state.cull === 'none' ? 'none' : 'back',
        frontFace: frontFlip ? 'cw' : 'ccw',
      },
      depthStencil: {
        format: DEPTH_FORMAT,
        // OpenGL writes no depth at all while the test is off.
        depthWriteEnabled: state.depthTest && state.depthWrite,
        depthCompare: state.depthTest ? 'less-equal' : 'always',
      },
      multisample: { count: p.samples },
    });
    pipeline.attributes = attributes;
    this.pipelines.set(id, pipeline);
    return pipeline;
  }

  _depthPipeline(cull) {
    const id = `depth|${cull}`;
    let pipeline = this.pipelines.get(id);
    if (pipeline) return pipeline;
    const module = this._module(depthWGSL());
    pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.depthLayout] }),
      vertex: {
        module, entryPoint: 'vs',
        buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: cull === 'none' ? 'none' : 'back',
        // Drawn flipped, so the winding reads the other way round.
        frontFace: cull === 'front' ? 'ccw' : 'cw',
      },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' },
    });
    this.pipelines.set(id, pipeline);
    return pipeline;
  }

  _drawGroup(textures) {
    const map = textures.map ? this._texture(textures.map) : null;
    const bump = textures.bumpMap ? this._texture(textures.bumpMap) : null;
    const id = `${map?.id ?? '-'}|${bump?.id ?? '-'}`;
    let group = this.drawGroups.get(id);
    if (!group) {
      group = this.device.createBindGroup({
        layout: this.drawLayout,
        entries: [
          { binding: 0, resource: { buffer: this.arena, size: DRAW_SIZE } },
          { binding: 1, resource: (map ? map.texture : this.dummy2D).createView() },
          { binding: 2, resource: map ? map.sampler : this.linear },
          { binding: 3, resource: (bump ? bump.texture : this.dummy2D).createView() },
          { binding: 4, resource: bump ? bump.sampler : this.linear },
        ],
      });
      this.drawGroups.set(id, group);
    }
    return group;
  }

  _customGroup() {
    if (!this.customGroup) {
      this.customGroup = this.device.createBindGroup({
        layout: this.customLayout,
        entries: [
          { binding: 0, resource: { buffer: this.arena, size: OBJECT_SIZE } },
          { binding: 1, resource: { buffer: this.arena, size: 256 } },
        ],
      });
    }
    return this.customGroup;
  }

  // ------------------------------------------------------------ resources

  /** Uploads whatever changed since the last sync; draws use what is resident. */
  syncGeometry(geometry) {
    for (const name of Object.keys(LOCATIONS)) {
      const attribute = geometry.attributes[name];
      if (attribute) this._buffer(attribute, U.VERTEX, true);
    }
  }

  _buffer(attribute, usage, sync) {
    let entry = this.buffers.get(attribute);
    const array = attribute.array instanceof Float64Array ? new Float32Array(attribute.array) : attribute.array;
    const size = alignTo(array.byteLength, 4);
    if (!entry || entry.size !== size) {
      entry?.buffer.destroy();
      entry = { buffer: this.device.createBuffer({ size, usage: usage | U.COPY_DST }), version: -1, size };
      this.buffers.set(attribute, entry);
    }
    if (entry.version !== attribute.version && (sync || entry.version === -1)) {
      if (array.byteLength % 4 === 0) {
        this.device.queue.writeBuffer(entry.buffer, 0, array.buffer, array.byteOffset, array.byteLength);
      } else {
        const padded = new Uint8Array(size);
        padded.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
        this.device.queue.writeBuffer(entry.buffer, 0, padded);
      }
      entry.version = attribute.version;
    }
    return entry;
  }

  _texture(texture) {
    let entry = this.textures.get(texture);
    if (!entry) {
      entry = { id: texture.id, version: -1 };
      this.textures.set(texture, entry);
      texture.addEventListener('dispose', () => {
        entry.texture?.destroy();
        this.textures.delete(texture);
      });
    }
    if (entry.version !== texture.version && texture.image) {
      const image = texture.image;
      const mipmaps = texture.generateMipmaps && texture.minFilter === LinearMipmapLinearFilter;
      const levels = mipmaps ? Math.floor(Math.log2(Math.max(image.width, image.height))) + 1 : 1;
      const format = texture.colorSpace === SRGBColorSpace ? 'rgba8unorm-srgb' : 'rgba8unorm';
      entry.texture?.destroy();
      entry.texture = this.device.createTexture({
        size: [image.width, image.height], format, mipLevelCount: levels,
        usage: T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source: image, flipY: texture.flipY },
        { texture: entry.texture, premultipliedAlpha: texture.premultiplyAlpha },
        [image.width, image.height],
      );
      if (mipmaps) this._generateMipmaps(entry.texture, format);
      entry.sampler = this._sampler(mipmaps, texture.anisotropy);
      entry.version = texture.version;
      entry.id = `${texture.id}.${texture.version}`;
      this.drawGroups.clear();
    }
    return entry;
  }

  _sampler(mipmaps, anisotropy) {
    const id = `${mipmaps}|${anisotropy}`;
    let sampler = this.samplers.get(id);
    if (!sampler) {
      sampler = this.device.createSampler({
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: mipmaps ? 'linear' : 'nearest',
        maxAnisotropy: mipmaps && anisotropy > 1 ? Math.min(16, anisotropy) : 1,
        lodMaxClamp: mipmaps ? 32 : 0,
      });
      this.samplers.set(id, sampler);
    }
    return sampler;
  }

  _generateMipmaps(texture, format) {
    const d = this.device;
    let pipeline = this.mipPipelines.get(format);
    if (!pipeline) {
      const module = this._module(mipmapWGSL());
      pipeline = d.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      this.mipPipelines.set(format, pipeline);
    }
    const encoder = d.createCommandEncoder();
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const group = d.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: this.linear },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
          loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    }
    d.queue.submit([encoder.finish()]);
  }

  _dfgTexture() {
    const texture = this.device.createTexture({ size: [DFG_SIZE, DFG_SIZE], format: 'rg16float', usage: T.TEXTURE_BINDING | T.COPY_DST });
    this.device.queue.writeTexture({ texture }, DFG_DATA, { bytesPerRow: DFG_SIZE * 4 }, [DFG_SIZE, DFG_SIZE]);
    return texture;
  }

  _solidTexture() {
    const texture = this.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST });
    this.device.queue.writeTexture({ texture }, new Uint8Array([0, 0, 0, 0]), { bytesPerRow: 4 }, [1, 1]);
    return texture;
  }

  _clearDepth(texture) {
    const encoder = this.device.createCommandEncoder();
    encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: texture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    }).end();
    this.device.queue.submit([encoder.finish()]);
  }

  _canvasTargets() {
    const t = this.canvasTargets;
    if (t && t.width === this.width && t.height === this.height) return t;
    t?.msaa.destroy();
    t?.depth.destroy();
    t?.resolve.destroy();
    const size = [this.width, this.height];
    const resolve = this.device.createTexture({ size, format: this.format, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
    this.canvasTargets = {
      width: this.width, height: this.height, resolve,
      msaa: this.device.createTexture({ size, format: this.format, sampleCount: SAMPLES, usage: T.RENDER_ATTACHMENT }),
      depth: this.device.createTexture({ size, format: DEPTH_FORMAT, sampleCount: SAMPLES, usage: T.RENDER_ATTACHMENT }),
      presentGroup: null,
    };
    return this.canvasTargets;
  }

  /** The resolved frame, turned right way up, onto the canvas. */
  _present(encoder) {
    const d = this.device;
    if (!this.presentPipeline) {
      const module = this._module(presentWGSL());
      this.presentPipeline = d.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      });
    }
    const t = this.canvasTargets;
    t.presentGroup ??= d.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: t.resolve.createView() }],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, t.presentGroup);
    pass.draw(3);
    pass.end();
  }

  _transmissionTarget() {
    const rt = this.transmission;
    if (rt && rt.width === this.width && rt.height === this.height) return rt;
    rt?.texture.destroy();
    rt?.msaa.destroy();
    rt?.depth.destroy();
    const size = [this.width, this.height];
    const levels = Math.floor(Math.log2(Math.max(this.width, this.height))) + 1;
    this.transmission = {
      width: this.width, height: this.height,
      texture: this.device.createTexture({ size, format: 'rgba16float', mipLevelCount: levels, usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING }),
      msaa: this.device.createTexture({ size, format: 'rgba16float', sampleCount: SAMPLES, usage: T.RENDER_ATTACHMENT }),
      depth: this.device.createTexture({ size, format: DEPTH_FORMAT, sampleCount: SAMPLES, usage: T.RENDER_ATTACHMENT }),
    };
    return this.transmission;
  }

  // ------------------------------------------------------------ environment

  /** Studio texture in, prefiltered cube-UV atlas out — see pmrem.js for the schedule. */
  prefilterEquirectangular(texture) {
    const d = this.device;
    const layout = pmremLayout(texture.image.width);
    const planes = pmremPlanes(layout.lodMax);
    const target = () => d.createTexture({
      size: [layout.width, layout.height], format: 'rgba16float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING,
    });
    const atlas = target();
    const pingPong = target();
    const source = this._texture(texture);

    const vertexBuffers = planes.map((plane) => {
      const position = d.createBuffer({ size: plane.position.byteLength, usage: U.VERTEX | U.COPY_DST });
      d.queue.writeBuffer(position, 0, plane.position);
      const direction = d.createBuffer({ size: plane.outputDirection.byteLength, usage: U.VERTEX | U.COPY_DST });
      d.queue.writeBuffer(direction, 0, plane.outputDirection);
      return [position, direction];
    });
    const buffers = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x3' }] },
    ];
    const pipelineFor = (code) => {
      const module = this._module(code);
      return d.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs', buffers },
        fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
      });
    };
    const equirect = pipelineFor(pmremEquirectWGSL());
    const ggx = pipelineFor(pmremGGXWGSL(layout));

    const run = (pipeline, to, entries, plane, viewport, load) => {
      const encoder = d.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.createView(), loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
      pass.setViewport(viewport[0], viewport[1], viewport[2], viewport[3], 0, 1);
      pass.setScissorRect(viewport[0], viewport[1], viewport[2], viewport[3]);
      pass.setVertexBuffer(0, vertexBuffers[plane][0]);
      pass.setVertexBuffer(1, vertexBuffers[plane][1]);
      pass.draw(36);
      pass.end();
      d.queue.submit([encoder.finish()]);
    };

    run(equirect, atlas, [
      { binding: 0, resource: source.texture.createView() },
      { binding: 1, resource: source.sampler },
    ], 0, [0, 0, 3 * layout.cubeSize, 2 * layout.cubeSize], false);

    let pingPongTouched = false;
    for (const pass of pmremSchedule(layout, planes)) {
      const from = pass.source === 'atlas' ? atlas : pingPong;
      const to = pass.target === 'atlas' ? atlas : pingPong;
      const params = d.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST });
      d.queue.writeBuffer(params, 0, new Float32Array([pass.roughness, pass.mipInt, 0, 0]));
      run(ggx, to, [
        { binding: 0, resource: from.createView() },
        { binding: 1, resource: this.linear },
        { binding: 2, resource: { buffer: params } },
      ], pass.plane, pass.viewport, to === atlas || pingPongTouched);
      if (to === pingPong) pingPongTouched = true;
    }

    for (const [a, b] of vertexBuffers) { a.destroy(); b.destroy(); }
    pingPong.destroy();
    return {
      isCubeUVTexture: true,
      texelWidth: layout.texelWidth,
      texelHeight: layout.texelHeight,
      maxMip: layout.maxMip,
      gpu: { texture: atlas },
      dispose: () => atlas.destroy(),
    };
  }
}

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ALIGNMENT = { f32: 4, vec2f: 8, vec3f: 16, mat4x4f: 16 };
const SIZE = { f32: 4, vec2f: 8, vec3f: 12, mat4x4f: 64 };

function structSize(fields) {
  let o = 0, align = 4;
  for (const [, type] of fields) {
    o = alignTo(o, ALIGNMENT[type]) + SIZE[type];
    align = Math.max(align, ALIGNMENT[type]);
  }
  return alignTo(o, align);
}

/** A column-major mat3 into WGSL's mat3x3f, whose columns are padded to vec4. */
function setMat3(f, o, m) {
  f[o] = m[0]; f[o + 1] = m[1]; f[o + 2] = m[2];
  f[o + 4] = m[3]; f[o + 5] = m[4]; f[o + 6] = m[5];
  f[o + 8] = m[6]; f[o + 9] = m[7]; f[o + 10] = m[8];
}

/** The vertex streams a program reads, in slot order. */
function attributesFor(key) {
  switch (key.kind) {
    case 'standard': return ['position', 'normal', ...(key.map || key.bumpMap ? ['uv'] : []), ...(key.vertexColors ? ['color'] : [])];
    case 'basic': return ['position', ...(key.map ? ['uv'] : []), ...(key.vertexColors ? ['color'] : [])];
    case 'sprite': return ['position', ...(key.map ? ['uv'] : [])];
    case 'shadow': return ['position', 'normal'];
    case 'custom': return ['position', 'normal', 'uv'];
    default: return ['position'];
  }
}
