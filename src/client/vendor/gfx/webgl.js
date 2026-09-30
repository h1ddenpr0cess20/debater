/**
 * The WebGL 2 backend: compiles the GLSL in shaders/glsl.js per program key,
 * keeps geometry and textures resident, and draws what the renderer hands it.
 * Where WebGPU is not available this is what runs, and it is meant to be
 * indistinguishable from it.
 */

import { LinearMipmapLinearFilter, SRGBColorSpace } from './core.js';
import { DFG_DATA, DFG_SIZE } from './dfg.js';
import { keyString } from './renderer.js';
import { pmremEquirect, pmremGGX, programSources } from './shaders/glsl.js';
import { pmremLayout, pmremPlanes, pmremSchedule } from './pmrem.js';

const ATTRIBUTES = ['position', 'normal', 'uv', 'color', 'outputDirection'];

export class WebGLBackend {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      depth: true,
      stencil: false,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'default',
    });
    if (!gl) throw new Error('WebGL 2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.isWebGL = true;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maxAnisotropy = this.anisotropy ? gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;

    this.programs = new Map();
    this.buffers = new WeakMap();
    this.textures = new WeakMap();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.width = canvas.width;
    this.height = canvas.height;
    this.transmission = null;
    this.shadowMap = null;
    this.dfg = this._dfgTexture();
    this.pass = null;
    gl.depthFunc(gl.LEQUAL);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
  }

  beginFrame() {}
  endFrame() {}

  // ------------------------------------------------------------ passes

  beginPass({ target, clear, frame }) {
    const gl = this.gl;
    if (target === 'canvas') {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    } else {
      const rt = this._transmissionTarget();
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.msaaFramebuffer);
      gl.viewport(0, 0, rt.width, rt.height);
    }
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.pass = { target, frame };
  }

  beginShadowPass(light, size) {
    const gl = this.gl;
    const map = this._shadowTarget(size);
    gl.bindFramebuffer(gl.FRAMEBUFFER, map.framebuffer);
    gl.viewport(0, 0, size[0], size[1]);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    this.pass = { target: 'shadow' };
    return map;
  }

  endPass() {
    const gl = this.gl;
    if (this.pass?.target === 'transmission') {
      const rt = this.transmission;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rt.msaaFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rt.resolveFramebuffer);
      gl.blitFramebuffer(0, 0, rt.width, rt.height, 0, 0, rt.width, rt.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, rt.texture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    this.pass = null;
  }

  // ------------------------------------------------------------ drawing

  draw(call) {
    const gl = this.gl;
    const frame = this.pass.frame;
    const program = this._program(call.key, call.material);
    gl.useProgram(program.handle);
    this._state(call.state);

    const u = program.uniforms;
    u.set('modelMatrix', call.object.modelMatrix, 'm4');
    u.set('modelViewMatrix', call.object.modelViewMatrix, 'm4');
    u.set('normalMatrix', call.object.normalMatrix, 'm3');
    u.set('projectionMatrix', frame.camera.projectionMatrix, 'm4');
    u.set('viewMatrix', frame.camera.viewMatrix, 'm4');
    u.set('cameraPosition', frame.camera.position, 'v3');
    u.set('isOrthographic', frame.camera.isOrthographic ? 1 : 0, 'i');

    // Uploads bind whatever unit is active, so every texture is made resident
    // before any unit is assigned.
    const map = call.textures.map ? this._texture(call.textures.map) : null;
    const bumpMap = call.textures.bumpMap ? this._texture(call.textures.bumpMap) : null;
    let unit = 0;
    const bindTexture = (name, texture) => {
      if (!u.has(name)) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      u.set(name, unit, 'i');
      unit++;
    };

    if (call.key.kind === 'custom') {
      for (const [name, { value }] of Object.entries(call.material.uniforms)) {
        if (typeof value === 'number') u.set(name, value, 'f');
        else if (value.isColor) u.set(name, [value.r, value.g, value.b], 'v3');
        else if (value.isVector3) u.set(name, [value.x, value.y, value.z], 'v3');
        else if (value.isVector2) u.set(name, [value.x, value.y], 'v2');
        else if (value.isMatrix4) u.set(name, value.elements, 'm4');
      }
    } else {
      for (const [name, value] of Object.entries(call.params)) u.set(name, value, uniformType(value));
      this._lights(u, frame);
      if (map) bindTexture('map', map);
      if (bumpMap) bindTexture('bumpMap', bumpMap);
      if (frame.env && call.key.envMap) bindTexture('envMap', frame.env.gpu.texture);
      bindTexture('dfgLUT', this.dfg);
      if (frame.shadow && u.has('directionalShadowMap')) {
        bindTexture('directionalShadowMap', frame.shadow.texture.texture);
        u.set('directionalShadowMatrix[0]', frame.shadow.matrix, 'm4');
        u.set('directionalShadowNormalBias[0]', frame.shadow.normalBias, 'f');
        u.set('directionalShadowParams', [frame.shadow.intensity, frame.shadow.bias, frame.shadow.radius, 0], 'v4');
        u.set('directionalShadowMapSize', frame.shadow.mapSize, 'v2');
      }
      if (frame.transmission && u.has('transmissionSamplerMap')) {
        bindTexture('transmissionSamplerMap', this.transmission.texture);
        u.set('transmissionSamplerSize', frame.transmission.size, 'v2');
      }
    }

    this._attributes(program, call.geometry);
    this._submit(call.geometry, call.topology, call.start, call.count);
  }

  drawDepth(call) {
    const gl = this.gl;
    const program = this._program({ kind: 'depth' });
    gl.useProgram(program.handle);
    this._state({ blending: 'none', depthTest: true, depthWrite: true, colorWrite: false, cull: call.cull });
    program.uniforms.set('modelViewMatrix', call.modelViewMatrix, 'm4');
    program.uniforms.set('projectionMatrix', call.projectionMatrix, 'm4');
    this._attributes(program, call.geometry);
    this._submit(call.geometry, call.topology, call.start, call.count);
  }

  _submit(geometry, topology, start, count) {
    const gl = this.gl;
    const mode = topology === 'lines' ? gl.LINES : topology === 'line-strip' ? gl.LINE_STRIP : gl.TRIANGLES;
    const index = geometry.index;
    if (index !== null) {
      const buffer = this._buffer(index, gl.ELEMENT_ARRAY_BUFFER);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      const bytes = index.array.BYTES_PER_ELEMENT;
      gl.drawElements(mode, count, bytes === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, start * bytes);
    } else {
      gl.drawArrays(mode, start, count);
    }
  }

  _state({ blending, depthTest, depthWrite, colorWrite, cull }) {
    const gl = this.gl;
    if (blending === 'none') {
      gl.disable(gl.BLEND);
    } else {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      if (blending === 'additive') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(depthWrite);
    gl.colorMask(colorWrite, colorWrite, colorWrite, colorWrite);
    if (cull === 'none') {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(cull === 'front' ? gl.CW : gl.CCW);
    }
  }

  _lights(u, frame) {
    u.set('ambientLightColor', frame.ambient, 'v3');
    frame.directional.forEach((l, i) => {
      u.set(`directionalLightDirection[${i}]`, l.direction, 'v3');
      u.set(`directionalLightColor[${i}]`, l.color, 'v3');
    });
    frame.point.forEach((l, i) => {
      u.set(`pointLightPosition[${i}]`, l.position, 'v3');
      u.set(`pointLightColor[${i}]`, l.color, 'v3');
      u.set(`pointLightDistance[${i}]`, l.distance, 'f');
      u.set(`pointLightDecay[${i}]`, l.decay, 'f');
    });
    frame.hemi.forEach((l, i) => {
      u.set(`hemisphereLightDirection[${i}]`, l.direction, 'v3');
      u.set(`hemisphereLightSkyColor[${i}]`, l.skyColor, 'v3');
      u.set(`hemisphereLightGroundColor[${i}]`, l.groundColor, 'v3');
    });
  }

  _attributes(program, geometry) {
    const gl = this.gl;
    for (let location = 0; location < ATTRIBUTES.length; location++) {
      const attribute = program.attributes[location] ? geometry.attributes[ATTRIBUTES[location]] : undefined;
      if (attribute === undefined) {
        gl.disableVertexAttribArray(location);
        continue;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer(attribute, gl.ARRAY_BUFFER));
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, attribute.itemSize, gl.FLOAT, attribute.normalized, 0, 0);
    }
  }

  // ------------------------------------------------------------ resources

  _program(key, material) {
    const id = keyString(key) + (key.kind === 'custom' ? `#${material.version}` : '');
    let program = this.programs.get(id);
    if (program) return program;
    const gl = this.gl;
    const [vs, fs] = programSources(key, material);
    const handle = gl.createProgram();
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(handle, shader);
      return shader;
    };
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    ATTRIBUTES.forEach((name, location) => gl.bindAttribLocation(handle, location, name));
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      const log = [gl.getShaderInfoLog(v), gl.getShaderInfoLog(f), gl.getProgramInfoLog(handle)].filter(Boolean).join('\n');
      throw new Error(`gfx: ${key.kind} program failed to link\n${log}`);
    }
    const attributes = ATTRIBUTES.map((name) => gl.getAttribLocation(handle, name) !== -1);
    program = { handle, attributes, uniforms: new Uniforms(gl, handle) };
    this.programs.set(id, program);
    return program;
  }

  /** Uploads whatever changed since the last sync; draws use what is resident. */
  syncGeometry(geometry) {
    const gl = this.gl;
    for (const name of ATTRIBUTES) {
      const attribute = geometry.attributes[name];
      if (attribute) this._buffer(attribute, gl.ARRAY_BUFFER, true);
    }
  }

  _buffer(attribute, target, sync = false) {
    const gl = this.gl;
    let entry = this.buffers.get(attribute);
    if (!entry) {
      entry = { buffer: gl.createBuffer(), version: -1, byteLength: 0 };
      this.buffers.set(attribute, entry);
    }
    if (entry.version !== attribute.version && (sync || entry.version === -1 || target === gl.ELEMENT_ARRAY_BUFFER)) {
      const data = attribute.array instanceof Float64Array ? new Float32Array(attribute.array) : attribute.array;
      gl.bindBuffer(target, entry.buffer);
      if (entry.byteLength === data.byteLength) gl.bufferSubData(target, 0, data);
      else gl.bufferData(target, data, entry.version === -1 ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW);
      entry.byteLength = data.byteLength;
      entry.version = attribute.version;
    }
    return entry.buffer;
  }

  _texture(texture) {
    const gl = this.gl;
    let entry = this.textures.get(texture);
    if (!entry) {
      entry = { handle: gl.createTexture(), version: -1 };
      this.textures.set(texture, entry);
      texture.addEventListener('dispose', () => {
        gl.deleteTexture(entry.handle);
        this.textures.delete(texture);
      });
    }
    if (entry.version !== texture.version && texture.image) {
      const image = texture.image;
      const mipmaps = texture.generateMipmaps && texture.minFilter === LinearMipmapLinearFilter;
      const levels = mipmaps ? Math.floor(Math.log2(Math.max(image.width, image.height))) + 1 : 1;
      if (entry.handle && entry.version !== -1) {
        gl.deleteTexture(entry.handle);
        entry.handle = gl.createTexture();
      }
      gl.bindTexture(gl.TEXTURE_2D, entry.handle);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      const internal = texture.colorSpace === SRGBColorSpace ? gl.SRGB8_ALPHA8 : gl.RGBA8;
      gl.texStorage2D(gl.TEXTURE_2D, levels, internal, image.width, image.height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (this.anisotropy && texture.anisotropy > 1) {
        gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(texture.anisotropy, this.maxAnisotropy));
      }
      if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
      entry.version = texture.version;
    }
    return entry.handle;
  }

  _dfgTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, DFG_SIZE, DFG_SIZE, 0, gl.RG, gl.HALF_FLOAT, DFG_DATA);
    setLinearClamp(gl, false);
    return texture;
  }

  _transmissionTarget() {
    const gl = this.gl;
    const width = this.width, height = this.height;
    let rt = this.transmission;
    if (rt && rt.width === width && rt.height === height) return rt;
    if (rt) {
      gl.deleteTexture(rt.texture);
      gl.deleteRenderbuffer(rt.color);
      gl.deleteRenderbuffer(rt.depth);
      gl.deleteFramebuffer(rt.msaaFramebuffer);
      gl.deleteFramebuffer(rt.resolveFramebuffer);
    }
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, width, height);
    setLinearClamp(gl, true);
    const color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RGBA16F, width, height);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT24, width, height);
    const msaaFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFramebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const resolveFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    rt = { width, height, texture, color, depth, msaaFramebuffer, resolveFramebuffer };
    this.transmission = rt;
    return rt;
  }

  _shadowTarget([width, height]) {
    const gl = this.gl;
    if (this.shadowMap && this.shadowMap.width === width && this.shadowMap.height === height) return this.shadowMap;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    setLinearClamp(gl, false);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowMap = { width, height, texture, framebuffer };
    return this.shadowMap;
  }

  // ------------------------------------------------------------ environment

  /** Studio texture in, prefiltered cube-UV atlas out — see pmrem.js for the schedule. */
  prefilterEquirectangular(texture) {
    const gl = this.gl;
    const layout = pmremLayout(texture.image.width);
    const planes = pmremPlanes(layout.lodMax);
    const target = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, layout.width, layout.height);
      setLinearClamp(gl, false);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { texture: t, framebuffer: fb };
    };
    const atlas = target();
    const pingPong = target();

    const link = ([vs, fs]) => {
      const handle = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(handle, shader);
      }
      ATTRIBUTES.forEach((name, location) => gl.bindAttribLocation(handle, location, name));
      gl.linkProgram(handle);
      return { handle, uniforms: new Uniforms(gl, handle) };
    };
    const equirect = link(pmremEquirect());
    const ggx = link(pmremGGX(layout));

    const drawPlane = (plane) => {
      const position = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, plane.position, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const direction = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, direction);
      gl.bufferData(gl.ARRAY_BUFFER, plane.outputDirection, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
      for (const location of [1, 2, 3]) gl.disableVertexAttribArray(location);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
      gl.disableVertexAttribArray(4);
      gl.deleteBuffer(position);
      gl.deleteBuffer(direction);
    };

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.SCISSOR_TEST);
    const viewport = (v) => { gl.viewport(v[0], v[1], v[2], v[3]); gl.scissor(v[0], v[1], v[2], v[3]); };

    gl.bindFramebuffer(gl.FRAMEBUFFER, atlas.framebuffer);
    viewport([0, 0, 3 * layout.cubeSize, 2 * layout.cubeSize]);
    gl.useProgram(equirect.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture(texture));
    equirect.uniforms.set('envMap', 0, 'i');
    drawPlane(planes[0]);

    gl.useProgram(ggx.handle);
    ggx.uniforms.set('envMap', 0, 'i');
    for (const pass of pmremSchedule(layout, planes)) {
      const from = pass.source === 'atlas' ? atlas : pingPong;
      const to = pass.target === 'atlas' ? atlas : pingPong;
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
      viewport(pass.viewport);
      gl.bindTexture(gl.TEXTURE_2D, from.texture);
      ggx.uniforms.set('roughness', pass.roughness, 'f');
      ggx.uniforms.set('mipInt', pass.mipInt, 'f');
      drawPlane(planes[pass.plane]);
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(atlas.framebuffer);
    gl.deleteFramebuffer(pingPong.framebuffer);
    gl.deleteTexture(pingPong.texture);
    gl.deleteProgram(equirect.handle);
    gl.deleteProgram(ggx.handle);

    return {
      isCubeUVTexture: true,
      texelWidth: layout.texelWidth,
      texelHeight: layout.texelHeight,
      maxMip: layout.maxMip,
      gpu: { texture: atlas.texture },
      dispose: () => gl.deleteTexture(atlas.texture),
    };
  }
}

function setLinearClamp(gl, mipmaps) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
}

function uniformType(value) {
  if (typeof value === 'number') return 'f';
  switch (value.length) {
    case 2: return 'v2';
    case 3: return 'v3';
    case 4: return 'v4';
    case 9: return 'm3';
    case 16: return 'm4';
    default: throw new Error('gfx: unexpected uniform value');
  }
}

/** Uniform locations, looked up once per program and name. */
class Uniforms {
  constructor(gl, program) {
    this.gl = gl;
    this.program = program;
    this.locations = new Map();
  }

  location(name) {
    let location = this.locations.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, location);
    }
    return location;
  }

  has(name) { return this.location(name) !== null; }

  set(name, value, type) {
    const location = this.location(name);
    if (location === null) return;
    const gl = this.gl;
    switch (type) {
      case 'f': gl.uniform1f(location, value); break;
      case 'i': gl.uniform1i(location, value); break;
      case 'v2': gl.uniform2fv(location, value); break;
      case 'v3': gl.uniform3fv(location, value); break;
      case 'v4': gl.uniform4fv(location, value); break;
      case 'm3': gl.uniformMatrix3fv(location, false, value); break;
      case 'm4': gl.uniformMatrix4fv(location, false, value); break;
    }
  }
}
