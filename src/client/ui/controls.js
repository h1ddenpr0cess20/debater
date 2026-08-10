/** Motions to argue, for when nobody can think of one. */
export const MOTIONS = Object.freeze([
  'The federal minimum wage should be abolished.',
  'Health care should be paid for out of taxes, not premiums.',
  'Breakfast is the most important meal of the day.',
  'Every household should be allowed to keep chickens.',
  'Public transport should be free at the point of use.',
  'Term limits would fix more than campaign finance reform would.',
  'Cities, not states, should set their own housing rules.',
  'A potato is a vegetable in the way that matters.',
  'Standardised testing should be scrapped.',
  'The Iowa caucuses should be abolished.',
  'The tipping system should be abolished and wages raised to match.',
]);

const MINUTE = 60;

/** Built from the document rather than the `Option` global: this module is
 *  handed its root, and should not reach past it for a constructor. */
function option(doc, label, value = label) {
  const el = doc.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
}

/**
 * Picks a value in a `<select>`, adding it if the list does not have it. The
 * caps are a short list of sensible numbers rather than a spinner, and a server
 * configured with a number nobody thought of still has to be selectable.
 */
function pick(select, value, label) {
  const wanted = String(value);
  if (![...select.options].some((o) => o.value === wanted)) {
    select.append(option(select.ownerDocument, label(value), wanted));
    [...select.options]
      .sort((a, b) => Number(a.value) - Number(b.value))
      .forEach((o) => select.append(o));
  }
  select.value = wanted;
}

/**
 * The bar along the bottom: the moderator's microphone, the one field they
 * type into, the three buttons that decide whether the debate is happening at
 * all, and the limits on how long it may.
 *
 * The field does two jobs, because before a debate and during one it is the
 * same job: saying something to the room. Empty and idle, it is the motion.
 * Live, it is the moderator putting a question.
 *
 * Stop is not a nicety. Two live realtime calls bill for as long as they are
 * open, so the button that ends them is a first-class control with a keyboard
 * shortcut, and the caps next to it are on by default rather than opt-in.
 */
export function createControls({
  root = document,
  getStatus,
  onStart,
  onSay,
  onMic,
  onToggle,
  onStop,
  onEngineChange,
  onModelChange,
  onVoiceChange,
  onCaps,
  onHeckle,
  onCancel,
}) {
  const formEl = root.querySelector('#controls');
  const micEl = root.querySelector('#mic');
  const topicEl = root.querySelector('#topic');
  const shuffleEl = root.querySelector('#shuffle');
  const startEl = root.querySelector('#start');
  const pauseEl = root.querySelector('#pause');
  const stopEl = root.querySelector('#stop');
  const engineEl = root.querySelector('#engine');
  const modelEl = root.querySelector('#model');
  const voicesEl = root.querySelector('#voices');
  const heckleEl = root.querySelector('#heckle');
  const turnsEl = root.querySelector('#cap-turns');
  const minutesEl = root.querySelector('#cap-minutes');
  const doc = formEl.ownerDocument;

  const voiceEls = new Map();
  /** No catalog means no calls to make, and `sync` must not undo saying so. */
  let unavailable = false;
  /** The roster, kept so the voice pickers can be rebuilt for another engine. */
  let debaters = [];
  let engines = new Map();

  /**
   * The model and voice pickers, rebuilt for one engine.
   *
   * Both lists belong to the engine rather than to the app — a Grok voice is not
   * an OpenAI voice and neither will answer to the other's name — so switching
   * engine throws both away and builds them again. Two debaters in the same
   * voice is the fastest way to make a debate unlistenable, so there is one
   * picker per lectern rather than one shared.
   */
  function useEngine(id) {
    const engine = engines.get(id);
    const models = engine?.models ?? [];
    const voices = engine?.voices ?? [];

    modelEl.replaceChildren(...models.map((m) => option(doc, m.display_name ?? m.id, m.id)));
    const chosen = models.some((m) => m.id === engine.model) ? engine.model : models[0]?.id ?? '';
    modelEl.value = chosen;

    voicesEl.replaceChildren();
    voiceEls.clear();
    const picked = {};
    for (const one of debaters) {
      const wanted = engine?.voices_for?.[one.id];
      const label = doc.createElement('label');
      label.className = 'voice chip';
      label.dataset.debater = one.id;
      label.style.setProperty('--accent', one.accent);
      label.append(one.name);

      const select = doc.createElement('select');
      select.id = `voice-${one.id}`;
      select.setAttribute('aria-label', `${one.name}'s voice`);
      select.replaceChildren(...voices.map((v) => option(doc, v)));
      select.value = voices.includes(wanted) ? wanted : voices[0];
      select.addEventListener('change', () => onVoiceChange(one.id, select.value));

      label.append(select);
      voicesEl.append(label);
      voiceEls.set(one.id, select);
      picked[one.id] = select.value;
    }

    sync();
    return { engine: id, model: chosen, voices: picked, switches: engine?.switches ?? [] };
  }

  function sync() {
    const { phase, mic } = getStatus();
    const idle = phase === 'idle' || phase === 'over';
    const busy = phase === 'connecting';
    const live = phase === 'running' || phase === 'paused';

    startEl.disabled = unavailable || busy || !topicEl.value.trim();
    startEl.textContent = busy ? 'dialling…' : idle ? 'debate' : 'say';
    shuffleEl.hidden = !idle;
    topicEl.placeholder = idle
      ? 'What are they arguing about?'
      : 'Put a question to them, or name one of them…';

    const held = phase === 'paused';
    pauseEl.disabled = !live;
    pauseEl.setAttribute('aria-pressed', String(held));
    pauseEl.setAttribute('aria-label', held ? 'Carry on' : 'Pause the debate');
    pauseEl.title = held ? 'Resume (space)' : 'Pause (space)';
    stopEl.disabled = idle;

    micEl.disabled = unavailable || busy;
    /** `aria-pressed` is the state and the styling hook both — one source. */
    micEl.setAttribute('aria-pressed', String(Boolean(mic)));
    micEl.setAttribute('aria-label', mic ? 'Close the moderator microphone' : 'Open the moderator microphone');

    topicEl.disabled = unavailable;
    /** Which engine a debate runs on is settled when the calls go out, so it is
     *  a choice you make between debates rather than during one. */
    engineEl.disabled = unavailable || !idle;
    modelEl.disabled = unavailable || !idle;
    turnsEl.disabled = !idle;
    minutesEl.disabled = !idle;
    for (const el of voiceEls.values()) el.disabled = !idle;
  }

  function caps() {
    return {
      turns: Number(turnsEl.value) || 0,
      seconds: (Number(minutesEl.value) || 0) * MINUTE,
    };
  }

  /** One field, two jobs: the motion before it starts, the moderator during. */
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = topicEl.value.trim();
    if (!text) return;
    const { phase } = getStatus();
    if (phase === 'idle' || phase === 'over') return onStart(text);
    topicEl.value = '';
    onSay(text);
    sync();
  });

  topicEl.addEventListener('input', sync);

  shuffleEl.addEventListener('click', () => {
    topicEl.value = MOTIONS[Math.floor(Math.random() * MOTIONS.length)];
    sync();
  });

  micEl.addEventListener('click', async () => {
    if ('busy' in micEl.dataset) return;
    micEl.dataset.busy = '';
    try {
      await onMic();
    } finally {
      delete micEl.dataset.busy;
      sync();
    }
  });

  pauseEl.addEventListener('click', () => {
    onToggle();
    sync();
  });

  stopEl.addEventListener('click', () => {
    onStop('stopped');
    sync();
  });

  modelEl.addEventListener('change', () => onModelChange(modelEl.value));

  /** A different engine is a different set of calls: the page rebuilds around it. */
  engineEl.addEventListener('change', () => onEngineChange(useEngine(engineEl.value)));

  heckleEl.addEventListener('click', () => {
    const on = heckleEl.getAttribute('aria-pressed') !== 'true';
    heckleEl.setAttribute('aria-pressed', String(on));
    heckleEl.textContent = on ? 'cut-ins on' : 'cut-ins off';
    onHeckle(on);
  });

  for (const el of [turnsEl, minutesEl]) {
    el.addEventListener('change', () => onCaps(caps()));
  }

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return onCancel();
    /** Space is the pause, unless the thing being typed into wants it. */
    if (e.key !== ' ' || e.target.closest('input, textarea, select, button')) return;
    e.preventDefault();
    onToggle();
    sync();
  });

  return {
    sync,
    caps,
    focus: () => topicEl.focus(),
    get topic() { return topicEl.value.trim(); },
    set topic(text) { topicEl.value = text ?? ''; sync(); },

    /** The microphone's own level, so the button shows it is hearing you. */
    setLevel(level) {
      micEl.style.setProperty('--level', String(Math.min(1, Math.max(0, level))));
    },

    /**
     * What the server offers.
     *
     * The engine picker is only shown when there is a choice to make: a server
     * with one key set has one engine that can take a call, and a disabled
     * dropdown next to the model is a question nobody asked.
     */
    setCatalog(catalog) {
      debaters = catalog.debaters;

      const usable = catalog.engines.filter((one) => one.ready);
      engineEl.replaceChildren(...usable.map((one) => option(doc, one.label, one.id)));
      engineEl.hidden = usable.length < 2;
      engineEl.value = usable.some((one) => one.id === catalog.engine)
        ? catalog.engine
        : usable[0].id;

      if (catalog.caps) {
        pick(turnsEl, catalog.caps.turns, (n) => `${n} turns`);
        pick(minutesEl, Math.max(1, Math.round(catalog.caps.seconds / MINUTE)), (n) => `${n} min`);
      }

      engines = new Map(catalog.engines.map((one) => [one.id, one]));
      return { ...useEngine(engineEl.value), caps: caps() };
    },

    catalogUnavailable() {
      unavailable = true;
      engineEl.hidden = true;
      modelEl.replaceChildren(option(doc, 'unavailable', ''));
      voicesEl.replaceChildren();
      sync();
    },
  };
}
