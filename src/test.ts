import { readFileSync } from 'fs';
import axios from 'axios';
import diff from 'deep-diff';
import 'dotenv/config';

const reqs = (JSON.parse(readFileSync('./data/requests.json', 'utf-8')) as string[]).filter(
  (it) => !it.startsWith('/search'),
);

const phost = `http://192.168.31.144:3001`; // prisma
const dhost = `http://192.168.31.144:3000`; // drizzle

const main = async () => {
  console.log('Start...')
  for (let i = 0; i < reqs.length; i++) {
    const params = reqs[i];
    const url1 = `${phost}${params}`;
    const url2 = `${dhost}${params}`;

    const [raw1, raw2] = (
      await Promise.all([
        axios.get(url1, { transformResponse: (it) => it }),
        axios.get(url2, { transformResponse: (it) => it }),
      ])
    ).map((it) => it.data as string);

    if ((i + 1) % 1000 === 0) {
      console.log(i + 1);
    }

    if (raw1 !== raw2) {
      const [res1, res2] = [JSON.parse(raw1), JSON.parse(raw2)];
      const diffed = diff(res1, res2);

      if (!diffed) {
        continue;
      }

      console.log(i + 1, url1);
      console.log(diffed);
      return;
    }
  }
};

main();
