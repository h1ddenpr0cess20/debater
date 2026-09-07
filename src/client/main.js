import './styles.css';
import './vendor/three-d-stage.js';

import { fetchCatalog } from './api.js';
import { createAudioBus } from './audio/bus.js';
import { createDirector } from './debate/director.js';
import { createModerator, MODERATOR } from './debate/moderator.js';
import { createTranscripts } from './debate/transcript.js';
import { createAgentSession } from './session/agent.js';
import { createXaiSession } from './session/xai.js';
import { buildHall } from './stage/index.js';
import { createToolSwitches } from './tools.js';
import { createConnectorsPanel } from './ui/connectors.js';
import { createControls } from './ui/controls.js';
import { createHud } from './ui/hud.js';
import { createMenu } from './ui/menu.js';
import { stripStageChrome } from './ui/stage.js';
import { createToolsPanel } from './ui/tools.js';
import { createTranscriptPanel } from './ui/transcript.js';
import { trackKeyboardInset } from './ui/viewport.js';

const stage = stripStageChrome(document.querySelector('three-d-stage'));
const { THREE } = await stage.ready;

/** The hall, and the two rigs standing in it. Keyed the way the server keys them. */
const hall = buildHall({ stage, THREE });
const rigs = { egg: hall.egg, potato: hall.potato };

const hud = createHud();
const menu = createMenu();
const transcripts = createTranscripts();
const switches = createToolSwitches();

trackKeyboardInset();

/**
 * A tool switched off should be off now, not next time, wherever that is
 * possible. It is on the xAI engine — the proxy re-declares the tools on the
 * call that is up — and it is not on OpenAI, where the tool list is settled when
 * the client secret is minted. `syncTools` answers for that, per lectern, so
 * this does not have to know which engine is running.
 */
const toolsPanel = createToolsPanel({
  switches,
  onChange() {
    const live = agents.filter((agent) => agent.syncTools());
    hud.notice(live.length
      ? 'switched — both of them are told mid-debate'
      : 'saved — the next debate is dialled with it');
  },
});

const connectorsPanel = createConnectorsPanel({
  /** Which connectors are on is settled when a session is minted, so a debate
   *  already under way was minted with the old set. It is told at the next one. */
  onChange: () => hud.notice('saved — the next debate is dialled with it'),
});

let director = null;
let moderator = null;
let bus = null;
let agents = [];
let model = '';
/** Filled in from the catalog, in place — the panels hold onto this object. */
const speakers = { [MODERATOR]: { id: MODERATOR, name: 'moderator', accent: '#8b8f98' } };

const transcriptPanel = createTranscriptPanel({
  transcripts,
  speakers,
  onNew: () => {
    transcripts.end();
    hud.clearAll();
    hud.notice('');
  },
  onResume: (id) => pickUp(id),
});

const controls = createControls({
  getStatus: () => ({ phase: director?.phase ?? 'idle', mic: Boolean(moderator?.live) }),

  onStart(topic) {
    if (!director) return;
    hud.clearAll();
    hud.notice('');
    hud.setMotion(topic);
    if (!transcripts.live) transcripts.begin({ topic, model });
    director.setLimits(controls.caps());
    director.start({ topic });
    /** The field has done its first job. From here it is the moderator's. */
    controls.topic = '';
  },

  /** A moderator line, typed. Both of them hear it; one is asked to answer. */
  onSay: (text) => director?.say(text),

  /**
   * The microphone. It stays open across turns — a moderator who has to arm
   * themselves before every question is not moderating — and the gates on the
   * bus are what decide whether the room can hear it.
   */
  async onMic() {
    if (!moderator) return;
    try {
      if (!moderator.open) await moderator.listen();
      moderator.live = !moderator.live;
      director?.micChanged();
      hud.setMic({ open: moderator.live });
      hud.notice(moderator.live ? 'microphone open — they can hear you' : '');
    } catch (err) {
      hud.notice(err?.message ?? String(err), { error: true });
    }
  },

  onToggle: () => director?.toggle(),
  onStop: (why) => director?.stop(why),
  onHeckle: (on) => { if (director) director.heckling = on; },

  /**
   * A model, and with it a provider.
   *
   * There is no separate engine switch: picking a Grok model is what puts the
   * debate on xAI. Most of the time that is just a new model on the two calls
   * we already have. When it crosses providers it is a different pair of calls
   * dialled a different way, so both lecterns and the director in front of them
   * are built again — which is only safe because the picker is disabled while a
   * debate is up.
   */
  onModelChange(chosen) {
    if (!chosen) return;
    model = chosen.model;

    if (!chosen.changed) {
      for (const agent of agents) agent.model = model;
      return;
    }

    director?.stop();
    switches.setCatalog(chosen.switches);
    toolsPanel.render();
    build(chosen);
    hud.notice(`${chosen.engine === 'xai' ? 'xAI' : 'OpenAI'} — the next debate runs on it`);
  },

  onVoiceChange(id, voice) {
    const agent = agents.find((one) => one.id === id);
    if (agent) agent.voice = voice;
  },

  onCaps: (caps) => director?.setLimits(caps),

  onCancel() {
    if (toolsPanel.isOpen) return toolsPanel.close();
    if (connectorsPanel.isOpen) return connectorsPanel.close();
    if (transcriptPanel.isOpen) return transcriptPanel.close();
    if (menu.isOpen) return menu.close();
    /** Nothing open to close: the escape hatch is the one that costs money. */
    director?.stop('stopped');
    controls.sync();
  },
});

/**
 * Picks an old debate back up. Both lecterns are redialled with those turns
 * handed over as context, and what is said from here lands in that same entry.
 */
function pickUp(id) {
  if (!director) return;
  director.stop();
  const earlier = transcripts.resume(id);
  if (!earlier) return;
  hud.clearAll();
  hud.setMotion(earlier.topic);
  director.setLimits(controls.caps());
  director.start({ topic: earlier.topic, turns: earlier.turns });
  controls.topic = '';
}

function wire() {
  director.on('phase', ({ phase, why }) => {
    hud.setPhase(phase, why);
    if (phase === 'over') {
      transcripts.end();
      for (const rig of Object.values(rigs)) rig.setState('idle');
      hud.setFloor(null);
    }
    controls.sync();
  });

  director.on('state', ({ id, state }) => {
    rigs[id]?.setState(state);
    hud.setState(id, state);
  });

  /**
   * A new turn starts on a clean caption, and nothing else clears one.
   *
   * Not on "thinking": hearing the other side speak is what puts a lectern into
   * that state, so clearing there wiped what somebody had just said the instant
   * their opponent opened their mouth — which is exactly when you want to read
   * it. Being asked to answer is the only moment their own last turn is over.
   */
  director.on('asked', ({ id }) => hud.clearCaption(id));

  director.on('level', ({ id, level }) => {
    if (id === MODERATOR) {
      controls.setLevel(level);
      hud.setMic({ open: Boolean(moderator?.live), level });
      return;
    }
    rigs[id]?.setLevel(level);
  });
  director.on('pulse', ({ id, weight }) => rigs[id]?.pulse(weight));
  director.on('text', ({ id, chunk }) => hud.appendCaption(id, chunk));
  director.on('floor', (id) => hud.setFloor(id));
  director.on('meter', (meter) => hud.setMeter(meter));
  director.on('turn', (turn) => transcripts.append(turn));

  director.on('interrupt', ({ id, over }) => {
    const who = speakers[id]?.name ?? id;
    hud.notice(`${who} cuts in over ${speakers[over]?.name ?? over}`);
  });

  director.on('nudge', ({ id, spoken }) => {
    const name = speakers[id]?.name ?? id;
    hud.notice(spoken
      ? `${name} did not pick that up — handing it over in text`
      : `${name} has nothing to answer — asking again`);
  });

  /**
   * A typed question, waiting for whoever is talking to finish. Said out loud
   * because the room looks identical to one that swallowed it.
   */
  director.on('waiting', ({ id, behind }) => {
    const name = speakers[id]?.name ?? id;
    const who = behind && behind !== MODERATOR ? speakers[behind]?.name ?? behind : null;
    hud.notice(who
      ? `${who} is finishing — ${name} takes that next`
      : `${name} takes that as soon as the floor is free`);
  });

  /** Said out loud, because a debate that stops dead used to stop in silence. */
  director.on('stalled', ({ id }) => {
    hud.notice(`nobody was saying anything — over to ${speakers[id]?.name ?? id}`);
  });

  /** One of them has gone to look something up, which is worth watching happen. */
  director.on('tool', ({ id, label }) => {
    if (label) hud.notice(`${speakers[id]?.name ?? id} is ${label}`);
  });

  director.on('error', ({ id, message }) => {
    hud.notice(id ? `${speakers[id]?.name ?? id}: ${message}` : message, { error: true });
    controls.sync();
  });
}

/** The roster and the caps, kept for every rebuild after the first. */
let roster = [];
let caps = null;
/** And the connector tools the page has to be able to answer, same reason. */
let connectorTools = [];
let toolLabels = {};

/**
 * The two lecterns and the director in front of them, for one engine.
 *
 * Which session class is used is the whole of the difference. Everything above
 * this line — the bus, the microphone, the rigs, the log — is the same app
 * either way, which is what makes the other engine an engine rather than a
 * second version of the page.
 */
function build({ engine: which, model: chosenModel, voices }) {
  const session = which === 'xai' ? createXaiSession : createAgentSession;
  agents = roster.map((one) => session({
    id: one.id,
    name: one.name,
    bus,
    model: chosenModel,
    voice: voices[one.id],
    switches,
    /**
     * The connector tools, which only the OpenAI engine can be handed: its
     * calls run browser-to-OpenAI, so a tool call arrives in this page and the
     * page is the only thing that can answer it. xAI runs its own inside its
     * own turn and ignores both of these.
     */
    connectorTools,
    toolLabels,
  }));

  director = createDirector({ bus, agents, moderator, caps });
  wire();
}

try {
  const catalog = await fetchCatalog();

  roster = catalog.debaters;
  caps = catalog.caps;
  connectorTools = catalog.connectors?.tools ?? [];
  toolLabels = catalog.connectors?.labels ?? {};

  for (const one of roster) {
    speakers[one.id] = one;
    const el = document.querySelector(`.lectern[data-debater="${one.id}"]`);
    if (!el) continue;
    el.style.setProperty('--accent', one.accent);
    el.querySelector('.name').textContent = one.name;
    el.querySelector('.party .long').textContent = one.leaning;
    /** The same word for a lectern too narrow to hold it — see `styles.css`. */
    el.querySelector('.party .short').textContent = one.leaning_short ?? one.leaning;
  }

  const chosen = controls.setCatalog(catalog);
  if (!chosen.model) throw new Error('this key can’t reach any realtime model');
  model = chosen.model;
  switches.setCatalog(chosen.switches);

  bus = createAudioBus();
  moderator = createModerator({ bus });
  build(chosen);
  hud.setMeter({ turns: 0, limit: caps.turns, seconds: 0, usage: {} });
} catch (err) {
  controls.catalogUnavailable();
  hud.notice(`${err.message} — is the proxy running? (npm run dev)`, { error: true });
}

/**
 * A tab nobody is looking at is a tab nobody notices the meter on. Hiding it
 * pauses the debate; the director's own idle timer hangs the calls up if it
 * stays hidden.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) director?.pause('paused — you left the tab');
  controls.sync();
});

window.addEventListener('pagehide', () => {
  director?.stop();
  moderator?.close();
});

controls.sync();
if (window.matchMedia('(pointer: fine)').matches) controls.focus();
