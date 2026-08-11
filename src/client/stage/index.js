import { buildEnvironment, dropShadows } from './environment.js';
import { createEgg } from './egg/index.js';
import { buildPan, liftOverRim, polarOverRim } from './pan.js';
import { createPodium, TOP } from './podium.js';
import { createPotato } from './potato/index.js';

/**
 * The debate hall: a cast iron frying pan, two lecterns angled at each other,
 * and a debater standing in front of each.
 *
 * The pan is the floor and the backdrop at once — see `pan.js`. A potato and an
 * egg were only ever going to end up in one room.
 *
 * Left is the potato, right is the egg — the sides they are given in
 * `personas.js`, and the colour on the front of each lectern says which is
 * which. Everything here is scenery; who says what is the director's business.
 */

/**
 * How far out each debater stands, and how far their spot is turned inward.
 *
 * The debater is what gets placed; the lectern swings across the front of them.
 * Turning the two spots inward is therefore what angles the lecterns at each
 * other, without either debater drifting off into the wings.
 */
export const REACH = 1.95;
export const TOE_IN = 0.34;

/** How much room to leave around the two of them, whatever shape the window is. */
const MARGIN = 1.04;

/**
 * The top slice of the frame the set is kept out of.
 *
 * That space is where the captions go. Keeping it clear in the camera is what
 * puts the text above their heads instead of across their faces — and it costs
 * nothing at runtime, where resizing the canvas to make room would re-frame
 * the shot every time somebody started talking.
 */
const HEADROOM = 0.3;

/**
 * And the bottom strip, which is the control bar's. Reserving it is what keeps
 * a lectern's feet out from behind the buttons on a phone, where the bar is two
 * rows tall and the window is not.
 */
const FOOTROOM = 0.16;

const ACCENT = { left: '#2f5d92', right: '#8e3232' };

/** As far down as the shot may ever be dragged, rim or no rim. */
const SWING = Math.PI * 0.495;

/**
 * Builds the hall into the stage and hands back the two rigs, keyed by side.
 *
 * The camera is framed on the pair rather than on the bounding sphere the stage
 * would pick, and re-framed when the window changes shape — a phone held
 * upright is a very different picture from a laptop, and both have to hold both
 * lecterns.
 */
export function buildHall({ stage, THREE }) {
  buildEnvironment({ stage, THREE });

  const hall = new THREE.Group();
  hall.name = 'hall';
  hall.add(buildPan(THREE));

  const left = createPodium(THREE, { name: 'podium-left', accent: ACCENT.left });
  left.group.position.x = -REACH;
  left.group.rotation.y = TOE_IN;

  const right = createPodium(THREE, { name: 'podium-right', accent: ACCENT.right });
  right.group.position.x = REACH;
  right.group.rotation.y = -TOE_IN;

  hall.add(left.group, right.group);

  const potato = left.stand(createPotato({ THREE, shadow: left.blot }));
  const egg = right.stand(createEgg({ THREE, shadow: right.blot }));

  /**
   * Both lecterns end up as far forward as the roomier of the two debaters
   * needs. They each worked out their own clearance and the two are not the
   * same, and a stage where one lectern is nearer the audience than the other
   * looks like a mistake, because it is one.
   */
  const ahead = Math.max(left.lectern.position.z, right.lectern.position.z);
  left.lectern.position.z = ahead;
  right.lectern.position.z = ahead;

  stage.setObject(hall);
  dropShadows({ stage, object: hall });

  const camera = stage._camera;
  const controls = stage._controls;

  /**
   * The two lecterns and whoever is standing on them — not the pan, which is
   * scenery and would frame the shot on nothing.
   */
  const set = new THREE.Box3()
    .setFromObject(left.group)
    .union(new THREE.Box3().setFromObject(right.group));
  const middle = set.getCenter(new THREE.Vector3());
  const span = set.getSize(new THREE.Vector3());

  /** Every corner of the set. What has to be on screen, all of it, always. */
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(
    i & 1 ? set.max.x : set.min.x,
    i & 2 ? set.max.y : set.min.y,
    i & 4 ? set.max.z : set.min.z,
  ));

  const scratch = new THREE.Vector3();

  function place(dist) {
    /**
     * Raised enough to see over both lecterns at whoever is behind them — and,
     * on a window tall enough to push the camera outside the pan, enough to see
     * over the near rim as well, which is the one thing on the set that can
     * stand between the shot and a debater's feet.
     */
    const height = liftOverRim({ points: corners, dist, height: middle.y + dist * 0.22 });
    camera.position.set(0, height, dist);
    camera.near = Math.max(dist / 200, 0.01);
    camera.far = dist * 40;
    camera.updateProjectionMatrix();
    camera.lookAt(0, middle.y, 0);
    camera.updateMatrixWorld(true);
  }

  /** Inside the frame, and clear of the strips the captions and the bar have. */
  function fits(headroom, footroom) {
    const ceiling = 1 - 2 * headroom;
    const floor = -1 + 2 * footroom;
    return corners.every((corner) => {
      const ndc = scratch.copy(corner).project(camera);
      return Math.abs(ndc.x) <= 1 && ndc.y >= floor && ndc.y <= ceiling;
    });
  }

  /**
   * Framed by asking, rather than by trigonometry.
   *
   * A box fit gets it wrong here and a sphere fit gets it wrong the other way:
   * the stage is wide and shallow, the camera looks down it at an angle, and
   * the canvas takes whatever shape is left once the captions and the controls
   * have had theirs. So this walks the camera back until all eight corners of
   * the set are inside the frustum, which is the thing actually being asked,
   * and stops the moment they are.
   */
  function frame() {
    const half = Math.tan((camera.fov * Math.PI) / 360);
    /** A short window has no room to give away; a tall one has plenty. */
    const headroom = stage.clientHeight > 520 ? HEADROOM : HEADROOM / 2;
    /** The bar wraps to two rows on a narrow one, and takes more of it. */
    const footroom = stage.clientWidth < 720 ? FOOTROOM * 1.5 : FOOTROOM;
    let dist = Math.max(span.y / 2 / half, span.x / 2 / (half * (camera.aspect || 1)));

    place(dist);
    for (let i = 0; i < 80 && !fits(headroom, footroom); i += 1) {
      dist *= 1.04;
      place(dist);
    }

    place(dist * MARGIN);
    controls.target.set(0, middle.y, 0);
    controls.update();
  }

  /** Not a turntable, and not somewhere you can get under the floor from. */
  controls.autoRotate = false;
  controls.maxPolarAngle = SWING;
  controls.minDistance = 2.5;
  controls.maxDistance = 16;

  /**
   * How far out the set reaches, for the swing cap: the corner nearest whoever
   * is orbiting is the one the rim comes up in front of first.
   */
  const spread = Math.max(...corners.map((corner) => Math.hypot(corner.x, corner.z)));

  /**
   * Re-capped as the camera moves, because how far it may swing down depends on
   * how far out it is. Inside the pan there is nothing between it and the set;
   * outside, the rim is. Guarded because the clamp is applied by an update, and
   * an update is what got us here.
   */
  let capping = false;
  controls.addEventListener('change', () => {
    if (capping) return;
    capping = true;
    controls.maxPolarAngle = polarOverRim({
      dist: camera.position.distanceTo(controls.target),
      target: controls.target.y,
      radius: spread,
      limit: SWING,
    });
    controls.update();
    capping = false;
  });

  frame();

  /**
   * Re-framed when the window changes shape, but only until someone has moved
   * the camera themselves — after that, rotating a phone is not a reason to
   * throw away the angle they chose.
   */
  let moved = false;
  controls.addEventListener('start', () => { moved = true; });
  const observer = new ResizeObserver(() => { if (!moved) frame(); });
  observer.observe(stage);

  return { hall, egg, potato, left: potato, right: egg, frame, top: TOP };
}
