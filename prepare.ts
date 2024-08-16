import { Database } from 'duckdb';
import fs from 'fs';

const db = new Database(':memory:');

const files = fs.readdirSync('result').filter((file) => file.endsWith('.parquet')).map((file) => file.replace('.parquet', ''));

const data: Record<string, any[]> = {};
files.forEach((testName) => {
  db.all(
    `
      WITH cpu_usage AS (
          SELECT
                AVG(core1) AS "core1",
                AVG(core2) AS "core2",
                AVG(core3) AS "core3",
                AVG(core4) AS "core4",
                time_bucket(INTERVAL '1s', epoch_ms(timestamp)) AS "time",
          FROM
               read_csv('result/cpu-usage-${testName}.csv')
            GROUP BY time
          ORDER BY time ASC
        ), reqs_per_sec AS (
            SELECT
                time_bucket(INTERVAL '1s', to_timestamp(timestamp)) AS "time",
                SUM(metric_value) AS "reqs_per_sec"
            FROM
                "result/${testName}.parquet"
            WHERE metric_name = 'http_reqs'
            GROUP BY time
          ORDER BY time ASC
        ), fail_reqs_per_sec AS (
            SELECT
                time_bucket(INTERVAL '1s', to_timestamp(timestamp)) AS "time",
                SUM(metric_value) AS "fail_reqs_per_sec"
            FROM
                "result/${testName}.parquet"
            WHERE 
              metric_name = 'http_req_failed'
            GROUP BY time
          ORDER BY time ASC
        ), req_duration AS (
            SELECT
              time_bucket(INTERVAL '1s', to_timestamp(timestamp)) AS "time",
              percentile_cont(0.95) WITHIN GROUP (ORDER BY metric_value) AS "successful95",
              percentile_cont(0.90) WITHIN GROUP (ORDER BY metric_value) AS "successful90",
              percentile_cont(0.99) WITHIN GROUP (ORDER BY metric_value) AS "successful99",
              AVG(metric_value) AS "average"
            FROM
              "result/${testName}.parquet"
            WHERE metric_name = 'http_req_duration'
              AND status < 400
            GROUP BY time
            ORDER BY time ASC
        )
        SELECT
            cpu_usage.time,
            core1,
            core2,
            core3,
            core4,
            reqs_per_sec,
            fail_reqs_per_sec,
            successful95,
            successful90,
            successful99,
            average
        FROM
            cpu_usage
        JOIN
            reqs_per_sec
        ON
            epoch_ms(cpu_usage.time) = epoch_ms(reqs_per_sec.time)
        JOIN 
            fail_reqs_per_sec
        ON
            epoch_ms(cpu_usage.time) = epoch_ms(fail_reqs_per_sec.time)
        JOIN
            req_duration
        ON
            epoch_ms(cpu_usage.time) = epoch_ms(req_duration.time);
      `,
    (err, res) => {
      console.log(`Processing ${testName}...`);
      if (err) {
        console.error(err);
        return;
      }
      data[testName] = res;

      if (Object.keys(data).length === files.length) {
        console.log('All data processed');
        // Do something with the data
        fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
      }
    },
  );
});
