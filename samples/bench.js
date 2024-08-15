import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { scenario } from 'k6/execution';
import http from 'k6/http';

const data = new SharedArray('requests', function () {
  return JSON.parse(open('./data/requests.json'));
  // return JSON.parse(open('./data/requests.json')).filter((it)=>!it.startsWith('/search'));
});

// const host = `http://192.168.31.144:3000`; // drizzle
const host = `http://192.168.31.144:3001`; // prisma

export const options = {
  vus: 200,
  duration: '300s',
  // iterations: 600000,
  
};
  
export default function () {
  const params = data[scenario.iterationInTest % data.length];
  const url = `${host}${params}`;

  http.get(url, {
    tags: { name: 'fetch' },
    timeout: '30s',
  });

  sleep(0.2 * (scenario.iterationInTest % 6));
}
