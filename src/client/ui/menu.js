/**
 * The menu in the corner: one chip, and the list it drops.
 *
 * The panels behind the rows keep their own open and close — all this decides
 * is whether the list is on screen, and it gets out of the way the moment a row
 * is picked.
 */
export function createMenu({ root = document } = {}) {
  const menuEl = root.querySelector('#menu');
  const toggleEl = root.querySelector('#menu-toggle');
  const itemsEl = root.querySelector('#menu-items');

  function open() {
    itemsEl.hidden = false;
    toggleEl.setAttribute('aria-expanded', 'true');
  }

  function close() {
    itemsEl.hidden = true;
    toggleEl.setAttribute('aria-expanded', 'false');
  }

  toggleEl.addEventListener('click', () => (itemsEl.hidden ? open() : close()));

  /** Picking a row is the end of the menu's job — the panel takes it from here. */
  itemsEl.addEventListener('click', (e) => {
    if (e.target.closest('button')) close();
  });

  /**
   * Anywhere else — the stage, the composer, a panel — puts it away. Captured
   * on the way down, because a pointer landing on something grabbable on the
   * stage is stopped there and never bubbles this far.
   */
  menuEl.ownerDocument.addEventListener('pointerdown', (e) => {
    if (!itemsEl.hidden && !menuEl.contains(e.target)) close();
  }, true);

  return {
    open,
    close,

    get isOpen() {
      return !itemsEl.hidden;
    },
  };
}
