import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { clock, createHud, tokens } from '../../src/client/ui/hud.js';
import { loadPage } from '../helpers/dom.js';

describe('the meters', () => {
  it('reads a clock the way a clock reads', () => {
    assert.equal(clock(0), '0:00');
    assert.equal(clock(9), '0:09');
    assert.equal(clock(605), '10:05');
  });

  it('counts both lecterns together, and stops counting digits past a thousand', () => {
    assert.equal(tokens({ egg: { input: 3, output: 4 } }), '7 tok');
    assert.equal(tokens({ egg: { input: 1200, output: 300 } }), '1.5k tok');
    assert.equal(tokens({}), '0 tok');
  });
});

describe('createHud', () => {
  let page;
  let hud;

  beforeEach(async () => {
    page = await loadPage();
    hud = createHud(page.document);
  });

  afterEach(() => page.close());

  it('finds every element it needs in the shipped markup', () => {
    for (const sel of ['#phase', '#motion', '#notice', '#mod',
      '#meter-turns', '#meter-clock', '#meter-tokens']) {
      assert.ok(page.$(sel), `${sel} is missing from index.html`);
    }
    assert.equal(page.$$('.lectern[data-debater]').length, 2);
  });

  it('drives the phase chip through both the text and the attribute', () => {
    hud.setPhase('running');
    assert.equal(page.$('#phase').textContent, 'running');
    assert.equal(page.$('#phase').dataset.phase, 'running');
  });

  it('says why it stopped, when it was told why', () => {
    hud.setPhase('over', 'time is up');
    assert.equal(page.$('#notice').textContent, 'time is up');
    assert.equal(page.$('#notice').classList.contains('visible'), true);
  });

  it('keeps a caption per lectern rather than one for the room', () => {
    hud.appendCaption('egg', 'bread ');
    hud.appendCaption('egg', 'is a scam');
    hud.appendCaption('potato', 'no');

    const egg = page.$('.lectern[data-debater="egg"] .caption');
    const potato = page.$('.lectern[data-debater="potato"] .caption');
    assert.equal(egg.textContent, 'bread is a scam');
    assert.equal(potato.textContent, 'no');

    hud.clearCaption('egg');
    assert.equal(egg.textContent, '');
    assert.equal(potato.textContent, 'no', 'clearing one cleared both');
  });

  it('renders the inline markup a model insists on emitting', () => {
    hud.appendCaption('egg', 'that is **not** true');
    assert.equal(page.$('.lectern[data-debater="egg"] .caption strong').textContent, 'not');
  });

  it('shrugs at a lectern that does not exist', () => {
    assert.doesNotThrow(() => hud.appendCaption('carrot', 'hello'));
  });

  it('marks who has the floor, including the person in the room', () => {
    hud.setFloor('egg');
    assert.equal(page.$('.lectern[data-debater="egg"]').dataset.floor, 'true');
    assert.equal(page.$('.lectern[data-debater="potato"]').dataset.floor, 'false');

    hud.setFloor('moderator');
    assert.equal(page.$('#mod').dataset.floor, 'true');
    assert.equal(page.$('.lectern[data-debater="egg"]').dataset.floor, 'false');
  });

  it('shows the microphone only once it is open', () => {
    assert.equal(page.$('#mod').dataset.live, 'false');
    hud.setMic({ open: true, level: 0.5 });
    assert.equal(page.$('#mod').dataset.live, 'true');
    assert.equal(page.$('#mod').style.getPropertyValue('--level'), '0.5');
  });

  it('tracks each lectern’s own state', () => {
    hud.setState('potato', 'thinking');
    assert.equal(page.$('.lectern[data-debater="potato"]').dataset.state, 'thinking');
    assert.equal(page.$('.lectern[data-debater="potato"] .state').textContent, 'thinking');
  });

  it('shows the meters as the director reports them', () => {
    hud.setMeter({ turns: 3, limit: 12, seconds: 65, usage: { egg: { input: 10, output: 5 } } });
    assert.equal(page.$('#meter-turns').textContent, '3/12 turns');
    assert.equal(page.$('#meter-clock').textContent, '1:05');
    assert.equal(page.$('#meter-tokens').textContent, '15 tok');
  });
});
