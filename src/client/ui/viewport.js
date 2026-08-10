/**
 * How tall the control bar is, published as a variable the captions sit above.
 *
 * It changes shape with the window — the buttons wrap onto a second line on a
 * phone — and the two lecterns' captions have to clear it, so this is measured
 * rather than guessed at in the stylesheet.
 */
export function trackControlsHeight(el, root = document.documentElement) {
  if (!el || typeof ResizeObserver === 'undefined') return () => {};

  const update = () => {
    root.style.setProperty('--controls-height', `${Math.round(el.offsetHeight)}px`);
  };

  const observer = new ResizeObserver(update);
  observer.observe(el);
  update();

  return () => observer.disconnect();
}

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
