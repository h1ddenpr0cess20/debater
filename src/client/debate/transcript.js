export const KEY = 'debater.transcripts.v1';

const LIMIT = 30;
const BUDGET = 300_000;
const PROBE = `${KEY}.probe`;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

export function defaultStorage() {
  try {
    const store = globalThis.localStorage;
    store.setItem(PROBE, '1');
    store.removeItem(PROBE);
    return store;
  } catch {
    return memoryStorage();
  }
}

function newId(startedAt) {
  return `d${startedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function valid(debate) {
  return Boolean(
    debate
    && typeof debate.id === 'string'
    && Number.isFinite(debate.startedAt)
    && Array.isArray(debate.turns)
    && debate.turns.every((t) => t && typeof t.content === 'string' && typeof t.speaker === 'string'),
  );
}

/**
 * Every debate this browser has held, and the one being held now.
 *
 * The same store the single-agent apps kept conversations in, turned side on:
 * a turn is filed under who said it rather than under a role, because there are
 * three speakers here — two lecterns and a moderator — and "assistant" stopped
 * meaning anything the moment there were two of them.
 */
export function createTranscripts({
  storage = defaultStorage(),
  key = KEY,
  limit = LIMIT,
  budget = BUDGET,
  now = Date.now,
} = {}) {
  let debates = load();
  let open = null;
  const listeners = new Set();

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? 'null');
      if (parsed?.version !== 1 || !Array.isArray(parsed.debates)) return [];
      return parsed.debates.filter(valid);
    } catch {
      return [];
    }
  }

  function save() {
    for (;;) {
      if (debates.length > limit) {
        debates.pop();
        continue;
      }
      const body = JSON.stringify({ version: 1, debates });
      if (body.length > budget && debates.length > 1) {
        debates.pop();
        continue;
      }
      try {
        storage.setItem(key, body);
      } catch {
        if (debates.length > 1) {
          debates.pop();
          continue;
        }
      }
      return;
    }
  }

  function changed() {
    for (const listener of listeners) listener();
  }

  function begin({ topic = '', model = '' } = {}) {
    end();
    open = { id: newId(now()), startedAt: now(), endedAt: null, topic, model, turns: [] };
    return open;
  }

  function append(turn) {
    const content = typeof turn?.content === 'string' ? turn.content.trim() : '';
    const speaker = typeof turn?.speaker === 'string' ? turn.speaker : '';
    if (!content || !speaker) return null;

    const line = { speaker, content, at: now() };
    open ??= begin();
    if (!debates.includes(open)) debates.unshift(open);
    open.turns.push(line);
    open.endedAt = line.at;

    save();
    changed();
    return line;
  }

  function end() {
    if (!open) return null;
    const closed = open;
    open = null;
    if (closed.turns.length) changed();
    return closed;
  }

  /** Opens a stored debate back up, so what is said next lands in it. */
  function resume(id) {
    const at = debates.findIndex((d) => d.id === id);
    if (at < 0) return null;

    end();
    open = debates[at];
    debates.splice(at, 1);
    debates.unshift(open);
    save();
    changed();
    return { ...open, turns: [...open.turns] };
  }

  return {
    begin,
    append,
    end,
    resume,

    get debates() {
      return debates.map((d) => ({ ...d, turns: [...d.turns] }));
    },

    get live() {
      return open?.id ?? null;
    },

    remove(id) {
      const at = debates.findIndex((d) => d.id === id);
      if (at < 0) return false;
      if (debates[at] === open) open = null;
      debates.splice(at, 1);
      save();
      changed();
      return true;
    },

    clear() {
      debates = [];
      open = null;
      try {
        storage.removeItem(key);
      } catch {}
      changed();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
