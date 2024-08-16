import concurrently from 'concurrently';
import fs from 'fs';

// const host = `http://192.168.31.144:3000`; // drizzle
const host = `http://192.168.31.144:3001`; // prisma

const fileName = 'prisma-joins-node-18';

fs.mkdirSync('result', { recursive: true });

const { result } = concurrently(
  [
    { command: `bun cpu-usage.ts -- ${host} result/cpu-usage-${fileName}`, name: 'cpu-usage' },
    { command: `sleep 1 && k6 run -e HOST=${host} bench.js --out csv=result/${fileName}.csv && duckdb :memory: "COPY (SELECT * FROM 'result/${fileName}.csv') TO 'result/${fileName}.parquet' (FORMAT 'parquet');" && rm result/${fileName}.csv`, name: 'bench' },
  ],
  {
    prefix: 'name',
    killOthers: ['failure', 'success'],
  },
);
result.then(
  () => console.log('All done!')
);
