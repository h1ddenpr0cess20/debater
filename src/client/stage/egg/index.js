import { ENERGY_GAIN, MOODS } from './moods.js';
import { approach, spring } from '../motion.js';
import { createShell } from './shell.js';
import { createShellSkin } from './skin.js';

const RADIUS = 0.78;

/**
 * How far he rolls from his spot before turning back. Shorter than he had the
 * floor to himself for — there is a lectern in front of him now, and somebody
 * else's on the other side.
 */
export const ROLL_REACH = 0.22;

/**
 * Marc, as a rig rather than a scene. The stage owns the lighting and decides
 * where he stands — this returns the group to hang off a podium, and the three
 * handles the debate drives him by.
 */
export function createEgg({ THREE, shadow = null }) {
  const skin = createShellSkin(THREE);
  const shell = createShell(THREE, skin);

  const marc = new THREE.Group();
  marc.name = 'marc';
  const spinner = new THREE.Group();
  spinner.name = 'spinner';
  const body = new THREE.Group();
  body.name = 'body';

  marc.add(spinner);
  spinner.add(body);
  body.add(shell.mesh);

  let mood = MOODS.idle;
  let state = 'idle';
  const m = { ...MOODS.idle };

  let sustain = 0;
  let impulse = 0;
  let energy = 0;

  const sq = { p: 0, v: 0 };
  const tx = { p: 0, v: 0 };
  const ty = { p: 0, v: 0 };
  const tz = { p: 0, v: 0 };

  let t = 0;
  let spinA = 0;
  let spinV = 0;
  let lie = 0;
  let ang = 0;
  let x = 0;
  let dir = 1;
  let rollPhase = 0;
  let rest = 0;
  let fidgetT = 2.4;

  const timer = new THREE.Timer();

  shell.mesh.onBeforeRender = () => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    t += dt;

    impulse = Math.max(0, impulse - impulse * Math.min(1, dt * 3.4) - dt * 0.05);
    energy = approach(energy, Math.min(1, sustain + impulse), 6, dt);

    for (const k in m) m[k] = approach(m[k], mood[k], 3.4, dt);

    const jitter = m.jitter * (1 + energy * ENERGY_GAIN.jitter);
    const squash = m.squash * (1 + energy * ENERGY_GAIN.squash);
    const rockAmp = m.rock + energy * ENERGY_GAIN.rock;

    const spinning = state === 'thinking';
    lie = approach(lie, spinning ? 1 : 0, 3.2, dt);
    if (spinning) {
      spinV += (m.spin - spinV) * Math.min(1, dt * 4.1) - spinV * 0.12 * dt;
    } else {
      spinV = approach(spinV, 0, 3.2, dt);
      if (Math.abs(spinV) < 0.05) spinV = 0;
    }
    spinA += spinV * dt;
    const precAmp = 0.018 * Math.min(1, Math.abs(spinV) / 6);
    const precA = spinA * 0.9;

    const rolling = m.roll > 0.02 && !spinning;
    let lift = 0;
    if (rolling) {
      if (rest > 0) {
        rest -= dt;
      } else {
        const speed = 1.15 * m.roll;
        rollPhase += dt * speed;
        ang += dir * dt * speed;
        x += dir * dt * speed * RADIUS;
        lift = Math.abs(Math.sin(rollPhase * 1.5)) * 0.035;
        if (Math.abs(x) > ROLL_REACH) {
          dir *= -1;
          rest = 0.5 + Math.random() * 0.6;
          sq.v += 1.2;
        }
      }
    } else {
      x = approach(x, 0, 1.8, dt);
      ang = approach(ang, 0, 1.8, dt);
      rest = 0;
    }

    if (m.fidget > 0.01) {
      fidgetT -= dt * m.fidget;
      if (fidgetT <= 0) {
        const r = Math.random();
        if (r < 0.45) sq.v += 1.8;
        else if (r < 0.75) ty.v += (Math.random() < 0.5 ? -1 : 1) * 2.2;
        else { tz.v += (Math.random() - 0.5) * 4; tx.v += 1.2; }
        fidgetT = 2.6 + Math.random() * 4;
      }
    }

    spring(sq, 175, 10.5, dt, squash);
    const rock = Math.sin(t * m.rockSpeed * 2.0) * rockAmp;
    spring(tz, 68, 6.2, dt, rolling && rest <= 0 ? dir * 0.1 : rock);
    spring(tx, 68, 6.2, dt, m.lean * 0.2);
    spring(ty, 38, 4.8, dt, 0);

    const tremor = jitter * 0.014;
    const breathe = Math.sin(t * 1.3) * 0.007;
    const orbit = lie * Math.min(1, Math.abs(spinV) / 9) * 0.075;

    marc.position.set(
      x + Math.cos(spinA * 0.9) * orbit + (Math.random() - 0.5) * tremor,
      lift + breathe * 0.5 + Math.abs(rock) * 0.34 - lie * 0.2,
      Math.sin(spinA * 0.9) * orbit + (Math.random() - 0.5) * tremor,
    );
    marc.rotation.set(
      tx.p + Math.sin(precA) * precAmp + (Math.random() - 0.5) * tremor,
      ty.p,
      tz.p + Math.cos(precA) * precAmp + (Math.random() - 0.5) * tremor * 1.3,
    );

    spinner.rotation.y = spinA;
    body.rotation.set(lie * Math.PI * 0.5, 0, -ang + lie * Math.sin(spinA * 0.9) * 0.05);

    const s = sq.p * 0.085 + breathe;
    body.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);

    /** The blot under him, which is all the shadow he gets on a lit stage. */
    if (shadow) {
      shadow.position.x = marc.position.x;
      shadow.position.z = marc.position.z;
      const spread = 1 - Math.min(0.45, Math.max(0, marc.position.y) * 1.2);
      shadow.scale.setScalar(spread);
      shadow.material.opacity = 0.34 * spread;
    }
  };

  return {
    group: marc,
    /** How far he gets from where he was put. The stage keeps that much clear. */
    reach: ROLL_REACH,
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
      sq.v += w * 2.4;
      tz.v += (Math.random() - 0.5) * w * 2.6;
    },
  };
}
