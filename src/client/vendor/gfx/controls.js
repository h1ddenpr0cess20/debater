/**
 * Orbit, dolly and pan around a target: drag to orbit, wheel or pinch to
 * zoom, right-drag or two fingers to pan. The feel — damping, speeds, the
 * polar clamp — is three.js r186's OrbitControls (MIT, © 2010-2025 three.js
 * authors), because the scenes were framed and tuned under it.
 */

import { EventDispatcher } from './core.js';
import { Quaternion, Spherical, Vector2, Vector3 } from './math.js';

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };
const _v = new Vector3();
const _twoPI = 2 * Math.PI;
const _EPS = 0.000001;

const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_DOLLY_PAN: 5 };

export class OrbitControls extends EventDispatcher {
  constructor(object, domElement) {
    super();
    this.object = object;
    this.enabled = true;
    this.state = STATE.NONE;
    this.target = new Vector3();
    this.minDistance = 0;
    this.maxDistance = Infinity;
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;
    this.minAzimuthAngle = -Infinity;
    this.maxAzimuthAngle = Infinity;
    this.enableDamping = false;
    this.dampingFactor = 0.05;
    this.enableZoom = true;
    this.zoomSpeed = 1.0;
    this.enableRotate = true;
    this.rotateSpeed = 1.0;
    this.enablePan = true;
    this.panSpeed = 1.0;
    this.autoRotate = false;
    this.autoRotateSpeed = 2.0;

    this._lastPosition = new Vector3();
    this._lastQuaternion = new Quaternion();
    this._lastTargetPosition = new Vector3();
    this._quat = new Quaternion().setFromUnitVectors(object.up, new Vector3(0, 1, 0));
    this._quatInverse = this._quat.clone().invert();
    this._spherical = new Spherical();
    this._sphericalDelta = new Spherical();
    this._scale = 1;
    this._panOffset = new Vector3();
    this._rotateStart = new Vector2();
    this._rotateEnd = new Vector2();
    this._rotateDelta = new Vector2();
    this._panStart = new Vector2();
    this._panEnd = new Vector2();
    this._panDelta = new Vector2();
    this._dollyStart = new Vector2();
    this._dollyEnd = new Vector2();
    this._dollyDelta = new Vector2();
    this._pointers = [];
    this._pointerPositions = {};
    this._controlActive = false;

    this._onPointerMove = onPointerMove.bind(this);
    this._onPointerDown = onPointerDown.bind(this);
    this._onPointerUp = onPointerUp.bind(this);
    this._onContextMenu = onContextMenu.bind(this);
    this._onMouseWheel = onMouseWheel.bind(this);
    this._onControlDown = (event) => {
      if (event.key !== 'Control') return;
      this._controlActive = true;
      this.domElement.getRootNode().addEventListener('keyup', this._onControlUp, { passive: true, capture: true });
    };
    this._onControlUp = (event) => {
      if (event.key !== 'Control') return;
      this._controlActive = false;
      this.domElement.getRootNode().removeEventListener('keyup', this._onControlUp, { passive: true, capture: true });
    };

    this.domElement = null;
    if (domElement) this.connect(domElement);

    this.update();
  }

  /** Start listening for input on `element` (the constructor does this for its element). */
  connect(element) {
    if (this.domElement) this.disconnect();
    this.domElement = element;
    element.addEventListener('pointerdown', this._onPointerDown);
    element.addEventListener('pointercancel', this._onPointerUp);
    element.addEventListener('contextmenu', this._onContextMenu);
    element.addEventListener('wheel', this._onMouseWheel, { passive: false });
    element.getRootNode().addEventListener('keydown', this._onControlDown, { passive: true, capture: true });
    element.style.touchAction = 'none';
  }

  getPolarAngle() { return this._spherical.phi; }
  getAzimuthalAngle() { return this._spherical.theta; }
  getDistance() { return this.object.position.distanceTo(this.target); }

  /** Stop listening for input. */
  disconnect() {
    const element = this.domElement;
    if (!element) return;
    element.removeEventListener('pointerdown', this._onPointerDown);
    element.ownerDocument.removeEventListener('pointermove', this._onPointerMove);
    element.ownerDocument.removeEventListener('pointerup', this._onPointerUp);
    element.removeEventListener('pointercancel', this._onPointerUp);
    element.removeEventListener('wheel', this._onMouseWheel);
    element.removeEventListener('contextmenu', this._onContextMenu);
    element.getRootNode().removeEventListener('keydown', this._onControlDown, { capture: true });
    element.getRootNode().removeEventListener('keyup', this._onControlUp, { capture: true });
    element.style.touchAction = '';
    this._pointers.length = 0;
    this._pointerPositions = {};
    this.state = STATE.NONE;
  }

  dispose() {
    this.disconnect();
  }

  update(deltaTime = null) {
    const position = this.object.position;
    _v.copy(position).sub(this.target);
    _v.applyQuaternion(this._quat);
    this._spherical.setFromVector3(_v);

    if (this.autoRotate && this.state === STATE.NONE) this._rotateLeft(this._getAutoRotationAngle(deltaTime));

    if (this.enableDamping) {
      this._spherical.theta += this._sphericalDelta.theta * this.dampingFactor;
      this._spherical.phi += this._sphericalDelta.phi * this.dampingFactor;
    } else {
      this._spherical.theta += this._sphericalDelta.theta;
      this._spherical.phi += this._sphericalDelta.phi;
    }

    let min = this.minAzimuthAngle;
    let max = this.maxAzimuthAngle;
    if (isFinite(min) && isFinite(max)) {
      if (min < -Math.PI) min += _twoPI; else if (min > Math.PI) min -= _twoPI;
      if (max < -Math.PI) max += _twoPI; else if (max > Math.PI) max -= _twoPI;
      if (min <= max) {
        this._spherical.theta = Math.max(min, Math.min(max, this._spherical.theta));
      } else {
        this._spherical.theta = this._spherical.theta > (min + max) / 2
          ? Math.max(min, this._spherical.theta) : Math.min(max, this._spherical.theta);
      }
    }

    this._spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._spherical.phi));
    this._spherical.makeSafe();

    if (this.enableDamping === true) this.target.addScaledVector(this._panOffset, this.dampingFactor);
    else this.target.add(this._panOffset);

    const prevRadius = this._spherical.radius;
    this._spherical.radius = this._clampDistance(this._spherical.radius * this._scale);
    const zoomChanged = prevRadius != this._spherical.radius;

    _v.setFromSpherical(this._spherical);
    _v.applyQuaternion(this._quatInverse);
    position.copy(this.target).add(_v);
    this.object.lookAt(this.target);

    if (this.enableDamping === true) {
      this._sphericalDelta.theta *= (1 - this.dampingFactor);
      this._sphericalDelta.phi *= (1 - this.dampingFactor);
      this._panOffset.multiplyScalar(1 - this.dampingFactor);
    } else {
      this._sphericalDelta.set(0, 0, 0);
      this._panOffset.set(0, 0, 0);
    }
    this._scale = 1;

    if (zoomChanged
      || this._lastPosition.distanceToSquared(this.object.position) > _EPS
      || 8 * (1 - this._lastQuaternion.dot(this.object.quaternion)) > _EPS
      || this._lastTargetPosition.distanceToSquared(this.target) > _EPS) {
      this.dispatchEvent(_changeEvent);
      this._lastPosition.copy(this.object.position);
      this._lastQuaternion.copy(this.object.quaternion);
      this._lastTargetPosition.copy(this.target);
      return true;
    }
    return false;
  }

  _getAutoRotationAngle(deltaTime) {
    if (deltaTime !== null) return (_twoPI / 60 * this.autoRotateSpeed) * deltaTime;
    return _twoPI / 60 / 60 * this.autoRotateSpeed;
  }

  _getZoomScale(delta) {
    const normalizedDelta = Math.abs(delta * 0.01);
    return Math.pow(0.95, this.zoomSpeed * normalizedDelta);
  }

  _rotateLeft(angle) { this._sphericalDelta.theta -= angle; }
  _rotateUp(angle) { this._sphericalDelta.phi -= angle; }

  _panLeft(distance, objectMatrix) {
    _v.setFromMatrixColumn(objectMatrix, 0);
    _v.multiplyScalar(-distance);
    this._panOffset.add(_v);
  }

  _panUp(distance, objectMatrix) {
    _v.setFromMatrixColumn(objectMatrix, 1);
    _v.multiplyScalar(distance);
    this._panOffset.add(_v);
  }

  _pan(deltaX, deltaY) {
    const element = this.domElement;
    _v.copy(this.object.position).sub(this.target);
    let targetDistance = _v.length();
    targetDistance *= Math.tan((this.object.fov / 2) * Math.PI / 180.0);
    this._panLeft(2 * deltaX * targetDistance / element.clientHeight, this.object.matrix);
    this._panUp(2 * deltaY * targetDistance / element.clientHeight, this.object.matrix);
  }

  _dollyOut(dollyScale) { this._scale /= dollyScale; }
  _dollyIn(dollyScale) { this._scale *= dollyScale; }
  _clampDistance(dist) { return Math.max(this.minDistance, Math.min(this.maxDistance, dist)); }

  _handleMoveRotate(x, y) {
    this._rotateEnd.set(x, y);
    this._rotateDelta.subVectors(this._rotateEnd, this._rotateStart).multiplyScalar(this.rotateSpeed);
    const element = this.domElement;
    this._rotateLeft(_twoPI * this._rotateDelta.x / element.clientHeight);
    this._rotateUp(_twoPI * this._rotateDelta.y / element.clientHeight);
    this._rotateStart.copy(this._rotateEnd);
  }

  _handleMovePan(x, y) {
    this._panEnd.set(x, y);
    this._panDelta.subVectors(this._panEnd, this._panStart).multiplyScalar(this.panSpeed);
    this._pan(this._panDelta.x, this._panDelta.y);
    this._panStart.copy(this._panEnd);
  }

  _handleMouseMoveDolly(event) {
    this._dollyEnd.set(event.clientX, event.clientY);
    this._dollyDelta.subVectors(this._dollyEnd, this._dollyStart);
    if (this._dollyDelta.y > 0) this._dollyOut(this._getZoomScale(this._dollyDelta.y));
    else if (this._dollyDelta.y < 0) this._dollyIn(this._getZoomScale(this._dollyDelta.y));
    this._dollyStart.copy(this._dollyEnd);
    this.update();
  }

  _handleMouseWheel(event) {
    if (event.deltaY < 0) this._dollyIn(this._getZoomScale(event.deltaY));
    else if (event.deltaY > 0) this._dollyOut(this._getZoomScale(event.deltaY));
    this.update();
  }

  /** Two fingers: the midpoint pans, and the spread between them dollies. */
  _touchCentre(event) {
    if (this._pointers.length === 1) return [event.pageX, event.pageY];
    const position = this._getSecondPointerPosition(event);
    return [0.5 * (event.pageX + position.x), 0.5 * (event.pageY + position.y)];
  }

  _touchSpread(event) {
    const position = this._getSecondPointerPosition(event);
    const dx = event.pageX - position.x;
    const dy = event.pageY - position.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _handleTouchMoveDolly(event) {
    this._dollyEnd.set(0, this._touchSpread(event));
    this._dollyDelta.set(0, Math.pow(this._dollyEnd.y / this._dollyStart.y, this.zoomSpeed));
    this._dollyOut(this._dollyDelta.y);
    this._dollyStart.copy(this._dollyEnd);
  }

  _addPointer(event) { this._pointers.push(event.pointerId); }

  _removePointer(event) {
    delete this._pointerPositions[event.pointerId];
    const i = this._pointers.indexOf(event.pointerId);
    if (i !== -1) this._pointers.splice(i, 1);
  }

  _isTrackingPointer(event) { return this._pointers.includes(event.pointerId); }

  _trackPointer(event) {
    let position = this._pointerPositions[event.pointerId];
    if (position === undefined) {
      position = new Vector2();
      this._pointerPositions[event.pointerId] = position;
    }
    position.set(event.pageX, event.pageY);
  }

  _getSecondPointerPosition(event) {
    const pointerId = event.pointerId === this._pointers[0] ? this._pointers[1] : this._pointers[0];
    return this._pointerPositions[pointerId];
  }

  _onTouchStart(event) {
    this._trackPointer(event);
    if (this._pointers.length === 1) {
      if (this.enableRotate === false) return;
      this._rotateStart.set(event.pageX, event.pageY);
      this.state = STATE.TOUCH_ROTATE;
    } else if (this._pointers.length === 2) {
      if (this.enableZoom === false && this.enablePan === false) return;
      if (this.enableZoom) this._dollyStart.set(0, this._touchSpread(event));
      if (this.enablePan) this._panStart.set(...this._touchCentre(event));
      this.state = STATE.TOUCH_DOLLY_PAN;
    } else {
      this.state = STATE.NONE;
    }
    if (this.state !== STATE.NONE) this.dispatchEvent(_startEvent);
  }

  _onTouchMove(event) {
    this._trackPointer(event);
    if (this.state === STATE.TOUCH_ROTATE) {
      if (this.enableRotate === false) return;
      this._handleMoveRotate(...this._touchCentre(event));
      this.update();
    } else if (this.state === STATE.TOUCH_DOLLY_PAN) {
      if (this.enableZoom === false && this.enablePan === false) return;
      if (this.enableZoom) this._handleTouchMoveDolly(event);
      if (this.enablePan) this._handleMovePan(...this._touchCentre(event));
      this.update();
    } else {
      this.state = STATE.NONE;
    }
  }

  _onMouseDown(event) {
    const modified = event.ctrlKey || event.metaKey || event.shiftKey;
    if (event.button === 1) {
      if (this.enableZoom === false) return;
      this._dollyStart.set(event.clientX, event.clientY);
      this.state = STATE.DOLLY;
    } else if ((event.button === 0 && !modified) || (event.button === 2 && modified)) {
      if (this.enableRotate === false) return;
      this._rotateStart.set(event.clientX, event.clientY);
      this.state = STATE.ROTATE;
    } else if (event.button === 0 || event.button === 2) {
      if (this.enablePan === false) return;
      this._panStart.set(event.clientX, event.clientY);
      this.state = STATE.PAN;
    } else {
      this.state = STATE.NONE;
    }
    if (this.state !== STATE.NONE) this.dispatchEvent(_startEvent);
  }

  _onMouseMove(event) {
    if (this.state === STATE.ROTATE) {
      if (this.enableRotate === false) return;
      this._handleMoveRotate(event.clientX, event.clientY);
      this.update();
    } else if (this.state === STATE.DOLLY) {
      if (this.enableZoom === false) return;
      this._handleMouseMoveDolly(event);
    } else if (this.state === STATE.PAN) {
      if (this.enablePan === false) return;
      this._handleMovePan(event.clientX, event.clientY);
      this.update();
    }
  }
}

function onPointerDown(event) {
  if (this.enabled === false) return;
  if (this._pointers.length === 0) {
    this.domElement.setPointerCapture(event.pointerId);
    this.domElement.ownerDocument.addEventListener('pointermove', this._onPointerMove);
    this.domElement.ownerDocument.addEventListener('pointerup', this._onPointerUp);
  }
  if (this._isTrackingPointer(event)) return;
  this._addPointer(event);
  if (event.pointerType === 'touch') this._onTouchStart(event);
  else this._onMouseDown(event);
}

function onPointerMove(event) {
  if (this.enabled === false) return;
  if (event.pointerType === 'touch') this._onTouchMove(event);
  else this._onMouseMove(event);
}

function onPointerUp(event) {
  this._removePointer(event);
  if (this._pointers.length === 0) {
    this.domElement.releasePointerCapture(event.pointerId);
    this.domElement.ownerDocument.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.ownerDocument.removeEventListener('pointerup', this._onPointerUp);
    this.dispatchEvent(_endEvent);
    this.state = STATE.NONE;
  } else if (this._pointers.length === 1) {
    const pointerId = this._pointers[0];
    const position = this._pointerPositions[pointerId];
    this._onTouchStart({ pointerId, pageX: position.x, pageY: position.y });
  }
}

function onMouseWheel(event) {
  if (this.enabled === false || this.enableZoom === false || this.state !== STATE.NONE) return;
  event.preventDefault();
  this.dispatchEvent(_startEvent);
  let deltaY = event.deltaY;
  if (event.deltaMode === 1) deltaY *= 16;
  else if (event.deltaMode === 2) deltaY *= 100;
  if (event.ctrlKey && !this._controlActive) deltaY *= 10;
  this._handleMouseWheel({ clientX: event.clientX, clientY: event.clientY, deltaY });
  this.dispatchEvent(_endEvent);
}

function onContextMenu(event) {
  if (this.enabled === false) return;
  event.preventDefault();
}

