import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KNOWN_VOICES, loadConfig } from '../../src/server/config.js';
import { DEBATERS } from '../../src/server/personas.js';

describe('loadConfig', () => {
  it('reads nothing from the ambient environment', () => {
    const config = loadConfig({});
    assert.equal(config.apiKey, undefined);
    assert.equal(config.port, 5173);
    assert.equal(config.baseUrl, 'https://api.openai.com/v1');
  });

  it('gives each lectern its own voice, from the persona by default', () => {
    const config = loadConfig({});
    assert.equal(config.debaterVoices.egg, DEBATERS.egg.voice);
    assert.equal(config.debaterVoices.potato, DEBATERS.potato.voice);
    assert.notEqual(config.debaterVoices.egg, config.debaterVoices.potato);
  });

  it('lets the environment pick a voice per lectern, and ignores nonsense', () => {
    const config = loadConfig({ EGG_VOICE: 'verse', POTATO_VOICE: 'kevin' });
    assert.equal(config.debaterVoices.egg, 'verse');
    assert.equal(config.debaterVoices.potato, DEBATERS.potato.voice);
  });

  it('offers every known voice to both of them', () => {
    assert.deepEqual(loadConfig({}).voices, [...KNOWN_VOICES]);
  });

  it('has caps whether or not anybody asked for them', () => {
    const { caps } = loadConfig({});
    assert.ok(caps.turns > 0 && caps.seconds > 0 && caps.idleSeconds > 0);
  });

  it('takes caps from the environment, and refuses junk rather than removing one', () => {
    const caps = loadConfig({ DEBATE_TURNS: '4', DEBATE_SECONDS: 'forever' }).caps;
    assert.equal(caps.turns, 4);
    assert.equal(caps.seconds, loadConfig({}).caps.seconds);
  });

  it('names no connectors unless it is told to', () => {
    assert.deepEqual(loadConfig({}).connectors.enabled, []);
    assert.deepEqual(loadConfig({ CONNECTORS: 'a, b' }).connectors.enabled, ['a', 'b']);
  });
});
