export function movingAverage(values: number[], window: number): number[] {
  const half = Math.max(1, Math.floor(window / 2));
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j];
      if (j >= 0 && j < values.length && Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    return n ? sum / n : Number.NaN;
  });
}

export function derivative(y: number[], t: number[]): number[] {
  const n = y.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n < 2) return out;
  out[0] = (y[1] - y[0]) / Math.max(1e-4, t[1] - t[0]);
  out[n - 1] = (y[n - 1] - y[n - 2]) / Math.max(1e-4, t[n - 1] - t[n - 2]);
  for (let i = 1; i < n - 1; i++) {
    out[i] = (y[i + 1] - y[i - 1]) / Math.max(1e-4, t[i + 1] - t[i - 1]);
  }
  return out;
}

export function median(values: number[]): number {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return Number.NaN;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function argMin(values: number[], from: number, to: number): number {
  let best = from;
  let bestV = Infinity;
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v < bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

export function argMax(values: number[], from: number, to: number): number {
  let best = from;
  let bestV = -Infinity;
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}
