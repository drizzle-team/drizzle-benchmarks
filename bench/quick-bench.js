import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { scenario } from 'k6/execution';
import http from 'k6/http';

const data = new SharedArray('requests', function () {
  return JSON.parse(open('../data/requests.json')).filter((it) => !it.startsWith('/search'));
});

const host = __ENV.HOST || `http://localhost:3000`;

export const options = {
  stages: [
    { duration: '5s', target: 500 },
    { duration: '20s', target: 500 },
    { duration: '5s', target: 1000 },
    { duration: '20s', target: 1000 },
    { duration: '5s', target: 1500 },
    { duration: '20s', target: 1500 },
    { duration: '5s', target: 2000 },
    { duration: '30s', target: 2000 },
  ],
};

export default function () {
  const params = data[scenario.iterationInTest % data.length];
  const url = `${host}${params}`;

  http.get(url, {
    headers: {
      Connection: 'keep-alive',
      'Keep-Alive': 'timeout=5, max=1000',
    },
    tags: { name: 'fetch' },
    timeout: '30s',
  });

  sleep(0.1 * (scenario.iterationInTest % 6));
}
