/**
 * What xAI actually accepts, asked directly.
 *
 * The engine is silent and says nothing about why, which is the one failure the
 * app cannot diagnose from inside itself: every frame it sends is plausible and
 * every reply it does not get looks the same. So this skips the app. It dials
 * the same endpoint with the same key, sends one session shape, asks for one
 * answer, and prints every frame that comes back with a timestamp on it.
 *
 * It walks a handful of shapes rather than one — the payload this app sends,
 * and the obvious suspects removed one at a time — so a single run says which
 * of them xAI answers and which it ignores. Nothing here is written back into
 * the app; the point is to find out, then fix `session.js` knowing.
 *
 *   node --env-file-if-exists=.env scripts/probe-xai.js
 *   node --env-file-if-exists=.env scripts/probe-xai.js --model grok-voice-latest
 */
import { WebSocket } from 'ws';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

/**
 * The key, from wherever it is. A probe that will not run because it wanted the
 * variable spelled its way is a probe that has wasted your time instead of
 * saving it, so this takes it on the command line as well, and says what it
 * looked at when it finds nothing.
 */
const KEY = arg('key', process.env.XAI_API_KEY || process.env.XAI_KEY || process.env.GROK_API_KEY);
const URL_ = arg('url', process.env.XAI_REALTIME_URL || 'wss://api.x.ai/v1/realtime');
const MODEL = arg('model', process.env.XAI_MODEL || 'grok-voice-latest');
const VOICE = arg('voice', 'atlas');
const RATE = 24_000;

if (!KEY) {
  console.error([
    'No key found. Pass it directly:',
    '',
    '  node scripts/probe-xai.js --key xai-...',
    '',
    'or set XAI_API_KEY in the environment, or put it in .env and run:',
    '',
    '  node --env-file-if-exists=.env scripts/probe-xai.js',
    '',
    `Checked XAI_API_KEY (${process.env.XAI_API_KEY ? 'set' : 'unset'}),`
      + ` XAI_KEY (${process.env.XAI_KEY ? 'set' : 'unset'}),`
      + ` GROK_API_KEY (${process.env.GROK_API_KEY ? 'set' : 'unset'}).`,
  ].join('\n'));
  process.exit(1);
}

const INSTRUCTIONS = 'You are a debater arguing that potatoes beat eggs.'
  + ' Answer out loud, in one or two sentences.';

/** The shapes worth asking about, most-like-the-app first. */
const SHAPES = [
  {
    name: 'as the app sends it',
    session: {
      voice: VOICE,
      instructions: INSTRUCTIONS,
      reasoning: { effort: 'none' },
      turn_detection: {
        type: 'server_vad', threshold: 0.7, prefix_padding_ms: 333, silence_duration_ms: 520,
      },
      audio: {
        input: { format: { type: 'audio/pcm', rate: RATE }, transport: 'json' },
        output: { format: { type: 'audio/pcm', rate: RATE }, transport: 'json' },
      },
      tools: [],
    },
  },
  {
    name: 'without reasoning',
    session: {
      voice: VOICE,
      instructions: INSTRUCTIONS,
      turn_detection: {
        type: 'server_vad', threshold: 0.7, prefix_padding_ms: 333, silence_duration_ms: 520,
      },
      audio: {
        input: { format: { type: 'audio/pcm', rate: RATE }, transport: 'json' },
        output: { format: { type: 'audio/pcm', rate: RATE }, transport: 'json' },
      },
      tools: [],
    },
  },
  {
    name: 'with create_response: false (what the port invented)',
    session: {
      voice: VOICE,
      instructions: INSTRUCTIONS,
      reasoning: { effort: 'none' },
      turn_detection: {
        type: 'server_vad', threshold: 0.7, prefix_padding_ms: 333,
        silence_duration_ms: 520, create_response: false, interrupt_response: true,
      },
      audio: {
        input: { format: { type: 'audio/pcm', rate: RATE }, transport: 'json' },
        output: { format: { type: 'audio/pcm', rate: RATE }, transport: 'json' },
      },
      tools: [],
    },
  },
  {
    name: 'voice and turn_detection nested under audio (the GA shape)',
    session: {
      instructions: INSTRUCTIONS,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: RATE },
          turn_detection: { type: 'server_vad', threshold: 0.7 },
        },
        output: { format: { type: 'audio/pcm', rate: RATE }, voice: VOICE },
      },
      tools: [],
    },
  },
  {
    name: 'bare minimum',
    session: { voice: VOICE, instructions: INSTRUCTIONS },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe({ name, session }) {
  const started = Date.now();
  const at = () => `+${String(Date.now() - started).padStart(5)}ms`;
  const seen = { updated: false, created: false, audio: 0, text: 0, errors: [], types: new Set() };

  console.log(`\n${'─'.repeat(72)}\n▶ ${name}`);

  const ws = new WebSocket(`${URL_}?model=${encodeURIComponent(MODEL)}`, {
    headers: { authorization: `Bearer ${KEY}` },
  });

  const done = new Promise((resolve) => {
    ws.on('open', async () => {
      console.log(`${at()}  socket open`);
      ws.send(JSON.stringify({ type: 'session.update', session }));

      await sleep(1500);
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Give your opening statement now.' }],
        },
      }));
      ws.send(JSON.stringify({ type: 'response.create' }));
      console.log(`${at()}  asked for a response`);

      await sleep(9000);
      if (ws.readyState === WebSocket.OPEN) ws.close(1000);
      resolve();
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) { console.log(`${at()}  <binary ${data.length}b>`); return; }
      let e;
      const text = data.toString();
      try { e = JSON.parse(text); } catch { console.log(`${at()}  <unparseable> ${text.slice(0, 160)}`); return; }

      seen.types.add(e.type);
      if (e.type === 'session.updated') seen.updated = true;
      if (e.type === 'response.created') seen.created = true;
      if (/audio\.delta$/.test(e.type)) { seen.audio++; return; }   // too many to print
      if (/transcript\.delta$|text\.delta$/.test(e.type)) { seen.text++; return; }
      if (e.type === 'error') seen.errors.push(e.error?.message ?? JSON.stringify(e.error));

      console.log(`${at()}  ${e.type}${e.type === 'error' ? `  →  ${JSON.stringify(e.error)}` : ''}`);
    });

    ws.on('error', (err) => { console.log(`${at()}  SOCKET ERROR  ${err.message}`); resolve(); });
    ws.on('close', (code, reason) => {
      console.log(`${at()}  closed ${code} ${reason?.toString() || ''}`);
      resolve();
    });
  });

  await done;
  console.log(`  ── session.updated: ${seen.updated} | response.created: ${seen.created}`
    + ` | audio deltas: ${seen.audio} | text deltas: ${seen.text}`
    + `${seen.errors.length ? `\n  ── errors: ${seen.errors.join(' / ')}` : ''}`);
  return { name, ...seen, types: [...seen.types] };
}

console.log(`endpoint ${URL_}\nmodel    ${MODEL}\nvoice    ${VOICE}`);

const results = [];
for (const shape of SHAPES) {
  results.push(await probe(shape));
  await sleep(500);
}

console.log(`\n${'═'.repeat(72)}\nSUMMARY`);
for (const r of results) {
  const verdict = r.audio > 0 ? 'SPOKE'
    : r.created ? 'created a response but no audio'
      : r.errors.length ? 'REJECTED'
        : 'silent';
  console.log(`  ${verdict.padEnd(34)} ${r.name}`);
  if (r.errors.length) console.log(`${' '.repeat(38)}${r.errors.join(' / ')}`);
}
console.log(`\nEvent types seen across all shapes:\n  ${
  [...new Set(results.flatMap((r) => r.types))].sort().join('\n  ') || '(none)'}`);
