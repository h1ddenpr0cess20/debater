export function amplitude(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buffer.length) * 7);
}

export function createAnalyser(audio, stream) {
  const node = audio.createAnalyser();
  node.fftSize = 1024;
  node.smoothingTimeConstant = 0.4;
  node.source = audio.createMediaStreamSource(stream);
  node.source.connect(node);
  node.buffer = new Float32Array(node.fftSize);
  return node;
}

const ATTACK = 0.45;
const RELEASE = 0.12;

export function createMeter(pick, onLevel) {
  let frame = 0;
  let level = 0;

  function tick() {
    frame = requestAnimationFrame(tick);
    const source = pick();
    const target = source ? amplitude(source, source.buffer) : 0;
    level += (target - level) * (target > level ? ATTACK : RELEASE);
    onLevel(level);
  }

  return {
    start() {
      if (!frame) frame = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      level = 0;
      onLevel(0);
    },
  };
}
