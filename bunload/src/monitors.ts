import type { Monitor } from './types';

/** GET <url> (default `${host}/stats`) returning per-core CPU % as number[] → { cpu: [...] }. */
export function serverStats(url?: string, every: Monitor['every'] = '200ms'): Monitor {
  return {
    every,
    async sample({ host, signal }) {
      const res = await fetch(url ?? `${host}/stats`, { signal });
      const cores = (await res.json()) as unknown;
      if (!Array.isArray(cores) || !cores.every((c) => typeof c === 'number')) return {};
      return { cpu: cores as number[] };
    },
  };
}
