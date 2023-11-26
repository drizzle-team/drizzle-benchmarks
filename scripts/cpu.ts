import axios from 'axios';
import fs from 'fs';

setInterval(async () => {
  const response = await axios.get('http://192.168.31.144:3002/stats');

  const data = response.data;

  // fs.appendFileSync('test/intervalVus2/cpuUsage-drizzle.txt', `${data.join(',')}\n`);
  fs.appendFileSync('test/intervalVus2/cpuUsage-prisma.txt', `${data.join(',')}\n`);
}, 200);
