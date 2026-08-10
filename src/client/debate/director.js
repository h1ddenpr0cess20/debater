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
const QUIET_LEVEL = 0.02;
const QUIET_MS = 900;

/** A person pauses mid-sentence in a way a model does not. */
const MODERATOR_QUIET_MS = 1500;

/** How long to wait for the microphone's words before answering them anyway. */
const TRANSCRIPT_WAIT = 1200;

/** How long a response may take to start before it is asked for again. */
const ASK_TIMEOUT = 6000;

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

const INTERJECT = 'Cut in now, over the top of them. One sentence, sharp, and it'
  + ' has to be about the thing they are saying right now. No greeting, no'
  + ' apology for interrupting, no summing up — object, and stop.';

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
  /** The last thing each of them said, for when the audio did not carry it. */
  const last = Object.fromEntries(order.map((id) => [id, '']));
  /** What the microphone said, as transcribed by whichever session got it first. */
  let heard = '';

  let phase = 'idle';
  let topic = '';
  let floor = null;
  let next = order[0];
  let turns = 0;
  let startedAt = 0;
  let elapsed = 0;
  let idleTimer = 0;
  let askTimer = 0;
  let handTimer = 0;
  let asked = null;
  let frame = 0;

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

  function micRoute() {
    /** No microphone, or one whose channel is not on the bus yet: nothing to route. */
    if (!moderator?.open || !bus.get(MODERATOR)) return;
    for (const id of order) bus.relay(MODERATOR, id, Boolean(moderator.live));
  }

  function takeFloor(id) {
    if (floor === id) return;
    floor = id;
    route(id);
    clearTimeout(askTimer);
    askTimer = 0;
    asked = null;
    if (id !== MODERATOR) {
      spokenAt = now();
      running = '';
    }
    emit('floor', id);
  }

  /**
   * Asks one of them for an answer, and asks again if nothing comes of it. A
   * response that never starts is the one failure that would end a debate
   * silently, so it is the one thing here that retries.
   */
  function ask(id, { instructions, retry = true } = {}) {
    const them = roster[id];
    if (!them?.connected || phase !== 'running') return false;
    next = id;
    asked = id;
    emit('asked', { id, cutting: Boolean(instructions) });
    them.say({ instructions });

    clearTimeout(askTimer);
    askTimer = 0;
    if (!retry) return true;

    askTimer = setTimeout(() => {
      if (phase !== 'running' || asked !== id) return;
      const again = roster[id];
      if (!again?.connected || again.busy || again.state === 'speaking') return;
      /** Nothing came back. Hand over the words instead of the sound. */
      const words = heard || last[other(id)];
      emit('nudge', { id, spoken: Boolean(words) });
      if (words) again.send(words);
      else again.say();
    }, ASK_TIMEOUT);
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
    if (floor === MODERATOR || handTimer) return;
    ask(other(id));
  }

  /** Whether the one listening should cut in over the one talking, right now. */
  function shouldCut(speaker) {
    if (!heckling || phase !== 'running' || floor !== speaker) return false;
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
    ask(id, { instructions: INTERJECT, retry: false });
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
    if (handTimer) return;
    floor = null;
    emit('floor', null);
    handTimer = setTimeout(finishHandBack, TRANSCRIPT_WAIT);
  }

  function finishHandBack() {
    clearTimeout(handTimer);
    handTimer = 0;
    if (phase !== 'running') return;
    const to = named(heard) ?? next ?? order[0];
    if (heard) emit('turn', { speaker: MODERATOR, content: heard });
    heard = '';
    route(to);
    ask(to);
  }

  for (const agent of agents) {
    agent.on('state', (state) => {
      emit('state', { id: agent.id, state });
      if (state === 'speaking') {
        takeFloor(agent.id);
        finished[agent.id] = false;
        quiet[agent.id] = null;
      }
    });

    agent.on('pulse', (weight) => emit('pulse', { id: agent.id, weight }));

    agent.on('text', (chunk) => {
      if (floor === agent.id) running += chunk;
      emit('text', { id: agent.id, chunk });
    });

    agent.on('said', (turn) => {
      last[agent.id] = turn.content;
      emit('turn', turn);
    });

    /**
     * What this session made of the audio coming in. While the microphone has
     * the floor that is the moderator's own words coming back to us — and both
     * sessions transcribe the same microphone, so the second copy is dropped.
     */
    agent.on('heard', (text) => {
      emit('heard', { id: agent.id, text });
      if (!text || !(floor === MODERATOR || handTimer)) return;
      if (!heard) heard = text;
      if (handTimer) finishHandBack();
    });

    agent.on('error', ({ message }) => emit('error', { id: agent.id, message }));

    agent.on('done', ({ usage: used } = {}) => {
      if (used) {
        usage[agent.id].input += used.input_tokens ?? 0;
        usage[agent.id].output += used.output_tokens ?? 0;
      }
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
        clearTimeout(handTimer);
        handTimer = 0;
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

  /** The clock, the meters, and the level each rig moves to. */
  function tick() {
    frame = requestAnimationFrame(tick);
    const at = now();

    watchModerator(at);

    for (const id of order) {
      const level = bus.level(id);
      emit('level', { id, level });

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
      if (Math.floor(elapsed / 1000) !== Math.floor((elapsed - 16) / 1000)) report();
    }
  }

  /**
   * A line from the moderator, typed rather than spoken. Both of them are given
   * it, so both know it was said; one of them is asked to answer.
   */
  function say(text, { to = null } = {}) {
    const line = String(text ?? '').trim();
    if (!line || phase !== 'running') return false;

    for (const agent of agents) agent.send(`[${MODERATOR}] ${line}`, { answer: false });
    emit('turn', { speaker: MODERATOR, content: line });

    const target = to ?? named(line) ?? next ?? order[0];
    /** Whoever was mid-answer is talked over, which is a moderator's privilege. */
    for (const agent of agents) if (agent.id !== target) agent.cancel();
    clearTimeout(handTimer);
    handTimer = 0;
    floor = null;
    route(target);
    ask(target);
    return true;
  }

  /** The moderator's opening, and the same thing after a pause. */
  function announce(line, to) {
    for (const agent of agents) agent.send(`[${MODERATOR}] ${line}`, { answer: false });
    emit('turn', { speaker: MODERATOR, content: line });
    route(to);
    ask(to);
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
       *  connection is handed its track at the handshake, and the gates
       *  between them have to have something to open onto. */
      for (const id of order) {
        bus.open(id);
        bus.live(id, true);
      }

      await Promise.all(agents.map((agent) => agent.start({ topic, turns: earlier, resumed })));
    } catch (err) {
      /** Whatever went wrong dialling, it is not a debate — say so and hang up
       *  rather than leaving the page reading "connecting" for ever. */
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
    for (const id of order) last[id] = '';
    startedAt = now();
    elapsed = 0;
    next = first;
    floor = null;
    setPhase('running');
    report();
    if (!frame) frame = requestAnimationFrame(tick);

    announce(resumed
      ? `We are picking this back up. The motion is still: ${topic}. ${roster[first].name}, carry on.`
      : `Tonight's motion: ${topic}. ${roster[first].name}, opening statement — keep it under thirty seconds.`,
    first);
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
      agent.cancel();
      bus.live(agent.id, false);
    }
    clearTimeout(askTimer);
    clearTimeout(handTimer);
    askTimer = handTimer = 0;
    asked = null;
    floor = null;
    elapsed = now() - startedAt;
    setPhase('paused', why);

    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => stop('paused too long — hung up to stop the meter'),
      limits.idleSeconds * 1000,
    );
  }

  function resume() {
    if (phase !== 'paused') return;
    clearTimeout(idleTimer);
    idleTimer = 0;
    for (const id of order) bus.live(id, true);
    startedAt = now() - elapsed;
    setPhase('running');
    announce(`Back to it. ${roster[next].name}, your turn.`, next);
  }

  /** The real one. Both calls are hung up and nothing is billing. */
  function stop(why = '') {
    clearTimeout(askTimer);
    clearTimeout(idleTimer);
    clearTimeout(handTimer);
    askTimer = idleTimer = handTimer = 0;
    asked = null;
    cancelAnimationFrame(frame);
    frame = 0;
    bus.silence();
    for (const agent of agents) agent.stop();
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
