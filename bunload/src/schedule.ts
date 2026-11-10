export interface Stage {
  /** '5s', '1m30s', '250ms' or milliseconds */
  duration: string | number;
  target: number;
}

export interface ResolvedStage {
  startMs: number;
  endMs: number;
  from: number;
  to: number;
}

export function parseDuration(d: string | number): number {
  if (typeof d === 'number') return d;
  let total = 0;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let m: RegExpExecArray | null;
  let matched = '';
  while ((m = re.exec(d))) {
    const v = Number(m[1]);
    total += m[2] === 'ms' ? v : m[2] === 's' ? v * 1e3 : m[2] === 'm' ? v * 60e3 : v * 3600e3;
    matched += m[0];
  }
  if (matched !== d) throw new Error(`bad duration: ${d}`);
  return total;
}

/** "5s:200,15s:200,5s:400" */
export function parseStagesArg(s: string): Stage[] {
  return s.split(',').map((part) => {
    const [duration, target] = part.split(':');
    if (!duration || target === undefined) throw new Error(`bad stage: ${part}`);
    return { duration, target: Number(target) };
  });
}

export function resolveStages(stages: Stage[], startVUs = 0): ResolvedStage[] {
  const out: ResolvedStage[] = [];
  let t = 0;
  let prev = startVUs;
  for (const s of stages) {
    const d = parseDuration(s.duration);
    out.push({ startMs: t, endMs: t + d, from: prev, to: s.target });
    t += d;
    prev = s.target;
  }
  return out;
}

export function totalDuration(stages: ResolvedStage[]) {
  return stages.length ? stages[stages.length - 1]!.endMs : 0;
}

/** Linear interpolation like k6 ramping-vus. Returns -1 after the last stage. */
export function targetAt(stages: ResolvedStage[], elapsedMs: number): number {
  for (const s of stages) {
    if (elapsedMs < s.endMs) {
      const span = s.endMs - s.startMs;
      const p = span > 0 ? (elapsedMs - s.startMs) / span : 1;
      return Math.round(s.from + (s.to - s.from) * p);
    }
  }
  return -1;
}

/** Split a global VU target across workers deterministically. */
export function shareOf(total: number, workers: number, index: number) {
  return Math.floor(total / workers) + (index < total % workers ? 1 : 0);
}

/**
 * Step ladder (the classic k6 profile): ramp to `from`, hold, ramp +`step`, hold, … up to `to`.
 * steps({ from: 200, to: 3000, step: 200, ramp: '5s', hold: '15s', lastHold: '55s' })
 */
export function steps(o: {
  from?: number;
  to: number;
  step: number;
  ramp: string | number;
  hold: string | number;
  lastHold?: string | number;
}): Stage[] {
  const out: Stage[] = [];
  for (let vus = o.from ?? o.step; vus <= o.to; vus += o.step) {
    out.push({ duration: o.ramp, target: vus }, { duration: vus + o.step > o.to ? (o.lastHold ?? o.hold) : o.hold, target: vus });
  }
  return out;
}
