/** How much of an earlier debate rides along when one is picked up. */
export const PRIOR_TURNS = 40;
export const PRIOR_CHARS = 6000;

/**
 * An earlier debate, seen from one lectern.
 *
 * The turns are stored by who said them — `egg`, `potato`, or the moderator —
 * and each session has to be handed its own version: what it said is
 * `assistant`, everything else is `user`, because those are the only two roles
 * a conversation has and the model has to recognise its own voice in the
 * record. They travel as turns rather than as a summary of turns, because that
 * is what the realtime API takes.
 *
 * The oldest go first when there are too many: what was said last is what the
 * next sentence is most likely to follow from.
 */
export function prior(turns = [], self) {
  const kept = turns
    .filter((turn) => turn?.content && typeof turn.content === 'string')
    .slice(-PRIOR_TURNS)
    .map((turn) => ({
      role: turn.speaker === self ? 'assistant' : 'user',
      content: String(turn.content).slice(0, PRIOR_CHARS),
    }));

  let total = kept.reduce((sum, turn) => sum + turn.content.length, 0);
  while (total > PRIOR_CHARS && kept.length > 1) {
    total -= kept.shift().content.length;
  }

  return kept;
}

/** One replayed turn, in the shape the API takes for that role. */
export function historyItem({ role, content }) {
  const part = role === 'assistant'
    ? { type: 'output_text', text: content }
    : { type: 'input_text', text: content };

  return {
    type: 'conversation.item.create',
    item: { type: 'message', role, status: 'completed', content: [part] },
  };
}
