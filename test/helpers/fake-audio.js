/** A gain node's parameter, with the ramps recorded as plain settled values. */
class FakeParam {
  constructor() {
    this.value = 0;
  }

  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
}

class FakeGain {
  constructor() {
    this.gain = new FakeParam();
    this.outputs = [];
  }

  connect(node) { this.outputs.push(node); }
  disconnect() { this.outputs.length = 0; }
}

class FakeSource {
  constructor(stream) {
    this.stream = stream;
    this.outputs = [];
  }

  connect(node) { this.outputs.push(node); }
  disconnect() { this.outputs.length = 0; }
}

/** Enough of an AudioContext for the bus: gates, feeds, sources and analysers. */
export class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.gains = [];
    this.sources = [];
    this.destinations = [];
    this.closed = false;
  }

  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createMediaStreamSource(stream) {
    const node = new FakeSource(stream);
    this.sources.push(node);
    return node;
  }

  createMediaStreamDestination() {
    const track = { id: `track-${this.destinations.length}`, enabled: true, stop() {} };
    const node = { stream: { getAudioTracks: () => [track] }, track };
    this.destinations.push(node);
    return node;
  }

  createAnalyser() {
    return {
      level: 0,
      fftSize: 2048,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData(buffer) { buffer.fill(this.level); },
    };
  }

  async resume() { this.state = 'running'; }
  async close() { this.closed = true; }
}

/** A stream with one track, which is all any of this looks at. */
export function fakeStream(name = 'stream') {
  const track = { id: name, enabled: true, stopped: false, stop() { this.stopped = true; } };
  return {
    track,
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
}
