import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { MOTIONS, createControls } from '../../src/client/ui/controls.js';
import { loadPage } from '../helpers/dom.js';

const OPENAI = {
  id: 'openai',
  label: 'OpenAI Realtime',
  ready: true,
  model: 'gpt-realtime-2.1',
  models: [{ id: 'gpt-realtime-2.1', display_name: 'gpt-realtime-2.1' }, { id: 'other-realtime' }],
  voices: ['ash', 'cedar', 'verse'],
  voices_for: { potato: 'cedar', egg: 'ash' },
  switches: [],
};

const XAI = {
  id: 'xai',
  label: 'xAI Grok Voice',
  ready: true,
  model: 'grok-voice-latest',
  models: [{ id: 'grok-voice-latest' }],
  voices: ['atlas', 'orion', 'rex'],
  voices_for: { potato: 'atlas', egg: 'orion' },
  switches: [{ name: 'web_search', label: 'web search' }],
};

const CATALOG = {
  engine: 'openai',
  engines: [OPENAI, XAI],
  debaters: [
    { id: 'potato', name: 'Tater', accent: '#2f5d92' },
    { id: 'egg', name: 'Marc', accent: '#8e3232' },
  ],
  caps: { turns: 9, seconds: 300 },
};

/** A server with one key set: the other engine's models are not offered at all. */
const ONE_ENGINE = { ...CATALOG, engines: [OPENAI, { ...XAI, ready: false }] };

describe('createControls', () => {
  let page;
  let controls;
  let status;
  const calls = [];

  beforeEach(async () => {
    page = await loadPage();
    status = { phase: 'idle', mic: false };
    calls.length = 0;
    controls = createControls({
      root: page.document,
      getStatus: () => status,
      onStart: (topic) => calls.push(['start', topic]),
      onSay: (text) => calls.push(['say', text]),
      onMic: () => calls.push(['mic']),
      onToggle: () => calls.push(['toggle']),
      onStop: (why) => calls.push(['stop', why]),
      onModelChange: (model) => calls.push(['model', model]),
      onVoiceChange: (id, voice) => calls.push(['voice', id, voice]),
      onCaps: (caps) => calls.push(['caps', caps]),
      onHeckle: (on) => calls.push(['heckle', on]),
      onCancel: () => calls.push(['cancel']),
    });
  });

  afterEach(() => page.close());

  it('finds every control it needs in the shipped markup', () => {
    for (const sel of ['#controls', '#topic', '#mic', '#start', '#pause', '#stop', '#shuffle',
      '#model', '#voices', '#heckle', '#cap-turns', '#cap-minutes']) {
      assert.ok(page.$(sel), `${sel} is missing from index.html`);
    }
  });

  it('builds one voice picker per lectern, each on its own voice', () => {
    const chosen = controls.setCatalog(CATALOG);
    assert.deepEqual(chosen.voices, { potato: 'cedar', egg: 'ash' });
    assert.equal(page.$$('#voices select').length, 2);
    assert.ok(page.$('#voice-egg'));
  });

  it('opens the caps on whatever the server said', () => {
    controls.setCatalog(CATALOG);
    assert.equal(page.$('#cap-turns').value, '9');
    assert.equal(page.$('#cap-minutes').value, '5');
    assert.deepEqual(controls.caps(), { turns: 9, seconds: 300 });
  });

  it('will not start a debate with no motion', () => {
    controls.setCatalog(CATALOG);
    assert.equal(page.$('#start').disabled, true);
    page.$('#topic').value = 'rent control';
    page.$('#topic').dispatchEvent(new page.window.Event('input'));
    assert.equal(page.$('#start').disabled, false);
  });

  it('fills the motion in for you when asked', () => {
    page.$('#shuffle').click();
    assert.ok(MOTIONS.includes(page.$('#topic').value));
  });

  it('starts a debate with the field, and moderates with it once one is running', () => {
    controls.setCatalog(CATALOG);
    page.$('#topic').value = 'rent control';
    page.$('#controls').dispatchEvent(new page.window.Event('submit'));
    assert.deepEqual(calls.at(-1), ['start', 'rent control']);

    status.phase = 'running';
    controls.sync();
    page.$('#topic').value = 'Tater, answer that';
    page.$('#controls').dispatchEvent(new page.window.Event('submit'));
    assert.deepEqual(calls.at(-1), ['say', 'Tater, answer that']);
    assert.equal(page.$('#topic').value, '', 'the line stayed in the box');
  });

  it('renames the button rather than moving it', () => {
    controls.setCatalog(CATALOG);
    assert.equal(page.$('#start').textContent, 'debate');
    status.phase = 'running';
    controls.sync();
    assert.equal(page.$('#start').textContent, 'say');
    status.phase = 'connecting';
    controls.sync();
    assert.equal(page.$('#start').textContent, 'dialling…');
  });

  it('only offers stop and pause while something is running', () => {
    controls.sync();
    assert.equal(page.$('#stop').disabled, true);
    assert.equal(page.$('#pause').disabled, true);

    status.phase = 'running';
    controls.sync();
    assert.equal(page.$('#stop').disabled, false);
    assert.equal(page.$('#pause').disabled, false);
    assert.equal(page.$('#pause').getAttribute('aria-pressed'), 'false');

    /** The button is a glyph, so what it says it does lives in the label. */
    status.phase = 'paused';
    controls.sync();
    assert.equal(page.$('#pause').getAttribute('aria-pressed'), 'true');
    assert.match(page.$('#pause').getAttribute('aria-label'), /carry on/i);
  });

  it('offers the caps as a short list rather than a spinner', () => {
    for (const sel of ['#cap-turns', '#cap-minutes']) {
      assert.equal(page.$(sel).tagName, 'SELECT');
      assert.ok(page.$$(`${sel} option`).length > 3, `${sel} has nothing to pick from`);
    }
  });

  it('finds room in the list for a cap nobody thought of', () => {
    controls.setCatalog({ ...CATALOG, caps: { turns: 7, seconds: 660 } });
    assert.equal(page.$('#cap-turns').value, '7');
    assert.equal(page.$('#cap-minutes').value, '11');
    assert.deepEqual(controls.caps(), { turns: 7, seconds: 660 });
  });

  it('locks the model and the voices once the calls are up', () => {
    controls.setCatalog(CATALOG);
    status.phase = 'running';
    controls.sync();
    assert.equal(page.$('#model').disabled, true);
    assert.equal(page.$('#voice-egg').disabled, true);
    assert.equal(page.$('#cap-turns').disabled, true);
  });

  it('shows the microphone as open when it is', () => {
    status.mic = true;
    controls.sync();
    assert.equal(page.$('#mic').getAttribute('aria-pressed'), 'true');
    status.mic = false;
    controls.sync();
    assert.equal(page.$('#mic').getAttribute('aria-pressed'), 'false');
  });

  it('toggles the cut-ins, and says which way it went', () => {
    page.$('#heckle').click();
    assert.deepEqual(calls.at(-1), ['heckle', false]);
    assert.equal(page.$('#heckle').textContent, 'cut-ins off');
    page.$('#heckle').click();
    assert.deepEqual(calls.at(-1), ['heckle', true]);
  });

  it('makes space bar the pause, unless you are typing', () => {
    const key = (target) => target.dispatchEvent(
      new page.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );

    key(page.document.body);
    assert.deepEqual(calls.at(-1), ['toggle']);

    calls.length = 0;
    key(page.$('#topic'));
    assert.deepEqual(calls, [], 'a space in the motion paused the debate');
  });

  it('makes escape the way out', () => {
    page.document.dispatchEvent(
      new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    assert.deepEqual(calls.at(-1), ['cancel']);
  });

  it('says so, and stops offering to dial, when the catalog is unreachable', () => {
    controls.catalogUnavailable();
    assert.equal(page.$('#start').disabled, true);
    assert.equal(page.$('#mic').disabled, true);
    assert.equal(page.$('#model').textContent, 'unavailable');
  });

  describe('the model picker', () => {
    /** There is no engine switch. The model is the switch. */
    const groups = () => page.$$('#model optgroup').map((g) => g.label);
    const models = () => page.$$('#model option').map((o) => o.value);
    const change = (value) => {
      page.$('#model').value = value;
      page.$('#model').dispatchEvent(new page.window.Event('change'));
      return calls.at(-1)[1];
    };

    it('lists every model this server can dial, under whoever runs it', () => {
      controls.setCatalog(CATALOG);
      assert.deepEqual(groups(), ['OpenAI Realtime', 'xAI Grok Voice']);
      assert.deepEqual(models(), ['gpt-realtime-2.1', 'other-realtime', 'grok-voice-latest']);
    });

    it('leaves out an engine there is no key for', () => {
      controls.setCatalog(ONE_ENGINE);
      assert.deepEqual(groups(), ['OpenAI Realtime']);
      assert.deepEqual(models(), ['gpt-realtime-2.1', 'other-realtime']);
    });

    it('opens on the model the server named', () => {
      const chosen = controls.setCatalog({ ...CATALOG, engine: 'xai' });
      assert.equal(chosen.engine, 'xai');
      assert.equal(chosen.model, 'grok-voice-latest');
      assert.equal(page.$('#model').value, 'grok-voice-latest');
    });

    it('opens on one it can dial when the named engine cannot', () => {
      const chosen = controls.setCatalog({ ...ONE_ENGINE, engine: 'xai' });
      assert.equal(chosen.engine, 'openai');
      assert.equal(chosen.model, 'gpt-realtime-2.1');
    });

    it('says which engine a model belongs to, so nothing has to parse a name', () => {
      controls.setCatalog(CATALOG);
      const byEngine = page.$$('#model option').map((o) => o.dataset.engine);
      assert.deepEqual(byEngine, ['openai', 'openai', 'xai']);
    });

    it('picking a Grok model is what puts the debate on xAI', () => {
      controls.setCatalog(CATALOG);
      const chosen = change('grok-voice-latest');

      assert.equal(chosen.engine, 'xai');
      assert.equal(chosen.model, 'grok-voice-latest');
      assert.equal(chosen.changed, true, 'the page was not told to rebuild the calls');
      assert.deepEqual(chosen.voices, { potato: 'atlas', egg: 'orion' });
      assert.deepEqual(page.$$('#voice-egg option').map((o) => o.value), XAI.voices);
      assert.deepEqual(chosen.switches, XAI.switches);
    });

    /** A model on the same engine is a new model, not a new pair of calls. */
    it('does not rebuild anything for another model on the same engine', () => {
      controls.setCatalog(CATALOG);
      const chosen = change('other-realtime');

      assert.equal(chosen.engine, 'openai');
      assert.equal(chosen.changed, false);
      assert.deepEqual(chosen.voices, { potato: 'cedar', egg: 'ash' });
    });

    it('keeps the voices you chose when the engine has not moved', () => {
      controls.setCatalog(CATALOG);
      page.$('#voice-egg').value = 'verse';

      assert.deepEqual(change('other-realtime').voices, { potato: 'cedar', egg: 'verse' });
    });

    it('goes back again, with the voices that engine names', () => {
      controls.setCatalog(CATALOG);
      change('grok-voice-latest');
      const back = change('gpt-realtime-2.1');

      assert.equal(back.engine, 'openai');
      assert.equal(back.changed, true);
      assert.deepEqual(back.voices, { potato: 'cedar', egg: 'ash' });
      assert.deepEqual(back.switches, []);
    });

    it('is not something you change mid-debate', () => {
      controls.setCatalog(CATALOG);
      assert.equal(page.$('#model').disabled, false);

      status.phase = 'running';
      controls.sync();
      assert.equal(page.$('#model').disabled, true);
    });
  });
});
