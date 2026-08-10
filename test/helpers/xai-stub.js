import { createServer } from 'node:http';
import { once } from 'node:events';

import { WebSocketServer } from 'ws';

export async function startXaiStub() {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });

  const state = {
    received: [],
    url: null,
    headers: null,
    socket: null,
  };

  let waiters = [];
  const check = () => {
    waiters = waiters.filter((w) => {
      if (state.received.length >= w.n) {
        w.resolve(state.received);
        return false;
      }
      return true;
    });
  };

  wss.on('connection', (ws, req) => {
    state.url = req.url;
    state.headers = req.headers;
    state.socket = ws;
    ws.on('message', (data) => {
      try {
        state.received.push(JSON.parse(data.toString()));
      } catch {
        state.received.push({ type: '<unparseable>', raw: data });
      }
      check();
    });
  });

  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const { port } = http.address();

  return {
    ...state,
    url: () => state.url,
    headers: () => state.headers,
    received: () => state.received,
    address: `ws://127.0.0.1:${port}`,
    send: (event) => state.socket.send(JSON.stringify(event)),
    waitFor(n, ms = 2000) {
      if (state.received.length >= n) return Promise.resolve(state.received);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`only ${state.received.length} of ${n} frames arrived`)),
          ms,
        );
        waiters.push({ n, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      });
    },
    async close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      http.close();
      await once(http, 'close');
    },
  };
}
