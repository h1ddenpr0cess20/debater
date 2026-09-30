/**
 * Vectors, matrices, rotations, colour and bounds.
 *
 * The scene code was written against three.js, and the numbers it lands on —
 * where a die comes to rest, how tall a debater stands, which way a face
 * points — are only the same if every formula here is the same one. So the
 * API and the arithmetic follow three.js r186 (MIT, © 2010-2025 three.js
 * authors) operation for operation; the storage is column-major throughout.
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const euclideanModulo = (n, m) => ((n % m) + m) % m;
export const lerp = (x, y, t) => (1 - t) * x + t * y;

export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  get width() { return this.x; }
  get height() { return this.y; }

  set(x, y) { this.x = x; this.y = y; return this; }
  setScalar(s) { this.x = s; this.y = s; return this; }
  clone() { return new Vector2(this.x, this.y); }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  negate() { this.x = -this.x; this.y = -this.y; return this; }
  dot(v) { return this.x * v.x + this.y * v.y; }
  cross(v) { return this.x * v.y - this.y * v.x; }
  lengthSq() { return this.x * this.x + this.y * this.y; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  normalize() { return this.divideScalar(this.length() || 1); }
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
  lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; return this; }
  equals(v) { return v.x === this.x && v.y === this.y; }
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; return this; }
  toArray(a = [], o = 0) { a[o] = this.x; a[o + 1] = this.y; return a; }
  fromBufferAttribute(attribute, i) { this.x = attribute.getX(i); this.y = attribute.getY(i); return this; }

  *[Symbol.iterator]() { yield this.x; yield this.y; }
}
Vector2.prototype.isVector2 = true;

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    if (z === undefined) z = this.z;
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  setX(x) { this.x = x; return this; }
  setY(y) { this.y = y; return this; }
  setZ(z) { this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScalar(s) { this.x += s; this.y += s; this.z += s; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subScalar(s) { this.x -= s; this.y -= s; this.z -= s; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiply(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  multiplyVectors(a, b) { this.x = a.x * b.x; this.y = a.y * b.y; this.z = a.z * b.z; return this; }
  divide(v) { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  applyEuler(euler) { return this.applyQuaternion(_quaternion.setFromEuler(euler)); }
  applyAxisAngle(axis, angle) { return this.applyQuaternion(_quaternion.setFromAxisAngle(axis, angle)); }

  applyMatrix3(m) {
    const x = this.x, y = this.y, z = this.z, e = m.elements;
    this.x = e[0] * x + e[3] * y + e[6] * z;
    this.y = e[1] * x + e[4] * y + e[7] * z;
    this.z = e[2] * x + e[5] * y + e[8] * z;
    return this;
  }

  applyNormalMatrix(m) { return this.applyMatrix3(m).normalize(); }

  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z, e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }

  applyQuaternion(q) {
    const vx = this.x, vy = this.y, vz = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    this.x = vx + qw * tx + qy * tz - qz * ty;
    this.y = vy + qw * ty + qz * tx - qx * tz;
    this.z = vz + qw * tz + qx * ty - qy * tx;
    return this;
  }

  project(camera) { return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix); }
  unproject(camera) { return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld); }

  transformDirection(m) {
    const x = this.x, y = this.y, z = this.z, e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }

  min(v) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
  max(v) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }

  clamp(min, max) {
    this.x = clamp(this.x, min.x, max.x);
    this.y = clamp(this.y, min.y, max.y);
    this.z = clamp(this.z, min.z, max.z);
    return this;
  }

  clampLength(min, max) {
    const length = this.length();
    return this.divideScalar(length || 1).multiplyScalar(clamp(length, min, max));
  }

  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize() { return this.divideScalar(this.length() || 1); }
  setLength(length) { return this.normalize().multiplyScalar(length); }

  lerp(v, a) {
    this.x += (v.x - this.x) * a;
    this.y += (v.y - this.y) * a;
    this.z += (v.z - this.z) * a;
    return this;
  }

  lerpVectors(a, b, t) {
    this.x = a.x + (b.x - a.x) * t;
    this.y = a.y + (b.y - a.y) * t;
    this.z = a.z + (b.z - a.z) * t;
    return this;
  }

  cross(v) { return this.crossVectors(this, v); }

  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  projectOnVector(v) {
    const denominator = v.lengthSq();
    if (denominator === 0) return this.set(0, 0, 0);
    const scalar = v.dot(this) / denominator;
    return this.copy(v).multiplyScalar(scalar);
  }

  projectOnPlane(normal) { _vector.copy(this).projectOnVector(normal); return this.sub(_vector); }
  reflect(normal) { return this.sub(_vector.copy(normal).multiplyScalar(2 * this.dot(normal))); }

  angleTo(v) {
    const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (denominator === 0) return Math.PI / 2;
    return Math.acos(clamp(this.dot(v) / denominator, -1, 1));
  }

  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  distanceToSquared(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }

  setFromSpherical(s) { return this.setFromSphericalCoords(s.radius, s.phi, s.theta); }

  setFromSphericalCoords(radius, phi, theta) {
    const sinPhiRadius = Math.sin(phi) * radius;
    this.x = sinPhiRadius * Math.sin(theta);
    this.y = Math.cos(phi) * radius;
    this.z = sinPhiRadius * Math.cos(theta);
    return this;
  }

  setFromMatrixPosition(m) { const e = m.elements; this.x = e[12]; this.y = e[13]; this.z = e[14]; return this; }

  setFromMatrixScale(m) {
    const sx = this.setFromMatrixColumn(m, 0).length();
    const sy = this.setFromMatrixColumn(m, 1).length();
    const sz = this.setFromMatrixColumn(m, 2).length();
    this.x = sx; this.y = sy; this.z = sz;
    return this;
  }

  setFromMatrixColumn(m, index) { return this.fromArray(m.elements, index * 4); }
  setFromMatrix3Column(m, index) { return this.fromArray(m.elements, index * 3); }
  setFromEuler(e) { this.x = e._x; this.y = e._y; this.z = e._z; return this; }
  setFromColor(c) { this.x = c.r; this.y = c.g; this.z = c.b; return this; }
  equals(v) { return v.x === this.x && v.y === this.y && v.z === this.z; }
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; return this; }
  toArray(a = [], o = 0) { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; return a; }

  fromBufferAttribute(attribute, i) {
    this.x = attribute.getX(i);
    this.y = attribute.getY(i);
    this.z = attribute.getZ(i);
    return this;
  }

  *[Symbol.iterator]() { yield this.x; yield this.y; yield this.z; }
}
Vector3.prototype.isVector3 = true;

/** Only what the renderer needs to carry a homogeneous point around. */
export class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x; this.y = y; this.z = z; this.w = w;
  }

  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }

  copy(v) {
    this.x = v.x; this.y = v.y; this.z = v.z;
    this.w = v.w !== undefined ? v.w : 1;
    return this;
  }

  setFromMatrixPosition(m) {
    const e = m.elements;
    this.x = e[12]; this.y = e[13]; this.z = e[14]; this.w = e[15];
    return this;
  }

  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z, w = this.w, e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
    this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;
    return this;
  }
}
Vector4.prototype.isVector4 = true;

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x; this._y = y; this._z = z; this._w = w;
  }

  get x() { return this._x; }
  set x(v) { this._x = v; this._onChangeCallback(); }
  get y() { return this._y; }
  set y(v) { this._y = v; this._onChangeCallback(); }
  get z() { return this._z; }
  set z(v) { this._z = v; this._onChangeCallback(); }
  get w() { return this._w; }
  set w(v) { this._w = v; this._onChangeCallback(); }

  set(x, y, z, w) {
    this._x = x; this._y = y; this._z = z; this._w = w;
    this._onChangeCallback();
    return this;
  }

  clone() { return new Quaternion(this._x, this._y, this._z, this._w); }

  copy(q) {
    this._x = q.x; this._y = q.y; this._z = q.z; this._w = q.w;
    this._onChangeCallback();
    return this;
  }

  /** XYZ is the only order the scenes rotate in. */
  setFromEuler(euler, update = true) {
    const x = euler._x, y = euler._y, z = euler._z, order = euler._order;
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    if (order === 'XYZ') {
      this._x = s1 * c2 * c3 + c1 * s2 * s3;
      this._y = c1 * s2 * c3 - s1 * c2 * s3;
      this._z = c1 * c2 * s3 + s1 * s2 * c3;
      this._w = c1 * c2 * c3 - s1 * s2 * s3;
    } else if (order === 'YXZ') {
      this._x = s1 * c2 * c3 + c1 * s2 * s3;
      this._y = c1 * s2 * c3 - s1 * c2 * s3;
      this._z = c1 * c2 * s3 - s1 * s2 * c3;
      this._w = c1 * c2 * c3 + s1 * s2 * s3;
    } else {
      throw new Error(`gfx: unsupported Euler order ${order}`);
    }
    if (update === true) this._onChangeCallback();
    return this;
  }

  setFromAxisAngle(axis, angle) {
    const halfAngle = angle / 2, s = Math.sin(halfAngle);
    this._x = axis.x * s; this._y = axis.y * s; this._z = axis.z * s;
    this._w = Math.cos(halfAngle);
    this._onChangeCallback();
    return this;
  }

  setFromRotationMatrix(m) {
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m21 = te[1], m22 = te[5], m23 = te[9];
    const m31 = te[2], m32 = te[6], m33 = te[10];
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      this._w = 0.25 / s;
      this._x = (m32 - m23) * s;
      this._y = (m13 - m31) * s;
      this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this._w = (m32 - m23) / s;
      this._x = 0.25 * s;
      this._y = (m12 + m21) / s;
      this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this._w = (m13 - m31) / s;
      this._x = (m12 + m21) / s;
      this._y = 0.25 * s;
      this._z = (m23 + m32) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this._w = (m21 - m12) / s;
      this._x = (m13 + m31) / s;
      this._y = (m23 + m32) / s;
      this._z = 0.25 * s;
    }
    this._onChangeCallback();
    return this;
  }

  setFromUnitVectors(vFrom, vTo) {
    let r = vFrom.dot(vTo) + 1;
    if (r < 1e-8) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this._x = -vFrom.y; this._y = vFrom.x; this._z = 0; this._w = r;
      } else {
        this._x = 0; this._y = -vFrom.z; this._z = vFrom.y; this._w = r;
      }
    } else {
      this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this._w = r;
    }
    return this.normalize();
  }

  identity() { return this.set(0, 0, 0, 1); }
  invert() { return this.conjugate(); }

  conjugate() {
    this._x *= -1; this._y *= -1; this._z *= -1;
    this._onChangeCallback();
    return this;
  }

  dot(v) { return this._x * v._x + this._y * v._y + this._z * v._z + this._w * v._w; }
  lengthSq() { return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w; }
  length() { return Math.sqrt(this.lengthSq()); }

  normalize() {
    let l = this.length();
    if (l === 0) {
      this._x = 0; this._y = 0; this._z = 0; this._w = 1;
    } else {
      l = 1 / l;
      this._x = this._x * l; this._y = this._y * l; this._z = this._z * l; this._w = this._w * l;
    }
    this._onChangeCallback();
    return this;
  }

  multiply(q) { return this.multiplyQuaternions(this, q); }
  premultiply(q) { return this.multiplyQuaternions(q, this); }

  multiplyQuaternions(a, b) {
    const qax = a._x, qay = a._y, qaz = a._z, qaw = a._w;
    const qbx = b._x, qby = b._y, qbz = b._z, qbw = b._w;
    this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._onChangeCallback();
    return this;
  }

  slerp(qb, t) {
    let x = qb._x, y = qb._y, z = qb._z, w = qb._w;
    let dot = this.dot(qb);
    if (dot < 0) { x = -x; y = -y; z = -z; w = -w; dot = -dot; }
    let s = 1 - t;
    if (dot < 0.9995) {
      const theta = Math.acos(dot);
      const sin = Math.sin(theta);
      s = Math.sin(s * theta) / sin;
      t = Math.sin(t * theta) / sin;
      this._x = this._x * s + x * t;
      this._y = this._y * s + y * t;
      this._z = this._z * s + z * t;
      this._w = this._w * s + w * t;
      this._onChangeCallback();
    } else {
      this._x = this._x * s + x * t;
      this._y = this._y * s + y * t;
      this._z = this._z * s + z * t;
      this._w = this._w * s + w * t;
      this.normalize();
    }
    return this;
  }

  equals(q) { return q._x === this._x && q._y === this._y && q._z === this._z && q._w === this._w; }

  fromArray(a, o = 0) {
    this._x = a[o]; this._y = a[o + 1]; this._z = a[o + 2]; this._w = a[o + 3];
    this._onChangeCallback();
    return this;
  }

  toArray(a = [], o = 0) { a[o] = this._x; a[o + 1] = this._y; a[o + 2] = this._z; a[o + 3] = this._w; return a; }

  _onChange(callback) { this._onChangeCallback = callback; return this; }
  _onChangeCallback() {}

  *[Symbol.iterator]() { yield this._x; yield this._y; yield this._z; yield this._w; }
}
Quaternion.prototype.isQuaternion = true;

export class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this._x = x; this._y = y; this._z = z; this._order = order;
  }

  get x() { return this._x; }
  set x(v) { this._x = v; this._onChangeCallback(); }
  get y() { return this._y; }
  set y(v) { this._y = v; this._onChangeCallback(); }
  get z() { return this._z; }
  set z(v) { this._z = v; this._onChangeCallback(); }
  get order() { return this._order; }
  set order(v) { this._order = v; this._onChangeCallback(); }

  set(x, y, z, order = this._order) {
    this._x = x; this._y = y; this._z = z; this._order = order;
    this._onChangeCallback();
    return this;
  }

  clone() { return new Euler(this._x, this._y, this._z, this._order); }

  copy(e) {
    this._x = e._x; this._y = e._y; this._z = e._z; this._order = e._order;
    this._onChangeCallback();
    return this;
  }

  setFromRotationMatrix(m, order = this._order, update = true) {
    const te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8];
    const m22 = te[5], m23 = te[9];
    const m32 = te[6], m33 = te[10];
    const m21 = te[1], m31 = te[2];
    if (order === 'XYZ') {
      this._y = Math.asin(clamp(m13, -1, 1));
      if (Math.abs(m13) < 0.9999999) {
        this._x = Math.atan2(-m23, m33);
        this._z = Math.atan2(-m12, m11);
      } else {
        this._x = Math.atan2(m32, m22);
        this._z = 0;
      }
    } else if (order === 'YXZ') {
      this._x = Math.asin(-clamp(m23, -1, 1));
      if (Math.abs(m23) < 0.9999999) {
        this._y = Math.atan2(m13, m33);
        this._z = Math.atan2(m21, m22);
      } else {
        this._y = Math.atan2(-m31, m11);
        this._z = 0;
      }
    } else {
      throw new Error(`gfx: unsupported Euler order ${order}`);
    }
    this._order = order;
    if (update === true) this._onChangeCallback();
    return this;
  }

  setFromQuaternion(q, order, update) {
    _matrix.makeRotationFromQuaternion(q);
    return this.setFromRotationMatrix(_matrix, order, update);
  }

  equals(e) { return e._x === this._x && e._y === this._y && e._z === this._z && e._order === this._order; }
  toArray(a = [], o = 0) { a[o] = this._x; a[o + 1] = this._y; a[o + 2] = this._z; a[o + 3] = this._order; return a; }

  _onChange(callback) { this._onChangeCallback = callback; return this; }
  _onChangeCallback() {}

  *[Symbol.iterator]() { yield this._x; yield this._y; yield this._z; yield this._order; }
}
Euler.prototype.isEuler = true;

export class Matrix3 {
  constructor() {
    this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  set(n11, n12, n13, n21, n22, n23, n31, n32, n33) {
    const te = this.elements;
    te[0] = n11; te[1] = n21; te[2] = n31;
    te[3] = n12; te[4] = n22; te[5] = n32;
    te[6] = n13; te[7] = n23; te[8] = n33;
    return this;
  }

  identity() { return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1); }

  copy(m) {
    const te = this.elements, me = m.elements;
    for (let i = 0; i < 9; i++) te[i] = me[i];
    return this;
  }

  setFromMatrix4(m) {
    const me = m.elements;
    return this.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10]);
  }

  invert() {
    const te = this.elements;
    const n11 = te[0], n21 = te[1], n31 = te[2];
    const n12 = te[3], n22 = te[4], n32 = te[5];
    const n13 = te[6], n23 = te[7], n33 = te[8];
    const t11 = n33 * n22 - n32 * n23;
    const t12 = n32 * n13 - n33 * n12;
    const t13 = n23 * n12 - n22 * n13;
    const det = n11 * t11 + n21 * t12 + n31 * t13;
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    const detInv = 1 / det;
    te[0] = t11 * detInv;
    te[1] = (n31 * n23 - n33 * n21) * detInv;
    te[2] = (n32 * n21 - n31 * n22) * detInv;
    te[3] = t12 * detInv;
    te[4] = (n33 * n11 - n31 * n13) * detInv;
    te[5] = (n31 * n12 - n32 * n11) * detInv;
    te[6] = t13 * detInv;
    te[7] = (n21 * n13 - n23 * n11) * detInv;
    te[8] = (n22 * n11 - n21 * n12) * detInv;
    return this;
  }

  transpose() {
    const m = this.elements;
    let tmp;
    tmp = m[1]; m[1] = m[3]; m[3] = tmp;
    tmp = m[2]; m[2] = m[6]; m[6] = tmp;
    tmp = m[5]; m[5] = m[7]; m[7] = tmp;
    return this;
  }

  getNormalMatrix(matrix4) { return this.setFromMatrix4(matrix4).invert().transpose(); }

  setUvTransform(tx, ty, sx, sy, rotation, cx, cy) {
    const c = Math.cos(rotation), s = Math.sin(rotation);
    return this.set(
      sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx,
      -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty,
      0, 0, 1,
    );
  }
}
Matrix3.prototype.isMatrix3 = true;

export class Matrix4 {
  constructor() {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
    const te = this.elements;
    te[0] = n11; te[4] = n12; te[8] = n13; te[12] = n14;
    te[1] = n21; te[5] = n22; te[9] = n23; te[13] = n24;
    te[2] = n31; te[6] = n32; te[10] = n33; te[14] = n34;
    te[3] = n41; te[7] = n42; te[11] = n43; te[15] = n44;
    return this;
  }

  identity() { return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); }
  clone() { return new Matrix4().fromArray(this.elements); }

  copy(m) {
    const te = this.elements, me = m.elements;
    for (let i = 0; i < 16; i++) te[i] = me[i];
    return this;
  }

  extractBasis(xAxis, yAxis, zAxis) {
    if (this.determinantAffine() === 0) {
      xAxis.set(1, 0, 0); yAxis.set(0, 1, 0); zAxis.set(0, 0, 1);
      return this;
    }
    xAxis.setFromMatrixColumn(this, 0);
    yAxis.setFromMatrixColumn(this, 1);
    zAxis.setFromMatrixColumn(this, 2);
    return this;
  }

  makeBasis(xAxis, yAxis, zAxis) {
    return this.set(
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      0, 0, 0, 1,
    );
  }

  extractRotation(m) {
    if (m.determinantAffine() === 0) return this.identity();
    const te = this.elements, me = m.elements;
    const scaleX = 1 / _v1.setFromMatrixColumn(m, 0).length();
    const scaleY = 1 / _v1.setFromMatrixColumn(m, 1).length();
    const scaleZ = 1 / _v1.setFromMatrixColumn(m, 2).length();
    te[0] = me[0] * scaleX; te[1] = me[1] * scaleX; te[2] = me[2] * scaleX; te[3] = 0;
    te[4] = me[4] * scaleY; te[5] = me[5] * scaleY; te[6] = me[6] * scaleY; te[7] = 0;
    te[8] = me[8] * scaleZ; te[9] = me[9] * scaleZ; te[10] = me[10] * scaleZ; te[11] = 0;
    te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
    return this;
  }

  makeRotationFromEuler(euler) {
    const te = this.elements;
    const x = euler.x, y = euler.y, z = euler.z;
    const a = Math.cos(x), b = Math.sin(x);
    const c = Math.cos(y), d = Math.sin(y);
    const e = Math.cos(z), f = Math.sin(z);
    if (euler.order === 'XYZ') {
      const ae = a * e, af = a * f, be = b * e, bf = b * f;
      te[0] = c * e; te[4] = -c * f; te[8] = d;
      te[1] = af + be * d; te[5] = ae - bf * d; te[9] = -b * c;
      te[2] = bf - ae * d; te[6] = be + af * d; te[10] = a * c;
    } else {
      throw new Error(`gfx: unsupported Euler order ${euler.order}`);
    }
    te[3] = 0; te[7] = 0; te[11] = 0;
    te[12] = 0; te[13] = 0; te[14] = 0; te[15] = 1;
    return this;
  }

  makeRotationFromQuaternion(q) { return this.compose(_zero, q, _one); }

  lookAt(eye, target, up) {
    const te = this.elements;
    _z.subVectors(eye, target);
    if (_z.lengthSq() === 0) _z.z = 1;
    _z.normalize();
    _x.crossVectors(up, _z);
    if (_x.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) _z.x += 0.0001;
      else _z.z += 0.0001;
      _z.normalize();
      _x.crossVectors(up, _z);
    }
    _x.normalize();
    _y.crossVectors(_z, _x);
    te[0] = _x.x; te[4] = _y.x; te[8] = _z.x;
    te[1] = _x.y; te[5] = _y.y; te[9] = _z.y;
    te[2] = _x.z; te[6] = _y.z; te[10] = _z.z;
    return this;
  }

  multiply(m) { return this.multiplyMatrices(this, m); }
  premultiply(m) { return this.multiplyMatrices(m, this); }

  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }

  determinant() {
    const te = this.elements;
    const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12];
    const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
    const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14];
    const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
    const t11 = n23 * n34 - n24 * n33;
    const t12 = n22 * n34 - n24 * n32;
    const t13 = n22 * n33 - n23 * n32;
    const t21 = n21 * n34 - n24 * n31;
    const t22 = n21 * n33 - n23 * n31;
    const t23 = n21 * n32 - n22 * n31;
    return n11 * (n42 * t11 - n43 * t12 + n44 * t13)
      - n12 * (n41 * t11 - n43 * t21 + n44 * t22)
      + n13 * (n41 * t12 - n42 * t21 + n44 * t23)
      - n14 * (n41 * t13 - n42 * t22 + n43 * t23);
  }

  determinantAffine() {
    const te = this.elements;
    const n11 = te[0], n12 = te[4], n13 = te[8];
    const n21 = te[1], n22 = te[5], n23 = te[9];
    const n31 = te[2], n32 = te[6], n33 = te[10];
    return n11 * (n22 * n33 - n23 * n32) - n12 * (n21 * n33 - n23 * n31) + n13 * (n21 * n32 - n22 * n31);
  }

  setPosition(x, y, z) {
    const te = this.elements;
    if (x.isVector3) { te[12] = x.x; te[13] = x.y; te[14] = x.z; }
    else { te[12] = x; te[13] = y; te[14] = z; }
    return this;
  }

  invert() {
    const te = this.elements;
    const n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3];
    const n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7];
    const n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11];
    const n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
    const t1 = n11 * n22 - n21 * n12;
    const t2 = n11 * n32 - n31 * n12;
    const t3 = n11 * n42 - n41 * n12;
    const t4 = n21 * n32 - n31 * n22;
    const t5 = n21 * n42 - n41 * n22;
    const t6 = n31 * n42 - n41 * n32;
    const t7 = n13 * n24 - n23 * n14;
    const t8 = n13 * n34 - n33 * n14;
    const t9 = n13 * n44 - n43 * n14;
    const t10 = n23 * n34 - n33 * n24;
    const t11 = n23 * n44 - n43 * n24;
    const t12 = n33 * n44 - n43 * n34;
    const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const detInv = 1 / det;
    te[0] = (n22 * t12 - n32 * t11 + n42 * t10) * detInv;
    te[1] = (n31 * t11 - n21 * t12 - n41 * t10) * detInv;
    te[2] = (n24 * t6 - n34 * t5 + n44 * t4) * detInv;
    te[3] = (n33 * t5 - n23 * t6 - n43 * t4) * detInv;
    te[4] = (n32 * t9 - n12 * t12 - n42 * t8) * detInv;
    te[5] = (n11 * t12 - n31 * t9 + n41 * t8) * detInv;
    te[6] = (n34 * t3 - n14 * t6 - n44 * t2) * detInv;
    te[7] = (n13 * t6 - n33 * t3 + n43 * t2) * detInv;
    te[8] = (n12 * t11 - n22 * t9 + n42 * t7) * detInv;
    te[9] = (n21 * t9 - n11 * t11 - n41 * t7) * detInv;
    te[10] = (n14 * t5 - n24 * t3 + n44 * t1) * detInv;
    te[11] = (n23 * t3 - n13 * t5 - n43 * t1) * detInv;
    te[12] = (n22 * t8 - n12 * t10 - n32 * t7) * detInv;
    te[13] = (n11 * t10 - n21 * t8 + n31 * t7) * detInv;
    te[14] = (n24 * t2 - n14 * t4 - n34 * t1) * detInv;
    te[15] = (n13 * t4 - n23 * t2 + n33 * t1) * detInv;
    return this;
  }

  getMaxScaleOnAxis() {
    const te = this.elements;
    const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
    const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
    const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];
    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }

  makeTranslation(x, y, z) {
    if (x.isVector3) return this.set(1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1);
    return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
  }

  makeRotationX(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
  }

  makeRotationY(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1);
  }

  makeRotationZ(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }

  makeScale(x, y, z) { return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1); }

  compose(position, quaternion, scale) {
    const te = this.elements;
    const x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    te[0] = (1 - (yy + zz)) * sx; te[1] = (xy + wz) * sx; te[2] = (xz - wy) * sx; te[3] = 0;
    te[4] = (xy - wz) * sy; te[5] = (1 - (xx + zz)) * sy; te[6] = (yz + wx) * sy; te[7] = 0;
    te[8] = (xz + wy) * sz; te[9] = (yz - wx) * sz; te[10] = (1 - (xx + yy)) * sz; te[11] = 0;
    te[12] = position.x; te[13] = position.y; te[14] = position.z; te[15] = 1;
    return this;
  }

  decompose(position, quaternion, scale) {
    const te = this.elements;
    position.x = te[12]; position.y = te[13]; position.z = te[14];
    const det = this.determinantAffine();
    if (det === 0) {
      scale.set(1, 1, 1);
      quaternion.identity();
      return this;
    }
    let sx = _v1.set(te[0], te[1], te[2]).length();
    const sy = _v1.set(te[4], te[5], te[6]).length();
    const sz = _v1.set(te[8], te[9], te[10]).length();
    if (det < 0) sx = -sx;
    _m1.copy(this);
    const invSX = 1 / sx, invSY = 1 / sy, invSZ = 1 / sz;
    const me = _m1.elements;
    me[0] *= invSX; me[1] *= invSX; me[2] *= invSX;
    me[4] *= invSY; me[5] *= invSY; me[6] *= invSY;
    me[8] *= invSZ; me[9] *= invSZ; me[10] *= invSZ;
    quaternion.setFromRotationMatrix(_m1);
    scale.x = sx; scale.y = sy; scale.z = sz;
    return this;
  }

  /** OpenGL's clip space, z in −1..1. The WebGPU backend remaps it on upload. */
  makePerspective(left, right, top, bottom, near, far) {
    const te = this.elements;
    const x = 2 * near / (right - left);
    const y = 2 * near / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    const c = -(far + near) / (far - near);
    const d = (-2 * far * near) / (far - near);
    te[0] = x; te[4] = 0; te[8] = a; te[12] = 0;
    te[1] = 0; te[5] = y; te[9] = b; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = -1; te[15] = 0;
    return this;
  }

  makeOrthographic(left, right, top, bottom, near, far) {
    const te = this.elements;
    const x = 2 / (right - left);
    const y = 2 / (top - bottom);
    const a = -(right + left) / (right - left);
    const b = -(top + bottom) / (top - bottom);
    const c = -2 / (far - near);
    const d = -(far + near) / (far - near);
    te[0] = x; te[4] = 0; te[8] = 0; te[12] = a;
    te[1] = 0; te[5] = y; te[9] = 0; te[13] = b;
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return this;
  }

  equals(m) {
    for (let i = 0; i < 16; i++) if (this.elements[i] !== m.elements[i]) return false;
    return true;
  }

  fromArray(a, o = 0) {
    for (let i = 0; i < 16; i++) this.elements[i] = a[i + o];
    return this;
  }

  toArray(a = [], o = 0) {
    for (let i = 0; i < 16; i++) a[o + i] = this.elements[i];
    return a;
  }
}
Matrix4.prototype.isMatrix4 = true;

export function SRGBToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

export function LinearToSRGB(c) {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

/**
 * Colour, held linear. Hex and CSS inputs are sRGB and are decoded on the way
 * in; `setRGB` and `setHSL` take working (linear) values as they are — which
 * is what the scenes that paint vertex colours in HSL were tuned against.
 */
export class Color {
  constructor(r, g, b) {
    this.r = 1; this.g = 1; this.b = 1;
    return this.set(r, g, b);
  }

  set(r, g, b) {
    if (g === undefined && b === undefined) {
      const value = r;
      if (value && value.isColor) this.copy(value);
      else if (typeof value === 'number') this.setHex(value);
      else if (typeof value === 'string') this.setStyle(value);
    } else {
      this.setRGB(r, g, b);
    }
    return this;
  }

  setScalar(s) { this.r = s; this.g = s; this.b = s; return this; }

  setHex(hex) {
    hex = Math.floor(hex);
    this.r = SRGBToLinear((hex >> 16 & 255) / 255);
    this.g = SRGBToLinear((hex >> 8 & 255) / 255);
    this.b = SRGBToLinear((hex & 255) / 255);
    return this;
  }

  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }

  setHSL(h, s, l) {
    h = euclideanModulo(h, 1);
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    if (s === 0) {
      this.r = this.g = this.b = l;
    } else {
      const p = l <= 0.5 ? l * (1 + s) : l + s - (l * s);
      const q = (2 * l) - p;
      this.r = hue2rgb(q, p, h + 1 / 3);
      this.g = hue2rgb(q, p, h);
      this.b = hue2rgb(q, p, h - 1 / 3);
    }
    return this;
  }

  /** `#rgb`, `#rrggbb` and `rgb(r, g, b)` — the forms the scenes use. */
  setStyle(style) {
    let m = /^#([A-Fa-f\d]+)$/.exec(style);
    if (m) {
      const hex = m[1];
      if (hex.length === 6) return this.setHex(parseInt(hex, 16));
      if (hex.length === 3) {
        return this.setRGB(
          SRGBToLinear(parseInt(hex.charAt(0), 16) / 15),
          SRGBToLinear(parseInt(hex.charAt(1), 16) / 15),
          SRGBToLinear(parseInt(hex.charAt(2), 16) / 15),
        );
      }
    }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/.exec(style);
    if (m) {
      return this.setRGB(
        SRGBToLinear(Math.min(255, parseInt(m[1], 10)) / 255),
        SRGBToLinear(Math.min(255, parseInt(m[2], 10)) / 255),
        SRGBToLinear(Math.min(255, parseInt(m[3], 10)) / 255),
      );
    }
    throw new Error(`gfx: unsupported colour ${style}`);
  }

  clone() { return new Color(this.r, this.g, this.b); }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }

  getHex() {
    return Math.round(clamp(LinearToSRGB(this.r) * 255, 0, 255)) * 65536
      + Math.round(clamp(LinearToSRGB(this.g) * 255, 0, 255)) * 256
      + Math.round(clamp(LinearToSRGB(this.b) * 255, 0, 255));
  }

  getHexString() { return ('000000' + this.getHex().toString(16)).slice(-6); }
  add(c) { this.r += c.r; this.g += c.g; this.b += c.b; return this; }
  multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }

  lerp(c, a) {
    this.r += (c.r - this.r) * a;
    this.g += (c.g - this.g) * a;
    this.b += (c.b - this.b) * a;
    return this;
  }

  lerpColors(c1, c2, a) {
    this.r = c1.r + (c2.r - c1.r) * a;
    this.g = c1.g + (c2.g - c1.g) * a;
    this.b = c1.b + (c2.b - c1.b) * a;
    return this;
  }

  equals(c) { return c.r === this.r && c.g === this.g && c.b === this.b; }
  toArray(a = [], o = 0) { a[o] = this.r; a[o + 1] = this.g; a[o + 2] = this.b; return a; }

  *[Symbol.iterator]() { yield this.r; yield this.g; yield this.b; }
}
Color.prototype.isColor = true;

export class Box3 {
  constructor(min = new Vector3(+Infinity, +Infinity, +Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min;
    this.max = max;
  }

  set(min, max) { this.min.copy(min); this.max.copy(max); return this; }

  setFromArray(array) {
    this.makeEmpty();
    for (let i = 0, il = array.length; i < il; i += 3) this.expandByPoint(_vector.fromArray(array, i));
    return this;
  }

  setFromBufferAttribute(attribute) {
    this.makeEmpty();
    for (let i = 0, il = attribute.count; i < il; i++) this.expandByPoint(_vector.fromBufferAttribute(attribute, i));
    return this;
  }

  setFromPoints(points) {
    this.makeEmpty();
    for (let i = 0, il = points.length; i < il; i++) this.expandByPoint(points[i]);
    return this;
  }

  setFromCenterAndSize(center, size) {
    const halfSize = _vector.copy(size).multiplyScalar(0.5);
    this.min.copy(center).sub(halfSize);
    this.max.copy(center).add(halfSize);
    return this;
  }

  setFromObject(object) {
    this.makeEmpty();
    return this.expandByObject(object);
  }

  clone() { return new Box3().copy(this); }
  copy(box) { this.min.copy(box.min); this.max.copy(box.max); return this; }

  makeEmpty() {
    this.min.x = this.min.y = this.min.z = +Infinity;
    this.max.x = this.max.y = this.max.z = -Infinity;
    return this;
  }

  isEmpty() { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }

  getCenter(target) {
    return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }

  getSize(target) { return this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min); }
  expandByPoint(point) { this.min.min(point); this.max.max(point); return this; }
  expandByVector(v) { this.min.sub(v); this.max.add(v); return this; }
  expandByScalar(s) { this.min.addScalar(-s); this.max.addScalar(s); return this; }

  /** Each part's own bounds, carried into the world — not a hull of the vertices. */
  expandByObject(object) {
    object.updateWorldMatrix(false, false);
    const geometry = object.geometry;
    if (geometry !== undefined) {
      if (geometry.boundingBox === null) geometry.computeBoundingBox();
      _box.copy(geometry.boundingBox);
      _box.applyMatrix4(object.matrixWorld);
      this.union(_box);
    }
    const children = object.children;
    for (let i = 0, l = children.length; i < l; i++) this.expandByObject(children[i]);
    return this;
  }

  containsPoint(p) {
    return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y
      && p.z >= this.min.z && p.z <= this.max.z;
  }

  intersectsBox(box) {
    return box.max.x >= this.min.x && box.min.x <= this.max.x && box.max.y >= this.min.y
      && box.min.y <= this.max.y && box.max.z >= this.min.z && box.min.z <= this.max.z;
  }

  intersectsSphere(sphere) {
    this.clampPoint(sphere.center, _vector);
    return _vector.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius;
  }

  clampPoint(point, target) { return target.copy(point).clamp(this.min, this.max); }
  distanceToPoint(point) { return this.clampPoint(point, _vector).distanceTo(point); }

  getBoundingSphere(target) {
    if (this.isEmpty()) {
      target.makeEmpty();
    } else {
      this.getCenter(target.center);
      target.radius = this.getSize(_vector).length() * 0.5;
    }
    return target;
  }

  intersect(box) {
    this.min.max(box.min);
    this.max.min(box.max);
    if (this.isEmpty()) this.makeEmpty();
    return this;
  }

  union(box) { this.min.min(box.min); this.max.max(box.max); return this; }

  applyMatrix4(matrix) {
    if (this.isEmpty()) return this;
    _points[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(matrix);
    _points[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(matrix);
    _points[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(matrix);
    _points[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(matrix);
    _points[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(matrix);
    _points[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(matrix);
    _points[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(matrix);
    _points[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(matrix);
    this.setFromPoints(_points);
    return this;
  }

  translate(offset) { this.min.add(offset); this.max.add(offset); return this; }
  equals(box) { return box.min.equals(this.min) && box.max.equals(this.max); }
}
Box3.prototype.isBox3 = true;

export class Sphere {
  constructor(center = new Vector3(), radius = -1) {
    this.center = center;
    this.radius = radius;
  }

  set(center, radius) { this.center.copy(center); this.radius = radius; return this; }

  setFromPoints(points, optionalCenter) {
    const center = this.center;
    if (optionalCenter !== undefined) center.copy(optionalCenter);
    else _box.setFromPoints(points).getCenter(center);
    let maxRadiusSq = 0;
    for (let i = 0, il = points.length; i < il; i++) {
      maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(points[i]));
    }
    this.radius = Math.sqrt(maxRadiusSq);
    return this;
  }

  clone() { return new Sphere().copy(this); }
  copy(s) { this.center.copy(s.center); this.radius = s.radius; return this; }
  isEmpty() { return this.radius < 0; }
  makeEmpty() { this.center.set(0, 0, 0); this.radius = -1; return this; }
  containsPoint(p) { return p.distanceToSquared(this.center) <= this.radius * this.radius; }
  distanceToPoint(p) { return p.distanceTo(this.center) - this.radius; }

  applyMatrix4(matrix) {
    this.center.applyMatrix4(matrix);
    this.radius = this.radius * matrix.getMaxScaleOnAxis();
    return this;
  }

  translate(offset) { this.center.add(offset); return this; }
}
Sphere.prototype.isSphere = true;

export class Plane {
  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal;
    this.constant = constant;
  }

  set(normal, constant) { this.normal.copy(normal); this.constant = constant; return this; }
  setComponents(x, y, z, w) { this.normal.set(x, y, z); this.constant = w; return this; }

  setFromNormalAndCoplanarPoint(normal, point) {
    this.normal.copy(normal);
    this.constant = -point.dot(this.normal);
    return this;
  }

  copy(p) { this.normal.copy(p.normal); this.constant = p.constant; return this; }

  normalize() {
    const inverseNormalLength = 1.0 / this.normal.length();
    this.normal.multiplyScalar(inverseNormalLength);
    this.constant *= inverseNormalLength;
    return this;
  }

  negate() { this.constant *= -1; this.normal.negate(); return this; }
  distanceToPoint(p) { return this.normal.dot(p) + this.constant; }

  projectPoint(point, target) {
    return target.copy(point).addScaledVector(this.normal, -this.distanceToPoint(point));
  }

  coplanarPoint(target) { return target.copy(this.normal).multiplyScalar(-this.constant); }
}
Plane.prototype.isPlane = true;

export class Ray {
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }

  set(origin, direction) { this.origin.copy(origin); this.direction.copy(direction); return this; }
  copy(ray) { this.origin.copy(ray.origin); this.direction.copy(ray.direction); return this; }
  at(t, target) { return target.copy(this.origin).addScaledVector(this.direction, t); }
  recast(t) { this.origin.copy(this.at(t, _vector)); return this; }

  distanceSqToPoint(point) {
    const directionDistance = _vector.subVectors(point, this.origin).dot(this.direction);
    if (directionDistance < 0) return this.origin.distanceToSquared(point);
    _vector.copy(this.origin).addScaledVector(this.direction, directionDistance);
    return _vector.distanceToSquared(point);
  }

  intersectSphere(sphere, target) {
    if (sphere.radius < 0) return null;
    _vector.subVectors(sphere.center, this.origin);
    const tca = _vector.dot(this.direction);
    const d2 = _vector.dot(_vector) - tca * tca;
    const radius2 = sphere.radius * sphere.radius;
    if (d2 > radius2) return null;
    const thc = Math.sqrt(radius2 - d2);
    const t0 = tca - thc;
    const t1 = tca + thc;
    if (t1 < 0) return null;
    if (t0 < 0) return this.at(t1, target);
    return this.at(t0, target);
  }

  intersectsSphere(sphere) {
    if (sphere.radius < 0) return false;
    return this.distanceSqToPoint(sphere.center) <= sphere.radius * sphere.radius;
  }

  distanceToPlane(plane) {
    const denominator = plane.normal.dot(this.direction);
    if (denominator === 0) return plane.distanceToPoint(this.origin) === 0 ? 0 : null;
    const t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;
    return t >= 0 ? t : null;
  }

  intersectPlane(plane, target) {
    const t = this.distanceToPlane(plane);
    return t === null ? null : this.at(t, target);
  }

  intersectBox(box, target) {
    let tmin, tmax, tymin, tymax, tzmin, tzmax;
    const invdirx = 1 / this.direction.x, invdiry = 1 / this.direction.y, invdirz = 1 / this.direction.z;
    const origin = this.origin;
    if (invdirx >= 0) {
      tmin = (box.min.x - origin.x) * invdirx;
      tmax = (box.max.x - origin.x) * invdirx;
    } else {
      tmin = (box.max.x - origin.x) * invdirx;
      tmax = (box.min.x - origin.x) * invdirx;
    }
    if (invdiry >= 0) {
      tymin = (box.min.y - origin.y) * invdiry;
      tymax = (box.max.y - origin.y) * invdiry;
    } else {
      tymin = (box.max.y - origin.y) * invdiry;
      tymax = (box.min.y - origin.y) * invdiry;
    }
    if (tmin > tymax || tymin > tmax) return null;
    if (tymin > tmin || isNaN(tmin)) tmin = tymin;
    if (tymax < tmax || isNaN(tmax)) tmax = tymax;
    if (invdirz >= 0) {
      tzmin = (box.min.z - origin.z) * invdirz;
      tzmax = (box.max.z - origin.z) * invdirz;
    } else {
      tzmin = (box.max.z - origin.z) * invdirz;
      tzmax = (box.min.z - origin.z) * invdirz;
    }
    if (tmin > tzmax || tzmin > tmax) return null;
    if (tzmin > tmin || tmin !== tmin) tmin = tzmin;
    if (tzmax < tmax || tmax !== tmax) tmax = tzmax;
    if (tmax < 0) return null;
    return this.at(tmin >= 0 ? tmin : tmax, target);
  }

  intersectsBox(box) { return this.intersectBox(box, _vector) !== null; }

  intersectTriangle(a, b, c, backfaceCulling, target) {
    const origin = this.origin, direction = this.direction;
    const dx = direction.x, dy = direction.y, dz = direction.z;
    const aox = a.x - origin.x, aoy = a.y - origin.y, aoz = a.z - origin.z;
    const box = b.x - origin.x, boy = b.y - origin.y, boz = b.z - origin.z;
    const cox = c.x - origin.x, coy = c.y - origin.y, coz = c.z - origin.z;
    const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
    let dkx, dky, dkz, akx, aky, akz, bkx, bky, bkz, ckx, cky, ckz;
    if (adx >= ady && adx >= adz) {
      dkz = dx; akz = aox; bkz = box; ckz = cox;
      if (dx >= 0) {
        dkx = dy; dky = dz;
        akx = aoy; aky = aoz; bkx = boy; bky = boz; ckx = coy; cky = coz;
      } else {
        dkx = dz; dky = dy;
        akx = aoz; aky = aoy; bkx = boz; bky = boy; ckx = coz; cky = coy;
      }
    } else if (ady >= adz) {
      dkz = dy; akz = aoy; bkz = boy; ckz = coy;
      if (dy >= 0) {
        dkx = dz; dky = dx;
        akx = aoz; aky = aox; bkx = boz; bky = box; ckx = coz; cky = cox;
      } else {
        dkx = dx; dky = dz;
        akx = aox; aky = aoz; bkx = box; bky = boz; ckx = cox; cky = coz;
      }
    } else {
      dkz = dz; akz = aoz; bkz = boz; ckz = coz;
      if (dz >= 0) {
        dkx = dx; dky = dy;
        akx = aox; aky = aoy; bkx = box; bky = boy; ckx = cox; cky = coy;
      } else {
        dkx = dy; dky = dx;
        akx = aoy; aky = aox; bkx = boy; bky = box; ckx = coy; cky = cox;
      }
    }
    if (dkz === 0) return null;
    const sx = dkx / dkz, sy = dky / dkz, sz = 1 / dkz;
    const ax = akx - sx * akz, ay = aky - sy * akz;
    const bx = bkx - sx * bkz, by = bky - sy * bkz;
    const cx = ckx - sx * ckz, cy = cky - sy * ckz;
    const u = cx * by - cy * bx;
    const v = ax * cy - ay * cx;
    const w = bx * ay - by * ax;
    if (backfaceCulling) {
      if (u < 0 || v < 0 || w < 0) return null;
    } else if ((u < 0 || v < 0 || w < 0) && (u > 0 || v > 0 || w > 0)) {
      return null;
    }
    const det = u + v + w;
    if (det === 0) return null;
    const tScaled = sz * (u * akz + v * bkz + w * ckz);
    if (det > 0 ? tScaled < 0 : tScaled > 0) return null;
    return this.at(tScaled / det, target);
  }

  applyMatrix4(m) {
    this.origin.applyMatrix4(m);
    this.direction.transformDirection(m);
    return this;
  }
}

export class Frustum {
  constructor() {
    this.planes = [new Plane(), new Plane(), new Plane(), new Plane(), new Plane(), new Plane()];
  }

  setFromProjectionMatrix(m) {
    const planes = this.planes, me = m.elements;
    const me0 = me[0], me1 = me[1], me2 = me[2], me3 = me[3];
    const me4 = me[4], me5 = me[5], me6 = me[6], me7 = me[7];
    const me8 = me[8], me9 = me[9], me10 = me[10], me11 = me[11];
    const me12 = me[12], me13 = me[13], me14 = me[14], me15 = me[15];
    planes[0].setComponents(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize();
    planes[1].setComponents(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize();
    planes[2].setComponents(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize();
    planes[3].setComponents(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize();
    planes[4].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize();
    planes[5].setComponents(me3 + me2, me7 + me6, me11 + me10, me15 + me14).normalize();
    return this;
  }

  intersectsObject(object) {
    const geometry = object.geometry;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    _sphere.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld);
    return this.intersectsSphere(_sphere);
  }

  intersectsSprite(sprite) {
    _sphere.center.set(0, 0, 0);
    _sphere.radius = 0.7071067811865476 + _spriteCenter.distanceTo(sprite.center);
    _sphere.applyMatrix4(sprite.matrixWorld);
    return this.intersectsSphere(_sphere);
  }

  intersectsSphere(sphere) {
    const center = sphere.center, negRadius = -sphere.radius;
    for (let i = 0; i < 6; i++) {
      if (this.planes[i].distanceToPoint(center) < negRadius) return false;
    }
    return true;
  }
}

export class Spherical {
  constructor(radius = 1, phi = 0, theta = 0) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
  }

  set(radius, phi, theta) { this.radius = radius; this.phi = phi; this.theta = theta; return this; }

  makeSafe() {
    const EPS = 0.000001;
    this.phi = clamp(this.phi, EPS, Math.PI - EPS);
    return this;
  }

  setFromVector3(v) { return this.setFromCartesianCoords(v.x, v.y, v.z); }

  setFromCartesianCoords(x, y, z) {
    this.radius = Math.sqrt(x * x + y * y + z * z);
    if (this.radius === 0) {
      this.theta = 0;
      this.phi = 0;
    } else {
      this.theta = Math.atan2(x, z);
      this.phi = Math.acos(clamp(y / this.radius, -1, 1));
    }
    return this;
  }
}

const _vector = new Vector3();
const _v1 = new Vector3();
const _quaternion = new Quaternion();
const _matrix = new Matrix4();
const _m1 = new Matrix4();
const _zero = new Vector3(0, 0, 0);
const _one = new Vector3(1, 1, 1);
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _box = new Box3();
const _sphere = new Sphere();
const _spriteCenter = new Vector2(0.5, 0.5);
const _points = Array.from({ length: 8 }, () => new Vector3());
