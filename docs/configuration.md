# Configuration

Everything is read from the environment, and `.env` is read by both `npm run
dev` and `npm start`. Copy [`.env.example`](../.env.example) and fill in one of
the two keys; nothing else has to be set.

## The engines

Two lecterns can be run on either of two providers. Set the key for one, or set
both: the model picker in the bar at the bottom then lists every model this
server can dial, grouped by whoever runs it, and picking one is what settles the
provider. The voice pickers and the `tools` panel follow it. It is disabled while
a debate is up, because which engine a debate runs on is settled when the calls
go out.

```sh
OPENAI_API_KEY=sk-...      # the OpenAI engine
XAI_API_KEY=xai-...        # the xAI engine
```

Either key stays in the Node process; neither ever reaches the browser. How it
stays there is the whole difference between the two:

| | OpenAI | xAI |
|---|---|---|
| what the page gets | two ten-minute client secrets, one per lectern, from `/api/session` | nothing |
| where the call runs | browser to OpenAI, over WebRTC | browser to this server to xAI, over a WebSocket at `/realtime` |
| audio | a media track, never touching this server | PCM16 at 24 kHz, in the event stream, through this server |
| tools | connectors — none registered, see below | web search, X search and MCP, run at xAI's end |
| switching a tool off | applies to the next debate | applies to the debate that is up |

`ENGINE=openai` or `ENGINE=xai` says which one the page opens on. Left unset it
is whichever there is a key for, preferring OpenAI. A server told to use an
engine it has no key for opens on the other one rather than refusing to start.

`OPENAI_BASE_URL` and `XAI_REALTIME_URL` point either engine somewhere else — a
gateway, or a stub.

## Who is at each lectern

The personas are the same on both engines — they are the app, not the provider —
and live in [`src/server/personas.js`](../src/server/personas.js): one block of
shared rules, and one persona each. What changes with the engine is the voice
each is read in and the model behind it.

| | |
|---|---|
| `EGG_VOICE` | Marc's OpenAI voice. Default `ash`. |
| `POTATO_VOICE` | Tater's OpenAI voice. Default `cedar`. |
| `OPENAI_REALTIME_MODEL` | Which OpenAI model the picker opens on. Default `gpt-realtime-2.1`. |
| `EGG_XAI_VOICE` | Marc's xAI voice. Default `orion`. |
| `POTATO_XAI_VOICE` | Tater's xAI voice. Default `atlas`. |
| `XAI_MODEL` | The same, for xAI. Default `grok-voice-latest`. |

`ENGINE` decides which of the two the picker opens on; after that it is whichever
model you choose.

The OpenAI voices are `ash`, `alloy`, `ballad`, `cedar`, `coral`, `echo`,
`marin`, `sage`, `shimmer` and `verse`.

All twenty-six of xAI's are offered: `rex`, `sal`, `atlas`, `zagan`, `orion`,
`perseus`, `leo`, `helix`, `zenith`, `rigel`, `castor`, `ursa`, `naksh`,
`kepler`, `ara`, `eve`, `carina`, `luna`, `iris`, `celeste`, `lumen`, `lux`,
`cosmo`, `sirius`, `altair` and `helios`. The first fourteen are the heavy end,
which is what the defaults are drawn from — both characters are written as men —
but who is arguing tonight is yours to decide, and the picker holds the lot.

Give them different ones on either engine: two debaters in the same voice is
unlistenable, and the page will not stop you doing it from the pickers.

Both of them can be given a different voice or model from the bar at the bottom
between debates.

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

## Tools

What is in the `tools` panel depends on which engine is running, because the
tools do. A switch there applies to the debate rather than to one lectern —
neither side gets a tool the other does not, which would not be a debate — and
it can only ever take away. A tool the environment never enabled has no switch,
and nothing the page sends can put one back.

On **xAI** the panel holds the hosted tools. All of them run inside the model's
own turn, at xAI's end: nothing is executed on this machine, no key of ours is
involved, and a tool call never has to find its way back to this process. That
is what makes them worth having in a debate — either side can be asked for a
source, and neither side can touch anything.

| | |
|---|---|
| `XAI_WEB_SEARCH` | Web search. Default on. |
| `XAI_X_SEARCH` | X search. Default on. |
| `XAI_MCP_SERVERS` | Remote MCP servers, as a JSON array. |
| `XAI_MCP_FILE` | Read the same array from a file instead. Default `mcp.json`. |

An MCP entry needs `server_label` and `server_url`; anything else on it,
including `authorization`, is passed upstream untouched. Credentials belong
here rather than in the page — the proxy is the only thing that reads them, and
the page is told the label and nothing else.

```sh
XAI_MCP_SERVERS=[{"server_label":"almanac","server_url":"https://mcp.example.com/mcp","authorization":"Bearer ..."}]
```

Switching one off mid-debate takes it out of the call that is up: the page tells
the proxy, and the proxy re-declares the session's tools. No redial.

On **OpenAI** the panel is empty, because the connectors it would list are (see
below). A switch thrown there is for the next debate — that engine settles its
tool list when the client secret is minted.

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
docker run -p 5173:5173 -e XAI_API_KEY=xai-... debater      # or the other engine
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
| `ENGINE` | `openai` or `xai`. Which one the page opens on. |
