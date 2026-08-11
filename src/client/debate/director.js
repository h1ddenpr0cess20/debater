import { createEmitter } from '../session/emitter.js';
import { MODERATOR } from './moderator.js';

/**
 * The thing standing between two live models and a bill.
 *
 * It owns the floor — who is talking, who is being fed whose voice, and who is
 * being asked to answer — and every limit on how long that may go on for.
 * Nothing here is decorative: two realtime calls wired into each other will
 * happily debate until the account runs out, so the caps below are the point of
 * the module rather than a setting on it.
 *
 * Neither debater decides when to speak. Their sessions are minted with turn
 * detection that never creates a response, so every answer in the room is one
 * this file asked for. That is what makes a moderator possible — both of them
 * hear the question, exactly one is asked to take it — and it is what makes an
 * interruption something that can be aimed rather than something that happens.
 */

/** Defaults for the caps. The panel can move them; it cannot remove them. */
export const CAPS = {
  turns: 12,
  seconds: 8 * 60,
  /** How long a pause may sit there before the calls are hung up anyway. */
  idleSeconds: 90,
};

/** Below this, for this long, whoever is talking has stopped. */
const QUIET_LEVEL = 0.05;
const QUIET_MS = 900;

/** A person pauses mid-sentence in a way a model does not. */
const MODERATOR_QUIET_MS = 1500;

/** How long to wait for the microphone's words before answering them anyway. */
const TRANSCRIPT_WAIT = 1200;

/** How long a response may take to start before it is asked for again. */
const ASK_TIMEOUT = 6000;

/**
 * How long a debate may be doing nothing at all before it is prodded.
 *
 * The failure this exists for looks the same however it is reached: the debate
 * is running, neither lectern is talking or generating, and no timer is left
 * armed to change that — so it stays that way until somebody hits stop. Every
 * hand-over path here can end in `ask` declining (they are answering already,
 * they owe us an answer that never arrived, the frame was refused upstream), and
 * a decline is not a plan. This is the plan.
 *
 * It is deliberately not clever about *why*. Anything that can silence the room
 * for this long with nothing pending is a bug, known or not, and the recovery is
 * the same one: ask whoever is up next.
 */
const STALL_MS = 9000;

/**
 * How long to wait for the listener to take in what was just said.
 *
 * Asking for an answer is not the same as the far end having heard the
 * question. Their session commits the incoming audio when its own voice
 * detection decides the turn is over, and only what is committed is in the
 * conversation — ask first and they answer an empty room, which comes out as
 * two models talking politely past each other. So the handover waits for that,
 * and only gives up on it after this long.
 */
const HEARD_WAIT = 3000;

/**
 * Cutting in.
 *
 * A debate where each side waits politely for the other to finish is not a
 * debate, it is a pair of speeches. So the listener is occasionally handed the
 * floor mid-sentence: the gate the other way opens, they are asked for one
 * sharp line, and the speaker's own turn detection — which *is* allowed to
 * interrupt — cuts their answer off the moment the objection lands.
 *
 * It is a chance rather than a rule, it needs the speaker to have been going
 * for a while, and it gets likelier when what they are saying reads as heated.
 */
const HEAT = /\b(absurd|ridiculous|nonsense|lie[sd]?|lying|liar|outrageous|disgrace|shameful|garbage|rubbish|nobody believes|you people|the fact is|let me finish|simply false|flat wrong|never once|every single)\b/i;

export const CUT = {
  /** Nothing before this much of a turn has gone by. */
  after: 5500,
  /** …and nothing in the opening statements, which are the first two turns. */
  grace: 2,
  /** …and never twice within this many turns. */
  cooldown: 2,
  base: 0.16,
  heated: 0.3,
  rambling: 0.22,
  ramblingAfter: 14_000,
};

/**
 * What a line handed over in text says about who said it.
 *
 * Everything either lectern is given arrives in the one role a conversation has
 * for somebody else, so the label is the whole of the difference between the
 * person in the room and the model at the other lectern. The personas are told
 * to read both of these and to read neither of them out.
 */
const FROM = {
  [MODERATOR]: `[${MODERATOR}]`,
  other: '[the other lectern]',
};

const mark = (from, text) => `${from === MODERATOR ? FROM[MODERATOR] : FROM.other} ${text}`;

/** Said to both of them the moment the microphone takes the floor. */
const MIC_MARK = `${FROM[MODERATOR]} I have the floor — the voice you are about`
  + ' to hear is mine, not the other lectern\'s.';

/**
 * One-off directions, sent as a line rather than as response instructions.
 *
 * Instructions on a response replace the session's instead of adding to them,
 * so steering a turn that way strips the persona off it. These go over as a
 * "[direction]" item, which both personas are told to obey and never read out.
 */
const DIRECTION = {
  interject: 'Cut in now, over the top of them. One sentence, sharp, and about the'
    + ' thing they are saying right this second. No greeting, no apology for'
    + ' interrupting, no summing up — object, and stop.',
  opening: 'Give your opening statement now. Under thirty seconds.',
  reply: 'Answer what they just said, then give your own opening statement. Under'
    + ' thirty seconds. Do not wait to be called on.',
};

export function createDirector({
  bus,
  agents,
  moderator = null,
  caps = {},
  now = Date.now,
  chance = Math.random,
} = {}) {
  const { on, emit } = createEmitter();
  const limits = { ...CAPS, ...caps };
  const roster = Object.fromEntries(agents.map((agent) => [agent.id, agent]));
  const order = agents.map((agent) => agent.id);
  const other = (id) => order.find((x) => x !== id);
  const named = (text) => order.find((id) => new RegExp(`\\b${roster[id].name}\\b`, 'i').test(text));

  const usage = Object.fromEntries(order.map((id) => [id, { input: 0, output: 0 }]));
  const quiet = {};
  const finished = Object.fromEntries(order.map((id) => [id, false]));
  /**
   * The last thing each of them said, for when the audio did not carry it —
   * the moderator included, because a question from the floor is the thing most
   * often left unheard and the least excusable to hand over as somebody else's.
   */
  const last = Object.fromEntries([...order, MODERATOR].map((id) => [id, '']));
  /** And who that was, most recently. */
  let spokeLast = null;
  /** Whether each of them has taken in what was said to them since. */
  const heardIt = Object.fromEntries(order.map((id) => [id, false]));
  /**
   * Whether each of them owes us an answer.
   *
   * A session takes one response at a time — a second `response.create` while
   * one is running is refused outright ("conversation already has an active
   * response"), and the debate loses a turn to an error. `busy` alone is not
   * enough to go on: it only turns true when the response has actually been
   * created, and everything here is asking a moment before that.
   */
  const pending = Object.fromEntries(order.map((id) => [id, false]));
  /**
   * An ask that is waiting for the answer it replaces to finish dying.
   *
   * Cancelling is a message, not an instant: the response is only really gone
   * when its `done` comes back. Asking in between is the same refusal as asking
   * during it, which is what moderating over the top of someone used to do.
   *
   * And an answer outlives its own `done`, by however long it takes to say —
   * which the engine that holds its own audio reports as a state of its own.
   * Both of those end in a lectern saying it has stopped, and `release` is the
   * one thing that empties this.
   */
  const queued = Object.fromEntries(order.map((id) => [id, null]));
  /** What the microphone said, as transcribed by whichever session got it first. */
  let heard = '';
  /**
   * And which session that was.
   *
   * Both lecterns transcribe the same microphone, so the second copy has to be
   * dropped — but one session sends the same line more than once as it fills
   * out, and that is not a second copy, it is a better one. Whoever got there
   * first keeps the right to improve on it; the other one is ignored.
   */
  let heardFrom = null;

  /**
   * A typed question, waiting for the room to be quiet enough to put it.
   *
   * Typing is silent. There is nothing for anybody to have heard and nothing to
   * talk over, so a line typed while one of them is mid-answer does not cut
   * them off: it reaches both lecterns as it lands, and the answer to it is
   * asked for once the answer under way has been given. Which is the same
   * moment the floor would have changed hands anyway — the question only
   * decides who it changes hands to.
   *
   * The microphone is the other thing entirely. A person talking *is* an
   * interruption, their sessions treat it as one, and none of this applies.
   */
  let question = null;

  let phase = 'idle';
  let topic = '';
  let floor = null;
  let next = order[0];
  let turns = 0;
  let startedAt = 0;
  let elapsed = 0;
  let waitingOn = null;
  let asked = null;
  let frame = 0;

  /**
   * Every timer this thing has, in one place.
   *
   * They are not bookkeeping — between them they are the whole of the director's
   * memory that something is *going* to happen. `stalled` reads them to decide
   * whether the room is waiting on something or merely quiet, so a handle left
   * behind after its timer has been cleared or has fired reads as a plan that
   * does not exist, and the recovery below never runs. Hence going through
   * `arm`/`disarm` rather than four variables and the discipline to zero them.
   */
  const timers = { idle: 0, ask: 0, hand: 0, heard: 0 };

  function disarm(...names) {
    for (const name of names) {
      clearTimeout(timers[name]);
      timers[name] = 0;
    }
  }

  function arm(name, ms, fn) {
    disarm(name);
    timers[name] = setTimeout(() => {
      timers[name] = 0;
      fn();
    }, ms);
  }

  /** How long the room has been doing nothing, or 0 if it is doing something. */
  let stalledSince = 0;

  /** The turn being spoken now, and when it started — what a cut-in is judged on. */
  let spokenAt = 0;
  let running = '';
  let rolledAt = 0;
  let lastCut = -CUT.cooldown;
  let heckling = true;

  function setPhase(to, why = '') {
    if (phase === to) return;
    phase = to;
    emit('phase', { phase, why });
  }

  function report() {
    emit('meter', {
      turns,
      limit: limits.turns,
      seconds: Math.round(elapsed / 1000),
      seconds_limit: limits.seconds,
      usage: { ...usage },
    });
  }

  /**
   * Who reaches whom.
   *
   * One debater at a time, except while somebody is cutting in. The microphone
   * is its own thing: it is open whenever it is switched on, into both lecterns
   * at once, because a question put to the room is heard by the room — and
   * because a moderator who has to wait for a gap is not moderating.
   */
  function route(speaker) {
    for (const id of order) bus.relay(id, other(id), speaker === id);
    micRoute();
  }

  /**
   * Says whose the next voice is.
   *
   * The moderator reaches a lectern down the same wire the opposite lectern
   * does — same gate, same input buffer, the same `user` turn at the far end —
   * and nothing in what arrives distinguishes a person in the room from the
   * model they are arguing with. So the far end assumed what it was told to
   * assume, and answered a question from the floor as though the other lectern
   * had asked it.
   *
   * This is the only thing that can say otherwise, and it has to go over before
   * the audio does. It does: the item is created when the microphone takes the
   * floor, and their speech is not committed to the conversation until they
   * stop talking.
   */
  function markModerator() {
    for (const agent of agents) agent.send(MIC_MARK, { answer: false });
  }

  function micRoute() {
    /** No microphone, or one whose channel is not on the bus yet: nothing to route. */
    if (!moderator?.open || !bus.get(MODERATOR)) return;
    for (const id of order) bus.relay(MODERATOR, id, Boolean(moderator.live));
  }

  function takeFloor(id) {
    if (floor === id) return;
    floor = id;
    route(id);
    disarm('ask');
    asked = null;
    if (id === MODERATOR) markModerator();
    else {
      spokenAt = now();
      running = '';
    }
    emit('floor', id);
  }

  /**
   * Who last said something this lectern is owed an answer to. The moderator if
   * they were the last to speak, and the opposite lectern otherwise — never
   * this lectern itself, which is being handed the room, not its own words.
   */
  function spoke(to) {
    return spokeLast && spokeLast !== to ? spokeLast : other(to);
  }

  /**
   * Asks one of them for an answer, and asks again if nothing comes of it. A
   * response that never starts is the one failure that would end a debate
   * silently, so it is the one thing here that retries.
   */
  function ask(id, { direction, retry = true } = {}) {
    const them = roster[id];
    if (!them?.connected || phase !== 'running') return false;
    /** Already asked, and the answer is on its way: one at a time. */
    if (pending[id]) return false;

    /**
     * They are mid-answer, so this ask has to wait for it — and waiting is the
     * whole of the fix. On xAI a lectern answers whatever it hears on its own,
     * so the one being handed the floor is very often still generating an
     * unsolicited answer the proxy is in the middle of cancelling. Dropping the
     * ask there left nothing armed and nobody speaking, and the room sat silent
     * until the stall watch noticed nine seconds later. `done` picks this up.
     */
    if (them.busy || them.state === 'speaking') {
      queued[id] = { direction };
      return false;
    }
    queued[id] = null;

    disarm('heard');
    waitingOn = null;
    next = id;
    asked = id;
    pending[id] = true;
    heardIt[id] = false;
    /** Something is happening again, whatever the last few seconds looked like. */
    stalledSince = 0;
    emit('asked', { id, direction: direction ?? null });
    if (direction) them.send(`[direction] ${direction}`, { answer: false });
    them.say();

    disarm('ask');
    if (!retry) return true;

    arm('ask', ASK_TIMEOUT, () => {
      if (phase !== 'running' || asked !== id) return;
      const again = roster[id];
      if (!again?.connected || again.busy || again.state === 'speaking') return;
      /**
       * Nothing came back. Hand over the words instead of the sound — whoever
       * said them, marked as theirs. Unmarked and taken from the other lectern
       * regardless, this answered the moderator's question by handing over the
       * last thing the opposite lectern had said and calling it the room.
       */
      const from = spoke(id);
      const words = last[from];
      emit('nudge', { id, spoken: Boolean(words) });
      pending[id] = false;
      if (words) again.send(mark(from, words));
      else again.say();
      pending[id] = true;
    });
    return true;
  }

  /**
   * Takes an ask back off the shelf.
   *
   * `ask` shelves rather than declines when the lectern is mid-answer, and this
   * is the only thing that ever takes one down again — so it has to run on
   * every way an answer can end, not just on the tidy one. `done` is the tidy
   * one. The other is a lectern that finished generating a while ago and has
   * been playing the answer out ever since: on the xAI engine that is a state
   * of its own, it can last seconds, and a moderator typing a question into it
   * was the surest way to find that out.
   */
  function release(id) {
    const waiting = queued[id];
    if (!waiting || phase !== 'running') return;
    queued[id] = null;
    /**
     * And back on the shelf if it still cannot go. `ask` declines for reasons
     * that pass — they are still talking, they still owe us the answer this is
     * waiting on — and every one of them turns up here, because this runs on a
     * lectern reporting in rather than on the answer being over. Taking one
     * down and dropping it is the failure this exists to stop, one step further
     * along.
     */
    if (!ask(id, waiting)) queued[id] ??= waiting;
  }

  /**
   * Whether anybody is mid-answer: owed one, generating one, or still saying
   * one. All three are somebody's turn in progress, and a typed question waits
   * for all three.
   */
  function midTurn() {
    return order.some((id) => pending[id] || finished[id]
      || roster[id]?.busy || roster[id]?.state === 'speaking');
  }

  /**
   * Puts the moderator's waiting question to whoever it was aimed at.
   *
   * Called from every place a turn can end, because the end of a turn is what
   * it has been waiting for. Answers whether it is off this file's hands —
   * asked for, or shelved against an answer that is nearly over. It is kept
   * rather than dropped otherwise: a question the room never gets round to is
   * the failure this is a fix for.
   */
  function putQuestion() {
    if (!question || phase !== 'running') return false;
    const { to } = question;
    disarm('hand');
    floor = null;
    route(to);
    if (!ask(to) && !queued[to]) return false;
    question = null;
    return true;
  }

  /**
   * Hands the turn to one of them, once they have actually heard it.
   *
   * Their session says so by committing the incoming audio, which arrives here
   * as `speech` ending. Waiting for it is the difference between a debate and
   * two monologues; not waiting for ever is the difference between a debate and
   * a stall, so there is a fallback, and it says out loud that it fired.
   */
  function handOver(to, { direction } = {}) {
    disarm('heard');
    if (heardIt[to]) return ask(to, { direction });

    waitingOn = to;
    arm('heard', HEARD_WAIT, () => {
      if (phase !== 'running' || waitingOn !== to) return;
      waitingOn = null;
      /** They never took it in. Say so — this is the failure that looks like
       *  them ignoring each other — and hand the words over instead, marked
       *  with whoever actually said them. */
      emit('unheard', { id: to });
      const from = spoke(to);
      const words = last[from];
      if (words) roster[to]?.send(mark(from, words), { answer: false });
      ask(to, { direction });
    });
    return true;
  }

  /**
   * One debater has stopped making noise. That — not the model finishing its
   * generation — is the end of a turn: the audio of a long answer plays out
   * well after the response is done, and cutting the relay at that point would
   * chop the last sentence off before the other one ever heard it.
   */
  function ended(id) {
    turns += 1;
    report();
    if (turns >= limits.turns) return stop(`that is ${turns} turns — the limit`);
    /** The person in the room is mid-sentence; they get the floor, not us. */
    if (floor === MODERATOR || timers.hand) return;
    /** A question was typed while they were talking. This is the moment it was
     *  waiting for, and it decides the floor instead of the order. */
    if (putQuestion()) return;
    /** The second turn of a debate is the other one's opening statement, which
     *  is a reply as well — everything after that needs no telling. */
    handOver(other(id), turns === 1 ? { direction: DIRECTION.reply } : {});
  }

  /** Whether the one listening should cut in over the one talking, right now. */
  function shouldCut(speaker) {
    if (!heckling || phase !== 'running' || floor !== speaker) return false;
    /** The moderator is waiting on the end of this turn. Nobody else gets to
     *  put another one in front of it. */
    if (question) return false;
    if (turns < CUT.grace || turns - lastCut < CUT.cooldown) return false;
    if (now() - spokenAt < CUT.after) return false;
    /** One roll a second, so a long turn is not a hundred chances at it. */
    if (now() - rolledAt < 1000) return false;
    rolledAt = now();

    const them = roster[other(speaker)];
    if (!them?.connected || them.busy || them.state === 'speaking') return false;

    let odds = CUT.base;
    if (HEAT.test(running)) odds += CUT.heated;
    if (now() - spokenAt > CUT.ramblingAfter) odds += CUT.rambling;
    return chance() < odds;
  }

  function cutIn(speaker) {
    const id = other(speaker);
    lastCut = turns;
    /** Both gates open for a moment: they talk over each other, as people do.
     *  The speaker's own turn detection is what cuts their answer short. */
    bus.relay(id, speaker, true);
    emit('interrupt', { id, over: speaker });
    ask(id, { direction: DIRECTION.interject, retry: false });
  }

  /**
   * The moderator has stopped talking. Both debaters heard it; one of them is
   * asked to answer — whoever was named, or whoever is up next.
   *
   * It waits a moment for the transcript first. Knowing which of them was
   * addressed is worth a second of silence, and the transcription lands well
   * inside one.
   */
  function handBack() {
    if (timers.hand) return;
    floor = null;
    emit('floor', null);
    arm('hand', TRANSCRIPT_WAIT, finishHandBack);
  }

  function finishHandBack() {
    disarm('hand');
    if (phase !== 'running') return;
    /** They have said something since typing it, out loud, to the room. That is
     *  the question being answered — the one still queued is last week's. */
    question = null;
    const to = named(heard) ?? next ?? order[0];
    if (heard) {
      /** In their own right, so a hand-over in text says the moderator asked
       *  it rather than dressing it up as the other lectern's last point. */
      last[MODERATOR] = heard;
      spokeLast = MODERATOR;
      emit('turn', { speaker: MODERATOR, content: heard });
    }
    heard = '';
    heardFrom = null;
    route(to);
    handOver(to);
  }

  for (const agent of agents) {
    agent.on('state', (state) => {
      emit('state', { id: agent.id, state });
      if (state === 'speaking') {
        takeFloor(agent.id);
        finished[agent.id] = false;
        quiet[agent.id] = null;
        return;
      }
      /** They have stopped talking — which is not the same event as having
       *  stopped generating, and is the one an ask can be waiting on. */
      release(agent.id);
    });

    agent.on('pulse', (weight) => emit('pulse', { id: agent.id, weight }));

    /**
     * Their session's own voice detection, on the audio coming *in*. When it
     * closes a turn, what they heard is committed to their conversation — and
     * that, not a stopwatch, is when they can be asked to answer it.
     */
    agent.on('speech', ({ started }) => {
      if (started) return;
      heardIt[agent.id] = true;
      emit('took', { id: agent.id });
      if (waitingOn === agent.id) {
        disarm('heard');
        waitingOn = null;
        ask(agent.id);
      }
    });

    agent.on('text', (chunk) => {
      if (floor === agent.id) running += chunk;
      emit('text', { id: agent.id, chunk });
    });

    agent.on('said', (turn) => {
      last[agent.id] = turn.content;
      spokeLast = agent.id;
      emit('turn', turn);
    });

    /**
     * What this session made of the audio coming in. While the microphone has
     * the floor that is the moderator's own words coming back to us — and both
     * sessions transcribe the same microphone, so the second copy is dropped.
     */
    agent.on('heard', (text) => {
      emit('heard', { id: agent.id, text });
      if (!text || !(floor === MODERATOR || timers.hand)) return;
      if (!heard || heardFrom === agent.id) {
        heard = text;
        heardFrom = agent.id;
      }
      if (timers.hand) finishHandBack();
    });

    /** A hosted tool, mid-turn: they have gone to look something up. */
    agent.on('tool', (label) => emit('tool', { id: agent.id, label }));

    /**
     * A frame the session refused — most often a second `response.create` while
     * one was already running. Nothing is coming back for it, and `pending` left
     * standing would decline every future ask for this lectern, which is a
     * debate that stops without saying so. Whether a response really is in
     * flight is the session's to answer, so take its word for it rather than
     * guessing from here.
     */
    agent.on('error', ({ message }) => {
      pending[agent.id] = agent.busy;
      emit('error', { id: agent.id, message });
    });

    agent.on('done', ({ usage: used, cancelled = false } = {}) => {
      if (used) {
        usage[agent.id].input += used.input_tokens ?? 0;
        usage[agent.id].output += used.output_tokens ?? 0;
      }
      /** They have answered; they may be asked again — and if something was
       * waiting on exactly that, it goes now. */
      pending[agent.id] = false;
      release(agent.id);
      /**
       * A cancelled answer is not a turn. It was talked over, or it was one of
       * the answers this engine gives unasked and the proxy refused — either
       * way nobody heard it out, and letting it through here would spend a turn
       * of the debate's budget on it and hand the floor over on top of whoever
       * actually has it.
       */
      if (cancelled) return report();
      /** Generation is over; the audio is not. `tick` decides when it is. */
      finished[agent.id] = true;
      quiet[agent.id] = null;
      report();
    });
  }

  /** The microphone, watched the same way the lecterns are. */
  function watchModerator(at) {
    const live = Boolean(moderator?.open && moderator.live);
    const level = live ? bus.level(MODERATOR) : 0;
    emit('level', { id: MODERATOR, level });
    if (!live) return;

    if (level > QUIET_LEVEL) {
      quiet[MODERATOR] = null;
      if (floor !== MODERATOR) {
        disarm('hand');
        takeFloor(MODERATOR);
      }
      return;
    }

    if (floor !== MODERATOR) return;
    quiet[MODERATOR] ??= at;
    if (at - quiet[MODERATOR] < MODERATOR_QUIET_MS) return;
    quiet[MODERATOR] = null;
    handBack();
  }

  /**
   * Whether the room is waiting on nothing.
   *
   * Not "is it quiet" — quiet is most of a handover. This is the stronger claim
   * that there is nothing to be quiet *for*: no timer armed, neither lectern
   * generating or playing out an answer, and no microphone mid-question. It is
   * built out of what the sessions say about themselves rather than out of
   * `pending`, because `pending` is a record of what was asked for and the whole
   * problem is that it can outlive the answer it was waiting on.
   */
  function stalled() {
    if (phase !== 'running') return false;
    if (timers.ask || timers.hand || timers.heard) return false;
    /** A question being asked in the room is not a stall, however quiet the two
     *  of them are being about it. */
    if (moderator?.open && moderator.live
      && (floor === MODERATOR || bus.level(MODERATOR) > QUIET_LEVEL)) return false;

    return order.every((id) => {
      const them = roster[id];
      return them?.connected
        && !them.busy
        && them.state !== 'speaking'
        && !finished[id]
        && bus.level(id) <= QUIET_LEVEL;
    });
  }

  /**
   * Nothing has happened for a while and nothing is going to. Whatever was
   * dropped — an ask declined, a response that never started, a frame refused —
   * the room is the room, and it is the director's to restart.
   */
  function watchStall(at) {
    if (!stalled()) {
      stalledSince = 0;
      return;
    }
    stalledSince ||= at;
    if (at - stalledSince < STALL_MS) return;
    stalledSince = 0;

    /** Proven, not assumed: `stalled` just established nothing is in flight. */
    for (const id of order) {
      pending[id] = false;
      queued[id] = null;
    }
    /** A question waiting on a turn that never ended is what this is for as
     *  much as anything: it goes out here rather than being forgotten. */
    const to = question?.to ?? next ?? order[0];
    emit('stalled', { id: to });
    if (putQuestion()) return;
    handOver(to);
  }

  /** The clock, the meters, and the level each rig moves to. */
  function tick() {
    frame = requestAnimationFrame(tick);
    const at = now();

    watchModerator(at);

    for (const id of order) {
      const level = bus.level(id);
      emit('level', { id, level });

      /**
       * Whether a turn just ended is only a question while the debate is
       * running. Pausing shuts the gates and deadens both tracks, so a lectern
       * that was mid-sentence goes quiet immediately — and read as the end of a
       * turn that is what it looks like, which spent a turn of the budget on
       * the pause and, on the last one of them, hung the debate up outright.
       */
      if (phase !== 'running') continue;

      if (!finished[id]) {
        if (floor === id && shouldCut(id)) cutIn(id);
        continue;
      }
      if (level > QUIET_LEVEL) {
        quiet[id] = null;
        continue;
      }
      quiet[id] ??= at;
      if (at - quiet[id] < QUIET_MS) continue;
      finished[id] = false;
      quiet[id] = null;
      ended(id);
    }

    if (phase === 'running') {
      elapsed = at - startedAt;
      if (elapsed >= limits.seconds * 1000) return stop('time is up');
      /** A lectern that has gone away is not a debate, and waiting on one is
       *  the same silence as any other stall with no way out of it. */
      if (!agents.every((agent) => agent.connected)) return stop('one of them dropped out');
      if (Math.floor(elapsed / 1000) !== Math.floor((elapsed - 16) / 1000)) report();
      watchStall(at);
    }
  }

  /**
   * A line from the moderator, typed rather than spoken. Both of them are given
   * it, so both know it was said; one of them is asked to answer.
   *
   * Nobody is cut off for it, and nothing in flight is thrown away. Whoever is
   * mid-answer finishes the answer — the room hears the end of the sentence it
   * was in the middle of — and the question is put the moment they do.
   */
  function say(text, { to = null } = {}) {
    const line = String(text ?? '').trim();
    if (!line || phase !== 'running') return false;

    for (const agent of agents) agent.send(mark(MODERATOR, line), { answer: false });
    last[MODERATOR] = line;
    spokeLast = MODERATOR;
    emit('turn', { speaker: MODERATOR, content: line });

    const target = to ?? named(line) ?? next ?? order[0];
    question = { to: target };
    /** However this ends up being put, they are the one who answers next. */
    next = target;

    /**
     * Straight out if the room is free — and the whole room, not just the one
     * being asked. Asking them while the other is mid-answer is the same two
     * voices at once by a different route.
     */
    if (!midTurn() && putQuestion()) return true;

    /** Behind somebody, and the room is told so: a question that lands in
     *  silence and sits there is the thing this reads as otherwise. */
    emit('waiting', { id: target, behind: floor });
    return true;
  }

  /**
   * The moderator's opening, and the same thing after a pause. Asked for
   * directly rather than handed over: the line went across as text, so there is
   * nothing for anybody to have heard first.
   */
  function announce(line, to, { direction } = {}) {
    for (const agent of agents) agent.send(mark(MODERATOR, line), { answer: false });
    last[MODERATOR] = line;
    spokeLast = MODERATOR;
    emit('turn', { speaker: MODERATOR, content: line });
    route(to);
    ask(to, { direction });
  }

  async function start({ topic: subject, first = order[0], turns: earlier = [] } = {}) {
    if (phase === 'running' || phase === 'connecting') return;
    topic = String(subject ?? '').trim();
    if (!topic) return emit('error', { message: 'give them something to argue about first' });

    setPhase('connecting');
    const resumed = earlier.length > 0;

    try {
      await bus.resume();
      /** Both ends of the wiring exist before either call does: a peer
       * connection is handed its track at the handshake, and the gates on the
       * bus have to have something to open onto. */
      for (const id of order) {
        bus.open(id);
        bus.live(id, true);
      }

      await Promise.all(agents.map((agent) => agent.start({ topic, turns: earlier, resumed })));
    } catch (err) {
      /** Whatever went wrong dialling, it is not a debate — say so and hang up
       * rather than leaving the page reading "connecting" for ever. */
      emit('error', { message: err?.message ?? String(err) });
      stop('never got off the ground');
      return;
    }

    if (!agents.every((agent) => agent.connected)) {
      stop('one of them never came up');
      return;
    }

    turns = 0;
    lastCut = -CUT.cooldown;
    heard = '';
    heardFrom = null;
    question = null;
    stalledSince = 0;
    for (const id of order) {
      heardIt[id] = false;
      pending[id] = false;
      queued[id] = null;
    }
    for (const id of Object.keys(last)) last[id] = '';
    spokeLast = null;
    startedAt = now();
    elapsed = 0;
    next = first;
    floor = null;
    setPhase('running');
    report();
    if (!frame) frame = requestAnimationFrame(tick);

    const order2 = order.map((id) => roster[id].name);
    announce(resumed
      ? `We are picking this back up. The motion is still: ${topic}. ${roster[first].name}, carry on.`
      : `Tonight's motion: ${topic}. ${roster[first].name} opens, ${roster[first].name === order2[0] ? order2[1] : order2[0]} follows straight after — and from there the two of you go at each other. Nobody waits to be called on.`,
    first, { direction: resumed ? null : DIRECTION.opening });
  }

  /**
   * Stops the exchange without hanging up. The gates shut, anything in flight is
   * cancelled, and both outbound tracks go dead — so no audio is being sent and
   * no answer is being generated. The calls stay open, which is not free: an
   * open session is still a session. That is what the idle timer is for.
   */
  function pause(why = 'paused') {
    if (phase !== 'running') return;
    bus.silence();
    for (const agent of agents) {
      /** Emptied before they are cut off, not after: stopping one of them is
       *  itself something an ask can be waiting on. */
      pending[agent.id] = false;
      queued[agent.id] = null;
      /** The answer they were playing out is cancelled rather than finished, so
       *  it is not a turn waiting on the audio to run out either. */
      finished[agent.id] = false;
      quiet[agent.id] = null;
      agent.cancel();
      bus.live(agent.id, false);
    }
    disarm('ask', 'hand', 'heard');
    asked = null;
    waitingOn = null;
    floor = null;
    /** Whoever it was aimed at is `next`, so resuming still goes to them —
     *  and they have had the line itself since it was typed. */
    question = null;
    stalledSince = 0;
    elapsed = now() - startedAt;
    setPhase('paused', why);

    arm('idle', limits.idleSeconds * 1000,
      () => stop('paused too long — hung up to stop the meter'));
  }

  function resume() {
    if (phase !== 'paused') return;
    disarm('idle');
    stalledSince = 0;
    for (const id of order) bus.live(id, true);
    startedAt = now() - elapsed;
    setPhase('running');
    announce(`Back to it. ${roster[next].name}, your turn.`, next);
  }

  /** The real one. Both calls are hung up and nothing is billing. */
  function stop(why = '') {
    disarm('ask', 'idle', 'hand', 'heard');
    asked = null;
    waitingOn = null;
    question = null;
    stalledSince = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    bus.silence();
    for (const agent of agents) {
      pending[agent.id] = false;
      queued[agent.id] = null;
      agent.stop();
    }
    for (const id of order) emit('level', { id, level: 0 });
    floor = null;
    if (phase !== 'idle') setPhase('over', why);
    report();
  }

  return {
    on,
    start,
    pause,
    resume,
    stop,
    say,

    /** Pause if it is running, resume if it is not. The one button. */
    toggle() {
      if (phase === 'running') return pause();
      if (phase === 'paused') return resume();
    },

    /** The microphone was switched on or off; the gates follow it. */
    micChanged() {
      micRoute();
      if (!moderator?.live && floor === MODERATOR) handBack();
    },

    get phase() { return phase; },
    get running() { return phase === 'running'; },
    get topic() { return topic; },
    get floor() { return floor; },
    get turns() { return turns; },
    get elapsed() { return phase === 'running' ? now() - startedAt : elapsed; },
    get usage() { return { ...usage }; },
    get limits() { return { ...limits }; },

    /** Whether they may talk over each other at all. */
    get heckling() { return heckling; },
    set heckling(on) { heckling = Boolean(on); },

    setLimits(patch = {}) {
      for (const key of ['turns', 'seconds', 'idleSeconds']) {
        const value = Math.round(Number(patch[key]));
        if (Number.isFinite(value) && value > 0) limits[key] = value;
      }
      report();
      return { ...limits };
    },
  };
}
