import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPage } from '../helpers/dom.js';

/**
 * The bits of the layout that have gone wrong once and would go wrong silently.
 *
 * These read the stylesheet rather than a rendered page, because none of it can
 * be rendered here — jsdom has no layout and no compositor. So they are contract
 * tests over the CSS: they cannot prove the room can be dragged, only that the
 * rule which lets it be dragged is still there and still paired with the one
 * that took it away. That is the part a later edit is liable to undo without
 * noticing, and it is worth a test even though the proof is a browser's job.
 */
const CSS = fileURLToPath(new URL('../../src/client/styles.css', import.meta.url));

let css;
const stylesheet = async () => (css ??= await readFile(CSS, 'utf8'));

/** The body of one top-level rule, by its selector. */
function rule(sheet, selector) {
  const at = sheet.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  const open = sheet.indexOf('{', at);
  return sheet.slice(open + 1, sheet.indexOf('}', open));
}

describe('the room, under the overlay', () => {
  /**
   * The stage lives inside `#top` so the captions can sit above it without the
   * canvas resizing. `#top` is `pointer-events: none` so a caption never eats a
   * click meant for the room — and because that inherits, it once took the
   * orbit controls with it and the room could not be turned at all.
   */
  it('is inside a stack that does not take pointer events', async () => {
    const page = await loadPage();
    try {
      const stage = page.$('three-d-stage');
      assert.ok(stage, 'the stage is missing from index.html');
      assert.equal(stage.closest('#top')?.id, 'top', 'the stage left the caption stack');
    } finally {
      page.close();
    }

    assert.match(rule(await stylesheet(), '#top'), /pointer-events:\s*none/);
  });

  it('takes them back for itself, or the room cannot be turned', async () => {
    assert.match(rule(await stylesheet(), 'three-d-stage'), /pointer-events:\s*auto/);
  });
});

describe('the lectern labels', () => {
  it('carry the party twice, so a narrow one can drop the long form', async () => {
    const page = await loadPage();
    try {
      for (const el of page.$$('.lectern[data-debater]')) {
        const party = el.querySelector('.party');
        assert.ok(party?.querySelector('.long')?.textContent, 'no long form to show');
        assert.ok(party?.querySelector('.short')?.textContent, 'no short form to fall back to');
      }
    } finally {
      page.close();
    }
  });

  it('show one of the two, never both and never neither', async () => {
    const sheet = await stylesheet();
    assert.match(sheet, /\.lectern \.party \.short \{ display: none; \}/);

    const narrow = sheet.slice(sheet.indexOf('@media (max-width: 600px)'));
    assert.match(narrow, /\.lectern \.party \.long \{ display: none; \}/);
    assert.match(narrow, /\.lectern \.party \.short \{ display: inline; \}/);
  });
});

describe('the options row', () => {
  it('is groups rather than loose controls, so it wraps in one piece', async () => {
    const page = await loadPage();
    try {
      const groups = page.$$('#options > .opt-group');
      assert.equal(groups.length, 2, '#options is not grouped');
      assert.ok(groups[0].querySelector('#model'), 'the model is not with the voices');
      assert.ok(groups[0].querySelector('#voices'));
      assert.ok(groups[1].querySelector('#heckle'), 'the switch is not with the caps');
      assert.ok(groups[1].querySelector('#cap-turns'));
      assert.ok(groups[1].querySelector('#cap-minutes'));
    } finally {
      page.close();
    }
  });

  /**
   * An auto margin in a wrapping flex container takes all the free space on the
   * first line, so whatever follows it has none left and wraps — however wide
   * the window is. That is what used to orphan the time cap on a line of its own.
   */
  it('does not push anything across with an auto margin', async () => {
    assert.doesNotMatch(rule(await stylesheet(), '#heckle'), /margin-left:\s*auto/);
  });
});
