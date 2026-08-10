# Configuration

Everything is read from the environment, and `.env` is read by both `npm run
dev` and `npm start`. Copy [`.env.example`](../.env.example) and fill in the
key; nothing else has to be set.

## The key

```sh
OPENAI_API_KEY=sk-...
```

It stays in the Node process. The browser is handed two ten-minute client
secrets — one per lectern — minted from it by `/api/session`, and never the key
itself. Both calls then run browser-to-OpenAI over WebRTC, which is why the
audio never touches this server.

`OPENAI_BASE_URL` points the proxy somewhere else — a gateway, or a stub.

## Who is at each lectern

| | |
|---|---|
| `EGG_VOICE` | Marc's voice. Default `ash`. |
| `POTATO_VOICE` | Tater's voice. Default `cedar`. |
| `OPENAI_REALTIME_MODEL` | What the model picker opens on. Default `gpt-realtime-2.1`. |

The voices are `ash`, `alloy`, `ballad`, `cedar`, `coral`, `echo`, `marin`,
`sage`, `shimmer` and `verse`. Give them different ones: two debaters in the
same voice is unlistenable, and the page will not stop you doing it from the
pickers.

Both of them can be given a different voice or model from the bar at the bottom
between debates. The personas themselves are in
[`src/server/personas.js`](../src/server/personas.js) — one block of shared
rules, and one persona each.

## The caps

Two open realtime sessions cost money for as long as they are open, and neither
debater will ever decide it has had enough. These are the things that decide it:

| | | |
|---|---|---|
| `DEBATE_TURNS` | 12 | Turns before both calls are hung up. |
| `DEBATE_SECONDS` | 480 | Wall clock before both calls are hung up. |
| `DEBATE_IDLE_SECONDS` | 90 | How long a pause may sit there before it becomes a hang-up. |

The first two open the fields in the bar, and can be changed there between
debates. The third is not in the page at all, because it exists for the case
where nobody is looking at the page.

Pause is not free. It shuts every audio gate, cancels anything mid-answer and
deadens both outbound tracks, so nothing is being generated and nothing is being
sent — but two sessions are still open at the far end. Stop is the one that
costs nothing afterwards.

## On a phone

The moderator's microphone needs a secure context, and `http://<your laptop>` on
the wifi is not one. So:

```sh
npm run dev:lan
```

That serves over HTTPS with a self-signed certificate from
`@vitejs/plugin-basic-ssl`, on every interface. Open
`https://<this machine on the wifi>:5173` and accept the warning once.

`npm run preview:lan` does the same for the built bundle. Real certificates go
in `SSL_KEY` and `SSL_CERT`, and are used whether or not `--https` was asked
for.

## Connectors

Nothing is registered. `connectors` in the page will say so.

The plumbing is all there: `/api/connectors` reads and writes the settings,
`/api/connectors/run` runs a tool on behalf of a debater whose call made the
tool call, `connectors.json` survives a restart, and whatever is switched on is
declared to both lecterns when their sessions are minted. What is missing is a
connector worth giving them —
[`src/server/connectors/catalog.js`](../src/server/connectors/catalog.js) has
the shape of one and the reasoning about which comes first.

| | |
|---|---|
| `CONNECTORS` | Names of connectors to switch on at boot, comma separated. |
| `CONNECTOR_FILE` | Where the panel's settings are written. Default `connectors.json`. |

## Docker

```sh
docker build -t debater .
docker run -p 5173:5173 -e OPENAI_API_KEY=sk-... debater
```

The image builds the client and serves `dist/` from the same Node process that
fronts the API. It has production dependencies only, so it cannot generate a
self-signed certificate: terminate TLS in front of it, or mount a real
`SSL_KEY`/`SSL_CERT` pair.

## Everything else

| | |
|---|---|
| `PORT` | Default 5173, for both the dev server and the built one. |
| `TRANSCRIPT` | Set false to stop the page keeping a log of debates. |
