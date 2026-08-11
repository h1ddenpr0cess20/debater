const TARGET_RATE = 24000;

const FRAME = TARGET_RATE / 50;

class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.carry = new Float32Array(0);
    this.pos = 0;
    this.out = new Int16Array(FRAME);
    this.n = 0;
    this.running = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;

    const input = inputs[0]?.[0];
    if (!input || !input.length) return true;

    let buf = input;
    if (this.carry.length) {
      buf = new Float32Array(this.carry.length + input.length);
      buf.set(this.carry, 0);
      buf.set(input, this.carry.length);
    }

    while (this.pos + 1 < buf.length) {
      const i = this.pos | 0;
      const frac = this.pos - i;
      const s = buf[i] + (buf[i + 1] - buf[i]) * frac;
      const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
      this.out[this.n++] = clamped * 32767;

      if (this.n === FRAME) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(FRAME);
        this.n = 0;
      }
      this.pos += this.ratio;
    }

    const consumed = this.pos | 0;
    this.carry = buf.slice(consumed);
    this.pos -= consumed;
    return true;
  }
}

registerProcessor('pcm-capture', PCMCapture);
