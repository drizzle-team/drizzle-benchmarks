import fs from 'fs';
import { parseArgs } from 'util';

const {
  values: { host, name, folder },
} = parseArgs({
  args: process.argv,
  options: {
    host: {
      type: 'string',
    },
    name: {
      type: 'string',
    },
    folder: {
      type: 'string',
      default: 'results',
    },
  },
  strict: true,
  allowPositionals: true,
});

if (!host) {
  throw new Error('host is required');
}

if (!name) {
  throw new Error('name is required');
}

if (!folder) {
  throw new Error('folder is required');
}

const filename = `${folder}/cpu-usage-${name}.csv`;

fs.writeFileSync(filename, 'core1,core2,core3,core4,timestamp\n', {
  flag: 'w', // 'w' means create a new file only if it does not exist
});

async function withRetries<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }
  }

  throw lastError;
}

setInterval(() => {
  withRetries(() => fetch(`${host}/stats`))
    .then((res) => res.json() as Promise<number[]>)
    .then((data) => {
      const [core1, core2, core3, core4] = data;

      if (
        core1 === undefined ||
        core2 === undefined ||
        core3 === undefined ||
        core4 === undefined ||
        core1 === null ||
        core2 === null ||
        core3 === null ||
        core4 === null
      ) {
        return;
      }

      fs.appendFileSync(filename, `${core1},${core2},${core3},${core4},${new Date().getTime()}\n`);
    });
}, 200);
