import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createToolSwitches } from '../../src/client/tools.js';
import { createToolsPanel } from '../../src/client/ui/tools.js';
import { loadPage } from '../helpers/dom.js';

/** What `/api/models` hands over for the xAI engine. */
const XAI_SWITCHES = [
  { name: 'web_search', label: 'web search' },
  { name: 'x_search', label: 'X search' },
  { name: 'mcp:almanac', label: 'almanac' },
];

function memory() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
}

describe('the tool switches', () => {
  it('has nothing to offer until an engine says what it has', () => {
    const switches = createToolSwitches({ storage: memory() });
    assert.deepEqual(switches.items, []);
    assert.deepEqual(switches.off, []);
  });

  it('opens with everything on, and only ever stores what was switched off', () => {
    const storage = memory();
    const switches = createToolSwitches({ storage });
    switches.setCatalog(XAI_SWITCHES);

    assert.deepEqual(switches.items.map((t) => t.enabled), [true, true, true]);

    switches.set('x_search', false);
    assert.deepEqual(switches.off, ['x_search']);
    assert.deepEqual(switches.labels, ['web search', 'almanac']);

    /** A second browser session picks up where this one left off. */
    const again = createToolSwitches({ storage });
    again.setCatalog(XAI_SWITCHES);
    assert.equal(again.enabled('x_search'), false);
    assert.equal(again.enabled('web_search'), true);
  });

  /**
   * The two engines name entirely different tools, and a browser holds switches
   * for both. One engine's list must not turn the other's switches back on.
   */
  it('remembers a switch for a tool the engine on now does not have', () => {
    const switches = createToolSwitches({ storage: memory() });
    switches.setCatalog(XAI_SWITCHES);
    switches.set('mcp:almanac', false);

    switches.setCatalog([]);
    assert.deepEqual(switches.items, []);
    assert.deepEqual(switches.off, ['mcp:almanac'], 'the switch was forgotten');

    switches.setCatalog(XAI_SWITCHES);
    assert.equal(switches.enabled('mcp:almanac'), false);
  });

  it('tells whoever is listening, so a live debate can be re-declared', () => {
    const switches = createToolSwitches({ storage: memory() });
    switches.setCatalog(XAI_SWITCHES);

    let told = 0;
    const stop = switches.subscribe(() => { told += 1; });

    switches.toggle('web_search');
    assert.equal(told, 1);

    /** Setting one to what it already is is not a change. */
    switches.set('web_search', false);
    assert.equal(told, 1);

    stop();
    switches.toggle('web_search');
    assert.equal(told, 1);
  });

  it('survives storage it cannot read or write', () => {
    const broken = {
      getItem: () => 'not json',
      setItem: () => { throw new Error('quota'); },
    };
    const switches = createToolSwitches({ storage: broken });
    switches.setCatalog(XAI_SWITCHES);
    assert.doesNotThrow(() => switches.set('web_search', false));
    assert.deepEqual(switches.off, ['web_search']);
  });

  it('drops entries from a catalog that are not tools', () => {
    const switches = createToolSwitches({ storage: memory() });
    switches.setCatalog([{ name: 'web_search' }, { label: 'nameless' }, null, 'x_search']);
    assert.deepEqual(switches.items.map((t) => t.label), ['web_search']);
  });
});

describe('the tools panel', () => {
  let page;
  let switches;
  let panel;
  let changes;

  beforeEach(async () => {
    page = await loadPage();
    switches = createToolSwitches({ storage: memory() });
    changes = 0;
    panel = createToolsPanel({
      root: page.document,
      switches,
      onChange: () => { changes += 1; },
    });
  });

  afterEach(() => page.close());

  it('finds everything it needs in the shipped markup', () => {
    for (const sel of ['#toolbox', '#toolbox-list', '#toolbox-toggle', '#toolbox-close']) {
      assert.ok(page.$(sel), `${sel} is missing from index.html`);
    }
  });

  it('says so rather than showing an empty list when there is nothing to switch', () => {
    panel.render();
    assert.equal(page.$$('#toolbox-list .tool-item').length, 0);
    assert.ok(page.$('#toolbox-list .empty'));
  });

  it('lists what the engine offers, each with a switch', () => {
    switches.setCatalog(XAI_SWITCHES);
    panel.render();

    assert.deepEqual(
      page.$$('#toolbox-list .tool-name').map((el) => el.textContent),
      ['web search', 'X search', 'almanac'],
    );
    assert.deepEqual(page.$$('#toolbox-list .switch').map((el) => el.textContent),
      ['on', 'on', 'on']);
  });

  it('switches one off, and says so to whoever is holding the calls', () => {
    switches.setCatalog(XAI_SWITCHES);
    panel.render();

    page.$$('#toolbox-list .switch')[1].dispatchEvent(
      new page.window.Event('click', { bubbles: true }),
    );

    assert.equal(switches.enabled('x_search'), false);
    assert.equal(changes, 1);
    assert.equal(page.$$('#toolbox-list .switch')[1].textContent, 'off');
    assert.equal(page.$$('#toolbox-list .tool-item')[1].dataset.on, 'false');
  });

  it('opens and closes from the tab, and says which it is', () => {
    switches.setCatalog(XAI_SWITCHES);
    const toggle = page.$('#toolbox-toggle');

    toggle.dispatchEvent(new page.window.Event('click', { bubbles: true }));
    assert.equal(panel.isOpen, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');

    toggle.dispatchEvent(new page.window.Event('click', { bubbles: true }));
    assert.equal(panel.isOpen, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  });
});
