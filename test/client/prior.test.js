import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PRIOR_CHARS, historyItem, prior } from '../../src/client/session/prior.js';

const turns = [
  { speaker: 'moderator', content: 'the motion is bread' },
  { speaker: 'egg', content: 'bread is a scam' },
  { speaker: 'potato', content: 'bread is fine' },
];

describe('prior', () => {
  it('shows each lectern its own lines as its own', () => {
    assert.deepEqual(prior(turns, 'egg'), [
      { role: 'user', content: 'the motion is bread' },
      { role: 'assistant', content: 'bread is a scam' },
      { role: 'user', content: 'bread is fine' },
    ]);
  });

  it('flips with the point of view', () => {
    const seen = prior(turns, 'potato');
    assert.equal(seen[1].role, 'user');
    assert.equal(seen[2].role, 'assistant');
  });

  it('counts the moderator as somebody else, from both lecterns', () => {
    for (const id of ['egg', 'potato']) {
      assert.equal(prior(turns, id)[0].role, 'user');
    }
  });

  it('drops the empty and the malformed', () => {
    assert.deepEqual(prior([{ speaker: 'egg' }, { content: 'x' }, null], 'egg'), [
      { role: 'user', content: 'x' },
    ]);
  });

  it('keeps the last forty turns, because the last is what the next follows from', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ speaker: 'egg', content: `t${i}` }));
    const kept = prior(many, 'egg');
    assert.equal(kept.length, 40);
    assert.equal(kept.at(-1).content, 't59');
  });

  it('trims from the front until the whole thing fits the budget', () => {
    const fat = Array.from({ length: 5 }, (_, i) => ({ speaker: 'egg', content: `${i}`.repeat(2000) }));
    const kept = prior(fat, 'egg');
    const total = kept.reduce((sum, turn) => sum + turn.content.length, 0);
    assert.ok(total <= PRIOR_CHARS, `${total} over budget`);
    assert.equal(kept.at(-1).content[0], '4');
  });

  it('takes nothing at all in its stride', () => {
    assert.deepEqual(prior(undefined, 'egg'), []);
  });
});

describe('historyItem', () => {
  it('uses the output shape for what this one said', () => {
    const item = historyItem({ role: 'assistant', content: 'mine' });
    assert.equal(item.item.content[0].type, 'output_text');
    assert.equal(item.item.status, 'completed');
  });

  it('uses the input shape for everybody else', () => {
    assert.equal(historyItem({ role: 'user', content: 'theirs' }).item.content[0].type, 'input_text');
  });
});
