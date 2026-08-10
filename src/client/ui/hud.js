const INLINE = [
  { tag: 'code', re: /`([^`\n]+)`/ },
  { tag: 'strong', re: /\*\*(\S|\S[\s\S]*?\S)\*\*/ },
  { tag: 'strong', re: /__(\S|\S[\s\S]*?\S)__/ },
  { tag: 's', re: /~~(\S|\S[\s\S]*?\S)~~/ },
  { tag: 'em', re: /(?<![\w*])\*(\S|\S[\s\S]*?\S)\*(?!\w)/ },
  { tag: 'em', re: /(?<![\w_])_(\S|\S[\s\S]*?\S)_(?!\w)/ },
];

function firstSpan(text) {
  let found = null;
  for (const { tag, re } of INLINE) {
    const m = re.exec(text);
    if (m && (!found || m.index < found.at)) {
      found = { tag, at: m.index, width: m[0].length, body: m[1] };
    }
  }
  return found;
}

function render(text, into) {
  let rest = text;
  for (let span = firstSpan(rest); span; span = firstSpan(rest)) {
    if (span.at) into.append(rest.slice(0, span.at));
    const el = into.ownerDocument.createElement(span.tag);
    if (span.tag === 'code') el.append(span.body);
    else render(span.body, el);
    into.append(el);
    rest = rest.slice(span.at + span.width);
  }
  if (rest) into.append(rest);
  return into;
}

export function clock(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function tokens(usage = {}) {
  const total = Object.values(usage)
    .reduce((sum, one) => sum + (one?.input ?? 0) + (one?.output ?? 0), 0);
  if (total < 1000) return `${total} tok`;
  return `${(total / 1000).toFixed(total < 10_000 ? 1 : 0)}k tok`;
}

/**
 * What the room shows: the state of the debate up top, and a running caption
 * under each lectern.
 *
 * Two captions rather than one. A debate read back as a single stream loses the
 * only thing that makes it a debate — you cannot see who is answering whom —
 * and the sides are already colour-coded by the lecterns behind them.
 */
export function createHud(root = document) {
  const phaseEl = root.querySelector('#phase');
  const motionEl = root.querySelector('#motion');
  const turnsEl = root.querySelector('#meter-turns');
  const clockEl = root.querySelector('#meter-clock');
  const tokensEl = root.querySelector('#meter-tokens');
  const noticeEl = root.querySelector('#notice');
  const modEl = root.querySelector('#mod');

  const sides = new Map();
  for (const el of root.querySelectorAll('.lectern[data-debater]')) {
    sides.set(el.dataset.debater, {
      root: el,
      caption: el.querySelector('.caption'),
      state: el.querySelector('.state'),
      turn: '',
    });
  }

  function side(id) {
    return sides.get(id) ?? null;
  }

  return {
    setPhase(phase, why = '') {
      phaseEl.dataset.phase = phase;
      phaseEl.textContent = phase;
      if (why) this.notice(why);
    },

    setMotion(text) {
      motionEl.textContent = text ?? '';
      motionEl.classList.toggle('visible', Boolean(text));
    },

    setMeter({ turns = 0, limit = 0, seconds = 0, usage = {} } = {}) {
      turnsEl.textContent = `${turns}/${limit} turns`;
      clockEl.textContent = clock(seconds);
      tokensEl.textContent = tokens(usage);
    },

    /** One line about what just happened, and why the debate stopped. */
    notice(text, { error = false } = {}) {
      noticeEl.textContent = text ?? '';
      noticeEl.classList.toggle('visible', Boolean(text));
      noticeEl.classList.toggle('error', error);
    },

    setState(id, state) {
      const one = side(id);
      if (!one) return;
      one.root.dataset.state = state;
      one.state.textContent = state;
    },

    /** Whose voice is carrying, so the room can dim whoever is not talking. */
    setFloor(id) {
      for (const [key, one] of sides) one.root.dataset.floor = String(key === id);
      if (modEl) modEl.dataset.floor = String(id === 'moderator');
    },

    /** The microphone: whether it is open at all, and how loud you are into it. */
    setMic({ open, level = 0 } = {}) {
      if (!modEl) return;
      modEl.dataset.live = String(Boolean(open));
      modEl.style.setProperty('--level', String(Math.min(1, Math.max(0, level))));
    },

    appendCaption(id, chunk) {
      const one = side(id);
      if (!one) return;
      one.turn += chunk;
      one.caption.classList.add('visible');
      one.caption.replaceChildren();
      render(one.turn, one.caption);
      one.caption.scrollTop = one.caption.scrollHeight;
    },

    clearCaption(id) {
      const one = side(id);
      if (!one) return;
      one.turn = '';
      one.caption.replaceChildren();
      one.caption.classList.remove('visible');
    },

    clearAll() {
      for (const id of sides.keys()) this.clearCaption(id);
    },
  };
}
