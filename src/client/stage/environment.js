/**
 * The hall. One even wash rather than a dark floor, because there are two of
 * them and they both turn: whichever way either one faces has to hold up.
 *
 * The shadow map goes off entirely. A lumpy body throws one that crawls as it
 * turns, and the rigs draw a soft blot on the slab under themselves instead —
 * see `podium.js`.
 */
export function buildEnvironment({ stage, THREE }) {
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#e7e2d8'); g.addColorStop(0.5, '#9c968a');
    g.addColorStop(0.56, '#4a4740'); g.addColorStop(1, '#22201d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = 'rgba(255,247,232,0.95)'; ctx.beginPath();
    ctx.ellipse(20, 6, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    const tex = new THREE.Texture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(stage._renderer);
    stage._scene.environment = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();

    /**
     * A directional key is what makes an unlit side, and both of them turn
     * through every facing. So the key drops to the little that shape needs and
     * the rest of the light goes omnidirectional, with a counter on the corner
     * the stage leaves to the wash.
     */
    const hemi = [];
    const fills = [];
    stage._scene.traverse((o) => {
      if (o.isHemisphereLight) hemi.push(o);
      else if (o.isDirectionalLight && o !== stage._key) fills.push(o);
    });
    for (const light of hemi) light.intensity = 0.42;
    for (const light of fills) light.intensity = 0.28;
    if (stage._key) stage._key.intensity = 0.5;

    const ambient = new THREE.AmbientLight(0xfff3e4, 0.5);
    ambient.name = 'hall-ambient';
    stage._scene.add(ambient);

    const counter = new THREE.DirectionalLight(0xffeeda, 0.28);
    counter.name = 'hall-counter-fill';
    counter.position.set(-5, 2.5, 4);
    stage._scene.add(counter);

    /** One warm lamp over each lectern, so the podiums are not flat slabs. High
     *  and dim: close enough to blow out a pale shell is close enough to see. */
    for (const x of [-1.8, 1.8]) {
      const lamp = new THREE.PointLight(0xffe9cc, 3.2, 12, 2);
      lamp.name = `hall-lamp-${x < 0 ? 'left' : 'right'}`;
      lamp.position.set(x, 4.6, 2.2);
      stage._scene.add(lamp);
    }
  } catch {
  }
}

/**
 * Off at the renderer, so no per-mesh flag can leave a shadow behind: the map
 * is neither rendered nor sampled. The materials have already compiled with the
 * shadow path in them, so they have to be told to build again — skip that and
 * the shader keeps sampling a map that is no longer there, which renders
 * everything the key lights black.
 */
export function dropShadows({ stage, object }) {
  if (stage._renderer) stage._renderer.shadowMap.enabled = false;

  object.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (material) material.needsUpdate = true;
    }
  });

  if (stage._ground) stage._ground.visible = false;
}
