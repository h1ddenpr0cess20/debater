export function spring(s, k, c, dt, to = 0) {
  s.v += (to - s.p) * k * dt - s.v * c * dt;
  s.p += s.v * dt;
  return s.p;
}

export function approach(value, target, rate, dt) {
  return value + (target - value) * Math.min(1, dt * rate);
}
