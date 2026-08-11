const PATH = '/realtime';

const OPEN_TIMEOUT = 15_000;

/**
 * The page's end of one lectern's proxied call.
 *
 * Only the xAI engine comes through here. What goes in the query string is
 * everything the proxy needs to build the session before the first frame — which
 * lectern this is, in what voice, on what model, about what — because the
 * alternative is a session config that has to be sent twice and a first turn
 * that might land between the two.
 *
 * The key is not in any of this. It never leaves the proxy.
 */
function socketUrl({ debater, voice, model, topic, resumed }) {
  const url = new URL(PATH, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (debater) url.searchParams.set('debater', debater);
  if (voice) url.searchParams.set('voice', voice);
  if (model) url.searchParams.set('model', model);
  if (topic) url.searchParams.set('topic', topic);
  if (resumed) url.searchParams.set('resumed', '1');
  return url;
}

export function connect({
  debater,
  voice,
  model,
  topic,
  resumed = false,
  history = [],
  toolsOff = [],
  onEvent,
  onClose,
}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl({ debater, voice, model, topic, resumed }));
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error('the connection to the proxy timed out'));
    }, OPEN_TIMEOUT);

    ws.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      /** Sent as the call opens, so the first session config already omits them. */
      if (toolsOff.length) ws.send(JSON.stringify({ type: 'session.tools', off: toolsOff }));
      /** Ahead of any audio, so the proxy has it before the debate is under way. */
      if (history.length) ws.send(JSON.stringify({ type: 'session.history', turns: history }));
      resolve({
        get open() {
          return ws.readyState === WebSocket.OPEN;
        },
        send(event) {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(JSON.stringify(event));
          return true;
        },
        close() {
          onClose = () => {};
          ws.close(1000);
        },
      });
    });

    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      try {
        onEvent(JSON.parse(e.data));
      } catch {
      }
    });

    ws.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('could not reach the proxy — is it running? (npm run dev)'));
    });

    ws.addEventListener('close', (e) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        return reject(new Error(e.reason || 'the proxy closed the connection'));
      }
      onClose(e.code === 1000 || e.code === 1005 ? null : e.reason || 'the call dropped');
    });
  });
}
