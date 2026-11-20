import Docker from "dockerode";
import getPort from "get-port";
import { Pool } from "pg";

async function main() {
  const docker = new Docker();
  const port = await getPort({ port: desiredPostgresPort });
  if (desiredPostgresPort !== port) {
    throw new Error(`${desiredPostgresPort} port is taken`);
  }
  // pinned: results move with the Postgres version, so change it deliberately. PG_IMAGE overrides it
  // (e.g. PG_IMAGE=postgres:15.4, what results before 2026-11 used).
  const image = process.env.PG_IMAGE ?? "postgres:18.6";
  // On Linux, Postgres shares the host's network stack. With a published port (-p) instead, every
  // byte between server and database goes through Docker's userland docker-proxy, which on our 4-core
  // server took ~0.6 of a core, about 15% of the machine. PG_NETWORK=bridge for the old behaviour;
  // Docker Desktop (macOS/Windows) always uses a published port.
  const hostNetwork = process.platform === "linux" && process.env.PG_NETWORK !== "bridge";

  // docker.pull resolves when the pull starts; wait for it to finish
  await new Promise<void>((resolve, reject) =>
    docker.pull(image, (err: unknown, stream: NodeJS.ReadableStream) =>
      err ? reject(err) : docker.modem.followProgress(stream, (e: unknown) => (e ? reject(e) : resolve())),
    ),
  );

  const pgContainer = await docker.createContainer({
    Image: image,
    Env: [
      "POSTGRES_PASSWORD=postgres",
      "POSTGRES_USER=postgres",
      "POSTGRES_DB=postgres",
    ],
    name: `drizzle-benchmarks-pg2`,
    // with host networking Postgres listens on the host port itself
    Cmd: hostNetwork ? ["postgres", "-c", `port=${port}`] : undefined,
    HostConfig: hostNetwork
      ? { AutoRemove: true, NetworkMode: "host" }
      : {
          AutoRemove: true,
          PortBindings: {
            "5432/tcp": [{ HostPort: `${port}` }],
          },
        },
  });

  await pgContainer.start();

  let sleep = 250;
  let timeLeft = 30000;
  let connected = false;
  let lastError: unknown | undefined;

  const dburl = `postgres://postgres:postgres@localhost:${port}/postgres`;
  const pool = new Pool({ connectionString: dburl });

  do {
    try {
      await pool.connect();
      connected = true;
      break;
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, sleep));
      timeLeft -= sleep;
    }
  } while (timeLeft > 0);
  if (!connected) {
    console.error("Cannot connect to Postgres");
    throw lastError;
  }
  // const sql_script = fs.readFileSync(path.resolve("data/init-db.sql"), "utf-8");
  // await pool.query(sql_script);
  console.log(`${image} is up and running on port ${port} (${hostNetwork ? "host network" : "published port"})...`);
  process.exit(0);
}

const desiredPostgresPort = 5435;
main();
