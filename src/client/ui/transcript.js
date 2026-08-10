const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function when(at, now = Date.now()) {
  const then = new Date(at);
  const today = new Date(now);
  const sameDay = then.toDateString() === today.toDateString();
  return sameDay ? TIME.format(then) : `${DAY.format(then)}, ${TIME.format(then)}`;
}

/**
 * The log: every debate this browser has held, and a way back into one.
 *
 * `continue` on an entry redials both lecterns with those turns handed over as
 * context, and what is said from there lands in the same entry rather than a
 * new one — the same resume the single-agent apps had, with two calls to
 * reopen instead of one.
 */
export function createTranscriptPanel({
  root = document,
  transcripts,
  speakers = {},
  onNew,
  onResume,
} = {}) {
  const panelEl = root.querySelector('#log');
  const listEl = root.querySelector('#log-list');
  const toggleEl = root.querySelector('#log-toggle');
  const newEl = root.querySelector('#log-new');
  const clearEl = root.querySelector('#log-clear');
  const closeEl = root.querySelector('#log-close');
  const doc = panelEl.ownerDocument;

  let armed = null;

  function disarm() {
    clearTimeout(armed);
    armed = null;
    clearEl.textContent = 'clear';
    clearEl.classList.remove('armed');
  }

  function resumeEl(debate) {
    const live = debate.id === transcripts.live;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'chip resume';
    button.disabled = live;
    button.append(live ? 'live' : 'continue');
    if (!live) {
      button.setAttribute('aria-label', `Continue the debate from ${when(debate.startedAt)}`);
      button.addEventListener('click', () => {
        close();
        onResume?.(debate.id);
      });
    }
    return button;
  }

  function debateEl(debate) {
    const section = doc.createElement('section');
    section.className = 'entry';

    const head = doc.createElement('header');
    head.className = 'chip';
    head.append(when(debate.startedAt));
    if (debate.model) {
      const dim = doc.createElement('span');
      dim.className = 'meta';
      dim.append(debate.model);
      head.append(dim);
    }
    head.append(resumeEl(debate));
    section.append(head);

    if (debate.topic) {
      const motion = doc.createElement('p');
      motion.className = 'motion';
      motion.append(debate.topic);
      section.append(motion);
    }

    for (const turn of debate.turns) {
      const line = doc.createElement('p');
      line.className = 'turn';
      line.dataset.speaker = turn.speaker;

      const who = doc.createElement('span');
      who.className = 'who chip';
      const speaker = speakers[turn.speaker];
      if (speaker?.accent) who.style.setProperty('--accent', speaker.accent);
      who.append(speaker?.name ?? turn.speaker);

      line.append(who, turn.content);
      section.append(line);
    }

    return section;
  }

  function render() {
    const debates = transcripts.debates;
    newEl.disabled = !transcripts.live;
    listEl.replaceChildren();

    if (!debates.length) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.append('No debates yet. Give them a motion and they will find something'
        + ' to disagree about — and settle it faster than Iowa counts.');
      listEl.append(empty);
      clearEl.disabled = true;
      return;
    }

    clearEl.disabled = false;
    listEl.append(...debates.map(debateEl));
    listEl.scrollTop = 0;
  }

  transcripts.subscribe(() => {
    if (!panelEl.hidden) render();
  });

  function open() {
    render();
    panelEl.hidden = false;
    toggleEl.setAttribute('aria-expanded', 'true');
    closeEl.focus();
  }

  function close() {
    disarm();
    panelEl.hidden = true;
    toggleEl.setAttribute('aria-expanded', 'false');
  }

  toggleEl.addEventListener('click', () => (panelEl.hidden ? open() : close()));
  closeEl.addEventListener('click', close);

  newEl.addEventListener('click', () => {
    close();
    onNew?.();
  });

  clearEl.addEventListener('click', () => {
    if (!armed) {
      clearEl.textContent = 'sure?';
      clearEl.classList.add('armed');
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    transcripts.clear();
    render();
  });

  return {
    open,
    close,
    render,
    get isOpen() {
      return !panelEl.hidden;
    },
  };
}
