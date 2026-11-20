# Drizzle Benchmarks
Drizzle has always been fast, we just wanted you to have a meaningful [benchmarks experience](https://orm.drizzle.team/benchmarks)

We run our benchmarks on 2 separate machines, so that the observer does not influence results. For the database we're using a PostgreSQL instance with 42MB of E-commerce data (~370k records).
The load generator runs on a Beelink mini PC and sends a production-like E-commerce request mix over a direct 1 Gb Ethernet link to a Lenovo M720q with an Intel Core i3-9100T (4 cores) and 32GB of RAM, which runs both the server under test and Postgres.

![image](https://github.com/drizzle-team/drizzle-benchmarks/assets/4045375/103ae551-7708-4752-b3ed-5734adfe897f)

To run your own tests, follow the instructions below.

## Repository layout

| path | |
|---|---|
| `src/` | Drizzle servers under test (Node or Bun, Hono or Elysia), Kysely servers (`kysely-*`), Drizzle on Effect 4 (`effect-*`), database seed, docker setup |
| `prisma7/` | Prisma 7 servers, `schema.prisma` (the Prisma model for both versions) and `prisma.config.ts` |
| `prisma8/` | Prisma 8 servers; a separate package with its own `node_modules`, since two Prisma versions can't share one install |
| `go/` | Go reference server (port 3002) |
| `bench/` | the benchmark: load profile (`index.ts`), request mix (`requests.ts`) |
| `bunload/` | the load generator library used by `bench/` ([docs](./bunload/README.md)) |
| `viewer/` | local copy of the orm.drizzle.team benchmark charts, to plot your own runs |
| `scripts/` | run the whole matrix on the two machines (`configs.ts` lists every config), summarise results (`peaks.ts`, `cpu-split.ts`), export the website's `data.json` (`site-data.ts`) |

## Prepare the server machine
1. Spin up a docker container with PostgreSQL 18.6 using the `pnpm start:docker` command (`PG_IMAGE=postgres:15.4 pnpm start:docker` for another version; 15.4 and 18.6 measured the same here). You can configure the database port in `./src/docker.ts`:
```ts
...
}

const desiredPostgresPort = 5435; // change here
main();
```
   On Linux the container uses the host's network (`--network host`), and Postgres listens on that port itself. With a published port instead (`-p`, Docker's default), every byte between the server and the database goes through Docker's userland `docker-proxy`. On our 4-core server that took about 0.6 of a core, roughly 15% of the machine, under every server alike. `PG_NETWORK=bridge pnpm start:docker` brings back the published port. Docker Desktop on macOS/Windows always uses one.
2. Update `DATABASE_URL` with the allocated database port in the `.env` file:
```env
DATABASE_URL="postgres://postgres:postgres@localhost:5435/postgres"
```
3. Seed the database with test data using `pnpm start:seed`. It runs the migrations in `drizzle/` and bulk-inserts ~370k rows with `db.bulkInsert()` in a few seconds. You can change the size of the database in `./src/seed.ts`:
```ts
...
}

main("micro"); // nano | micro
```
4. Install Node 22.18+ or 24 (we use Node 24, e.g. [`nvm use 24`](https://github.com/nvm-sh/nvm)), or Bun for the Bun servers. The TypeScript runs as-is on Node's built-in type stripping, so there's no `tsx` or build step.
   The published runs used these runtimes, at the paths `scripts/configs.ts` starts them from:

| config runtime | version | path on the server machine |
|---|---|---|
| `bun14` | Bun 1.4.4 | `~/.bun/bin/bun` (the default install) |
| `bun13` | Bun 1.3.13 | `~/.bun-1.3.13/bun` |
| `node24` | Node 24.22.2 | `~/.nvm/versions/node/v24.22.2/bin/node` (`nvm install 24.22.2`) |
| `node26` | Node 26.13.0 | `~/.nvm/versions/node/v26.13.0/bin/node` (`nvm install 26.13.0`) |
| `go` | Go 1.27.4 (`go.mod`) | `/tmp/bench-go-server`, built with `cd go && go build -o /tmp/bench-go-server .` |

   Install somewhere else and edit `runtimes` in `scripts/configs.ts` to match.
5. Start the server you want to test. Every server exposes `/stats` (per-core CPU usage), which the benchmark samples, and `/stats/procs` (raw per-process CPU counters of the machine, for `--procs`, below), and takes `WORKERS=n` for the number of processes: Drizzle and Prisma 8 default to one per CPU core, Prisma 7 to 2. The Drizzle servers can run on any of three Postgres drivers, with the same pool size per process (`POOL_MAX`, default 10):

| `DRIVER` | driver | |
|---|---|---|
| `pg` | node-postgres | default on Node |
| `drizzle` | `drizzle-orm/postgres`, Drizzle's own driver | pipelines independent queries over the pool's connections; `PIPELINE=off` checks a connection out per query instead, `PIPELINE=<n>` fixes the depth |
| `bun` | `Bun.SQL` | default on Bun; Bun only |

```bash
DRIVER=drizzle bun src/drizzle-server-bun.ts   # Bun + Drizzle's driver
DRIVER=bun bun src/drizzle-server-bun.ts       # Bun + Bun.SQL
```

```bash
## Drizzle (port 3000)
pnpm start:drizzle              # Node + Hono
bun src/drizzle-server-bun.ts   # Bun + Hono

## Prisma 7 (port 3001)
pnpm prepare:prisma             # generate the client into prisma7/generated
pnpm start:prisma               # Node + Hono
bun prisma7/server-bun.ts       # Bun + Hono

## Prisma 8 (port 3003)
cd prisma8 && bun install && bun run generate && cd ..   # emit the contract from prisma7/schema.prisma
node prisma8/server-node.ts     # Node + Hono
bun prisma8/server-bun.ts       # Bun + Hono
DRIVER=drizzle bun prisma8/server-bun.ts   # Prisma 8 on Drizzle's Postgres driver

## Go (port 3002)
cd go && go run .

## Kysely + Hono (port 3004)
DRIVER=drizzle bun src/kysely-server-bun.ts   # Bun; DRIVER=drizzle | pg | postgresjs
DRIVER=pg node src/kysely-server-node.ts      # Node

## Drizzle on Effect 4 + Hono (port 3005)
DRIVER=effect node src/effect-server-node.ts  # DRIVER=effect | drizzle
```

The Effect server is Drizzle ORM on Effect 4 (`effect` and `@effect/sql-pg` 4.1.4) with the same queries as the Drizzle servers, each prepared once with `.prepare('<name>')`; a handler runs its prepared query's Effect through a `ManagedRuntime` from Hono. `DRIVER` picks the connector and driver:

| `DRIVER` | connector | driver |
|---|---|---|
| `effect` (default) | `drizzle-orm/effect-postgres` | `@effect/sql-pg`, Effect's own driver, with `multiplex: true` (up to 32 statements pipelined per connection) |
| `drizzle` | `drizzle-orm/postgres/effect` | `DrizzlePostgresClient`, Drizzle's driver: statements outside a transaction share the pool's connections, pipelined (no option to turn it on) |

`MULTIPLEX=0` runs `effect` without multiplexing, `@effect/sql-pg`'s default (config `effect-node26-effect-nomultiplex`).

Both pass the `.prepare` name to the driver, so every query is a named server-side statement. Both connectors come from the same drizzle-orm as the other servers (`45b4a38`, the rc6 preview build). On `effect`, `totalPrice` (a `real`) shows the float32's exact digits (`31836.779296875` for `31836.78`), as on Bun.SQL.

The Kysely servers serve the same routes and response shapes as the Drizzle servers, one query per request with nested relations through `jsonObjectFrom` / `jsonArrayFrom`. Each query is compiled once at startup (`.compile()`) and run with `db.executeQuery()`. `DRIVER` picks what sits under Kysely's `PostgresDialect`:

| `DRIVER` | driver | prepared statements |
|---|---|---|
| `drizzle` (default) | `@drizzle-team/postgres/compat-kysely`, Drizzle's driver, pipelined | named per SQL text (`autoName`) |
| `pg` | node-postgres `pg.Pool` | none: every query unnamed |
| `postgresjs` | postgres.js through `kysely-postgres-js`'s `PostgresJSDialect` (a connection reserved per query) | named per SQL text (`prepare: true`) |

Prisma 7 runs on node-postgres (`@prisma/adapter-pg`) by default. `DRIVER=drizzle` swaps in `@drizzle-team/postgres/compat-prisma7`, a drop-in for it, and `STATEMENT_NAMES=1` gives every distinct SQL text a server-side statement name through either adapter's `statementNameGenerator` (`prisma7/adapter.ts`).

Processes and connection pools at the defaults:

| server | pool per process | processes | connections on a 4-core server |
|---|---|---|---|
| Drizzle | 10 (`POOL_MAX`) | one per CPU core | 40 |
| Prisma 7 | 10 (`POOL_MAX`) | 2 | 20 |
| Prisma 8 | 10 (`POOL_MAX`) | one per CPU core | 40 |
| Go | 10 per CPU core (`POOL_MAX` per core, one pgxpool) | 1 | 40 |

For a like-for-like run, start every server with the same `WORKERS` and `POOL_MAX`; `scripts/matrix.ts` runs them all at 2 processes × 8 connections (Go: one process, `POOL_MAX=4` per core = 16), the best shape measured on the 4-core Lenovo. Watch the total against Postgres's `max_connections` (100 by default): on a 10-core machine, one process per core × 10 connections already uses all 100.

Notes on the two Prisma versions:
- **Prepared statements:** Prisma 7 has no prepared-statements API, so it sends every query as an unnamed statement that Postgres re-parses each time. The Prisma 8 server prepares every query once at startup with `db.prepare()`, the same way the Drizzle servers use `.prepare()`.
- **Shared schema:** Prisma 8 reads `prisma7/schema.prisma` as its contract (`prisma7Schema(...)`), so both versions use one model. Their responses are identical except for Postgres `date` columns, which Prisma 7 returns as a full timestamp and Prisma 8 as `YYYY-MM-DD`.
- **Prisma 8 drivers:** `DRIVER=pg` (default) or `DRIVER=drizzle`. Prisma 8 only accepts a node-postgres `pg.Pool`, so `DRIVER=drizzle` binds `@drizzle-team/postgres/compat-prisma8`, Drizzle's driver in that shape. Responses and prepared statements are identical either way. Prisma 8's codecs decode only from text, so on either driver every value becomes a string first.
- **No `db sign`:** Prisma 8 never writes its contract marker into the shared database. Without it, the first query only logs a warning.

## Prepare the load machine
1. Install [Bun](https://bun.sh) 1.3 or later.
2. Install the load generator and viewer dependencies:
```bash
cd bunload && bun install && cd ..
cd viewer && bun install && cd ..
```
3. Check the load machine can reach the server: `curl http://192.168.31.144:3000/stats` should print a JSON array.
   On macOS 15+, the app you run the benchmark from (Terminal, VS Code, …) needs **System Settings → Privacy & Security → Local Network** access. Without it, connections to LAN addresses fail with "No route to host".

## Run benchmarks 🚀
```bash
bun bench/index.ts <host> <name>                     # full profile: 300 → 4800 VUs, +300 every 20s, 5m40s
bun bench/index.ts <host> <name> --quick             # 500 → 3000 VUs in 60s
bun bench/index.ts <host> <name> --requests 1000000  # same ramp, stop after 1M requests
bun bench/index.ts <host> <name> --no-warmup         # skip the 10s unrecorded warm-up

bun bench/index.ts http://192.168.31.144:3000 drizzle
bun bench/index.ts http://192.168.31.144:3001 prisma7
bun bench/index.ts http://192.168.31.144:3003 prisma8
bun bench/index.ts http://192.168.31.144:3002 go
```

Each run prints per-second progress and a summary, and writes `results/<name>.parquet`. That one file holds a row per request (timestamp, latency, TTFB, status, errors, VUs, retries, iteration) plus the server CPU sampled from `/stats` during the run.

What a run does:
- **Warm-up:** 10 s of the same request mix at up to 200 users, not recorded. A fresh server opens its Postgres connections, prepares its statements on each of them and JIT-compiles its hot paths in its first seconds of load, which would otherwise show as a latency spike at the start of every graph.
- **Requests:** a deterministic E-commerce mix generated at runtime (`bench/requests.ts`). Every run, against every server, sends the identical request sequence.
- **Load profile:** virtual users ramp up in steps like k6's `ramping-vus`. Each VU keeps one keep-alive connection and thinks 0–375 ms between requests.
- **Customising:** the load profile, request mix and sampled metrics (`monitor`) are plain TypeScript in `bench/index.ts`. See the [bunload docs](./bunload/README.md).

Use wired ethernet between the two machines. Over Wi-Fi, latency climbs and requests stall while the server sits idle, so the numbers measure the network instead of the server.

### Run the whole matrix from a third machine
`scripts/` drives both machines over SSH: the server machine runs Postgres and each server in turn, and the load machine benches it over Ethernet. Addresses default to our setup and can be overridden with `SERVER`, `BENCH`, `SERVER_DIR`, `BENCH_DIR` and `SERVER_ETH_IP` (see `scripts/remote.ts`).
```bash
bun scripts/lan.ts all                       # SSH keys, network/tool check, rsync this repo, install deps
bun scripts/lan.ts sync install              # after local changes

bun scripts/matrix.ts --smoke                # start every config, hit each route once
bun scripts/matrix.ts --requests full --suffix full          # every config, full profile → results/<config>-full.parquet
bun scripts/matrix.ts --requests 100000 'drizzle-bun14-*' go # selected configs (names or globs), 100k requests each
bun scripts/matrix.ts --ramp 8000 --suffix ramp --cpu                         # every config's peak, CPU per process
bun scripts/cpu-split.ts results/drizzle-bun14-drizzle-ramp.parquet           # where the CPU went, per VU step
bun scripts/peaks.ts results/*-full.parquet                                   # peak rps per run (best VU step), p95/p99 and CPU per request there
```
- `--ramp <maxVus>` finds where a server saturates. It goes from 0 to 3,000 VUs in 60 s (+250 every 5 s), then adds 200 VUs every 10 s up to `maxVus`. Each run ends once the server is saturated: two VU steps in a row gain less than 2% rps over the best step, or the last 5 s average more than `--stop-ms` latency (default 200), or more than 1% of them fail. So every config stops a couple of steps past its own peak.
- The matrix runs every Node/Bun server with `--workers 2 --pool 8` by default (2 processes × 8 connections); pass others to compare.
- `--cpu` passes `--procs` to `bench/index.ts`, which reads the server's `/stats/procs` once a second and stores how much CPU went to the server under test, to Postgres, to `docker-proxy` and to kernel interrupt handling as `proc.*` metric rows in the run's parquet (% of one core). `scripts/cpu-split.ts` turns those into a per-step table with CPU µs per request. Reading `/proc` costs the server about 1 ms a second.
To run this from outside the LAN, `bun scripts/tailscale.ts up` puts both machines on your tailnet without sudo; then use `SERVER=lenovo-ts BENCH=beelink-ts bun scripts/matrix.ts …`. The load still goes over the machines' direct Ethernet link.

Configs are named `<orm>-<runtime>[-<driver>]`, with runtimes `bun13`, `bun14`, `node24` and `node26`, and drivers `drizzle` (Drizzle's own driver, pipelined), `bunsql`, `pg` and `postgresjs`. `drizzle-elysia-*` is the Bun server on Elysia 1.4 instead of Hono, and `drizzle-elysia2-*` the same on Elysia 2.0 (`2.0.0-rc.4`, the `elysia2` alias). `prisma7-<rt>` and `prisma8-<rt>` are Prisma on node-postgres with its defaults; `prisma7-<rt>-pg` / `prisma7-<rt>-drizzle` add named statements (`STATEMENT_NAMES=1`), and `prisma8-<rt>-drizzle` is Prisma 8 on Drizzle's driver. `effect-node26-effect` / `effect-node26-drizzle` are Drizzle on Effect, Node 26 only, with the two `DRIVER` values above. `scripts/configs.ts` has the exact command of each. The server machine rests `--cooldown` seconds (default 60) between runs, and the results are copied back into `results/`.

### Run on the two machines alone
`matrix.ts` needs your machine connected for the whole run. To start a run and disconnect, run the matrix on the machines themselves: `scripts/server-agent.ts` on the server machine starts and stops each config's server when asked over the direct Ethernet link (a fixed set of actions by config name, listening only on that link), and `scripts/bench-run.ts` on the load machine walks the configs. This is how the published results were run.
```bash
# server machine, repo root (build the Go server first if you run `go`)
setsid -f bun scripts/server-agent.ts --workers 2 --pool 8 > /tmp/server-agent.log 2>&1 < /dev/null

# load machine, repo root
setsid -f bun scripts/bench-run.ts --requests full --cpu --suffix full > run.log 2>&1 < /dev/null      # every config
setsid -f bun scripts/bench-run.ts --requests full --cpu --suffix full 'kysely-*' > run.log 2>&1 < /dev/null
```
`bench-run.ts` takes the same options as `matrix.ts`, plus `--agent` (default `http://10.0.0.2:3999`) and `--target` (`http://10.0.0.2`). It stops if the server machine reboots or Postgres goes down, drops the run that broke, and tells the agent to exit at the end. Results land in the load machine's `results/`.

We kept each comparison in its own folder: `results/` (the main matrix), `results-kysely/` (Kysely on the three drivers), `results-prisma/` (Prisma with named statements and on Drizzle's driver) and `results-cap/` (Drizzle on Bun 1.4 ramped past 4,800 VUs to find its ceiling). They aren't in git (about 40 MB of parquet per run); `bun scripts/peaks.ts <folder>/*.parquet` prints a table of each.

## View results
```bash
bun viewer/serve.ts results   # → http://localhost:4321
```
This uses the same charts as [orm.drizzle.team/benchmarks](https://orm.drizzle.team/benchmarks): latency, requests/sec and CPU, played back side by side. Pick any two runs as A and B; Reload picks up new runs.

To export the per-second data in the website's `data.json` format (the four CPU cores, requests/s, failures, latencies and VUs per second; per-process metrics left out):
```bash
bun scripts/site-data.ts                                                     # results/ → data.json
bun scripts/site-data.ts --out data.json results results-kysely --exclude 'kysely-*-drizzle-*'
bun viewer/serve.ts data.json                                                # check it in the charts
```
