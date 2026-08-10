import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEBATERS,
  DEBATER_IDS,
  debater,
  instructions,
  opponentBlock,
  resumedBlock,
  sessionConfig,
  topicBlock,
} from '../../src/server/personas.js';

describe('the roster', () => {
  it('is exactly two, one a side', () => {
    assert.deepEqual([...DEBATER_IDS].sort(), ['egg', 'potato']);
    assert.deepEqual(DEBATER_IDS.map((id) => DEBATERS[id].side).sort(), ['left', 'right']);
  });

  it('gives each of them a leaning, a colour and a voice of their own', () => {
    const voices = new Set();
    for (const id of DEBATER_IDS) {
      const one = DEBATERS[id];
      assert.ok(one.name, `${id} has no name`);
      assert.match(one.accent, /^#[0-9a-f]{6}$/i, `${id} has no colour`);
      assert.ok(one.leaning, `${id} has no leaning`);
      assert.ok(!voices.has(one.voice), `${id} shares a voice with the other one`);
      voices.add(one.voice);
    }
  });

  it('puts the egg on the right and the potato on the left', () => {
    assert.equal(DEBATERS.egg.leaning, 'Republican');
    assert.equal(DEBATERS.potato.leaning, 'Democrat');
  });

  it('hands back nothing for a lectern that does not exist', () => {
    assert.equal(debater('carrot'), null);
  });
});

describe('instructions', () => {
  it('names the other one, and only the other one', () => {
    const block = opponentBlock(DEBATERS.egg);
    assert.match(block, /Tater/);
    assert.doesNotMatch(block, /Across from you is Marc/);
  });

  it('carries the motion, flattened and capped', () => {
    assert.match(topicBlock('  rent   control  \n works '), /rent control works/);
    assert.equal(topicBlock(''), '');
    assert.ok(topicBlock('x'.repeat(900)).length < 600);
  });

  it('says a resumed debate is resumed, and otherwise says nothing', () => {
    assert.match(resumedBlock(true), /picked back up/);
    assert.equal(resumedBlock(false), '');
  });

  it('gives each debater their own persona plus the shared rules', () => {
    const egg = instructions(DEBATERS.egg, { topic: 'tariffs' });
    const potato = instructions(DEBATERS.potato, { topic: 'tariffs' });

    assert.match(egg, /egg named Marc/);
    assert.match(potato, /potato named Tater/);
    for (const text of [egg, potato]) {
      assert.match(text, /\[moderator\]/, 'the moderator is not explained');
      assert.match(text, /never break character/i);
      assert.match(text, /tariffs/);
    }
  });
});

describe('sessionConfig', () => {
  const config = sessionConfig('gpt-realtime-2.1', 'ballad', {
    debater: DEBATERS.egg,
    topic: 'tariffs',
  });

  it('never lets turn detection answer for them', () => {
    assert.equal(config.audio.input.turn_detection.create_response, false);
  });

  it('does let them be talked over, which is what a cut-in is', () => {
    assert.equal(config.audio.input.turn_detection.interrupt_response, true);
  });

  it('leaves noise reduction off — the input is another model, not a room', () => {
    assert.ok(!('noise_reduction' in config.audio.input));
  });

  it('transcribes what comes in, which is how the moderator is heard', () => {
    assert.ok(config.audio.input.transcription.model);
  });

  it('takes the model, the voice and whatever tools it was handed', () => {
    assert.equal(config.model, 'gpt-realtime-2.1');
    assert.equal(config.audio.output.voice, 'ballad');
    assert.deepEqual(config.tools, []);
    assert.deepEqual(
      sessionConfig('m', 'v', { debater: DEBATERS.egg, tools: [{ name: 'x' }] }).tools,
      [{ name: 'x' }],
    );
  });
});
