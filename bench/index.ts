import concurrently from 'concurrently';
import fs from 'fs';
import { parseArgs } from 'util';

// const host = `http://192.168.31.144:3000`; // drizzle
// const host = `http://192.168.31.144:3001`; // prisma
// const host = `http://192.168.31.144:3002`; // go
// const host = `http://192.168.31.144:3003`; // rust

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

fs.mkdirSync(folder, { recursive: true });

const { result } = concurrently(
  [
    { command: `tsx bench/cpu-usage.ts --host ${host} --name ${name} --folder ${folder}`, name: 'cpu-usage' },
    {
      command: `sleep 1 && k6 run -e HOST=${host} bench/bench.js --out csv=${folder}/${name}.csv && duckdb :memory: "COPY (SELECT * FROM '${folder}/${name}.csv') TO '${folder}/${name}.parquet' (FORMAT 'parquet');" && rm ${folder}/${name}.csv`,
      name: 'bench',
    },
  ],
  {
    prefix: 'name',
    killOthers: ['failure', 'success'],
  },
);
result.then(() => console.log('All done!'));
