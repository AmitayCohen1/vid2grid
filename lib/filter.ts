/* One-Euro filter (Casiez et al. 2012): low lag when moving, low jitter when still. */

export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  constructor(
    private minCutoff = 1.0,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, dt: number): number {
    if (this.xPrev === null || !(dt > 0)) {
      this.xPrev = x;
      return x;
    }
    const dx = (x - this.xPrev) / dt;
    const ad = this.alpha(this.dCutoff, dt);
    this.dxPrev = ad * dx + (1 - ad) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = this.alpha(cutoff, dt);
    const out = a * x + (1 - a) * this.xPrev;
    this.xPrev = out;
    return out;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

/** Filter a 3-vector with three independent One-Euro filters. */
export class OneEuro3 {
  private f: [OneEuro, OneEuro, OneEuro];
  constructor(minCutoff = 1.0, beta = 0.02) {
    this.f = [new OneEuro(minCutoff, beta), new OneEuro(minCutoff, beta), new OneEuro(minCutoff, beta)];
  }
  filter(v: { x: number; y: number; z: number }, dt: number) {
    return { x: this.f[0].filter(v.x, dt), y: this.f[1].filter(v.y, dt), z: this.f[2].filter(v.z, dt) };
  }
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
