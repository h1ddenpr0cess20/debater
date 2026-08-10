# Design

## Two calls, no microphone between them

Each debater is an ordinary OpenAI Realtime call, run browser-to-OpenAI over
WebRTC. The only unusual thing is what goes down the wire as their microphone.

The audio bus ([`src/client/audio/bus.js`](../src/client/audio/bus.js)) gives
each of them a `MediaStreamDestination` node with nothing connected to it. Its
track exists at handshake time and carries silence, which is what the peer
connection is handed. What eventually feeds it is the *other* debater's voice,
arriving over their own call, through a gain node:

```
egg's remote audio ──▶ gate(egg→potato) ──▶ potato's feed ──▶ potato's peer connection
potato's remote audio ─▶ gate(potato→egg) ─▶ egg's feed ────▶ egg's peer connection
moderator's mic ──────▶ gate(mod→egg), gate(mod→potato)
```

Every hop is a gate. Handing the floor over is one gate opening and one
shutting; one debater talking over the other is both open at once; pausing is
all of them shut.

Playback is through an `<audio>` element rather than through the graph, because
Chrome will not pull samples out of a remote stream that has no sink attached —
and the bus needs those samples, since the relay is made of them.

## Nobody answers on their own

Both sessions are minted with `turn_detection.create_response: false`. Turn
detection still runs — it commits the input buffer, and it still interrupts —
but no response is ever created by it. Every answer in the room is one the
director asked for.

That one setting is what the rest hangs off:

- **Two models cannot answer at once.** Which matters most for the moderator,
  who is heard by both of them: without it, a question to the room gets answered
  in chorus.
- **A turn ends when the sound stops**, not when the model finishes generating.
  Generation finishes seconds before the audio has played out, and a relay cut
  at `response.done` would chop the last sentence off before the other one ever
  heard it. So the director watches the analyser: quiet for 900ms is the end of
  a turn, and then the other one is asked.
- **A cut-in can be aimed.** The director opens the gate the wrong way,
  asks the listener for one sharp line with a per-response `instructions`, and
  lets the speaker's own turn detection — which *is* allowed to interrupt — cut
  them off when the objection lands. It sounds like being talked over because it
  is being talked over.

The cost of driving it this way is a retry: a `response.create` that never
becomes audio would end the debate silently. So the director waits six seconds
and, if nothing has started, hands the other one's last words over as text.

## Who is where

```
main.js ──▶ stage/       the hall: two spots, two lecterns, two rigs
        ──▶ audio/bus    the gates
        ──▶ session/     one Realtime call per lectern
        ──▶ debate/      the director, the moderator, the transcript
        ──▶ ui/          the bar, the captions, the panels
```

The director ([`src/client/debate/director.js`](../src/client/debate/director.js))
is the only thing that knows whose turn it is, and the only thing that can spend
money. Everything else reports to it or draws what it says.

## The stage

The two rigs are the egg from `marc` and the potato from `tater`, unchanged
except for what the room needs: they no longer build their own lighting or place
themselves, and each reports how far it wanders while it talks.

Both are scaled to the same height. An egg is naturally about twice a potato,
which is fine when each has an app to itself.

The debater is the origin of their spot, not the lectern: turning the two spots
inward has to swing the lecterns across the front of them rather than swinging
the debaters out into the wings. The lectern is then pushed forward by however
much clearance the rig turns out to need — half its longest axis, because
thinking lays both of them down and spins them about the vertical, plus its
wander, plus a margin. Nothing may pass through the furniture, and
[`test/client/stage.test.js`](../test/client/stage.test.js) is what says so.

There is no shadow map. A lumpy body throws one that crawls as it turns, so the
renderer draws none and each rig moves a soft blot on the floor beneath itself.

## The server

It is a proxy and a static host, and it never sees any audio. It lists the
realtime models, mints one ten-minute client secret per lectern with that
lectern's persona baked into it, and serves the build. State-changing requests
are checked against the page's own origin, because there is no auth and a page
in another tab should not be able to mint calls against your key.

The personas are two blocks of prose and one block of shared rules in
[`src/server/personas.js`](../src/server/personas.js). The rules are what keep
it a debate: one point a turn, answer what was actually said, the moderator is a
real person, no naming real people, and stop when you are told to.
