import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'fs';
import { parseArgs } from 'util';

const {
  values: { folder },
} = parseArgs({
  args: process.argv,
  options: {
    folder: {
      type: 'string',
      default: 'results',
    },
  },
  strict: true,
  allowPositionals: true,
});

if (!folder) {
  throw new Error('folder is required');
}

const main = async () => {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();

  const files = fs
    .readdirSync(folder)
    .filter((file) => file.endsWith('.parquet'))
    .map((file) => file.replace('.parquet', ''));

  const data: Record<string, any[]> = {};
  for (const testName of files) {
    const result = await connection.run(
      `
      WITH cpu_usage AS (
        SELECT
          time_bucket(INTERVAL '1s', epoch_ms(timestamp)) AS "time",
          AVG(core1) AS "core1",
          AVG(core2) AS "core2",
          AVG(core3) AS "core3",
          AVG(core4) AS "core4"
        FROM
          read_csv('${folder}/cpu-usage-${testName}.csv')
        GROUP BY time
        ORDER BY time ASC
      ), reqs_per_sec AS (
        SELECT
          time_bucket(INTERVAL '1s', to_timestamp(timestamp)) AS "time",
          SUM(metric_value) AS "reqs_per_sec"
        FROM
          "${folder}/${testName}.parquet"
        WHERE metric_name = 'http_reqs'
        GROUP BY time
      ), fail_reqs_per_sec AS (
        SELECT
          time_bucket(INTERVAL '1s', to_timestamp(timestamp)) AS "time",
          SUM(metric_value) AS "fail_reqs_per_sec"
        FROM
          "${folder}/${testName}.parquet"
        WHERE 
          metric_name = 'http_req_failed'
        GROUP BY time
      ), req_duration AS (
        SELECT
          time_bucket(INTERVAL '1s', to_timestamp(timestamp)) AS "time",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY metric_value) AS "latency_95",
          percentile_cont(0.90) WITHIN GROUP (ORDER BY metric_value) AS "latency_90",
          percentile_cont(0.99) WITHIN GROUP (ORDER BY metric_value) AS "latency_99",
          AVG(metric_value) AS "latency_average"
        FROM
          "${folder}/${testName}.parquet"
        WHERE metric_name = 'http_req_duration'
          AND status < 400
        GROUP BY time
      )
      SELECT
        cpu_usage.time,
        cpu_usage.core1,
        cpu_usage.core2,
        cpu_usage.core3,
        cpu_usage.core4,
        reqs_per_sec.reqs_per_sec,
        fail_reqs_per_sec.fail_reqs_per_sec,
        req_duration.latency_95,
        req_duration.latency_90,
        req_duration.latency_99,
        req_duration.latency_average
      FROM
        cpu_usage
      JOIN reqs_per_sec ON epoch_ms(cpu_usage.time) = epoch_ms(reqs_per_sec.time)
      JOIN fail_reqs_per_sec ON epoch_ms(cpu_usage.time) = epoch_ms(fail_reqs_per_sec.time)
      JOIN req_duration ON epoch_ms(cpu_usage.time) = epoch_ms(req_duration.time)
      ORDER BY cpu_usage.time ASC;
    `,
    );

    console.log(`Processing ${testName}...`);
    data[testName] = await result.getRowObjectsJS();
  }

  console.log('All data processed');
  // Do something with the data
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
