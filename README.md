# Drizzle Benchmarks
Drizzle has always been fast, we just wanted you to have a meaningful [benchmarks experience](https://orm.drizzle.team/benchmarks)

We run our benchmarks on 2 separate machines, so that the observer does not influence results. For the database we're using a PostgreSQL instance with 42MB of E-commerce data (~370k records).
The load generator runs on a MacBook Air and sends a production-like E-commerce request mix through 1GB ethernet to a Lenovo M720q with Intel Core i3-9100T and 32GB of RAM.

![image](https://github.com/drizzle-team/drizzle-benchmarks/assets/4045375/103ae551-7708-4752-b3ed-5734adfe897f)

To run your own tests, follow the instructions below.

## Repository layout

| path | |
|---|---|
| `src/` | Drizzle servers under test (Node or Bun, Hono or Elysia), database seed, docker setup |
| `prisma7/` | Prisma 7 servers, `schema.prisma` (the Prisma model for both versions) and `prisma.config.ts` |
| `prisma8/` | Prisma 8 servers; a separate package with its own `node_modules`, since two Prisma versions can't share one install |
| `go/` | Go reference server (port 3002) |
| `bench/` | the benchmark: load profile (`index.ts`), request mix (`requests.ts`) |
| `bunload/` | the load generator library used by `bench/` ([docs](./bunload/README.md)) |
| `viewer/` | local copy of the orm.drizzle.team benchmark charts, to plot your own runs |

## Prepare the server machine
1. Spin up a docker container with PostgreSQL using the `pnpm start:docker` command. You can configure the database port in `./src/docker.ts`:
```ts
...
}

const desiredPostgresPort = 5432; // change here
main();
```
2. Update `DATABASE_URL` with the allocated database port in the `.env` file:
```env
DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres"
```
3. Seed the database with test data using `pnpm start:seed`. It runs the migrations in `drizzle/` and bulk-inserts ~370k rows with `db.bulkInsert()` in a few seconds. You can change the size of the database in `./src/seed.ts`:
```ts
...
}

main("micro"); // nano | micro
```
4. Install Node 22.18+ or 24 (we use Node 24, e.g. [`nvm use 24`](https://github.com/nvm-sh/nvm)), or Bun for the Bun servers. The TypeScript runs as-is on Node's built-in type stripping, so there's no `tsx` or build step.
5. Start the server you want to test. Every server exposes `/stats` (per-core CPU usage), which the benchmark samples, and takes `WORKERS=n` for the number of processes: Drizzle and Prisma 8 default to one per CPU core, Prisma 7 to 2. The Drizzle servers can run on any of three Postgres drivers, with the same pool size per process (`POOL_MAX`, default 10):

| `DRIVER` | driver | |
|---|---|---|
| `pg` | node-postgres | default on Node |
| `drizzle` | `drizzle-orm/postgres`, Drizzle's own driver | |
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
```

Processes and connection pools at the defaults:

| server | pool per process | processes | connections on a 4-core server |
|---|---|---|---|
| Drizzle | 10 (`POOL_MAX`) | one per CPU core | 40 |
| Prisma 7 | 10 (node-postgres default, not configurable yet) | 2 | 20 |
| Prisma 8 | 10 (`POOL_MAX`) | one per CPU core | 40 |
| Go | up to 200 (`MaxConns` in `go/db/client.go`) | 1 | up to 200 |

For a like-for-like run, start every server with the same `WORKERS`. Watch the total against Postgres's `max_connections` (100 by default): on a 10-core machine, one process per core × 10 connections already uses all 100.

Notes on the two Prisma versions:
- **Prepared statements:** Prisma 7 has no prepared-statements API, so it sends every query as an unnamed statement that Postgres re-parses each time. The Prisma 8 server prepares every query once at startup with `db.prepare()`, the same way the Drizzle servers use `.prepare()`.
- **Shared schema:** Prisma 8 reads `prisma7/schema.prisma` as its contract (`prisma7Schema(...)`), so both versions use one model. Their responses are identical except for Postgres `date` columns, which Prisma 7 returns as a full timestamp and Prisma 8 as `YYYY-MM-DD`.
- **Prisma 8 drivers:** `DRIVER=pg` (default) or `DRIVER=drizzle`. Prisma 8 only accepts node-postgres, so `prisma8/drizzle-pg-pool.ts` presents Drizzle's driver as a `pg.Pool`. Responses and prepared statements are identical either way. Prisma 8's codecs decode only from text, so on either driver every value becomes a string first.
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
bun bench/index.ts <host> <name>                     # full profile: 0 → 3000 VUs over ~5m40s
bun bench/index.ts <host> <name> --quick             # 500 → 3000 VUs in 60s
bun bench/index.ts <host> <name> --requests 1000000  # same ramp, stop after 1M requests

bun bench/index.ts http://192.168.31.144:3000 drizzle
bun bench/index.ts http://192.168.31.144:3001 prisma7
bun bench/index.ts http://192.168.31.144:3003 prisma8
bun bench/index.ts http://192.168.31.144:3002 go
```

Each run prints per-second progress and a summary, and writes `results/<name>.parquet`. That one file holds a row per request (timestamp, latency, TTFB, status, errors, VUs, retries, iteration) plus the server CPU sampled from `/stats` during the run.

What a run does:
- **Requests:** a deterministic E-commerce mix generated at runtime (`bench/requests.ts`). Every run, against every server, sends the identical request sequence.
- **Load profile:** virtual users ramp up in steps like k6's `ramping-vus`. Each VU keeps one keep-alive connection and thinks 0–375 ms between requests.
- **Customising:** the load profile, request mix and sampled metrics (`monitor`) are plain TypeScript in `bench/index.ts`. See the [bunload docs](./bunload/README.md).

Use wired ethernet between the two machines. Over Wi-Fi, latency climbs and requests stall while the server sits idle, so the numbers measure the network instead of the server.

## View results
```bash
bun viewer/serve.ts results   # → http://localhost:4321
```
This uses the same charts as [orm.drizzle.team/benchmarks](https://orm.drizzle.team/benchmarks): latency, requests/sec and CPU, played back side by side. Pick any two runs as A and B; Reload picks up new runs.

To export the per-second data in the website's `data.json` format, with the viewer running:
```bash
curl -s localhost:4321/api/runs > data.json
```
