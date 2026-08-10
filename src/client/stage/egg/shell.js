export function shapeEgg(positions) {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const taper = 1 - 0.075 * y - 0.055 * y * y;
    positions[i] *= 0.84 * taper;
    positions[i + 2] *= 0.84 * taper;
    positions[i + 1] = y * 1.03 + 0.01;
  }
  return positions;
}

export function createShell(THREE, skin) {
  const geometry = new THREE.SphereGeometry(1, 128, 96);
  shapeEgg(geometry.attributes.position.array);
  geometry.computeVertexNormals();

  const material = new THREE.MeshPhysicalMaterial({
    name: 'eggshell',
    color: new THREE.Color(skin.map ? '#ffffff' : '#f0e3cd'),
    map: skin.map,
    bumpMap: skin.bumpMap,
    bumpScale: 0.7,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.6,
    sheen: 0.4,
    sheenColor: new THREE.Color('#fff2dd'),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'shell';

  return { mesh, geometry, material };
}
