/**
 * <three-d-stage> — the 3D stage every character is drawn on.
 *
 * The stage owns the whole scene: the renderer (WebGPU where the browser has
 * it, WebGL 2 where it does not — both run the same shading model), neutral
 * studio lighting with a soft ground shadow, orbit controls (drag to orbit,
 * wheel to zoom, right-drag to pan), a camera auto-framed to the object's
 * bounds, and resize handling.
 *
 * Usage:
 *   <three-d-stage background="#0f0e0d"></three-d-stage>
 *   <script type="module">
 *     import './vendor/gfx/stage.js';
 *     const stage = document.querySelector('three-d-stage');
 *     const { GFX } = await stage.ready;
 *     const model = new GFX.Group();
 *     // …build the model out of meshes…
 *     stage.setObject(model);
 *   </script>
 *
 * Attributes:
 *   background — CSS color behind the scene (default a warm paper tone)
 *   autorotate — when present, a slow turntable until the user interacts
 *   renderer   — "webgpu" or "webgl" to pin a backend; otherwise WebGPU is
 *                tried first, and a lost WebGPU device drops to WebGL 2
 *                without a reload. `?renderer=webgl` in the page URL does
 *                the same as the attribute.
 *
 * Model in real-world meters, centered on the origin, y-up. The stage fills
 * its own box; size it with ordinary CSS (default 100vw/100vh page hero).
 *
 * Default setup: hemisphere + key + fill lights, a soft ground shadow from
 * the key, and no environment until a scene prefilters one into
 * `stage._scene.environment`.
 */

import * as GFX from './index.js';
import { OrbitControls } from './controls.js';
import { Renderer } from './renderer.js';
import { WebGLBackend } from './webgl.js';
import { WebGPUBackend } from './webgpu.js';

const stylesheet = `
  :host {
    position: relative;
    display: block;
    width: 100%;
    height: 100vh;
    background: var(--stage-bg, #f0eee6);
    overflow: hidden;
  }
  canvas { display: block; outline: none; }
  .err {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font: 500 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #8a2f20;
    text-align: center;
    white-space: pre-line;
  }
`;

/** WebGPU first; if it is missing or refuses to start, WebGL 2 on a fresh canvas. */
async function createRenderer(preference) {
  if (preference !== 'webgl' && typeof navigator !== 'undefined' && navigator.gpu) {
    const canvas = document.createElement('canvas');
    try {
      return new Renderer(await WebGPUBackend.create(canvas), canvas);
    } catch (err) {
      if (preference === 'webgpu') throw err;
      console.warn('three-d-stage: WebGPU unavailable, falling back to WebGL 2.', err);
    }
  }
  const canvas = document.createElement('canvas');
  return new Renderer(new WebGLBackend(canvas), canvas);
}

class ThreeDStage extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = stylesheet;
    root.appendChild(style);
    this._err = document.createElement('div');
    this._err.className = 'err';
    root.appendChild(this._err);
    /** Resolves with { GFX } once the scene is live — build the model in
     *  `await stage.ready` so nothing races the renderer starting up. */
    this.ready = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
  }

  connectedCallback() {
    if (this._booted) {
      // Re-attached after a removal — resume what disconnected stopped.
      if (this._renderer) {
        this._renderer.setAnimationLoop(this._loop);
        this._ro && this._ro.observe(this);
      }
      return;
    }
    this._booted = true;
    this._boot().catch((err) => {
      this._err.style.display = 'flex';
      this._err.textContent = 'The 3D view could not start: this browser offers neither WebGPU nor WebGL 2.\n\n'
        + String(err && err.message ? err.message : err);
      this._readyReject(err);
    });
  }

  async _boot() {
    const bg = this.getAttribute('background');
    if (bg) this.style.setProperty('--stage-bg', bg);
    const preference = this.getAttribute('renderer')
      || new URLSearchParams(globalThis.location?.search ?? '').get('renderer');

    const renderer = await createRenderer(preference);
    if (renderer.isWebGPU && preference !== 'webgpu') {
      renderer.backend.onLost = () => this._fallBackToWebGL();
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = GFX.PCFShadowMap;
    this._renderer = renderer;
    this.shadowRoot.insertBefore(renderer.domElement, this._err);

    const scene = new GFX.Scene();
    this._scene = scene;

    const camera = new GFX.PerspectiveCamera(45, 1, 0.01, 500);
    camera.position.set(3, 2.2, 4);
    this._camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    this._controls = controls;

    // Neutral studio: soft sky/ground wash, a shadow-casting key light,
    // and a dim fill from behind so silhouettes never go black.
    scene.add(new GFX.HemisphereLight(0xffffff, 0xd8d2c4, 1.0));
    const key = new GFX.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    this._key = key;
    scene.add(key);
    const fill = new GFX.DirectionalLight(0xfff4e6, 0.5);
    fill.position.set(-5, 3, -4);
    scene.add(fill);

    const ground = new GFX.Mesh(
      new GFX.PlaneGeometry(200, 200),
      new GFX.ShadowMaterial({ opacity: 0.18 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this._ground = ground;
    scene.add(ground);

    this._autorotate = this.hasAttribute('autorotate');
    controls.autoRotate = this._autorotate;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
    });

    const fit = () => {
      const w = this.clientWidth || 1;
      const h = this.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    fit();
    this._ro = new ResizeObserver(fit);
    this._loop = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    // Detached while the renderer was starting? Stay idle — the
    // connectedCallback resume starts the loop and observer on reattach.
    if (this.isConnected) {
      this._ro.observe(this);
      renderer.setAnimationLoop(this._loop);
    }

    this._readyResolve({ GFX });
  }

  /** The WebGPU device is gone (driver reset, GPU process crash, a browser
   *  that offers WebGPU but cannot present it): keep going on WebGL 2 with the
   *  same scene, camera and controls, on a fresh canvas in the same place. */
  _fallBackToWebGL() {
    const renderer = this._renderer;
    const old = renderer.domElement;
    const canvas = document.createElement('canvas');
    let backend;
    try {
      backend = new WebGLBackend(canvas);
    } catch (err) {
      this._err.style.display = 'flex';
      this._err.textContent = 'The 3D view stopped: the graphics device was lost and WebGL 2 is not available.\n\n'
        + String(err && err.message ? err.message : err);
      return;
    }
    console.warn('three-d-stage: continuing on WebGL 2.');
    renderer.setBackend(backend, canvas);
    old.replaceWith(canvas);
    this._controls.connect(canvas);
  }

  disconnectedCallback() {
    // Stop rendering and observing while detached; connectedCallback
    // resumes both. (The renderer itself is kept — a move within the
    // document must not rebuild the scene.)
    if (this._renderer) this._renderer.setAnimationLoop(null);
    if (this._ro) this._ro.disconnect();
  }

  /** Show (and own) the object. Replaces any previous object, enables
   *  shadows on every mesh, rests it on the ground plane, and frames
   *  the camera to its bounds. */
  setObject(object) {
    if (!this._scene) throw new Error('three-d-stage: not ready — await stage.ready first');
    if (this._object) this._scene.remove(this._object);
    this._object = object;
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const box = new GFX.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      // Rest the object on the ground without moving its origin.
      this._ground.position.y = box.min.y;
      const sphere = box.getBoundingSphere(new GFX.Sphere());
      const dist = (sphere.radius / Math.tan((this._camera.fov * Math.PI) / 360)) * 1.35;
      const dir = new GFX.Vector3(1, 0.55, 1.25).normalize();
      this._camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
      this._camera.near = Math.max(dist / 100, 0.01);
      this._camera.far = dist * 100;
      this._camera.updateProjectionMatrix();
      this._controls.target.copy(sphere.center);
      this._controls.update();
      const span = sphere.radius * 3;
      this._key.shadow.camera.left = -span;
      this._key.shadow.camera.right = span;
      this._key.shadow.camera.top = span;
      this._key.shadow.camera.bottom = -span;
      this._key.shadow.camera.updateProjectionMatrix();
    }
    this._scene.add(object);
  }
}

customElements.define('three-d-stage', ThreeDStage);
