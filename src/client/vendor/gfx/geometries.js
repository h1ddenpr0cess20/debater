/**
 * The primitive shapes the scenes are built from.
 *
 * Vertex order, winding, UVs and groups all follow three.js r186 (MIT,
 * © 2010-2025 three.js authors) exactly — the scenes number die faces by
 * triangle order, displace sphere vertices by index and pick lectern
 * heights off these bounds, so "about the same mesh" would not be the same
 * scene.
 */

import { BufferGeometry, Float32BufferAttribute } from './core.js';
import { DEG2RAD, Vector2, Vector3, clamp } from './math.js';

export class SphereGeometry extends BufferGeometry {
  constructor(radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2,
    thetaStart = 0, thetaLength = Math.PI) {
    super();
    this.type = 'SphereGeometry';
    this.parameters = { radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength };
    widthSegments = Math.max(3, Math.floor(widthSegments));
    heightSegments = Math.max(2, Math.floor(heightSegments));
    const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);
    let index = 0;
    const grid = [];
    const vertex = new Vector3();
    const normal = new Vector3();
    const indices = [], vertices = [], normals = [], uvs = [];

    for (let iy = 0; iy <= heightSegments; iy++) {
      const row = [];
      const v = iy / heightSegments;
      const theta = thetaStart + v * thetaLength;
      const y = radius * Math.cos(theta);
      const ringRadius = Math.sqrt(radius * radius - y * y);
      let uOffset = 0;
      if (iy === 0 && thetaStart === 0) uOffset = 0.5 / widthSegments;
      else if (iy === heightSegments && thetaEnd === Math.PI) uOffset = -0.5 / widthSegments;
      for (let ix = 0; ix <= widthSegments; ix++) {
        const u = ix / widthSegments;
        const phi = phiStart + u * phiLength;
        vertex.x = -ringRadius * Math.cos(phi);
        vertex.y = y;
        vertex.z = ringRadius * Math.sin(phi);
        vertices.push(vertex.x, vertex.y, vertex.z);
        normal.copy(vertex).normalize();
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(u + uOffset, 1 - v);
        row.push(index++);
      }
      grid.push(row);
    }

    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = grid[iy][ix + 1];
        const b = grid[iy][ix];
        const c = grid[iy + 1][ix];
        const d = grid[iy + 1][ix + 1];
        if (iy !== 0 || thetaStart > 0) indices.push(a, b, d);
        if (iy !== heightSegments - 1 || thetaEnd < Math.PI) indices.push(b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();
    this.type = 'PlaneGeometry';
    this.parameters = { width, height, widthSegments, heightSegments };
    const widthHalf = width / 2, heightHalf = height / 2;
    const gridX = Math.floor(widthSegments), gridY = Math.floor(heightSegments);
    const gridX1 = gridX + 1, gridY1 = gridY + 1;
    const segmentWidth = width / gridX, segmentHeight = height / gridY;
    const indices = [], vertices = [], normals = [], uvs = [];

    for (let iy = 0; iy < gridY1; iy++) {
      const y = iy * segmentHeight - heightHalf;
      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segmentWidth - widthHalf;
        vertices.push(x, -y, 0);
        normals.push(0, 0, 1);
        uvs.push(ix / gridX, 1 - (iy / gridY));
      }
    }
    for (let iy = 0; iy < gridY; iy++) {
      for (let ix = 0; ix < gridX; ix++) {
        const a = ix + gridX1 * iy;
        const b = ix + gridX1 * (iy + 1);
        const c = (ix + 1) + gridX1 * (iy + 1);
        const d = (ix + 1) + gridX1 * iy;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class CircleGeometry extends BufferGeometry {
  constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    this.type = 'CircleGeometry';
    this.parameters = { radius, segments, thetaStart, thetaLength };
    segments = Math.max(3, segments);
    const indices = [], vertices = [0, 0, 0], normals = [0, 0, 1], uvs = [0.5, 0.5];

    for (let s = 0, i = 3; s <= segments; s++, i += 3) {
      const segment = thetaStart + s / segments * thetaLength;
      vertices.push(radius * Math.cos(segment), radius * Math.sin(segment), 0);
      normals.push(0, 0, 1);
      uvs.push((vertices[i] / radius + 1) / 2, (vertices[i + 1] / radius + 1) / 2);
    }
    for (let i = 1; i <= segments; i++) indices.push(i, i + 1, 0);

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
    super();
    this.type = 'BoxGeometry';
    this.parameters = { width, height, depth, widthSegments, heightSegments, depthSegments };
    widthSegments = Math.floor(widthSegments);
    heightSegments = Math.floor(heightSegments);
    depthSegments = Math.floor(depthSegments);
    const indices = [], vertices = [], normals = [], uvs = [];
    let numberOfVertices = 0;
    let groupStart = 0;

    const buildPlane = (u, v, w, udir, vdir, planeWidth, planeHeight, planeDepth, gridX, gridY, materialIndex) => {
      const segmentWidth = planeWidth / gridX, segmentHeight = planeHeight / gridY;
      const widthHalf = planeWidth / 2, heightHalf = planeHeight / 2, depthHalf = planeDepth / 2;
      const gridX1 = gridX + 1, gridY1 = gridY + 1;
      let vertexCounter = 0, groupCount = 0;
      const vector = new Vector3();
      for (let iy = 0; iy < gridY1; iy++) {
        const y = iy * segmentHeight - heightHalf;
        for (let ix = 0; ix < gridX1; ix++) {
          const x = ix * segmentWidth - widthHalf;
          vector[u] = x * udir;
          vector[v] = y * vdir;
          vector[w] = depthHalf;
          vertices.push(vector.x, vector.y, vector.z);
          vector[u] = 0;
          vector[v] = 0;
          vector[w] = planeDepth > 0 ? 1 : -1;
          normals.push(vector.x, vector.y, vector.z);
          uvs.push(ix / gridX, 1 - (iy / gridY));
          vertexCounter += 1;
        }
      }
      for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
          const a = numberOfVertices + ix + gridX1 * iy;
          const b = numberOfVertices + ix + gridX1 * (iy + 1);
          const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
          const d = numberOfVertices + (ix + 1) + gridX1 * iy;
          indices.push(a, b, d, b, c, d);
          groupCount += 6;
        }
      }
      this.addGroup(groupStart, groupCount, materialIndex);
      groupStart += groupCount;
      numberOfVertices += vertexCounter;
    };

    buildPlane('z', 'y', 'x', -1, -1, depth, height, width, depthSegments, heightSegments, 0);
    buildPlane('z', 'y', 'x', 1, -1, depth, height, -width, depthSegments, heightSegments, 1);
    buildPlane('x', 'z', 'y', 1, 1, width, depth, height, widthSegments, depthSegments, 2);
    buildPlane('x', 'z', 'y', 1, -1, width, depth, -height, widthSegments, depthSegments, 3);
    buildPlane('x', 'y', 'z', 1, -1, width, height, depth, widthSegments, heightSegments, 4);
    buildPlane('x', 'y', 'z', -1, -1, width, height, -depth, widthSegments, heightSegments, 5);

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

/** Groups: 0 the side, 1 the top cap, 2 the bottom cap — a material array follows them. */
export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1,
    openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    this.type = 'CylinderGeometry';
    this.parameters = { radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };
    radialSegments = Math.floor(radialSegments);
    heightSegments = Math.floor(heightSegments);
    const indices = [], vertices = [], normals = [], uvs = [];
    let index = 0;
    const indexArray = [];
    const halfHeight = height / 2;
    let groupStart = 0;

    const generateTorso = () => {
      const normal = new Vector3();
      const vertex = new Vector3();
      let groupCount = 0;
      const slope = (radiusBottom - radiusTop) / height;
      for (let y = 0; y <= heightSegments; y++) {
        const indexRow = [];
        const v = y / heightSegments;
        const radius = v * (radiusBottom - radiusTop) + radiusTop;
        for (let x = 0; x <= radialSegments; x++) {
          const u = x / radialSegments;
          const theta = u * thetaLength + thetaStart;
          const sinTheta = Math.sin(theta);
          const cosTheta = Math.cos(theta);
          vertex.x = radius * sinTheta;
          vertex.y = -v * height + halfHeight;
          vertex.z = radius * cosTheta;
          vertices.push(vertex.x, vertex.y, vertex.z);
          normal.set(sinTheta, slope, cosTheta).normalize();
          normals.push(normal.x, normal.y, normal.z);
          uvs.push(u, 1 - v);
          indexRow.push(index++);
        }
        indexArray.push(indexRow);
      }
      for (let x = 0; x < radialSegments; x++) {
        for (let y = 0; y < heightSegments; y++) {
          const a = indexArray[y][x];
          const b = indexArray[y + 1][x];
          const c = indexArray[y + 1][x + 1];
          const d = indexArray[y][x + 1];
          if (radiusTop > 0 || y !== 0) { indices.push(a, b, d); groupCount += 3; }
          if (radiusBottom > 0 || y !== heightSegments - 1) { indices.push(b, c, d); groupCount += 3; }
        }
      }
      this.addGroup(groupStart, groupCount, 0);
      groupStart += groupCount;
    };

    const generateCap = (top) => {
      const centerIndexStart = index;
      let groupCount = 0;
      const radius = top === true ? radiusTop : radiusBottom;
      const sign = top === true ? 1 : -1;
      for (let x = 1; x <= radialSegments; x++) {
        vertices.push(0, halfHeight * sign, 0);
        normals.push(0, sign, 0);
        uvs.push(0.5, 0.5);
        index++;
      }
      const centerIndexEnd = index;
      for (let x = 0; x <= radialSegments; x++) {
        const u = x / radialSegments;
        const theta = u * thetaLength + thetaStart;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        vertices.push(radius * sinTheta, halfHeight * sign, radius * cosTheta);
        normals.push(0, sign, 0);
        uvs.push((cosTheta * 0.5) + 0.5, (sinTheta * 0.5 * sign) + 0.5);
        index++;
      }
      for (let x = 0; x < radialSegments; x++) {
        const c = centerIndexStart + x;
        const i = centerIndexEnd + x;
        if (top === true) indices.push(i, i + 1, c);
        else indices.push(i + 1, i, c);
        groupCount += 3;
      }
      this.addGroup(groupStart, groupCount, top === true ? 1 : 2);
      groupStart += groupCount;
    };

    generateTorso();
    if (openEnded === false) {
      if (radiusTop > 0) generateCap(true);
      if (radiusBottom > 0) generateCap(false);
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false,
    thetaStart = 0, thetaLength = Math.PI * 2) {
    super(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
    this.type = 'ConeGeometry';
    this.parameters = { radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2,
    thetaStart = 0, thetaLength = Math.PI * 2) {
    super();
    this.type = 'TorusGeometry';
    this.parameters = { radius, tube, radialSegments, tubularSegments, arc, thetaStart, thetaLength };
    radialSegments = Math.floor(radialSegments);
    tubularSegments = Math.floor(tubularSegments);
    const indices = [], vertices = [], normals = [], uvs = [];
    const center = new Vector3(), vertex = new Vector3(), normal = new Vector3();

    for (let j = 0; j <= radialSegments; j++) {
      const v = thetaStart + (j / radialSegments) * thetaLength;
      for (let i = 0; i <= tubularSegments; i++) {
        const u = i / tubularSegments * arc;
        vertex.x = (radius + tube * Math.cos(v)) * Math.cos(u);
        vertex.y = (radius + tube * Math.cos(v)) * Math.sin(u);
        vertex.z = tube * Math.sin(v);
        vertices.push(vertex.x, vertex.y, vertex.z);
        center.x = radius * Math.cos(u);
        center.y = radius * Math.sin(u);
        normal.subVectors(vertex, center).normalize();
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(i / tubularSegments, j / radialSegments);
      }
    }
    for (let j = 1; j <= radialSegments; j++) {
      for (let i = 1; i <= tubularSegments; i++) {
        const a = (tubularSegments + 1) * j + i - 1;
        const b = (tubularSegments + 1) * (j - 1) + i - 1;
        const c = (tubularSegments + 1) * (j - 1) + i;
        const d = (tubularSegments + 1) * j + i;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  }
}

/** A profile in the (radius, height) plane, turned about y. */
export class LatheGeometry extends BufferGeometry {
  constructor(points = [new Vector2(0, -0.5), new Vector2(0.5, 0), new Vector2(0, 0.5)], segments = 12,
    phiStart = 0, phiLength = Math.PI * 2) {
    super();
    this.type = 'LatheGeometry';
    this.parameters = { points, segments, phiStart, phiLength };
    segments = Math.floor(segments);
    phiLength = clamp(phiLength, 0, Math.PI * 2);
    const indices = [], vertices = [], uvs = [], initNormals = [], normals = [];
    const inverseSegments = 1.0 / segments;
    const normal = new Vector3(), curNormal = new Vector3(), prevNormal = new Vector3();
    let dx, dy;

    for (let j = 0; j <= points.length - 1; j++) {
      if (j === 0) {
        dx = points[j + 1].x - points[j].x;
        dy = points[j + 1].y - points[j].y;
        normal.x = dy * 1.0;
        normal.y = -dx;
        normal.z = dy * 0.0;
        prevNormal.copy(normal);
        normal.normalize();
        initNormals.push(normal.x, normal.y, normal.z);
      } else if (j === points.length - 1) {
        initNormals.push(prevNormal.x, prevNormal.y, prevNormal.z);
      } else {
        dx = points[j + 1].x - points[j].x;
        dy = points[j + 1].y - points[j].y;
        normal.x = dy * 1.0;
        normal.y = -dx;
        normal.z = dy * 0.0;
        curNormal.copy(normal);
        normal.x += prevNormal.x;
        normal.y += prevNormal.y;
        normal.z += prevNormal.z;
        normal.normalize();
        initNormals.push(normal.x, normal.y, normal.z);
        prevNormal.copy(curNormal);
      }
    }

    for (let i = 0; i <= segments; i++) {
      const phi = phiStart + i * inverseSegments * phiLength;
      const sin = Math.sin(phi);
      const cos = Math.cos(phi);
      for (let j = 0; j <= points.length - 1; j++) {
        vertices.push(points[j].x * sin, points[j].y, points[j].x * cos);
        uvs.push(i / segments, j / (points.length - 1));
        normals.push(initNormals[3 * j] * sin, initNormals[3 * j + 1], initNormals[3 * j] * cos);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < points.length - 1; j++) {
        const base = j + i * points.length;
        const a = base, b = base + points.length, c = base + points.length + 1, d = base + 1;
        indices.push(a, b, d, c, d, b);
      }
    }

    this.setIndex(indices);
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  }
}

/** Non-indexed: every triangle has its own three vertices, subdivided `detail` times. */
export class PolyhedronGeometry extends BufferGeometry {
  constructor(vertices = [], indices = [], radius = 1, detail = 0) {
    super();
    this.type = 'PolyhedronGeometry';
    this.parameters = { vertices, indices, radius, detail };
    const vertexBuffer = [];
    const uvBuffer = [];

    const pushVertex = (v) => vertexBuffer.push(v.x, v.y, v.z);
    const getVertexByIndex = (i, v) => { v.x = vertices[i * 3]; v.y = vertices[i * 3 + 1]; v.z = vertices[i * 3 + 2]; };
    const azimuth = (v) => Math.atan2(v.z, -v.x);
    const inclination = (v) => Math.atan2(-v.y, Math.sqrt((v.x * v.x) + (v.z * v.z)));

    const subdivideFace = (a, b, c, d) => {
      const cols = d + 1;
      const v = [];
      for (let i = 0; i <= cols; i++) {
        v[i] = [];
        const aj = a.clone().lerp(c, i / cols);
        const bj = b.clone().lerp(c, i / cols);
        const rows = cols - i;
        for (let j = 0; j <= rows; j++) {
          if (j === 0 && i === cols) v[i][j] = aj;
          else v[i][j] = aj.clone().lerp(bj, j / rows);
        }
      }
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < 2 * (cols - i) - 1; j++) {
          const k = Math.floor(j / 2);
          if (j % 2 === 0) {
            pushVertex(v[i][k + 1]);
            pushVertex(v[i + 1][k]);
            pushVertex(v[i][k]);
          } else {
            pushVertex(v[i][k + 1]);
            pushVertex(v[i + 1][k + 1]);
            pushVertex(v[i + 1][k]);
          }
        }
      }
    };

    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    for (let i = 0; i < indices.length; i += 3) {
      getVertexByIndex(indices[i + 0], a);
      getVertexByIndex(indices[i + 1], b);
      getVertexByIndex(indices[i + 2], c);
      subdivideFace(a, b, c, detail);
    }

    const vertex = new Vector3();
    for (let i = 0; i < vertexBuffer.length; i += 3) {
      vertex.set(vertexBuffer[i], vertexBuffer[i + 1], vertexBuffer[i + 2]).normalize().multiplyScalar(radius);
      vertexBuffer[i] = vertex.x; vertexBuffer[i + 1] = vertex.y; vertexBuffer[i + 2] = vertex.z;
    }

    for (let i = 0; i < vertexBuffer.length; i += 3) {
      vertex.set(vertexBuffer[i], vertexBuffer[i + 1], vertexBuffer[i + 2]);
      uvBuffer.push(azimuth(vertex) / 2 / Math.PI + 0.5, 1 - (inclination(vertex) / Math.PI + 0.5));
    }

    const centroid = new Vector3();
    const correctUV = (u, stride, v, azi) => {
      if (azi < 0 && u === 1) uvBuffer[stride] = u - 1;
      if (v.x === 0 && v.z === 0) uvBuffer[stride] = azi / 2 / Math.PI + 0.5;
    };
    for (let i = 0, j = 0; i < vertexBuffer.length; i += 9, j += 6) {
      a.set(vertexBuffer[i], vertexBuffer[i + 1], vertexBuffer[i + 2]);
      b.set(vertexBuffer[i + 3], vertexBuffer[i + 4], vertexBuffer[i + 5]);
      c.set(vertexBuffer[i + 6], vertexBuffer[i + 7], vertexBuffer[i + 8]);
      const uA = uvBuffer[j], uB = uvBuffer[j + 2], uC = uvBuffer[j + 4];
      centroid.copy(a).add(b).add(c).divideScalar(3);
      const azi = azimuth(centroid);
      correctUV(uA, j, a, azi);
      correctUV(uB, j + 2, b, azi);
      correctUV(uC, j + 4, c, azi);
    }
    for (let i = 0; i < uvBuffer.length; i += 6) {
      const x0 = uvBuffer[i], x1 = uvBuffer[i + 2], x2 = uvBuffer[i + 4];
      const max = Math.max(x0, x1, x2), min = Math.min(x0, x1, x2);
      if (max > 0.9 && min < 0.1) {
        if (x0 < 0.2) uvBuffer[i] += 1;
        if (x1 < 0.2) uvBuffer[i + 2] += 1;
        if (x2 < 0.2) uvBuffer[i + 4] += 1;
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(vertexBuffer, 3));
    this.setAttribute('normal', new Float32BufferAttribute(vertexBuffer.slice(), 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvBuffer, 2));
    if (detail === 0) this.computeVertexNormals();
    else this.normalizeNormals();
  }
}

export class IcosahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    const t = (1 + Math.sqrt(5)) / 2;
    const vertices = [
      -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
      0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
      t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
    ];
    const indices = [
      0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
      1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
      3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
      4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
    ];
    super(vertices, indices, radius, detail);
    this.type = 'IcosahedronGeometry';
    this.parameters = { radius, detail };
  }
}

const _triangle = { a: new Vector3(), b: new Vector3(), c: new Vector3() };
const _normal = new Vector3();
const _e0 = new Vector3();
const _e1 = new Vector3();

/** The creases of a mesh — edges whose two faces meet at more than `thresholdAngle` degrees. */
export class EdgesGeometry extends BufferGeometry {
  constructor(geometry = null, thresholdAngle = 1) {
    super();
    this.type = 'EdgesGeometry';
    this.parameters = { geometry, thresholdAngle };
    if (geometry === null) return;

    const precision = Math.pow(10, 4);
    const thresholdDot = Math.cos(DEG2RAD * thresholdAngle);
    const indexAttr = geometry.getIndex();
    const positionAttr = geometry.getAttribute('position');
    const indexCount = indexAttr ? indexAttr.count : positionAttr.count;
    const indexArr = [0, 0, 0];
    const vertKeys = ['a', 'b', 'c'];
    const hashes = new Array(3);
    const edgeData = {};
    const vertices = [];
    const hashOf = (v) => `${Math.round(v.x * precision)},${Math.round(v.y * precision)},${Math.round(v.z * precision)}`;

    for (let i = 0; i < indexCount; i += 3) {
      if (indexAttr) {
        indexArr[0] = indexAttr.getX(i);
        indexArr[1] = indexAttr.getX(i + 1);
        indexArr[2] = indexAttr.getX(i + 2);
      } else {
        indexArr[0] = i; indexArr[1] = i + 1; indexArr[2] = i + 2;
      }
      const { a, b, c } = _triangle;
      a.fromBufferAttribute(positionAttr, indexArr[0]);
      b.fromBufferAttribute(positionAttr, indexArr[1]);
      c.fromBufferAttribute(positionAttr, indexArr[2]);
      _normal.subVectors(c, b);
      _e0.subVectors(a, b);
      _normal.cross(_e0);
      const lengthSq = _normal.lengthSq();
      if (lengthSq > 0) _normal.multiplyScalar(1 / Math.sqrt(lengthSq));
      else _normal.set(0, 0, 0);

      hashes[0] = hashOf(a);
      hashes[1] = hashOf(b);
      hashes[2] = hashOf(c);
      if (hashes[0] === hashes[1] || hashes[1] === hashes[2] || hashes[2] === hashes[0]) continue;

      for (let j = 0; j < 3; j++) {
        const jNext = (j + 1) % 3;
        const vecHash0 = hashes[j];
        const vecHash1 = hashes[jNext];
        const v0 = _triangle[vertKeys[j]];
        const v1 = _triangle[vertKeys[jNext]];
        const hash = `${vecHash0}_${vecHash1}`;
        const reverseHash = `${vecHash1}_${vecHash0}`;
        if (reverseHash in edgeData && edgeData[reverseHash]) {
          if (_normal.dot(edgeData[reverseHash].normal) <= thresholdDot) {
            vertices.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
          }
          edgeData[reverseHash] = null;
        } else if (!(hash in edgeData)) {
          edgeData[hash] = { index0: indexArr[j], index1: indexArr[jNext], normal: _normal.clone() };
        }
      }
    }

    for (const key in edgeData) {
      if (edgeData[key]) {
        const { index0, index1 } = edgeData[key];
        _e0.fromBufferAttribute(positionAttr, index0);
        _e1.fromBufferAttribute(positionAttr, index1);
        vertices.push(_e0.x, _e0.y, _e0.z, _e1.x, _e1.y, _e1.z);
      }
    }
    this.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  }
}

// ---------------------------------------------------------------- 2D shapes

class LineCurve {
  constructor(v1, v2) { this.v1 = v1; this.v2 = v2; }

  getPoint(t, point = new Vector2()) {
    if (t === 1) point.copy(this.v2);
    else point.copy(this.v2).sub(this.v1).multiplyScalar(t).add(this.v1);
    return point;
  }
}
LineCurve.prototype.isLineCurve = true;

const quadraticBezier = (t, p0, p1, p2) => {
  const k = 1 - t;
  return k * k * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
};

class QuadraticBezierCurve {
  constructor(v0, v1, v2) { this.v0 = v0; this.v1 = v1; this.v2 = v2; }

  getPoint(t, point = new Vector2()) {
    return point.set(
      quadraticBezier(t, this.v0.x, this.v1.x, this.v2.x),
      quadraticBezier(t, this.v0.y, this.v1.y, this.v2.y),
    );
  }
}

/** An outline drawn with moveTo / lineTo / quadraticCurveTo. Holes are not supported. */
export class Shape {
  constructor() {
    this.curves = [];
    this.currentPoint = new Vector2();
  }

  moveTo(x, y) { this.currentPoint.set(x, y); return this; }

  lineTo(x, y) {
    this.curves.push(new LineCurve(this.currentPoint.clone(), new Vector2(x, y)));
    this.currentPoint.set(x, y);
    return this;
  }

  quadraticCurveTo(cpX, cpY, x, y) {
    this.curves.push(new QuadraticBezierCurve(this.currentPoint.clone(), new Vector2(cpX, cpY), new Vector2(x, y)));
    this.currentPoint.set(x, y);
    return this;
  }

  getPoints(divisions = 12) {
    const points = [];
    let last;
    for (const curve of this.curves) {
      const resolution = curve.isLineCurve ? 1 : divisions;
      for (let d = 0; d <= resolution; d++) {
        const point = curve.getPoint(d / resolution);
        if (last && last.equals(point)) continue;
        points.push(point);
        last = point;
      }
    }
    return points;
  }
}

const shapeArea = (contour) => {
  const n = contour.length;
  let a = 0.0;
  for (let p = n - 1, q = 0; q < n; p = q++) a += contour[p].x * contour[q].y - contour[q].x * contour[p].y;
  return a * 0.5;
};

const isClockWise = (points) => shapeArea(points) < 0;

/**
 * Ear clipping, as earcut (ISC, © Mapbox) does it for a polygon without
 * holes: the same linked ring, the same ear test, the same order of cuts.
 */
function earcut(data) {
  const node = (i, x, y) => ({ i, x, y, prev: null, next: null });
  const insertNode = (i, x, y, last) => {
    const p = node(i, x, y);
    if (!last) { p.prev = p; p.next = p; }
    else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  };
  const removeNode = (p) => { p.next.prev = p.prev; p.prev.next = p.next; };
  const area = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  const equals = (p1, p2) => p1.x === p2.x && p1.y === p2.y;
  const pointInTriangle = (ax, ay, bx, by, cx, cy, px, py) => (cx - px) * (ay - py) >= (ax - px) * (cy - py)
    && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);

  let sum = 0;
  for (let i = 0, j = data.length - 2; i < data.length; i += 2) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  let last;
  if (sum > 0) for (let i = 0; i < data.length; i += 2) last = insertNode(i / 2 | 0, data[i], data[i + 1], last);
  else for (let i = data.length - 2; i >= 0; i -= 2) last = insertNode(i / 2 | 0, data[i], data[i + 1], last);
  if (last && equals(last, last.next)) { removeNode(last); last = last.next; }

  const triangles = [];
  if (!last || last.next === last.prev) return triangles;

  const isEar = (ear) => {
    const a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    const x0 = Math.min(a.x, b.x, c.x), y0 = Math.min(a.y, b.y, c.y);
    const x1 = Math.max(a.x, b.x, c.x), y1 = Math.max(a.y, b.y, c.y);
    for (let p = c.next; p !== a; p = p.next) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
        && !(a.x === p.x && a.y === p.y) && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y)
        && area(p.prev, p, p.next) >= 0) return false;
    }
    return true;
  };

  const filterPoints = (start) => {
    let p = start, end = start, again;
    do {
      again = false;
      if (equals(p, p.next) || area(p.prev, p, p.next) === 0) {
        removeNode(p);
        p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else {
        p = p.next;
      }
    } while (again || p !== end);
    return end;
  };

  const clip = (ear, pass) => {
    let stop = ear;
    while (ear.prev !== ear.next) {
      const prev = ear.prev, next = ear.next;
      if (isEar(ear)) {
        triangles.push(prev.i, ear.i, next.i);
        removeNode(ear);
        ear = next.next;
        stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) clip(filterPoints(ear), 1);
        else throw new Error('gfx: shape outline is not a simple polygon');
        break;
      }
    }
  };
  clip(last, 0);
  return triangles;
}

function triangulate(contour) {
  if (contour.length > 2 && contour[contour.length - 1].equals(contour[0])) contour.pop();
  const flat = [];
  for (const p of contour) flat.push(p.x, p.y);
  const triangles = earcut(flat);
  const faces = [];
  for (let i = 0; i < triangles.length; i += 3) faces.push(triangles.slice(i, i + 3));
  return faces;
}

const topUV = (vertices, a, b, c) => [
  new Vector2(vertices[a * 3], vertices[a * 3 + 1]),
  new Vector2(vertices[b * 3], vertices[b * 3 + 1]),
  new Vector2(vertices[c * 3], vertices[c * 3 + 1]),
];

function sideWallUV(vertices, a, b, c, d) {
  const p = (i) => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]];
  const [ax, ay, az] = p(a), [bx, by, bz] = p(b), [cx, cy, cz] = p(c), [dx, dy, dz] = p(d);
  if (Math.abs(ay - by) < Math.abs(ax - bx)) {
    return [new Vector2(ax, 1 - az), new Vector2(bx, 1 - bz), new Vector2(cx, 1 - cz), new Vector2(dx, 1 - dz)];
  }
  return [new Vector2(ay, 1 - az), new Vector2(by, 1 - bz), new Vector2(cy, 1 - cz), new Vector2(dy, 1 - dz)];
}

/**
 * A shape pushed out along z by `depth`, with rounded bevels. Non-indexed,
 * flat-normalled, groups 0 for the lids and 1 for the walls.
 */
export class ExtrudeGeometry extends BufferGeometry {
  constructor(shape, options = {}) {
    super();
    this.type = 'ExtrudeGeometry';
    this.parameters = { shapes: shape, options };
    const verticesArray = [];
    const uvArray = [];
    const placeholder = [];

    const curveSegments = options.curveSegments !== undefined ? options.curveSegments : 12;
    const steps = options.steps !== undefined ? options.steps : 1;
    const depth = options.depth !== undefined ? options.depth : 1;
    const bevelEnabled = options.bevelEnabled !== undefined ? options.bevelEnabled : true;
    let bevelThickness = options.bevelThickness !== undefined ? options.bevelThickness : 0.2;
    let bevelSize = options.bevelSize !== undefined ? options.bevelSize : bevelThickness - 0.1;
    let bevelOffset = options.bevelOffset !== undefined ? options.bevelOffset : 0;
    let bevelSegments = options.bevelSegments !== undefined ? options.bevelSegments : 3;
    if (!bevelEnabled) {
      bevelSegments = 0; bevelThickness = 0; bevelSize = 0; bevelOffset = 0;
    }

    let vertices = shape.getPoints(curveSegments);
    if (!isClockWise(vertices)) vertices = vertices.reverse();

    const THRESHOLD_SQ = 1e-10 * 1e-10;
    let prevPos = vertices[0];
    for (let i = 1; i <= vertices.length; i++) {
      const currentIndex = i % vertices.length;
      const currentPos = vertices[currentIndex];
      const dx = currentPos.x - prevPos.x, dy = currentPos.y - prevPos.y;
      const scaling = Math.max(Math.abs(currentPos.x), Math.abs(currentPos.y), Math.abs(prevPos.x), Math.abs(prevPos.y));
      if (dx * dx + dy * dy <= THRESHOLD_SQ * scaling * scaling) {
        vertices.splice(currentIndex, 1);
        i--;
        continue;
      }
      prevPos = currentPos;
    }

    const contour = vertices;
    const vlen = vertices.length;
    const scalePt2 = (pt, vec, size) => pt.clone().addScaledVector(vec, size);

    const getBevelVec = (inPt, inPrev, inNext) => {
      let vTransX, vTransY, shrinkBy;
      const vPrevX = inPt.x - inPrev.x, vPrevY = inPt.y - inPrev.y;
      const vNextX = inNext.x - inPt.x, vNextY = inNext.y - inPt.y;
      const vPrevLensq = vPrevX * vPrevX + vPrevY * vPrevY;
      const collinear0 = vPrevX * vNextY - vPrevY * vNextX;
      if (Math.abs(collinear0) > Number.EPSILON) {
        const vPrevLen = Math.sqrt(vPrevLensq);
        const vNextLen = Math.sqrt(vNextX * vNextX + vNextY * vNextY);
        const ptPrevShiftX = inPrev.x - vPrevY / vPrevLen;
        const ptPrevShiftY = inPrev.y + vPrevX / vPrevLen;
        const ptNextShiftX = inNext.x - vNextY / vNextLen;
        const ptNextShiftY = inNext.y + vNextX / vNextLen;
        const sf = ((ptNextShiftX - ptPrevShiftX) * vNextY - (ptNextShiftY - ptPrevShiftY) * vNextX)
          / (vPrevX * vNextY - vPrevY * vNextX);
        vTransX = ptPrevShiftX + vPrevX * sf - inPt.x;
        vTransY = ptPrevShiftY + vPrevY * sf - inPt.y;
        const vTransLensq = vTransX * vTransX + vTransY * vTransY;
        if (vTransLensq <= 2) return new Vector2(vTransX, vTransY);
        shrinkBy = Math.sqrt(vTransLensq / 2);
      } else {
        let directionEq = false;
        if (vPrevX > Number.EPSILON) {
          if (vNextX > Number.EPSILON) directionEq = true;
        } else if (vPrevX < -Number.EPSILON) {
          if (vNextX < -Number.EPSILON) directionEq = true;
        } else if (Math.sign(vPrevY) === Math.sign(vNextY)) {
          directionEq = true;
        }
        if (directionEq) {
          vTransX = -vPrevY; vTransY = vPrevX; shrinkBy = Math.sqrt(vPrevLensq);
        } else {
          vTransX = vPrevX; vTransY = vPrevY; shrinkBy = Math.sqrt(vPrevLensq / 2);
        }
      }
      return new Vector2(vTransX / shrinkBy, vTransY / shrinkBy);
    };

    const contourMovements = [];
    for (let i = 0, il = contour.length, j = il - 1, k = i + 1; i < il; i++, j++, k++) {
      if (j === il) j = 0;
      if (k === il) k = 0;
      contourMovements[i] = getBevelVec(contour[i], contour[j], contour[k]);
    }
    const verticesMovements = contourMovements.concat();

    const v = (x, y, z) => placeholder.push(x, y, z);

    let faces;
    if (bevelSegments === 0) {
      faces = triangulate(contour);
    } else {
      const contracted = [];
      for (let b = 0; b < bevelSegments; b++) {
        const t = b / bevelSegments;
        const z = bevelThickness * Math.cos(t * Math.PI / 2);
        const bs = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;
        for (let i = 0, il = contour.length; i < il; i++) {
          const vert = scalePt2(contour[i], contourMovements[i], bs);
          v(vert.x, vert.y, -z);
          if (t === 0) contracted.push(vert);
        }
      }
      faces = triangulate(contracted);
    }
    const flen = faces.length;
    const bs = bevelSize + bevelOffset;

    for (let i = 0; i < vlen; i++) {
      const vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
      v(vert.x, vert.y, 0);
    }
    for (let s = 1; s <= steps; s++) {
      for (let i = 0; i < vlen; i++) {
        const vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
        v(vert.x, vert.y, depth / steps * s);
      }
    }
    for (let b = bevelSegments - 1; b >= 0; b--) {
      const t = b / bevelSegments;
      const z = bevelThickness * Math.cos(t * Math.PI / 2);
      const bs2 = bevelSize * Math.sin(t * Math.PI / 2) + bevelOffset;
      for (let i = 0, il = contour.length; i < il; i++) {
        const vert = scalePt2(contour[i], contourMovements[i], bs2);
        v(vert.x, vert.y, depth + z);
      }
    }

    const addVertex = (index) => verticesArray.push(placeholder[index * 3], placeholder[index * 3 + 1], placeholder[index * 3 + 2]);
    const addUV = (uv) => uvArray.push(uv.x, uv.y);
    const f3 = (a, b, c) => {
      addVertex(a); addVertex(b); addVertex(c);
      const next = verticesArray.length / 3;
      topUV(verticesArray, next - 3, next - 2, next - 1).forEach(addUV);
    };
    const f4 = (a, b, c, d) => {
      addVertex(a); addVertex(b); addVertex(d);
      addVertex(b); addVertex(c); addVertex(d);
      const next = verticesArray.length / 3;
      const uvs = sideWallUV(verticesArray, next - 6, next - 3, next - 2, next - 1);
      addUV(uvs[0]); addUV(uvs[1]); addUV(uvs[3]);
      addUV(uvs[1]); addUV(uvs[2]); addUV(uvs[3]);
    };

    let start = verticesArray.length / 3;
    if (bevelEnabled) {
      let offset = 0;
      for (let i = 0; i < flen; i++) f3(faces[i][2] + offset, faces[i][1] + offset, faces[i][0] + offset);
      offset = vlen * (steps + bevelSegments * 2);
      for (let i = 0; i < flen; i++) f3(faces[i][0] + offset, faces[i][1] + offset, faces[i][2] + offset);
    } else {
      for (let i = 0; i < flen; i++) f3(faces[i][2], faces[i][1], faces[i][0]);
      for (let i = 0; i < flen; i++) f3(faces[i][0] + vlen * steps, faces[i][1] + vlen * steps, faces[i][2] + vlen * steps);
    }
    this.addGroup(start, verticesArray.length / 3 - start, 0);

    start = verticesArray.length / 3;
    let i = contour.length;
    while (--i >= 0) {
      const j = i;
      let k = i - 1;
      if (k < 0) k = contour.length - 1;
      for (let s = 0, sl = steps + bevelSegments * 2; s < sl; s++) {
        const slen1 = vlen * s, slen2 = vlen * (s + 1);
        f4(j + slen1, k + slen1, k + slen2, j + slen2);
      }
    }
    this.addGroup(start, verticesArray.length / 3 - start, 1);

    this.setAttribute('position', new Float32BufferAttribute(verticesArray, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uvArray, 2));
    this.computeVertexNormals();
  }
}
