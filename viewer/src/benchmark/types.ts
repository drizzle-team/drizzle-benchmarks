export interface IData {
  time: number;
  /** local: VUs at that second (from bunload's prepare()) */
  vus: number;
  latency: {
    avg: number;
    p90: number;
    p95: number;
  };
  cpus: {
    cpu1: number;
    cpu2: number;
    cpu3: number;
    cpu4: number;
    cpus: number;
  };
  reqs: number;
  failReqs: number;
  totalFailReqs: number;
  totalReqs: number;
  avg: {
    p95: number;
    cpus: number;
    latency: number;
    reqs: number;
  };
  max: {
    reqs: number;
    latency: number;
  };
}

export interface IJSONData {
  time: string;
  core1: number;
  core2: number;
  core3: number;
  core4: number;
  reqs_per_sec: number;
  fail_reqs_per_sec: number;
  latency_95: number;
  latency_90: number;
  latency_99: number;
  latency_average: number;
}

/** core1..core4 are absent when the run had no /stats endpoint */
export type IRunRow = Omit<IJSONData, "core1" | "core2" | "core3" | "core4"> &
  Partial<Pick<IJSONData, "core1" | "core2" | "core3" | "core4">> & { vus?: number };

/** prepare() output: run name -> per-second rows */
export type IRuns = Record<string, IRunRow[]>;

/** which two runs are compared (left = top charts, right = bottom charts) */
export interface ISelection {
  left: string;
  right: string;
}
