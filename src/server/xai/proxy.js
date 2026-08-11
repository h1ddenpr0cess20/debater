import { WebSocketServer, WebSocket } from 'ws';

import { debater, DEBATER_IDS } from '../personas.js';
import { buildTools, sessionConfig } from './session.js';
import { pickTools, switchedOff } from './tools.js';

/**
 * The xAI half of the app: one socket per lectern, proxied.
 *
 * The OpenAI engine mints a ten-minute client secret and gets out of the way —
 * the call runs browser-to-OpenAI over WebRTC. xAI's realtime API is a
 * WebSocket that wants an API key on it, and an API key is not something to hand
 * a browser, so this process sits in the middle of both calls: audio and the
 * page's own frames go up, everything comes back down, and the key never leaves
 * here.
 *
 * That middle seat is also where the persona lives. The page names a lectern and
 * a motion; what either of those turns into is decided in this file, so a page
 * cannot rewrite who is arguing or what they were told the rules are.
 */

/** What the page may send upstream. Everything else is dropped in silence. */
const ALLOWED = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'conversation.item.create',
  'response.create',
  'response.cancel',
]);

const MAX_FRAME = 1 << 20;

/**
 * The page's own frame: which of the server's tools it wants left out of this
 * debate. It can only take away — what exists is the environment's to say — and
 * it lands mid-call, so switching one is a fresh `session.update` rather than a
 * redial. It applies to this lectern's call; the page sends it to both.
 */
export const TOOLS_EVENT = 'session.tools';

/**
 * The other frame the page keeps to itself: the turns of an earlier debate it is
 * picking back up out of its own log. The proxy replays them upstream as real
 * conversation items, ahead of anything said in the new call.
 *
 * It arrives already cast into the two roles a conversation has — this lectern's
 * own turns as `assistant`, everything else as `user` — because only the page
 * knows which lectern said what.
 */
export const HISTORY_EVENT = 'session.history';

/** How much of an earlier debate the proxy will replay. */
const HISTORY_TURNS = 40;
const HISTORY_CHARS = 6000;

/**
 * The proxy's own frame down to the page: an answer this lectern gave without
 * being asked, which has just been cancelled upstream.
 *
 * The cancel is a round trip, and xAI has seconds of audio in the air behind a
 * response by the time it lands. The page cannot tell that audio from an answer
 * somebody wanted, so it is told the id the moment the decision is made and
 * drops everything that arrives for it.
 */
export const REFUSED_EVENT = 'proxy.refused';

/** How long a motion may be. `topicBlock` caps it again on the way in. */
const TOPIC_CHARS = 400;

/**
 * Which frames from xAI are worth parsing on the way past. Everything else is
 * forwarded as bytes — audio deltas are most of the traffic and the largest, and
 * none of this is worth a JSON.parse of every one of them.
 */
const INSPECT = /"(response\.created|response\.done|error)"/;

/**
 * What the page sent, cut back to turns this will actually replay. The content
 * is text the model reads, so it is capped here as well as in the page — the
 * page is not the only thing that can open this socket.
 */
export function priorTurns(turns) {
  const kept = (Array.isArray(turns) ? turns : [])
    .filter((turn) => (turn?.role === 'user' || turn?.role === 'assistant')
      && typeof turn.content === 'string'
      && turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, HISTORY_CHARS) }))
    .slice(-HISTORY_TURNS);

  let total = kept.reduce((sum, turn) => sum + turn.content.length, 0);
  while (total > HISTORY_CHARS && kept.length > 1) {
    total -= kept.shift().content.length;
  }

  return kept;
}

/**
 * One replayed turn, as an item. Both roles carry `input_text`: xAI documents
 * history seeding with a user text message or an assistant text message, and
 * `input_text` as the content type for a text message either way. `output_text`
 * is the OpenAI GA shape and not this one.
 *
 * Each of these is a billed event upstream, which is what keeps the replay
 * capped: a picked-up debate costs its turns, once, per lectern.
 */
export function historyItem({ role, content }) {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role,
      status: 'completed',
      content: [{ type: 'input_text', text: content }],
    },
  };
}

/**
 * What the page may say, and in what shape.
 *
 * Per-response instructions are stripped rather than refused: instructions on a
 * `response.create` replace the session's for that response, so letting one
 * through would be letting a page hand this lectern a job with no persona
 * attached to it. The director never sends one, and a page that does gets its
 * response without it.
 */
export function sanitize(event) {
  if (!event || typeof event !== 'object' || !ALLOWED.has(event.type)) return null;

  if (event.type === 'response.create') {
    const { instructions, ...response } = event.response ?? {};
    return { ...event, response };
  }

  /**
   * A user message and nothing else. The moderator's lines, the director's
   * handovers and its "[direction]" notes are all user messages; an assistant
   * one would be a page writing this lectern's own record for it, and the turns
   * of an earlier debate have `session.history` for exactly that reason.
   */
  if (event.type === 'conversation.item.create') {
    const item = event.item;
    if (!item || item.type !== 'message' || item.role !== 'user') return null;
  }

  return event;
}

function safeCloseCode(code) {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

/** One lectern's call, as the query string asked for it. */
export function readCall(url, config) {
  const params = new URL(url, 'http://localhost').searchParams;

  const asked = params.get('debater');
  const id = DEBATER_IDS.includes(asked) ? asked : DEBATER_IDS[0];

  const voice = params.get('voice');
  const model = params.get('model');

  return {
    id,
    voice: config.voices.includes(voice) ? voice : config.debaterVoices[id],
    model: config.models.includes(model) ? model : config.defaultModel,
    topic: (params.get('topic') ?? '').replace(/\s+/g, ' ').trim().slice(0, TOPIC_CHARS),
    resumed: params.get('resumed') === '1',
  };
}

/**
 * The floor, kept honest.
 *
 * Everything about this app rests on one thing: one lectern is asked to answer,
 * exactly one answers. The single-agent app this engine is ported from wants the
 * opposite — a person stops talking, the model replies, and that is the product
 * — so its turn detection creates responses and this one inherits that. There is
 * no flag here that turns it off: the port tried inventing one and the debate
 * did nothing at all.
 *
 * So the floor is held here instead, against what actually comes back rather
 * than against a payload's promise. This counts what the page asked for against
 * what was created upstream, and cancels a response nobody asked for — which,
 * on this engine, is every response the far lectern's voice triggers on its own.
 * A cancelled response is a bad turn; two models answering every sentence the
 * other says, and the moderator in chorus, is a bad app and a bill.
 */
export function createFloor({ limit = 2 } = {}) {
  let wanted = 0;

  return {
    /** The page asked for one. */
    asked() {
      wanted = Math.min(limit, wanted + 1);
    },

    /**
     * One was created upstream. True if it is ours to keep — false means nobody
     * asked, and the caller cancels it.
     */
    created() {
      if (wanted === 0) return false;
      wanted -= 1;
      return true;
    },

    /**
     * A response ended without ever being created — the frame was refused, or
     * the call went down mid-handshake. Whatever the page was owed, it is not
     * coming, and holding the credit would let the next unsolicited response
     * through.
     */
    reset() {
      wanted = 0;
    },

    get outstanding() {
      return wanted;
    },
  };
}

export function createXaiProxy(config) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (client, req) => {
    const call = readCall(req.url, config);
    const self = debater(call.id);

    /**
     * What actually went up and what actually came back, in the terminal running
     * the server.
     *
     * A debate that does nothing and says nothing about why is the failure this
     * engine keeps landing in, and it is unfixable from the page: every frame it
     * sends looks plausible and every reply it never gets looks the same as
     * every other reply it never gets. So the proxy — the one place that sees
     * both halves — says what it saw. Audio is left out or it is the only thing
     * you would read; everything else is one line, and an error is printed whole.
     */
    const trace = (arrow, event) => {
      if (!config.trace) return;
      const type = event?.type ?? '?';
      if (type === 'input_audio_buffer.append' || /audio\.delta$/.test(type)) return;
      const detail = type === 'error' || event?.response?.status === 'failed'
        ? `  ${JSON.stringify(event.error ?? event.response?.status_details ?? event.response)}`
        : '';
      console.log(`xai[${call.id}] ${arrow} ${type}${detail}`);
    };

    const tell = (message) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', error: { message } }));
      }
    };

    if (!config.apiKey) {
      tell('XAI_API_KEY is not set — the proxy has nothing to dial with.');
      return client.close(4001, 'no api key');
    }

    const url = `${config.realtimeUrl}?model=${encodeURIComponent(call.model)}`;
    const upstream = new WebSocket(url, {
      headers: { authorization: `Bearer ${config.apiKey}` },
    });

    const floor = createFloor();
    let pending = [];
    let history = [];
    let off = [];

    /** Built per send, not per call: the panel can switch a tool off mid-debate. */
    const update = () => JSON.stringify({
      type: 'session.update',
      session: sessionConfig({
        voice: call.voice,
        debater: self,
        topic: call.topic,
        resumed: call.resumed && history.length > 0,
        tools: buildTools(pickTools(config.tools, off)),
      }),
    });

    const sendUp = (event) => {
      if (upstream.readyState !== WebSocket.OPEN) return false;
      upstream.send(JSON.stringify(event));
      return true;
    };

    /** Everything the proxy needs to know from a frame it is only passing on. */
    function inspect(text) {
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        return;
      }

      if (event.type === 'response.created') {
        if (floor.created()) return;
        console.warn(`xai: ${call.id} answered without being asked — cancelling`);
        /** Ahead of the cancel, so the page stops playing it before xAI stops
         *  sending it. Everything already in the air is dropped there. */
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: REFUSED_EVENT,
            response_id: event.response?.id ?? null,
          }));
        }
        sendUp({ type: 'response.cancel' });
        return;
      }

      /**
       * A response the page was owed that is not coming.
       *
       * Both cases are the same problem: a credit that is never spent leaves the
       * floor thinking one more answer is expected than really is, and the next
       * response nobody asked for is let through on it. An `error` is most often
       * a second `response.create` refused while one was running — the page
       * asked, and the answer to that ask does not exist. Credits are spent at
       * `response.created`, so a response genuinely in flight has already taken
       * its one and this clears nothing it needs.
       */
      if (event.type === 'error') return floor.reset();
      if (event.type === 'response.done' && event.response?.status === 'failed') floor.reset();
    }

    /**
     * An earlier debate, laid back down as items. It goes after the session
     * config, which explains what these turns are, and before anything the page
     * queued while the handshake was still in the air.
     */
    const replay = () => {
      for (const turn of history) upstream.send(JSON.stringify(historyItem(turn)));
    };

    upstream.on('open', () => {
      const first = update();
      if (config.trace) {
        console.log(`xai[${call.id}] → session.update on ${call.model} as ${call.voice}`);
        console.log(JSON.parse(first).session);
      }
      upstream.send(first);
      replay();
      for (const frame of pending) upstream.send(frame);
      pending = [];
      client.send(JSON.stringify({
        type: 'proxy.ready',
        debater: call.id,
        model: call.model,
        voice: call.voice,
      }));
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      if (isBinary) return;
      const text = data.toString();
      /** Parsed only when there is a reason to: audio deltas are most of these. */
      if (config.trace && !/"(response\.output_audio|response\.audio)\.delta"/.test(text)) {
        try {
          trace('←', JSON.parse(text));
        } catch {
          console.log(`xai[${call.id}] ← <unparseable> ${text.slice(0, 200)}`);
        }
      }
      if (INSPECT.test(text)) inspect(text);
    });

    upstream.on('error', (err) => {
      if (config.trace) console.log(`xai[${call.id}] ← SOCKET ERROR ${err.message}`);
      tell(`the call to xAI failed — ${err.message}`);
    });

    upstream.on('close', (code, reason) => {
      if (config.trace) {
        console.log(`xai[${call.id}] ← closed ${code} ${reason?.toString() || ''}`);
      }
      if (client.readyState === WebSocket.OPEN) {
        client.close(safeCloseCode(code), reason?.toString().slice(0, 120) || '');
      }
    });

    client.on('message', (data, isBinary) => {
      if (isBinary || data.length > MAX_FRAME) return;

      let incoming;
      try {
        incoming = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (incoming?.type === TOOLS_EVENT) {
        off = switchedOff(config.tools, incoming.off);
        if (upstream.readyState === WebSocket.OPEN) upstream.send(update());
        return;
      }

      /**
       * Picking a debate up is something the page does as it dials, so this
       * normally lands while the handshake is still out and `open` does the
       * replaying. A late one still gets laid down, once.
       */
      if (incoming?.type === HISTORY_EVENT) {
        if (history.length) return;
        history = priorTurns(incoming.turns);
        if (history.length && upstream.readyState === WebSocket.OPEN) {
          upstream.send(update());
          replay();
        }
        return;
      }

      const event = sanitize(incoming);
      if (!event) {
        trace('✗ dropped', incoming);
        return;
      }
      if (event.type === 'response.create') floor.asked();
      trace('→', event);

      const frame = JSON.stringify(event);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push(frame);
    });

    client.on('close', () => {
      pending = [];
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1000);
      else upstream.terminate();
    });

    client.on('error', () => {
      upstream.terminate();
    });
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close: () => wss.close(),
  };
}
