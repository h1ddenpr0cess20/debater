import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickTools, switchedOff, toolCatalog } from '../../src/server/xai/tools.js';

const ALL = {
  webSearch: true,
  xSearch: true,
  mcpServers: [
    { server_label: 'almanac', server_url: 'https://one.example/mcp' },
    { server_label: 'ledger', server_url: 'https://two.example/mcp' },
  ],
};

describe('toolCatalog', () => {
  it('names everything the environment switched on, in panel order', () => {
    assert.deepEqual(toolCatalog(ALL), [
      { name: 'web_search', label: 'web search' },
      { name: 'x_search', label: 'X search' },
      { name: 'mcp:almanac', label: 'almanac' },
      { name: 'mcp:ledger', label: 'ledger' },
    ]);
  });

  it('offers no switch for a tool the environment never enabled', () => {
    assert.deepEqual(toolCatalog({ webSearch: false, xSearch: false }), []);
    assert.deepEqual(toolCatalog(), []);
  });
});

describe('switchedOff', () => {
  it('keeps only the names this server actually has a switch for', () => {
    assert.deepEqual(switchedOff(ALL, ['x_search', 'mcp:ledger']), ['x_search', 'mcp:ledger']);
  });

  /** A browser holds switches across engines and across config changes. */
  it('shrugs at a switch for something that is not here', () => {
    assert.deepEqual(switchedOff(ALL, ['mcp:gone', 'remember', 42, null]), []);
    assert.deepEqual(switchedOff(ALL, 'web_search'), []);
    assert.deepEqual(switchedOff(ALL, undefined), []);
  });

  it('says each name once, however many times it was sent', () => {
    assert.deepEqual(switchedOff(ALL, ['web_search', 'web_search']), ['web_search']);
  });
});

describe('pickTools', () => {
  it('takes away exactly what was switched off', () => {
    const left = pickTools(ALL, ['web_search', 'mcp:almanac']);
    assert.equal(left.webSearch, false);
    assert.equal(left.xSearch, true);
    assert.deepEqual(left.mcpServers.map((s) => s.server_label), ['ledger']);
  });

  /** The contract: a page subtracts, and cannot add. */
  it('cannot switch on what the environment left off', () => {
    const left = pickTools({ webSearch: false, xSearch: true, mcpServers: [] }, []);
    assert.equal(left.webSearch, false);
  });

  it('is everything when nothing is off', () => {
    assert.deepEqual(pickTools(ALL), { ...ALL });
    assert.deepEqual(pickTools(ALL, []), { ...ALL });
  });
});
