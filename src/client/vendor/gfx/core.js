/**
 * The scene graph: objects, geometry buffers, cameras, lights, materials and
 * textures. Plain data — nothing here touches the DOM or a GPU, so the rigs
 * can be built and measured under Node. The renderers read it.
 *
 * The shapes of these objects, and the order things happen in (world
 * matrices, bounds, normals), follow three.js r186 (MIT, © 2010-2025 three.js
 * authors), which is what the scenes were written against.
 */

import {
  Box3, Color, Euler, Frustum, Matrix3, Matrix4, Quaternion, Ray, Sphere, Vector2, Vector3,
} from './math.js';

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

export const NoBlending = 0;
export const NormalBlending = 1;
export const AdditiveBlending = 2;

export const NoColorSpace = '';
export const SRGBColorSpace = 'srgb';
export const LinearSRGBColorSpace = 'srgb-linear';

export const UVMapping = 300;
export const EquirectangularReflectionMapping = 303;
export const CubeUVReflectionMapping = 306;

export const LinearFilter = 1006;
export const LinearMipmapLinearFilter = 1008;
export const ClampToEdgeWrapping = 1001;

export const PCFShadowMap = 1;

export class EventDispatcher {
  addEventListener(type, listener) {
    if (this._listeners === undefined) this._listeners = {};
    const listeners = this._listeners;
    if (listeners[type] === undefined) listeners[type] = [];
    if (listeners[type].indexOf(listener) === -1) listeners[type].push(listener);
  }

  hasEventListener(type, listener) {
    const listeners = this._listeners;
    return listeners !== undefined && listeners[type] !== undefined && listeners[type].indexOf(listener) !== -1;
  }

  removeEventListener(type, listener) {
    const listenerArray = this._listeners?.[type];
    if (listenerArray === undefined) return;
    const index = listenerArray.indexOf(listener);
    if (index !== -1) listenerArray.splice(index, 1);
  }

  dispatchEvent(event) {
    const listenerArray = this._listeners?.[event.type];
    if (listenerArray === undefined) return;
    event.target = this;
    for (const listener of listenerArray.slice(0)) listener.call(this, event);
    event.target = null;
  }
}

export class Layers {
  constructor() { this.mask = 1; }
  test(layers) { return (this.mask & layers.mask) !== 0; }
}

let objectId = 0;
const _v1 = new Vector3();
const _q1 = new Quaternion();
const _m1 = new Matrix4();
const _target = new Vector3();
const _position = new Vector3();
const _xAxis = new Vector3(1, 0, 0);
const _yAxis = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);

export class Object3D extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, 'id', { value: objectId++ });
    this.name = '';
    this.type = 'Object3D';
    this.parent = null;
    this.children = [];
    this.up = Object3D.DEFAULT_UP.clone();

    const position = new Vector3();
    const rotation = new Euler();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    rotation._onChange(() => quaternion.setFromEuler(rotation, false));
    quaternion._onChange(() => rotation.setFromQuaternion(quaternion, undefined, false));

    Object.defineProperties(this, {
      position: { configurable: true, enumerable: true, value: position },
      rotation: { configurable: true, enumerable: true, value: rotation },
      quaternion: { configurable: true, enumerable: true, value: quaternion },
      scale: { configurable: true, enumerable: true, value: scale },
      modelViewMatrix: { value: new Matrix4() },
      normalMatrix: { value: new Matrix3() },
    });

    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.matrixAutoUpdate = true;
    this.matrixWorldAutoUpdate = true;
    this.matrixWorldNeedsUpdate = false;
    this.layers = new Layers();
    this.visible = true;
    this.castShadow = false;
    this.receiveShadow = false;
    this.frustumCulled = true;
    this.renderOrder = 0;
    this.userData = {};
  }

  /** Called with (renderer, scene, camera, geometry, material, group) just before this draws. */
  onBeforeRender() {}
  onAfterRender() {}

  applyMatrix4(matrix) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    this.matrix.premultiply(matrix);
    this.matrix.decompose(this.position, this.quaternion, this.scale);
  }

  applyQuaternion(q) { this.quaternion.premultiply(q); return this; }
  setRotationFromAxisAngle(axis, angle) { this.quaternion.setFromAxisAngle(axis, angle); }
  setRotationFromMatrix(m) { this.quaternion.setFromRotationMatrix(m); }

  rotateOnAxis(axis, angle) {
    _q1.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(_q1);
    return this;
  }

  rotateOnWorldAxis(axis, angle) {
    _q1.setFromAxisAngle(axis, angle);
    this.quaternion.premultiply(_q1);
    return this;
  }

  rotateX(angle) { return this.rotateOnAxis(_xAxis, angle); }
  rotateY(angle) { return this.rotateOnAxis(_yAxis, angle); }
  rotateZ(angle) { return this.rotateOnAxis(_zAxis, angle); }

  translateOnAxis(axis, distance) {
    _v1.copy(axis).applyQuaternion(this.quaternion);
    this.position.add(_v1.multiplyScalar(distance));
    return this;
  }

  localToWorld(vector) {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(this.matrixWorld);
  }

  worldToLocal(vector) {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(_m1.copy(this.matrixWorld).invert());
  }

  lookAt(x, y, z) {
    if (x.isVector3) _target.copy(x);
    else _target.set(x, y, z);
    const parent = this.parent;
    this.updateWorldMatrix(true, false);
    _position.setFromMatrixPosition(this.matrixWorld);
    if (this.isCamera || this.isLight) _m1.lookAt(_position, _target, this.up);
    else _m1.lookAt(_target, _position, this.up);
    this.quaternion.setFromRotationMatrix(_m1);
    if (parent) {
      _m1.extractRotation(parent.matrixWorld);
      _q1.setFromRotationMatrix(_m1);
      this.quaternion.premultiply(_q1.invert());
    }
  }

  add(object) {
    if (arguments.length > 1) {
      for (let i = 0; i < arguments.length; i++) this.add(arguments[i]);
      return this;
    }
    if (object === this || !(object && object.isObject3D)) return this;
    object.removeFromParent();
    object.parent = this;
    this.children.push(object);
    object.dispatchEvent({ type: 'added' });
    return this;
  }

  remove(object) {
    if (arguments.length > 1) {
      for (let i = 0; i < arguments.length; i++) this.remove(arguments[i]);
      return this;
    }
    const index = this.children.indexOf(object);
    if (index !== -1) {
      object.parent = null;
      this.children.splice(index, 1);
      object.dispatchEvent({ type: 'removed' });
    }
    return this;
  }

  removeFromParent() {
    if (this.parent !== null) this.parent.remove(this);
    return this;
  }

  clear() { return this.remove(...this.children); }

  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      const object = child.getObjectByName(name);
      if (object !== undefined) return object;
    }
    return undefined;
  }

  getWorldPosition(target) {
    this.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.matrixWorld);
  }

  getWorldQuaternion(target) {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_position, target, _v1);
    return target;
  }

  getWorldDirection(target) {
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    return target.set(e[8], e[9], e[10]).normalize();
  }

  raycast() {}

  traverse(callback) {
    callback(this);
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) children[i].traverse(callback);
  }

  traverseVisible(callback) {
    if (this.visible === false) return;
    callback(this);
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) children[i].traverseVisible(callback);
  }

  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }

  updateMatrixWorld(force) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) children[i].updateMatrixWorld(force);
  }

  updateWorldMatrix(updateParents, updateChildren, force = false) {
    const parent = this.parent;
    if (updateParents === true && parent !== null) parent.updateWorldMatrix(true, false);
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    if (updateChildren === true) {
      const children = this.children;
      for (let i = 0, l = children.length; i < l; i++) children[i].updateWorldMatrix(false, true, force);
    }
  }
}
Object3D.DEFAULT_UP = new Vector3(0, 1, 0);
Object3D.prototype.isObject3D = true;

export class Group extends Object3D {
  constructor() {
    super();
    this.type = 'Group';
  }
}
Group.prototype.isGroup = true;

export class Scene extends Object3D {
  constructor() {
    super();
    this.type = 'Scene';
    /** The prefiltered studio the physical materials reflect — from a PMREMGenerator. */
    this.environment = null;
  }
}
Scene.prototype.isScene = true;

// ---------------------------------------------------------------- geometry

export class BufferAttribute {
  constructor(array, itemSize, normalized = false) {
    if (Array.isArray(array)) throw new TypeError('gfx: BufferAttribute wants a typed array');
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.normalized = normalized;
    this.version = 0;
  }

  set needsUpdate(value) { if (value === true) this.version++; }

  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  getW(i) { return this.array[i * this.itemSize + 3]; }
  setX(i, x) { this.array[i * this.itemSize] = x; return this; }
  setY(i, y) { this.array[i * this.itemSize + 1] = y; return this; }
  setZ(i, z) { this.array[i * this.itemSize + 2] = z; return this; }

  setXY(i, x, y) {
    i *= this.itemSize;
    this.array[i] = x; this.array[i + 1] = y;
    return this;
  }

  setXYZ(i, x, y, z) {
    i *= this.itemSize;
    this.array[i] = x; this.array[i + 1] = y; this.array[i + 2] = z;
    return this;
  }

  applyMatrix4(m) {
    for (let i = 0, l = this.count; i < l; i++) {
      _v1.fromBufferAttribute(this, i).applyMatrix4(m);
      this.setXYZ(i, _v1.x, _v1.y, _v1.z);
    }
    return this;
  }

  applyNormalMatrix(m) {
    for (let i = 0, l = this.count; i < l; i++) {
      _v1.fromBufferAttribute(this, i).applyNormalMatrix(m);
      this.setXYZ(i, _v1.x, _v1.y, _v1.z);
    }
    return this;
  }

  clone() { return new BufferAttribute(this.array.slice(), this.itemSize, this.normalized); }
}
BufferAttribute.prototype.isBufferAttribute = true;

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized) { super(new Float32Array(array), itemSize, normalized); }
}

export class Uint16BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized) { super(new Uint16Array(array), itemSize, normalized); }
}

export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize, normalized) { super(new Uint32Array(array), itemSize, normalized); }
}

function arrayNeedsUint32(array) {
  for (let i = array.length - 1; i >= 0; --i) if (array[i] >= 65535) return true;
  return false;
}

let geometryId = 0;
const _box = new Box3();
const _vector = new Vector3();

export class BufferGeometry extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, 'id', { value: geometryId++ });
    this.type = 'BufferGeometry';
    this.index = null;
    this.attributes = {};
    this.groups = [];
    this.boundingBox = null;
    this.boundingSphere = null;
    this.drawRange = { start: 0, count: Infinity };
  }

  getIndex() { return this.index; }

  setIndex(index) {
    if (Array.isArray(index)) {
      this.index = new (arrayNeedsUint32(index) ? Uint32BufferAttribute : Uint16BufferAttribute)(index, 1);
    } else {
      this.index = index;
    }
    return this;
  }

  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  deleteAttribute(name) { delete this.attributes[name]; return this; }
  hasAttribute(name) { return this.attributes[name] !== undefined; }
  addGroup(start, count, materialIndex = 0) { this.groups.push({ start, count, materialIndex }); }
  clearGroups() { this.groups = []; }
  setDrawRange(start, count) { this.drawRange.start = start; this.drawRange.count = count; }

  applyMatrix4(matrix) {
    const position = this.attributes.position;
    if (position !== undefined) {
      position.applyMatrix4(matrix);
      position.needsUpdate = true;
    }
    const normal = this.attributes.normal;
    if (normal !== undefined) {
      normal.applyNormalMatrix(new Matrix3().getNormalMatrix(matrix));
      normal.needsUpdate = true;
    }
    if (this.boundingBox !== null) this.computeBoundingBox();
    if (this.boundingSphere !== null) this.computeBoundingSphere();
    return this;
  }

  rotateX(angle) { return this.applyMatrix4(_m1.makeRotationX(angle)); }
  rotateY(angle) { return this.applyMatrix4(_m1.makeRotationY(angle)); }
  rotateZ(angle) { return this.applyMatrix4(_m1.makeRotationZ(angle)); }
  translate(x, y, z) { return this.applyMatrix4(_m1.makeTranslation(x, y, z)); }
  scale(x, y, z) { return this.applyMatrix4(_m1.makeScale(x, y, z)); }

  computeBoundingBox() {
    if (this.boundingBox === null) this.boundingBox = new Box3();
    const position = this.attributes.position;
    if (position !== undefined) this.boundingBox.setFromBufferAttribute(position);
    else this.boundingBox.makeEmpty();
  }

  computeBoundingSphere() {
    if (this.boundingSphere === null) this.boundingSphere = new Sphere();
    const position = this.attributes.position;
    if (!position) return;
    const center = this.boundingSphere.center;
    _box.setFromBufferAttribute(position);
    _box.getCenter(center);
    let maxRadiusSq = 0;
    for (let i = 0, il = position.count; i < il; i++) {
      _vector.fromBufferAttribute(position, i);
      maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
    }
    this.boundingSphere.radius = Math.sqrt(maxRadiusSq);
  }

  /** Area-weighted and summed in the attribute's own float32, as three does. */
  computeVertexNormals() {
    const index = this.index;
    const positionAttribute = this.getAttribute('position');
    if (positionAttribute === undefined) return;
    let normalAttribute = this.getAttribute('normal');
    if (normalAttribute === undefined || normalAttribute.count !== positionAttribute.count) {
      normalAttribute = new BufferAttribute(new Float32Array(positionAttribute.count * 3), 3);
      this.setAttribute('normal', normalAttribute);
    } else {
      normalAttribute.array.fill(0);
    }
    const pA = new Vector3(), pB = new Vector3(), pC = new Vector3();
    const nA = new Vector3(), nB = new Vector3(), nC = new Vector3();
    const cb = new Vector3(), ab = new Vector3();
    if (index) {
      for (let i = 0, il = index.count; i < il; i += 3) {
        const vA = index.getX(i + 0), vB = index.getX(i + 1), vC = index.getX(i + 2);
        pA.fromBufferAttribute(positionAttribute, vA);
        pB.fromBufferAttribute(positionAttribute, vB);
        pC.fromBufferAttribute(positionAttribute, vC);
        cb.subVectors(pC, pB);
        ab.subVectors(pA, pB);
        cb.cross(ab);
        nA.fromBufferAttribute(normalAttribute, vA);
        nB.fromBufferAttribute(normalAttribute, vB);
        nC.fromBufferAttribute(normalAttribute, vC);
        nA.add(cb); nB.add(cb); nC.add(cb);
        normalAttribute.setXYZ(vA, nA.x, nA.y, nA.z);
        normalAttribute.setXYZ(vB, nB.x, nB.y, nB.z);
        normalAttribute.setXYZ(vC, nC.x, nC.y, nC.z);
      }
    } else {
      for (let i = 0, il = positionAttribute.count; i < il; i += 3) {
        pA.fromBufferAttribute(positionAttribute, i + 0);
        pB.fromBufferAttribute(positionAttribute, i + 1);
        pC.fromBufferAttribute(positionAttribute, i + 2);
        cb.subVectors(pC, pB);
        ab.subVectors(pA, pB);
        cb.cross(ab);
        normalAttribute.setXYZ(i + 0, cb.x, cb.y, cb.z);
        normalAttribute.setXYZ(i + 1, cb.x, cb.y, cb.z);
        normalAttribute.setXYZ(i + 2, cb.x, cb.y, cb.z);
      }
    }
    this.normalizeNormals();
    normalAttribute.needsUpdate = true;
  }

  normalizeNormals() {
    const normals = this.attributes.normal;
    for (let i = 0, il = normals.count; i < il; i++) {
      _vector.fromBufferAttribute(normals, i).normalize();
      normals.setXYZ(i, _vector.x, _vector.y, _vector.z);
    }
  }

  toNonIndexed() {
    if (this.index === null) return this;
    const indices = this.index.array;
    const geometry = new BufferGeometry();
    for (const name in this.attributes) {
      const { array, itemSize, normalized } = this.attributes[name];
      const out = new array.constructor(indices.length * itemSize);
      let k = 0;
      for (let i = 0, l = indices.length; i < l; i++) {
        let index = indices[i] * itemSize;
        for (let j = 0; j < itemSize; j++) out[k++] = array[index++];
      }
      geometry.setAttribute(name, new BufferAttribute(out, itemSize, normalized));
    }
    for (const group of this.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    return geometry;
  }

  dispose() { this.dispatchEvent({ type: 'dispose' }); }
}
BufferGeometry.prototype.isBufferGeometry = true;

// ---------------------------------------------------------------- drawables

const _inverseMatrix = new Matrix4();
const _ray = new Ray();
const _sphere = new Sphere();
const _sphereHitAt = new Vector3();
const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();
const _intersectionPoint = new Vector3();
const _intersectionPointWorld = new Vector3();

function triangleNormal(a, b, c, target) {
  target.subVectors(c, b);
  _v1.subVectors(a, b);
  target.cross(_v1);
  const lengthSq = target.lengthSq();
  return lengthSq > 0 ? target.multiplyScalar(1 / Math.sqrt(lengthSq)) : target.set(0, 0, 0);
}

function checkIntersection(object, material, raycaster, ray, a, b, c) {
  object.getVertexPosition(a, _vA);
  object.getVertexPosition(b, _vB);
  object.getVertexPosition(c, _vC);
  const hit = material.side === BackSide
    ? ray.intersectTriangle(_vC, _vB, _vA, true, _intersectionPoint)
    : ray.intersectTriangle(_vA, _vB, _vC, material.side === FrontSide, _intersectionPoint);
  if (hit === null) return null;
  _intersectionPointWorld.copy(_intersectionPoint).applyMatrix4(object.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(_intersectionPointWorld);
  if (distance < raycaster.near || distance > raycaster.far) return null;
  const face = { a, b, c, normal: new Vector3(), materialIndex: 0 };
  triangleNormal(_vA, _vB, _vC, face.normal);
  return { distance, point: _intersectionPointWorld.clone(), object, face };
}

export class Mesh extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) {
    super();
    this.type = 'Mesh';
    this.geometry = geometry;
    this.material = material;
  }

  getVertexPosition(index, target) {
    return target.fromBufferAttribute(this.geometry.attributes.position, index);
  }

  raycast(raycaster, intersects) {
    const geometry = this.geometry;
    const material = this.material;
    const matrixWorld = this.matrixWorld;
    if (material === undefined) return;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    _sphere.copy(geometry.boundingSphere).applyMatrix4(matrixWorld);
    _ray.copy(raycaster.ray).recast(raycaster.near);
    if (_sphere.containsPoint(_ray.origin) === false) {
      if (_ray.intersectSphere(_sphere, _sphereHitAt) === null) return;
      if (_ray.origin.distanceToSquared(_sphereHitAt) > (raycaster.far - raycaster.near) ** 2) return;
    }
    _inverseMatrix.copy(matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inverseMatrix);
    if (geometry.boundingBox !== null && _ray.intersectsBox(geometry.boundingBox) === false) return;

    const index = geometry.index;
    const position = geometry.attributes.position;
    const drawRange = geometry.drawRange;
    const count = index !== null ? index.count : position.count;
    const vertex = index !== null ? (i) => index.getX(i) : (i) => i;
    const spans = Array.isArray(material)
      ? geometry.groups.map((g) => ({ material: material[g.materialIndex], group: g,
        start: Math.max(g.start, drawRange.start),
        end: Math.min(count, Math.min(g.start + g.count, drawRange.start + drawRange.count)) }))
      : [{ material, group: null, start: Math.max(0, drawRange.start),
        end: Math.min(count, drawRange.start + drawRange.count) }];
    for (const span of spans) {
      for (let i = span.start; i < span.end; i += 3) {
        const hit = checkIntersection(this, span.material, raycaster, _ray, vertex(i), vertex(i + 1), vertex(i + 2));
        if (hit) {
          hit.faceIndex = Math.floor(i / 3);
          if (span.group) hit.face.materialIndex = span.group.materialIndex;
          intersects.push(hit);
        }
      }
    }
  }
}
Mesh.prototype.isMesh = true;

export class Line extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new LineBasicMaterial()) {
    super();
    this.type = 'Line';
    this.geometry = geometry;
    this.material = material;
  }
}
Line.prototype.isLine = true;

export class LineSegments extends Line {
  constructor(geometry, material) {
    super(geometry, material);
    this.type = 'LineSegments';
  }
}
LineSegments.prototype.isLineSegments = true;

let spriteGeometry = null;

/** One unit quad in the xy plane, turned to face the camera in the vertex shader. */
function getSpriteGeometry() {
  if (spriteGeometry === null) {
    spriteGeometry = new BufferGeometry();
    spriteGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    spriteGeometry.setAttribute('position', new Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    spriteGeometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  }
  return spriteGeometry;
}

export class Sprite extends Object3D {
  constructor(material = new SpriteMaterial()) {
    super();
    this.type = 'Sprite';
    this.geometry = getSpriteGeometry();
    this.material = material;
    this.center = new Vector2(0.5, 0.5);
  }
}
Sprite.prototype.isSprite = true;

export class Raycaster {
  constructor(origin, direction, near = 0, far = Infinity) {
    this.ray = new Ray(origin, direction);
    this.near = near;
    this.far = far;
    this.camera = null;
    this.layers = new Layers();
  }

  set(origin, direction) { this.ray.set(origin, direction); }

  setFromCamera(coords, camera) {
    if (camera.isPerspectiveCamera) {
      this.ray.origin.setFromMatrixPosition(camera.matrixWorld);
      this.ray.direction.set(coords.x, coords.y, 0.5).unproject(camera).sub(this.ray.origin).normalize();
    } else {
      this.ray.origin.set(coords.x, coords.y, camera.projectionMatrix.elements[14]).unproject(camera);
      this.ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
    }
    this.camera = camera;
  }

  intersectObject(object, recursive = true, intersects = []) {
    intersect(object, this, intersects, recursive);
    intersects.sort((a, b) => a.distance - b.distance);
    return intersects;
  }

  intersectObjects(objects, recursive = true, intersects = []) {
    for (const object of objects) intersect(object, this, intersects, recursive);
    intersects.sort((a, b) => a.distance - b.distance);
    return intersects;
  }
}

function intersect(object, raycaster, intersects, recursive) {
  if (object.layers.test(raycaster.layers)) object.raycast(raycaster, intersects);
  if (recursive === true) {
    for (const child of object.children) intersect(child, raycaster, intersects, true);
  }
}

// ---------------------------------------------------------------- cameras

export class Camera extends Object3D {
  constructor() {
    super();
    this.type = 'Camera';
    this.matrixWorldInverse = new Matrix4();
    this.projectionMatrix = new Matrix4();
    this.projectionMatrixInverse = new Matrix4();
  }

  getWorldDirection(target) { return super.getWorldDirection(target).negate(); }

  updateMatrixWorld(force) {
    super.updateMatrixWorld(force);
    this._updateInverse();
  }

  updateWorldMatrix(updateParents, updateChildren, force = false) {
    super.updateWorldMatrix(updateParents, updateChildren, force);
    this._updateInverse();
  }

  /** The view matrix ignores whatever scale rounding has crept into the world matrix. */
  _updateInverse() {
    this.matrixWorld.decompose(_position, _q1, _v1);
    if (_v1.x === 1 && _v1.y === 1 && _v1.z === 1) {
      this.matrixWorldInverse.copy(this.matrixWorld).invert();
    } else {
      this.matrixWorldInverse.compose(_position, _q1, _v1.set(1, 1, 1)).invert();
    }
  }
}
Camera.prototype.isCamera = true;

export class PerspectiveCamera extends Camera {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.type = 'PerspectiveCamera';
    this.fov = fov;
    this.zoom = 1;
    this.near = near;
    this.far = far;
    this.aspect = aspect;
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix() {
    const near = this.near;
    const top = near * Math.tan((Math.PI / 180) * 0.5 * this.fov) / this.zoom;
    const height = 2 * top;
    const width = this.aspect * height;
    const left = -0.5 * width;
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
PerspectiveCamera.prototype.isPerspectiveCamera = true;

export class OrthographicCamera extends Camera {
  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super();
    this.type = 'OrthographicCamera';
    this.zoom = 1;
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix() {
    const dx = (this.right - this.left) / (2 * this.zoom);
    const dy = (this.top - this.bottom) / (2 * this.zoom);
    const cx = (this.right + this.left) / 2;
    const cy = (this.top + this.bottom) / 2;
    this.projectionMatrix.makeOrthographic(cx - dx, cx + dx, cy + dy, cy - dy, this.near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
OrthographicCamera.prototype.isOrthographicCamera = true;

// ---------------------------------------------------------------- lights

export class Light extends Object3D {
  constructor(color, intensity = 1) {
    super();
    this.type = 'Light';
    this.color = new Color(color);
    this.intensity = intensity;
  }
}
Light.prototype.isLight = true;

export class AmbientLight extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.type = 'AmbientLight';
  }
}
AmbientLight.prototype.isAmbientLight = true;

export class HemisphereLight extends Light {
  constructor(skyColor, groundColor, intensity) {
    super(skyColor, intensity);
    this.type = 'HemisphereLight';
    this.position.copy(Object3D.DEFAULT_UP);
    this.updateMatrix();
    this.groundColor = new Color(groundColor);
  }
}
HemisphereLight.prototype.isHemisphereLight = true;

/**
 * The directional light's shadow: an orthographic camera looking from the
 * light at its target, a depth map `mapSize` square, and the matrix that maps
 * a world position into that map's [0, 1] texture space.
 */
export class DirectionalLightShadow {
  constructor() {
    this.camera = new OrthographicCamera(-5, 5, 5, -5, 0.5, 500);
    this.intensity = 1;
    this.bias = 0;
    this.normalBias = 0;
    this.radius = 1;
    this.mapSize = new Vector2(512, 512);
    this.matrix = new Matrix4();
    this.frustum = new Frustum();
  }

  updateMatrices(light) {
    const camera = this.camera;
    _position.setFromMatrixPosition(light.matrixWorld);
    camera.position.copy(_position);
    _target.setFromMatrixPosition(light.target.matrixWorld);
    camera.lookAt(_target);
    camera.updateMatrixWorld();
    _m1.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_m1);
    this.matrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    this.matrix.multiply(_m1);
  }
}

export class DirectionalLight extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.type = 'DirectionalLight';
    this.position.copy(Object3D.DEFAULT_UP);
    this.updateMatrix();
    this.target = new Object3D();
    this.shadow = new DirectionalLightShadow();
  }
}
DirectionalLight.prototype.isDirectionalLight = true;

export class PointLight extends Light {
  constructor(color, intensity, distance = 0, decay = 2) {
    super(color, intensity);
    this.type = 'PointLight';
    this.distance = distance;
    this.decay = decay;
  }
}
PointLight.prototype.isPointLight = true;

// ---------------------------------------------------------------- textures

let textureId = 0;

export class Texture extends EventDispatcher {
  constructor(image = null) {
    super();
    Object.defineProperty(this, 'id', { value: textureId++ });
    this.name = '';
    this.image = image;
    this.mapping = UVMapping;
    this.wrapS = ClampToEdgeWrapping;
    this.wrapT = ClampToEdgeWrapping;
    this.magFilter = LinearFilter;
    this.minFilter = LinearMipmapLinearFilter;
    this.anisotropy = 1;
    this.flipY = true;
    this.premultiplyAlpha = false;
    this.generateMipmaps = true;
    this.colorSpace = NoColorSpace;
    this.offset = new Vector2(0, 0);
    this.repeat = new Vector2(1, 1);
    this.center = new Vector2(0, 0);
    this.rotation = 0;
    this.matrix = new Matrix3();
    this.version = 0;
  }

  set needsUpdate(value) { if (value === true) this.version++; }

  updateMatrix() {
    this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y,
      this.rotation, this.center.x, this.center.y);
  }

  dispose() { this.dispatchEvent({ type: 'dispose' }); }
}
Texture.prototype.isTexture = true;

export class CanvasTexture extends Texture {
  constructor(canvas) {
    super(canvas);
    this.needsUpdate = true;
  }
}
CanvasTexture.prototype.isCanvasTexture = true;

/** Raw texels: `data` is a typed array, rows bottom-up, never flipped. */
export class DataTexture extends Texture {
  constructor(data, width, height, format = 'rgba8unorm') {
    super({ data, width, height });
    this.format = format;
    this.flipY = false;
    this.generateMipmaps = false;
    this.minFilter = LinearFilter;
  }
}
DataTexture.prototype.isDataTexture = true;

// ---------------------------------------------------------------- materials

let materialId = 0;

export class Material extends EventDispatcher {
  constructor() {
    super();
    Object.defineProperty(this, 'id', { value: materialId++ });
    this.name = '';
    this.type = 'Material';
    this.blending = NormalBlending;
    this.side = FrontSide;
    this.vertexColors = false;
    this.opacity = 1;
    this.transparent = false;
    this.depthTest = true;
    this.depthWrite = true;
    this.colorWrite = true;
    this.alphaTest = 0;
    this.premultipliedAlpha = false;
    this.forceSinglePass = false;
    this.toneMapped = true;
    this.visible = true;
    this.userData = {};
    this.version = 0;
  }

  set needsUpdate(value) { if (value === true) this.version++; }

  setValues(values) {
    if (values === undefined) return;
    for (const key in values) {
      const newValue = values[key];
      if (newValue === undefined) continue;
      const currentValue = this[key];
      if (currentValue && currentValue.isColor) currentValue.set(newValue);
      else if (currentValue && currentValue.isVector2 && newValue && newValue.isVector2) currentValue.copy(newValue);
      else this[key] = newValue;
    }
  }

  dispose() { this.dispatchEvent({ type: 'dispose' }); }
}
Material.prototype.isMaterial = true;

export class MeshBasicMaterial extends Material {
  constructor(parameters) {
    super();
    this.type = 'MeshBasicMaterial';
    this.color = new Color(0xffffff);
    this.map = null;
    this.setValues(parameters);
  }
}
MeshBasicMaterial.prototype.isMeshBasicMaterial = true;

export class MeshStandardMaterial extends Material {
  constructor(parameters) {
    super();
    this.type = 'MeshStandardMaterial';
    this.color = new Color(0xffffff);
    this.roughness = 1.0;
    this.metalness = 0.0;
    this.map = null;
    this.emissive = new Color(0x000000);
    this.emissiveIntensity = 1.0;
    this.bumpMap = null;
    this.bumpScale = 1;
    this.envMapIntensity = 1.0;
    this.flatShading = false;
    this.setValues(parameters);
  }
}
MeshStandardMaterial.prototype.isMeshStandardMaterial = true;

export class MeshPhysicalMaterial extends MeshStandardMaterial {
  constructor(parameters) {
    super();
    this.type = 'MeshPhysicalMaterial';
    this.clearcoat = 0;
    this.clearcoatRoughness = 0.0;
    this.ior = 1.5;
    this.iridescence = 0;
    this.iridescenceIOR = 1.3;
    this.iridescenceThicknessRange = [100, 400];
    this.sheen = 0;
    this.sheenColor = new Color(0x000000);
    this.sheenRoughness = 1.0;
    this.transmission = 0;
    this.thickness = 0;
    this.attenuationDistance = Infinity;
    this.attenuationColor = new Color(1, 1, 1);
    this.specularIntensity = 1.0;
    this.specularColor = new Color(1, 1, 1);
    this.setValues(parameters);
  }
}
MeshPhysicalMaterial.prototype.isMeshPhysicalMaterial = true;

export class ShadowMaterial extends Material {
  constructor(parameters) {
    super();
    this.type = 'ShadowMaterial';
    this.color = new Color(0x000000);
    this.transparent = true;
    this.setValues(parameters);
  }
}
ShadowMaterial.prototype.isShadowMaterial = true;

export class LineBasicMaterial extends Material {
  constructor(parameters) {
    super();
    this.type = 'LineBasicMaterial';
    this.color = new Color(0xffffff);
    this.setValues(parameters);
  }
}
LineBasicMaterial.prototype.isLineBasicMaterial = true;

export class SpriteMaterial extends Material {
  constructor(parameters) {
    super();
    this.type = 'SpriteMaterial';
    this.color = new Color(0xffffff);
    this.map = null;
    this.rotation = 0;
    this.transparent = true;
    this.setValues(parameters);
  }
}
SpriteMaterial.prototype.isSpriteMaterial = true;

/**
 * A material whose shading is written by hand — once for each backend, since
 * each speaks its own shading language:
 *
 *   glsl: { vertex, fragment }  GLSL ES 3.00 in the old-style dialect
 *         (`varying`, `gl_FragColor`). `position`, `normal`, `uv` and the
 *         object matrices (modelMatrix, modelViewMatrix, viewMatrix,
 *         projectionMatrix, normalMatrix, cameraPosition) are declared for
 *         you; declare the entries of `uniforms` yourself.
 *   wgsl: a WGSL module with entry points `vs` and `fs`. The vertex inputs
 *         are `@location(0) position`, `@location(1) normal` and
 *         `@location(2) uv`; the matrices arrive as `object` (see
 *         `Object` in shaders/wgsl.js) and the entries of `uniforms`, in
 *         declaration order, as the fields of `material`.
 *
 * Whatever comes out is written as it is: no colour-space conversion, as
 * with any hand-written shader.
 */
export class ShaderMaterial extends Material {
  constructor(parameters) {
    super();
    this.type = 'ShaderMaterial';
    this.uniforms = {};
    this.glsl = null;
    this.wgsl = null;
    this.setValues(parameters);
  }
}
ShaderMaterial.prototype.isShaderMaterial = true;

// ---------------------------------------------------------------- time

/** Frame time in seconds between `update()` calls. */
export class Timer {
  constructor() {
    this._previousTime = 0;
    this._currentTime = 0;
    this._startTime = performance.now();
    this._delta = 0;
    this._elapsed = 0;
  }

  getDelta() { return this._delta / 1000; }
  getElapsed() { return this._elapsed / 1000; }

  update(timestamp) {
    this._previousTime = this._currentTime;
    this._currentTime = (timestamp !== undefined ? timestamp : performance.now()) - this._startTime;
    this._delta = this._currentTime - this._previousTime;
    this._elapsed += this._delta;
    return this;
  }
}

/** Seconds since the last `getDelta()`; the first call starts it and returns 0. */
export class Clock {
  constructor(autoStart = true) {
    this.autoStart = autoStart;
    this.startTime = 0;
    this.oldTime = 0;
    this.elapsedTime = 0;
    this.running = false;
  }

  start() {
    this.startTime = performance.now();
    this.oldTime = this.startTime;
    this.elapsedTime = 0;
    this.running = true;
  }

  getElapsedTime() {
    this.getDelta();
    return this.elapsedTime;
  }

  getDelta() {
    let diff = 0;
    if (this.autoStart && !this.running) {
      this.start();
      return 0;
    }
    if (this.running) {
      const newTime = performance.now();
      diff = (newTime - this.oldTime) / 1000;
      this.oldTime = newTime;
      this.elapsedTime += diff;
    }
    return diff;
  }
}
