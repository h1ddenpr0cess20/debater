# Debater

Two realtime voice agents at two lecterns, arguing with each other. Marc is an
egg and takes the Republican side; Tater is a potato and takes the Democratic
one. Neither is talking to you: each one's voice is wired into the other one's
call as its microphone, so as far as the provider is concerned both are having
an ordinary conversation with a person, and the person is the opposite lectern.

You are the moderator. There is a microphone and a text field, both of which
reach both of them, and a stop button that hangs the whole thing up.

## Run

```sh
git clone https://github.com/h1ddenpr0cess20/debater
cd debater
npm install
cp .env.example .env      # add your OPENAI_API_KEY, or your XAI_API_KEY
npm run dev               # → http://localhost:5173
```

Type a motion — or hit `pick one` — and press `debate`. Both calls come up, the
moderator's opening goes to both of them, and one is asked to start.

## Two engines

The lecterns run on OpenAI Realtime or on xAI's Grok voice API. Set one key, or
set both and pick from the bar at the bottom — the picker only shows up when
there is a choice, and it is locked while a debate is up.

The personas, the floor, the caps and the log are the same either way. What
differs is how a call is made, and it is the reason the xAI side is worth having:

| | OpenAI | xAI |
|---|---|---|
| the call | browser to OpenAI over WebRTC, the key never leaving this server | proxied through this server over a WebSocket, for the same reason |
| audio | a media track the browser moves | PCM16 in the event stream, played and captured by the page |
| tools | the connectors, of which there are none yet | web search, X search and MCP, run at xAI's end |

That last row is the point. `tools` fills up on the xAI engine, and a debate
where either side can be asked to produce a source is a better debate. Switching
one off there takes it out of the debate that is running, mid-sentence, without
a redial — the proxy re-declares the session's tools. On OpenAI the same switch
is for the next debate.

## The floor

Only one of them is ever asked to answer. Their sessions are minted with turn
detection that never creates a response of its own, so every reply in the room
is one the page asked for. That is what stops two models answering the same
sentence at once, and it is what makes the rest of this possible:

- **Handing over.** When one stops making noise — not when the model finishes
  generating, which is several seconds earlier — the other is asked to answer.
  The audio gate follows the floor: one open, one shut.
- **Cutting in.** Occasionally the listener is handed the floor mid-sentence and
  asked for one sharp line. The speaker's own turn detection is what cuts them
  off, so it sounds like being talked over rather than like a hard edit. It
  needs the speaker to have been going a while, it gets likelier when what they
  are saying reads as heated, and `cut-ins` switches it off.
- **The moderator.** The microphone is open into both lecterns at once, so a
  question is heard by the room; when you stop talking, one of them is asked to
  take it — whoever you named, or whoever is up next. Typing does the same
  thing. Interrupting them works: you are talking over a session that is allowed
  to be interrupted.
- **Getting unstuck.** Every one of those hand-overs can be declined — they are
  answering already, or they owe an answer that never arrived — and a decline
  used to be the end of the debate, in silence. So the director watches for a
  room that is doing nothing and has nothing armed to change that, and after
  nine seconds of it asks whoever is up next and says so in the notice line.

## Money

Two live realtime calls bill for as long as they are open, and two models given
each other's audio will keep going until something stops them. So something
always does:

| | |
|---|---|
| `stop` | Hangs both calls up. Nothing is billing afterwards. `esc` does it too, once the panels are closed. |
| `pause` | Shuts every gate, cancels whatever is mid-answer and deadens both outbound tracks. The calls stay open — cheap, not free — and a pause left sitting hangs up on its own after 90 seconds. `space` does it too. |
| turn cap | The debate ends after this many turns. Twelve by default. |
| time cap | And after this many minutes. Eight by default. |
| hidden tab | Switching away pauses it, which starts that 90-second clock. |

The meters along the top are the turn count, the wall clock, and the tokens both
sessions have reported so far.

## What is where

`tools` is the per-debate switch panel, and what is in it is whatever the engine
running has. On xAI that is web search, X search and any MCP server the
environment names; on OpenAI it is empty, because the connectors are. A switch
there applies to both lecterns — neither side gets a tool the other does not —
and it can only take away.

`connectors` is where a tool this server runs would be switched on, and it is
empty: the route, the settings file and the tool declaration are all wired and
tested, and nothing is registered. See
[`src/server/connectors/catalog.js`](src/server/connectors/catalog.js).

`log` keeps every debate, turn by turn and speaker by speaker. `continue` on one
redials both lecterns with those turns handed over as context, and what is said
from there lands back in that same entry.

| Script | |
|---|---|
| `npm run dev` | Vite, with the proxy mounted as middleware — one process |
| `npm run dev:lan` | The same, over HTTPS on the network — for a phone |
| `npm run build` | Bundles the client to `dist/` |
| `npm start` | Serves `dist/` with the same proxy in front |
| `npm run preview` | `build` then `start` |
| `npm run preview:lan` | `build` then `start`, over HTTPS on the network |
| `npm test` | `node:test` over the server and the client |
| `npm run lint` | ESLint |

The microphone needs a secure page, so a phone needs `npm run dev:lan` — see
[configuration](docs/configuration.md#on-a-phone).

## Docs

- [configuration](docs/configuration.md) — the environment, the caps, a phone, Docker
- [design](docs/design.md) — how the audio is wired and why the floor works the way it does
- [about the debate](docs/about-the-debate.md) — what these two are and are not

The egg and the potato come from [marc](https://github.com/h1ddenpr0cess20/marc)
and [tater](https://github.com/h1ddenpr0cess20/tater), where each had an app to
itself.
