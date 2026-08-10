import { ENERGY_GAIN, MOODS } from './moods.js';
import { approach, spring } from '../motion.js';
import { createTuber } from './tuber.js';

/**
 * A potato stands on his end: long axis up, so he tips about x to lean in and
 * about z to rock and waddle, and steps out and back along z. Thinking is the
 * one state that lays him down, which is what the stance tilt is for.
 *
 * Same rig as he had to himself; what changed is that the stage places him now,
 * and a lectern top is smaller than a floor.
 */

/**
 * How far he wanders from his spot before turning back. Shorter than he had the
 * floor to himself for — there is a lectern in front of him now.
 */
export const STEP_REACH = 0.22;

/**
 * The body is authored lying along x, so standing is a quarter turn about z.
 * Negative swings the fatter end down, which is the end a potato sits on.
 */
const STAND = -Math.PI / 2;

export function createPotato({ THREE, shadow = null }) {
  const tuber = createTuber(THREE);

  const tater = new THREE.Group();
  tater.name = 'tater';
  const spinner = new THREE.Group();
  spinner.name = 'spinner';
  const body = new THREE.Group();
  body.name = 'body';
  // Under the squash, so the squash stays vertical while he tips over to think.
  const stance = new THREE.Group();
  stance.name = 'stance';
  stance.rotation.z = STAND * MOODS.idle.stand;

  tater.add(spinner);
  spinner.add(body);
  body.add(stance);
  stance.add(tuber.mesh);

  let mood = MOODS.idle;
  let state = 'idle';
  const m = { ...MOODS.idle };

  let sustain = 0;
  let impulse = 0;
  let energy = 0;

  const sq = { p: 0, v: 0 };    // squash, vertical
  const nod = { p: 0, v: 0 };   // tilt about z — the lean, and the waddle on it
  const sway = { p: 0, v: 0 };  // tilt about x — the rock, and leaning into a step
  const turn = { p: 0, v: 0 };  // yaw about y — a fidgeting look around

  let t = 0;
  let spinA = 0;
  let spinV = 0;
  let z = 0;
  let dir = 1;
  let stepPhase = 0;
  let rest = 0;
  let fidgetT = 2.4;

  const timer = new THREE.Timer();

  tuber.mesh.onBeforeRender = () => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    t += dt;

    impulse = Math.max(0, impulse - impulse * Math.min(1, dt * 3.4) - dt * 0.05);
    energy = approach(energy, Math.min(1, sustain + impulse), 6, dt);

    for (const k in m) m[k] = approach(m[k], mood[k], 3.4, dt);

    const jitter = m.jitter * (1 + energy * ENERGY_GAIN.jitter);
    const squash = m.squash * (1 + energy * ENERGY_GAIN.squash);
    const rockAmp = m.rock + energy * ENERGY_GAIN.rock;

    // Thinking lays him off his end onto his belly and spins him there, with the
    // wobble of anything spun off axis. The stance tilt below does the lying.
    const spinning = state === 'thinking';
    if (spinning) {
      spinV += (m.spin - spinV) * Math.min(1, dt * 4.1) - spinV * 0.12 * dt;
    } else {
      spinV = approach(spinV, 0, 3.2, dt);
      if (Math.abs(spinV) < 0.05) spinV = 0;
    }
    spinA += spinV * dt;
    const wobble = Math.min(1, Math.abs(spinV) / 9);
    const precAmp = 0.03 * Math.min(1, Math.abs(spinV) / 6);
    const precA = spinA * 0.9;

    // Talking walks him out and back: a waddle over his base, one bob per step.
    const walking = m.step > 0.02 && !spinning;
    let lift = 0;
    let waddle = 0;
    if (walking) {
      if (rest > 0) {
        rest -= dt;
      } else {
        const speed = 1.15 * m.step;
        stepPhase += dt * speed;
        z += dir * dt * speed * tuber.radius;
        waddle = Math.sin(stepPhase * 5.2) * 0.09;
        lift = Math.abs(Math.sin(stepPhase * 5.2)) * 0.03;
        if (Math.abs(z) > STEP_REACH) {
          dir *= -1;
          rest = 0.5 + Math.random() * 0.6;
          sq.v += 1.2;
        }
      }
    } else {
      z = approach(z, 0, 1.8, dt);
      rest = 0;
    }

    if (m.fidget > 0.01) {
      fidgetT -= dt * m.fidget;
      if (fidgetT <= 0) {
        const r = Math.random();
        if (r < 0.45) sq.v += 1.8;
        else if (r < 0.75) turn.v += (Math.random() < 0.5 ? -1 : 1) * 1.6;
        else { sway.v += (Math.random() - 0.5) * 4; nod.v += 1.2; }
        fidgetT = 2.6 + Math.random() * 4;
      }
    }

    spring(sq, 175, 10.5, dt, squash);
    const rock = Math.sin(t * m.rockSpeed * 2.0) * rockAmp;
    spring(sway, 68, 6.2, dt, walking && rest <= 0 ? dir * 0.1 : rock);
    spring(nod, 68, 6.2, dt, m.lean * 0.2 + waddle);
    spring(turn, 38, 4.8, dt, 0);

    const tremor = jitter * 0.014;
    const breathe = Math.sin(t * 1.3) * 0.007;
    const orbit = wobble * 0.05;

    tater.position.set(
      Math.cos(spinA * 0.9) * orbit + (Math.random() - 0.5) * tremor,
      lift + breathe * 0.5 + Math.abs(rock) * 0.34,
      z + Math.sin(spinA * 0.9) * orbit + (Math.random() - 0.5) * tremor,
    );
    tater.rotation.set(
      sway.p + Math.cos(precA) * precAmp + (Math.random() - 0.5) * tremor * 1.3,
      turn.p,
      nod.p + Math.sin(precA) * precAmp + (Math.random() - 0.5) * tremor,
    );

    spinner.rotation.y = spinA;
    stance.rotation.z = STAND * m.stand;

    const s = sq.p * 0.085 + breathe;
    body.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);

    /**
     * The blot under him. A lumpy body throws a shadow map that crawls as it
     * turns, so the stage renders none and draws this instead.
     */
    if (shadow) {
      shadow.position.x = tater.position.x;
      shadow.position.z = tater.position.z;
      const spread = 1 - Math.min(0.45, Math.max(0, tater.position.y) * 1.2);
      shadow.scale.setScalar(spread);
      shadow.material.opacity = 0.34 * spread;
    }
  };

  return {
    group: tater,
    /** How far he gets from where he was put. The stage keeps that much clear. */
    reach: STEP_REACH,
    get state() { return state; },

    setState(next) {
      if (!Object.hasOwn(MOODS, next) || next === state) return;
      state = next;
      mood = MOODS[next];
      if (next === 'idle' || next === 'thinking') sustain = 0;
    },

    setLevel(level) {
      sustain = Math.min(1, Math.max(0, level));
    },

    pulse(weight = 0.3) {
      const w = Math.min(1, Math.max(0, weight));
      impulse = Math.min(1, impulse + w);
      sway.v += (Math.random() - 0.5) * w * 2.6;
      sq.v += w * 2.4;
    },
  };
}
