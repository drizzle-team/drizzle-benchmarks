import axios from 'axios';
import r from 'ramda';
import diff from 'deep-diff';
import 'dotenv/config';
import { requests } from '../bench/requests.ts';

// same deterministic request sequence the benchmark sends
const path = requests({ seed: 1 });
const reqs = Array.from({ length: 400_000 }, (_, i) => path(i));

const phost = `http://192.168.31.144:3001`; // prisma
const dhost = `http://192.168.31.144:3000`; // drizzle

const main = async () => {
  for (let i = 0; i < reqs.length; i++) {
    const params = reqs[i];
    const url1 = `${phost}${params}`;
    const url2 = `${dhost}${params}`;

    const [res1, res2] = (await Promise.all([axios.get(url1), axios.get(url2)])).map((it) => it.data);

    i += 1;
    if (i % 1000 === 1) {
      console.log(i);
    }

    if (!r.equals(res1, res2)) {
      const diffed = diff(res1, res2)!!;
      if (diffed[0]!.path![1] === 'totalPrice') {
        continue;
      }
      console.log(i, url1);
      console.log(diffed);
      return;
    }
  }
};

main();
