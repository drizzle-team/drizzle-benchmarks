// Shared state between the library entry (run) and worker.ts inside a worker thread.
//
// Workers re-import the user's bench file. When that file calls run(config), run()
// sees `runtime.ctx` and hands the config (with its closures) to the worker instead
// of starting a new test.
import type { BenchConfig } from './types';

export interface WorkerCtx {
  runIndex: number;
  capture(config: BenchConfig): void;
}

export const runtime: { ctx: WorkerCtx | null; calls: number; active: boolean } = {
  ctx: null,
  calls: 0,
  active: false,
};
