import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CATALOG } from '../../src/server/connectors/catalog.js';
import { createConnectors } from '../../src/server/connectors/index.js';
import { applyPatch, describe as summarise } from '../../src/server/connectors/settings.js';

async function registry(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'debater-connectors-'));
  const file = join(dir, 'connectors.json');
  return { file, connectors: createConnectors({ connectors: { file, ...extra } }) };
}

describe('the connector catalog', () => {
  it('is empty, which is the state of the feature rather than a bug', () => {
    assert.deepEqual(CATALOG, []);
  });
});

describe('createConnectors', () => {
  it('declares no tools, because nothing is registered', async () => {
    const { connectors } = await registry();
    assert.deepEqual(connectors.tools, []);
    assert.deepEqual(connectors.names, []);
    assert.equal(connectors.enabled, false);
    assert.deepEqual(connectors.labels, {});
  });

  it('describes an empty catalog to the panel rather than failing at it', async () => {
    const { connectors } = await registry();
    assert.deepEqual(connectors.settings(), { connectors: [] });
  });

  it('answers no tool name at all', async () => {
    const { connectors } = await registry();
    assert.equal(connectors.handles('anything'), false);
    assert.equal(connectors.handles(''), false);
    assert.deepEqual(await connectors.run('anything'), {
      ok: false,
      error: 'anything is not a connector tool',
    });
  });

  it('refuses a patch naming something that is not registered', async () => {
    const { connectors } = await registry();
    const result = connectors.configure({ enabled: { almanac: true } });
    assert.equal(result.ok, false);
    assert.match(result.error, /almanac/);
  });

  it('saves an empty patch rather than throwing at one', async () => {
    const { connectors, file } = await registry();
    const result = connectors.configure({});
    assert.equal(result.ok, true);
    assert.equal(result.saved, true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { enabled: {}, options: {} });
  });

  it('warns about an environment naming a connector nobody wrote', async () => {
    const warned = [];
    const warn = console.warn;
    console.warn = (line) => warned.push(line);
    try {
      await registry({ enabled: ['almanac'] });
    } finally {
      console.warn = warn;
    }
    assert.match(warned.join('\n'), /almanac/);
  });

  it('closes cleanly with nothing open', async () => {
    const { connectors } = await registry();
    assert.doesNotThrow(() => connectors.close());
  });
});

describe('settings', () => {
  it('validates against the catalog rather than against the caller', () => {
    const state = { file: 'x', enabled: {}, options: {} };
    assert.throws(() => applyPatch(state, { options: { almanac: {} } }), /almanac/);
    assert.deepEqual(applyPatch(state, {}), state);
  });

  it('summarises the empty catalog as an empty list', () => {
    assert.deepEqual(summarise({ enabled: {}, options: {} }), { connectors: [] });
  });
});
