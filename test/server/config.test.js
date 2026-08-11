import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KNOWN_VOICES, XAI_MODELS, XAI_VOICES, loadConfig } from '../../src/server/config.js';
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

describe('the engine', () => {
  it('is OpenAI unless something says otherwise', () => {
    assert.equal(loadConfig({ OPENAI_API_KEY: 'sk-test' }).engine, 'openai');
    assert.equal(loadConfig({}).engine, 'openai');
  });

  /** A server with one key set should open on the engine that key belongs to. */
  it('is the one there is a key for', () => {
    assert.equal(loadConfig({ XAI_API_KEY: 'xai-test' }).engine, 'xai');
    assert.equal(loadConfig({ XAI_API_KEY: 'xai-test', OPENAI_API_KEY: 'sk-test' }).engine, 'openai');
  });

  it('is whichever one was named outright', () => {
    const both = { OPENAI_API_KEY: 'sk-test', XAI_API_KEY: 'xai-test' };
    assert.equal(loadConfig({ ...both, ENGINE: 'xai' }).engine, 'xai');
    assert.equal(loadConfig({ ...both, ENGINE: ' XAI ' }).engine, 'xai');
    assert.equal(loadConfig({ ...both, ENGINE: 'anthropic' }).engine, 'openai');
  });
});

describe('the xAI engine', () => {
  it('offers every voice, and gives the two lecterns different ones', () => {
    const { xai } = loadConfig({});
    assert.deepEqual(xai.voices, [...XAI_VOICES]);
    assert.equal(xai.voices.length, 26);
    assert.notEqual(xai.debaterVoices.egg, xai.debaterVoices.potato);
    for (const voice of Object.values(xai.debaterVoices)) assert.ok(XAI_VOICES.includes(voice));
  });

  it('lets the environment pick a voice per lectern, and ignores nonsense', () => {
    const { xai } = loadConfig({ EGG_XAI_VOICE: 'kepler', POTATO_XAI_VOICE: 'morgan-freeman' });
    assert.equal(xai.debaterVoices.egg, 'kepler');
    assert.equal(xai.debaterVoices.potato, loadConfig({}).xai.debaterVoices.potato);
  });

  /** The OpenAI pickers and the xAI ones name entirely different voices. */
  it('keeps its voices out of the other engine’s picker', () => {
    const config = loadConfig({});
    assert.equal(config.voices.some((v) => XAI_VOICES.includes(v)), false);
    assert.equal(config.xai.voices.some((v) => KNOWN_VOICES.includes(v)), false);
  });

  it('takes a model nobody published, and puts it first', () => {
    const { xai } = loadConfig({ XAI_MODEL: 'grok-voice-experimental' });
    assert.equal(xai.defaultModel, 'grok-voice-experimental');
    assert.deepEqual(xai.models, ['grok-voice-experimental', ...XAI_MODELS]);
  });

  it('has the hosted tools on, and can be told to switch one off', () => {
    assert.deepEqual(loadConfig({}).xai.tools.webSearch, true);
    assert.deepEqual(loadConfig({ XAI_X_SEARCH: 'false' }).xai.tools.xSearch, false);
  });

  it('reads MCP servers out of the environment and drops malformed ones', () => {
    const { xai } = loadConfig({
      XAI_MCP_SERVERS: JSON.stringify([
        { server_label: 'almanac', server_url: 'https://one.example/mcp' },
        { server_label: 'no-url' },
      ]),
    });
    assert.deepEqual(xai.tools.mcpServers.map((s) => s.server_label), ['almanac']);
  });

  it('says nothing rather than throwing when that is not JSON', () => {
    assert.deepEqual(loadConfig({ XAI_MCP_SERVERS: '{' }).xai.tools.mcpServers, []);
  });
});
