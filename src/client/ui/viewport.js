export function trackKeyboardInset(root = document.documentElement) {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();

  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
