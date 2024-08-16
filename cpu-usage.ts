import fs from 'fs';

// const host = `http://192.168.31.144:3000`; // drizzle
// const host = `http://192.168.31.144:3001`; // prisma

const host = Bun.argv[2];
const fileName = Bun.argv[3];

fs.writeFileSync(`${fileName}.csv`, 'core1,core2,core3,core4,timestamp\n', {
  flag: 'w', // 'w' means create a new file only if it does not exist
});

setInterval(() => {
  fetch(`${host}/stats`)
    .then((res) => res.json() as Promise<number[]>)
    .then((data) => {
      const [core1, core2, core3, core4] = data;
      fs.appendFileSync(`${fileName}.csv`, `${core1},${core2},${core3},${core4},${new Date().getTime()}\n`);
    });
}, 200);
