# Drizzle Benchmarks
Drizzle has always been fast, we just wanted you to have a meaningful [benchmarks experience](orm.drizzle.team#benchmarks)  

We ran our benchmarks on 2 separate machines, so that observer does not influence results. For database we're using PostgreSQL instance with 42MB of E-commerce data(~370k records).  
K6 benchmarking instance lives on MacBook Air and makes [1M prepared requests](./data/requests.json) through 1GB ethernet to Lenovo M720q with Intel Core i3-9100T and 32GB of RAM.

![image](https://github.com/drizzle-team/drizzle-benchmarks/assets/4045375/103ae551-7708-4752-b3ed-5734adfe897f)


To run your own tests - follow instructions below!

## Prepare test machine
1. Spin up a docker container with PostgreSQL using `pnpm start:docker` command. You can configure a desired database port in `./src/docker.ts` file:
```ts
...
}

const desiredPostgresPort = 5432; // change here
main();
```
2. Update `DATABASE_URL` with allocated database port in .env file:
```env
DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres"
```
3. Seed your database with test data using `pnpm start:seed` command, you can change the size of the database in `./src/seed.ts` file:
```ts
...
}

main("micro"); // nano | micro
```
4. Make sure you have Node version 18 installed or above. You can use [`nvm use 18`](https://github.com/nvm-sh/nvm) command
5. Start Drizzle/Prisma server:
```bash
## Drizzle
pnpm start:drizzle

## Prisma
pnpm prepare:prisma
pnpm start:prisma
```

## Prepare testing machine
1. Generate a list of http requests with `pnpm start:generate`. It will output a list of http requests to be run on the tested server | `./data/requests.json`
2. Install [k6 load tester](https://k6.io/)
3. Configure tested server url in `./k6.js` file
```js
// const host = `http://192.168.31.144:3000`; // drizzle
const host = `http://192.168.31.144:3001`; // prisma
```
4. Run tests with `k6 run bench.js` 🚀
