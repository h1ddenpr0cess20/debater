# Design

## Two calls, no microphone between them

Each debater is an ordinary realtime call. The only unusual thing is what goes
down the wire as their microphone.

The audio bus ([`src/client/audio/bus.js`](../src/client/audio/bus.js)) gives
each of them an `ear`: a gain node with nothing connected to it, which therefore
exists at handshake time and carries silence. What eventually feeds it is the
*other* debater's voice, arriving over their own call, through a gate:

```
egg's voice ─────▶ gate(egg→potato) ──▶ potato's ear ──▶ what potato hears
potato's voice ──▶ gate(potato→egg) ──▶ egg's ear ─────▶ what egg hears
moderator's mic ─▶ gate(mod→egg), gate(mod→potato)
```

Every hop is a gate. Handing the floor over is one gate opening and one
shutting; one debater talking over the other is both open at once; pausing is
all of them shut.

## The two engines

The ear is where the engines part company, and it is the only place they do.

**OpenAI** runs browser-to-OpenAI over WebRTC. The ear feeds a
`MediaStreamDestination` whose track is what the peer connection is handed at
the handshake. Their voice comes back on a media track, and is played through an
`<audio>` element rather than through the graph — Chrome will not pull samples
out of a remote stream that has no sink attached, and the bus needs those
samples, since the relay is made of them.

**xAI** runs browser to this server to xAI, over a WebSocket at `/realtime`, one
per lectern. There is no client secret to mint — an xAI realtime session wants
the API key on it — so the proxy holds the key and sits in the middle of both
calls, which also makes it the thing that decides what a lectern's persona and
tools are. Audio is PCM16 at 24 kHz in the event stream both ways: an audio
worklet reads the ear and resamples it into frames going up, and what comes back
is scheduled into a gain node that is both what the room hears and what the bus
relays. No media track, no `<audio>` element, same gates.

`live(id, false)` — what a pause does — deadens the ear and disables the track,
because between them that is "this lectern hears nothing and sends nothing" on
either engine.

Above the ear nothing knows which is running.
[`session/agent.js`](../src/client/session/agent.js) and
[`session/xai.js`](../src/client/session/xai.js) present the same surface to the
director and emit the same events in the same order, and
[`session/events.js`](../src/client/session/events.js) is one handler for both —
the audio hooks it takes are simply not given on the engine whose audio it never
touches.

## Nobody answers on their own

Every answer in the room is one the director asked for. Turn detection still
runs — it commits the input buffer, and it still interrupts — but on its own it
never puts a voice in the room.

The OpenAI session is minted with `turn_detection.create_response: false`, and
that is the whole of it there. xAI's realtime API has no such flag: the port
invented one, sent it, and got a debate that did nothing at all — so the session
is now sent exactly what the single-agent app it came from sends, and the floor
is held in [`proxy.js`](../src/server/xai/proxy.js) instead, against what
actually comes back rather than against a payload's promise. It counts the
`response.create` frames the page sends against the `response.created` events
coming back, and cancels one nobody asked for, naming it to the page ahead of
the cancel so the audio already in the air is dropped rather than played. The
failure it stands in for is silent and expensive: both models answering every
sentence the other says, and answering the moderator in chorus, with the page —
which cannot tell a response it asked for from one it did not — carrying on as
though it were driving.

That one rule is what the rest hangs off:

- **Two models cannot answer at once.** Which matters most for the moderator,
  who is heard by both of them: without it, a question to the room gets answered
  in chorus.
- **A turn ends when the sound stops**, not when the model finishes generating.
  Generation finishes seconds before the audio has played out, and a relay cut
  at `response.done` would chop the last sentence off before the other one ever
  heard it. So the director watches the analyser: quiet for 900ms is the end of
  a turn, and then the other one is asked.

  Which makes "still saying it" a state of its own, and on the xAI engine a long
  one: the page is holding that audio, so the lectern is not busy, not finished,
  and not askable. Everything that asks for an answer waits it out — and what
  ends the wait is [`session/pcm.js`](../src/client/session/pcm.js) saying its
  queue has run dry, because nothing in the event stream marks that moment.
  Without it the state stuck at "speaking" for good, and the moderator was the
  one who found out: a typed question goes to whoever is up next, which is
  whoever just answered, which is the lectern that is still saying it.

- **A typed question waits for it.** Typing is silent, so there is nothing for
  the room to have heard and nothing to talk over: the line reaches both
  lecterns as it is sent, whoever is mid-answer is heard out, and the question
  is put when that turn ends — where it decides the floor instead of the order.
  A microphone is the opposite and always was. A person talking is an
  interruption, their sessions treat it as one, and the answer is cut off where
  it stands.
- **A cut-in can be aimed.** The director opens the gate the wrong way,
  asks the listener for one sharp line with a per-response `instructions`, and
  lets the speaker's own turn detection — which *is* allowed to interrupt — cut
  them off when the objection lands. It sounds like being talked over because it
  is being talked over.

The cost of driving it this way is that the debate only continues if something
asks it to. Two things guard that.

The first is a retry: a `response.create` that never becomes audio would end the
debate silently, so the director waits six seconds and, if nothing has started,
hands the other one's last words over as text.

The second is a watchdog, because the retry only covers a turn that was asked
for. Every hand-over ends in `ask`, and `ask` can decline — they are answering
already, they are still saying the last one, or they still owe an answer that
was refused upstream and will never arrive to clear the flag saying so. The
first two shelve the ask and `release` puts it back out when that lectern
reports it has stopped; the rest leave nothing armed, and the room goes quiet
for good. So `stalled()` asks the stronger question: not "is it
quiet" — quiet is most of a hand-over — but "is there anything to be quiet for".
No timer armed, neither lectern generating or playing audio out, no microphone
mid-question. Nine seconds of that and the director clears what it thought it
was owed, asks whoever is up next, and says so in the notice line.

It is deliberately incurious about *why*. Anything that can silence a running
debate that long with nothing pending is a bug, known or not, and the recovery
is the same one either way. Its precondition is that the timers tell the truth,
which is why they go through `arm`/`disarm` — a handle left behind after its
timer fired reads as a plan that does not exist.

## Who is where

```
main.js ──▶ stage/       the hall: two spots, two lecterns, two rigs
        ──▶ audio/bus    the gates
        ──▶ session/     one realtime call per lectern, on either engine
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

A static host, and a front end for whichever engine is running. It lists what
can be dialled — the realtime models for OpenAI, a constant for xAI — and serves
the build.

For OpenAI it mints one ten-minute client secret per lectern with that lectern's
persona baked into it, and sees no audio at all. For xAI it is in the middle of
both calls: [`src/server/xai/proxy.js`](../src/server/xai/proxy.js) holds the
key, builds each session from the lectern named in the query string, forwards
audio in both directions, and answers for the floor. What the page may send
upstream is an allowlist — a `session.update` of its own is dropped, and
per-response `instructions` are stripped, because either would let a page
replace the persona.

State-changing requests are checked against the page's own origin, and so is the
WebSocket upgrade: there is no auth here, the same-origin policy does not cover
WebSockets at all, and a page in another tab should not be able to run a debate
on your key.

The personas are two blocks of prose and one block of shared rules in
[`src/server/personas.js`](../src/server/personas.js). The rules are what keep
it a debate: one point a turn, answer what was actually said, the moderator is a
real person, no naming real people, and stop when you are told to.
