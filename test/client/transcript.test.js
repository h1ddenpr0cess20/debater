import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KEY, createTranscripts } from '../../src/client/debate/transcript.js';

function storage(seed = null) {
  const map = new Map(seed ? [[KEY, JSON.stringify(seed)]] : []);
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function clock(start = 1_700_000_000_000) {
  let at = start;
  return () => (at += 1000);
}

describe('createTranscripts', () => {
  it('files a turn under whoever said it', () => {
    const log = createTranscripts({ storage: storage(), now: clock() });
    log.begin({ topic: 'bread', model: 'gpt-realtime-2.1' });
    log.append({ speaker: 'egg', content: 'bread is a scam' });
    log.append({ speaker: 'moderator', content: 'Tater?' });

    const [debate] = log.debates;
    assert.equal(debate.topic, 'bread');
    assert.deepEqual(debate.turns.map((t) => t.speaker), ['egg', 'moderator']);
  });

  it('refuses a turn with nothing in it, or nobody behind it', () => {
    const log = createTranscripts({ storage: storage(), now: clock() });
    log.begin({ topic: 'bread' });
    assert.equal(log.append({ speaker: 'egg', content: '   ' }), null);
    assert.equal(log.append({ content: 'orphan' }), null);
    assert.deepEqual(log.debates[0]?.turns ?? [], []);
  });

  it('opens a debate on the first turn if nobody opened one', () => {
    const log = createTranscripts({ storage: storage(), now: clock() });
    log.append({ speaker: 'egg', content: 'unprompted' });
    assert.equal(log.debates.length, 1);
    assert.ok(log.live);
  });

  it('survives a reload', () => {
    const store = storage();
    const first = createTranscripts({ storage: store, now: clock() });
    first.begin({ topic: 'bread' });
    first.append({ speaker: 'egg', content: 'a point' });

    const second = createTranscripts({ storage: store, now: clock() });
    assert.equal(second.debates[0].turns[0].content, 'a point');
  });

  it('throws away a stored blob it does not recognise', () => {
    const log = createTranscripts({ storage: storage({ version: 99, debates: 'no' }) });
    assert.deepEqual(log.debates, []);
  });

  it('drops a stored debate whose turns are the wrong shape', () => {
    const log = createTranscripts({
      storage: storage({
        version: 1,
        debates: [
          { id: 'a', startedAt: 1, turns: [{ speaker: 'egg', content: 'fine' }] },
          { id: 'b', startedAt: 2, turns: [{ content: 'nobody said it' }] },
        ],
      }),
    });
    assert.deepEqual(log.debates.map((d) => d.id), ['a']);
  });

  it('picks one back up, moves it to the top, and files new turns in it', () => {
    const log = createTranscripts({ storage: storage(), now: clock() });
    log.begin({ topic: 'first' });
    log.append({ speaker: 'egg', content: 'one' });
    log.begin({ topic: 'second' });
    log.append({ speaker: 'egg', content: 'two' });

    const first = log.debates.find((d) => d.topic === 'first');
    const resumed = log.resume(first.id);

    assert.equal(resumed.topic, 'first');
    assert.equal(log.debates[0].id, first.id);
    log.append({ speaker: 'potato', content: 'three' });
    assert.deepEqual(log.debates[0].turns.map((t) => t.content), ['one', 'three']);
  });

  it('hands back a copy, so nothing outside can edit the log in place', () => {
    const log = createTranscripts({ storage: storage(), now: clock() });
    log.append({ speaker: 'egg', content: 'one' });
    log.debates[0].turns.push({ speaker: 'egg', content: 'forged' });
    assert.equal(log.debates[0].turns.length, 1);
  });

  it('keeps the newest and drops the oldest past the limit', () => {
    const log = createTranscripts({ storage: storage(), limit: 2, now: clock() });
    for (const topic of ['a', 'b', 'c']) {
      log.begin({ topic });
      log.append({ speaker: 'egg', content: topic });
    }
    assert.deepEqual(log.debates.map((d) => d.topic), ['c', 'b']);
  });

  it('drops old debates rather than failing when the budget is gone', () => {
    const log = createTranscripts({ storage: storage(), budget: 400, now: clock() });
    for (const topic of ['a', 'b', 'c', 'd']) {
      log.begin({ topic });
      log.append({ speaker: 'egg', content: topic.repeat(80) });
    }
    assert.ok(log.debates.length < 4);
    assert.equal(log.debates[0].topic, 'd');
  });

  it('tells whoever is listening when anything changes', () => {
    const log = createTranscripts({ storage: storage(), now: clock() });
    let changes = 0;
    const off = log.subscribe(() => { changes += 1; });
    log.append({ speaker: 'egg', content: 'one' });
    off();
    log.append({ speaker: 'egg', content: 'two' });
    assert.equal(changes, 1);
  });

  it('clears everything, including what is being talked in', () => {
    const store = storage();
    const log = createTranscripts({ storage: store, now: clock() });
    log.append({ speaker: 'egg', content: 'one' });
    log.clear();
    assert.deepEqual(log.debates, []);
    assert.equal(log.live, null);
    assert.equal(store.getItem(KEY), null);
  });
});
