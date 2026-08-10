/** `stand` is the stance: 1 upright on his end, 0 lying down on his side. */
export const MOODS = {
  idle:      { jitter: 0.06, lean:  0.00, rock: 0.05, rockSpeed: 1.0, step: 0.00, spin: 0,  squash: 0.00, stand: 1, fidget: 0.35 },
  listening: { jitter: 0.03, lean: -0.60, rock: 0.10, rockSpeed: 1.5, step: 0.00, spin: 0,  squash: 0.12, stand: 1, fidget: 0.20 },
  thinking:  { jitter: 0.05, lean:  0.10, rock: 0.02, rockSpeed: 1.2, step: 0.00, spin: 11, squash: 0.00, stand: 0, fidget: 0.00 },
  speaking:  { jitter: 0.16, lean:  0.20, rock: 0.05, rockSpeed: 1.6, step: 0.32, spin: 0,  squash: 0.50, stand: 1, fidget: 0.10 },
};

export const ENERGY_GAIN = { squash: 2.2, jitter: 0.9, rock: 0.04 };
