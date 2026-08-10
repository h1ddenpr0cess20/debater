const WIDTH = 2048;
const HEIGHT = 1024;
const SPECKLES = 900;

const INERT = { map: null, bumpMap: null };

function canvas2d(width, height) {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  return ctx ? { el, ctx } : null;
}

export function createShellSkin(THREE, { width = WIDTH, height = HEIGHT, random = Math.random } = {}) {
  const colour = canvas2d(width, height);
  const bump = canvas2d(width, height);
  if (!colour || !bump) return INERT;

  const g = colour.ctx;
  g.fillStyle = '#f0e3cd';
  g.fillRect(0, 0, width, height);

  const b = bump.ctx;
  b.fillStyle = '#808080';
  b.fillRect(0, 0, width, height);

  for (let i = 0; i < SPECKLES; i++) {
    const x = random() * width;
    const y = random() * height;
    const r = 1.5 + random() * 5.5;
    const a = 0.05 + random() * 0.16;
    const warm = random() < 0.5;

    g.fillStyle = warm ? `rgba(168,132,86,${a})` : `rgba(120,104,88,${a * 0.8})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    g.fill();

    b.fillStyle = `rgba(90,90,90,${a * 1.6})`;
    b.beginPath();
    b.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    b.fill();
  }

  const map = new THREE.CanvasTexture(colour.el);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bumpMap = new THREE.CanvasTexture(bump.el);

  return { map, bumpMap };
}
