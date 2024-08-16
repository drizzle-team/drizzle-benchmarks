import fs from 'fs';

// const host = `http://192.168.31.144:3000`; // drizzle
const host = `http://192.168.31.144:3001`; // prisma

fs.writeFileSync('cpu-usage.csv', 'core1, core2, core3, core4, time\n', {
  flag: 'w', // 'w' means create a new file only if it does not exist
});

setInterval(() => {
  fetch(`${host}/stats`)
    .then((res) => res.json() as Promise<number[]>)
    .then((data) => {
      fs.appendFileSync('cpu-usage.csv', data.join(',') + ',' + new Date().getTime() + '\n');
    });
}, 200);
