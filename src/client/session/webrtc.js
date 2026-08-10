const REALTIME_URL = 'https://api.openai.com/v1/realtime/calls';

const CHANNEL_TIMEOUT = 15_000;

function channelOpen(pc, channel) {
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = (err) => (err ? reject(err) : resolve());
  });

  const timer = setTimeout(
    () => done(new Error('the events channel never opened')),
    CHANNEL_TIMEOUT,
  );
  const done = (err) => {
    clearTimeout(timer);
    settle(err);
  };

  if (channel.readyState === 'open') done();

  channel.addEventListener('open', () => done());
  channel.addEventListener('error', () => done(new Error('the events channel failed')));
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      done(new Error('the call dropped before it was ready'));
    }
  });

  return { promise, cancel: () => done() };
}

export async function connect({ secret, micStream, onEvent, onTrack, onClose }) {
  const pc = new RTCPeerConnection();
  let ready;

  try {
    pc.ontrack = (e) => onTrack(e.streams[0]);
    pc.addTrack(micStream.getAudioTracks()[0], micStream);

    const channel = pc.createDataChannel('oai-events');
    channel.addEventListener('message', (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
      }
    });

    ready = channelOpen(pc, channel);

    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        onClose(pc.connectionState === 'failed' ? 'the call dropped' : null);
      }
    });

    await pc.setLocalDescription(await pc.createOffer());
    const answer = await fetch(REALTIME_URL, {
      method: 'POST',
      body: pc.localDescription.sdp,
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/sdp' },
    });
    if (!answer.ok) throw new Error(`realtime handshake failed (${answer.status})`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });

    await ready.promise;

    return {
      pc,
      get open() { return channel.readyState === 'open'; },
      send(message) {
        if (channel.readyState !== 'open') return false;
        channel.send(JSON.stringify(message));
        return true;
      },
      close() {
        channel.close();
        pc.close();
      },
    };
  } catch (err) {
    ready?.cancel();
    pc.close();
    throw err;
  }
}
