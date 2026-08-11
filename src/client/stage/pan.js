/**
 * The set: a cast iron frying pan, seen from inside it.
 *
 * The two debaters are a potato and an egg, so the floor they argue on is the
 * one place both of them were always headed. It replaces the old flat floor and
 * the cyclorama in one piece — the flared wall is the backdrop, and it closes
 * the room off from every angle the camera can be dragged to, which is what the
 * cyclorama was for.
 *
 * Everything is turned out of one profile, revolved. A pan is a solid of
 * revolution and drawing it as one is what gets the rolled rim to read as metal
 * folded over rather than as a wall with a cap on it.
 */

/** Where the debaters stand. The flare starts outside this. */
export const COOK_RADIUS = 5.5;

/** How wide the base rolls up into the wall. Corners of a pan are radii. */
const CORNER = 0.8;

/**
 * The flat of the pan: level iron, and so the only part of it a lectern can
 * stand on without one of its feet ending up higher than the others.
 */
export const FLAT = COOK_RADIUS - CORNER;

/** Inside of the rim, at the top of the flare. Nothing may be framed past it. */
export const RIM_HEIGHT = 1.75;

/** How thick the iron is. Rim, wall and base are all cast in one piece. */
const IRON = 0.34;

/** The outside of the rim: the silhouette anything looking in has to clear. */
export const RIM_RADIUS = COOK_RADIUS + 0.85;

/** A little air over the rim, so the near edge does not graze a lectern's feet. */
const CLEARANCE = 0.15;

/**
 * Whether a camera on the +z axis, at this height and distance, can see every
 * one of these points without the near rim cutting across them.
 *
 * A pan is a wall all the way round, and the framing walks the camera back far
 * enough on a tall window that it ends up outside its own set — looking in over
 * the near rim rather than out from inside the pan. From there the rim is in
 * front of the debaters' feet unless the shot is raised, so this is what the
 * framing asks before it settles on an angle.
 */
export function seesOverRim({ points, dist, height }) {
  const top = RIM_HEIGHT + CLEARANCE;
  return points.every((p) => {
    const dx = p.x;
    const dy = p.y - height;
    const dz = p.z - dist;
    /** Where the line of sight crosses the rim's radius, if it does at all. */
    const a = dx * dx + dz * dz;
    if (a === 0) return true;
    const b = 2 * dist * dz;
    const c = dist * dist - RIM_RADIUS * RIM_RADIUS;
    const disc = b * b - 4 * a * c;
    if (disc <= 0) return true;
    const root = Math.sqrt(disc);
    for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
      /** Only crossings between the camera and the point can hide it. */
      if (t <= 0 || t >= 1) continue;
      if (height + dy * t < top) return false;
    }
    return true;
  });
}

/**
 * The height a camera that far out has to be at to see the whole set, given the
 * height the shot would otherwise use. Never lower than that: from inside the
 * pan there is no near rim to clear and the answer is the shot as framed.
 */
export function liftOverRim({ points, dist, height }) {
  if (seesOverRim({ points, dist, height })) return height;
  let low = height;
  let high = Math.max(height, RIM_HEIGHT) * 2;
  for (let i = 0; i < 24 && !seesOverRim({ points, dist, height: high }); i += 1) high *= 1.5;
  for (let i = 0; i < 32; i += 1) {
    const mid = (low + high) / 2;
    if (seesOverRim({ points, dist, height: mid })) high = mid;
    else low = mid;
  }
  return high;
}

/**
 * How far round a camera orbiting the set may be let, before the near rim comes
 * up between it and the debaters.
 *
 * Dragging the shot down used to end up behind the cyclorama, which was drawn
 * on its inside face only and so was not there from behind. The pan is solid
 * iron from both sides, and a camera that ducks under the rim is looking at the
 * outside of a frying pan. So the swing is capped, at whatever the distance
 * makes room for: from inside the pan there is nothing in the way and the cap is
 * the one the stage came with, and it tightens as the camera backs out past the
 * rim.
 *
 * `radius` is how far out the far side of the set is, `target` how high the
 * camera is looking, and `limit` the cap to keep when the rim is not the thing
 * in the way.
 */
export function polarOverRim({ dist, target, radius, limit }) {
  const top = RIM_HEIGHT + CLEARANCE;

  const sees = (polar) => {
    const flat = dist * Math.sin(polar);
    const height = target + dist * Math.cos(polar);
    /** Inside the pan the near rim is behind the camera, not in front of it. */
    if (flat <= RIM_RADIUS || flat <= radius) return true;
    const t = (flat - RIM_RADIUS) / (flat - radius);
    if (t <= 0 || t >= 1) return true;
    return height * (1 - t) >= top;
  };

  if (sees(limit)) return limit;
  let low = 0;
  let high = limit;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (sees(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * A quarter-turn of profile, as points in the (radius, height) plane.
 *
 * The corners of a pan are radii, not creases — the base rolls into the wall
 * and the wall rolls over into the rim — and a cast body with a sharp corner in
 * it looks pressed out of sheet.
 */
function arc(THREE, cx, cy, r, from, to, steps = 8) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    out.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return out;
}

/**
 * The seasoned surface: near black, worn paler in the middle where a pan gets
 * used, with the faint concentric rings a lathe-turned base is left with.
 */
function cookTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#131211';
  ctx.fillRect(0, 0, 512, 512);

  const worn = ctx.createRadialGradient(256, 256, 10, 256, 256, 250);
  worn.addColorStop(0, 'rgba(96,84,70,0.34)');
  worn.addColorStop(0.45, 'rgba(62,55,47,0.2)');
  worn.addColorStop(1, 'rgba(20,19,18,0)');
  ctx.fillStyle = worn;
  ctx.fillRect(0, 0, 512, 512);

  ctx.lineWidth = 1;
  for (let r = 12; r < 250; r += 6) {
    ctx.strokeStyle = `rgba(198,182,160,${0.014 + (r % 18 === 0 ? 0.016 : 0)})`;
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * The handle: a flattened bar off the back of the pan, tilted up the way a
 * handle is so it clears the counter, with the hanging ring on the end.
 *
 * It goes out the back rather than to one side. Either side is somebody's half
 * of the stage, and a bar across one debater and not the other reads as a
 * lopsided set rather than as a pan.
 */
function buildHandle(THREE, iron) {
  const handle = new THREE.Group();
  handle.name = 'pan-handle';

  const LENGTH = 4.8;
  const TILT = 0.3;

  /** The collar the handle is cast into, which sits on the outside of the rim. */
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.44, 0.9, 16, 1, false), iron);
  socket.name = 'pan-handle-socket';
  socket.rotation.x = Math.PI / 2 - 0.5;
  socket.position.set(0, RIM_HEIGHT - 0.55, -RIM_RADIUS);
  socket.scale.set(1, 1, 0.55);
  handle.add(socket);

  /** Oval in section: taller than it is wide, which is what a cast bar is. */
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, LENGTH, 14, 1, false), iron);
  bar.name = 'pan-handle-bar';
  bar.rotation.x = Math.PI / 2 + TILT;
  bar.scale.set(0.62, 1, 1);
  bar.position.set(
    0,
    RIM_HEIGHT - 0.32 + Math.sin(TILT) * (LENGTH / 2),
    -(RIM_RADIUS + 0.14) - Math.cos(TILT) * (LENGTH / 2),
  );
  handle.add(bar);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.11, 10, 24), iron);
  ring.name = 'pan-handle-ring';
  ring.position.set(
    0,
    RIM_HEIGHT - 0.32 + Math.sin(TILT) * (LENGTH + 0.3),
    -(RIM_RADIUS + 0.14) - Math.cos(TILT) * (LENGTH + 0.3),
  );
  ring.rotation.x = TILT;
  ring.scale.set(1, 1, 0.6);
  handle.add(ring);

  return handle;
}

/**
 * Builds the pan and hands it back as one group, base at y = 0 so a debater
 * standing at the origin is standing in it.
 */
export function buildPan(THREE) {
  const pan = new THREE.Group();
  pan.name = 'pan';

  const iron = new THREE.MeshStandardMaterial({
    name: 'pan-iron',
    color: 0x17130f,
    roughness: 0.42,
    metalness: 0.72,
    side: THREE.DoubleSide,
  });

  /**
   * One contour, from the middle of the inside out and round the whole body:
   * base, corner, flare, over the rim, back down the outside, and in along the
   * underside to the middle again. Revolved, that is the pan.
   */
  /** Where the base has finished rolling into the wall and the flare starts. */
  const knee = -0.55;
  const cx = FLAT;
  const cy = CORNER;
  /** The lip is a bead: a half-round the wall is folded over into. */
  const bead = 0.28;
  const lip = { x: RIM_RADIUS - bead, y: RIM_HEIGHT - bead };

  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(cx, 0),
    /** Inside: the base rolls up into the wall, and the wall flares to the lip. */
    ...arc(THREE, cx, cy, CORNER, -Math.PI / 2, knee),
    new THREE.Vector2(lip.x - bead * 0.2, lip.y - 0.02),
    /** Over the top and back down the outside. */
    ...arc(THREE, lip.x, lip.y, bead, Math.PI, 0, 12),
    /** Outside: the same body, offset by however thick the iron is. */
    new THREE.Vector2(cx + Math.cos(knee) * (CORNER + IRON), cy + Math.sin(knee) * (CORNER + IRON)),
    ...arc(THREE, cx, cy, CORNER + IRON, knee, -Math.PI / 2),
    new THREE.Vector2(0, -IRON),
  ];

  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), iron);
  body.name = 'pan-body';
  pan.add(body);

  /**
   * The cooking surface, laid a hair over the base of the body. Its own mesh
   * because it is the one part that is worn rather than cast, and because it is
   * the floor: it is what the blots under the two of them fall on.
   */
  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(FLAT + 0.25, 96),
    new THREE.MeshStandardMaterial({
      name: 'pan-surface',
      map: cookTexture(THREE),
      roughness: 0.44,
      metalness: 0.62,
    }),
  );
  surface.name = 'floor';
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.002;
  pan.add(surface);

  pan.add(buildHandle(THREE, iron));

  return pan;
}
