import { faker } from "@faker-js/faker";
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres";
import { migrate } from "drizzle-orm/postgres/migrator";
import type { PgTable } from "drizzle-orm/pg-core";
import { customers, details, employees, orders, products, suppliers } from "./schema.ts";

type CustomerInsert = typeof customers.$inferInsert;
type EmployeeInsert = typeof employees.$inferInsert;
type OrderInsert = typeof orders.$inferInsert;
type SupplierInsert = typeof suppliers.$inferInsert;
type ProductInsert = typeof products.$inferInsert;
type DetailInsert = typeof details.$inferInsert;

// SEED_INSERT=bulk (default): db.bulkInsert() — the driver inserts via unnest and chunks on its own
// SEED_INSERT=values: classic db.insert().values() in SEED_CHUNK-row statements, same driver, for comparison
const insertMode = process.env.SEED_INSERT === "values" ? "values" : "bulk";
const CHUNK = Number(process.env.SEED_CHUNK ?? 2_500); // values mode only; keep rows × columns ≤ 32767

const titlesOfCourtesy = ["Ms.", "Mrs.", "Dr."];
const unitsOnOrders = [0, 10, 20, 30, 50, 60, 70, 80, 100];
const reorderLevels = [0, 5, 10, 15, 20, 25, 30];
const quantityPerUnit = [
  "100 - 100 g pieces",
  "100 - 250 g bags",
  "10 - 200 g glasses",
  "10 - 4 oz boxes",
  "10 - 500 g pkgs.",
  "10 - 500 g pkgs.",
  "10 boxes x 12 pieces",
  "10 boxes x 20 bags",
  "10 boxes x 8 pieces",
  "10 kg pkg.",
  "10 pkgs.",
  "12 - 100 g bars",
  "12 - 100 g pkgs",
  "12 - 12 oz cans",
  "12 - 1 lb pkgs.",
  "12 - 200 ml jars",
  "12 - 250 g pkgs.",
  "12 - 355 ml cans",
  "12 - 500 g pkgs.",
  "750 cc per bottle",
  "5 kg pkg.",
  "50 bags x 30 sausgs.",
  "500 ml",
  "500 g",
  "48 pieces",
  "48 - 6 oz jars",
  "4 - 450 g glasses",
  "36 boxes",
  "32 - 8 oz bottles",
  "32 - 500 g boxes",
];
const discounts = [0.05, 0.15, 0.2, 0.25];

const getRandomInt = (from: number, to: number): number => {
  return Math.round(Math.random() * (to - from) + from);
};

const randFromArray = faker.helpers.arrayElement;

const weightedRandom = <T>(
  config: { weight: number; value: T | T[] }[]
): (() => T) => {
  // probability mass function
  const pmf = config.map((it) => it.weight);

  const fn = (sum: number) => (value: number) => {
    return (sum += value);
  };
  const mapFn = fn(0);

  // cumulative distribution function
  const cdf = pmf.map((it) => mapFn(it));
  // [0.6, 0.7, 0.9...]
  return () => {
    const rand = Math.random();
    for (let i = 0; i < cdf.length; i++) {
      if (cdf[i] >= rand) {
        const item = config[i];
        if (typeof item.value === "object") {
          return randFromArray(item.value as T[]);
        }
        return item.value;
      }
    }
    throw Error(`no rand for: ${rand} | ${cdf.join(",")}`);
  };
};

const sizes = {
  nano: {
    employees: 50,
    customers: 1000,
    orders: 5000,
    products: 500,
    suppliers: 100,
  },
  micro: {
    employees: 200,
    customers: 10000,
    orders: 50000,
    products: 5000,
    suppliers: 1000,
  },
} as const;

async function main(size: keyof typeof sizes) {
  const config = sizes[size];
  const db = drizzle(process.env.DATABASE_URL!);
  await migrate(db, { migrationsFolder: "drizzle" });

  const timings: { table: string; rows: number; generateMs: number; insertMs: number }[] = [];
  /** generate rows (faker), then insert them, timing both separately */
  async function seed<T extends PgTable>(name: string, table: T, generate: () => any[]) {
    console.log(`seeding ${name}...`);
    let t = performance.now();
    const rows = generate();
    const generateMs = performance.now() - t;
    t = performance.now();
    if (insertMode === "bulk") {
      await db.bulkInsert(table, rows);
    } else {
      for (let i = 0; i < rows.length; i += CHUNK) await db.insert(table).values(rows.slice(i, i + CHUNK));
    }
    timings.push({ table: name, rows: rows.length, generateMs, insertMs: performance.now() - t });
  }

  await seed("customers", customers, () => {
    const rows: CustomerInsert[] = [];
    for (let customerId = 1; customerId <= config.customers; customerId++) {
      rows.push({
        companyName: faker.company.name(),
        contactName: faker.person.fullName(),
        contactTitle: faker.person.jobTitle(),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        postalCode: getRandomInt(0, 1) ? faker.location.zipCode() : null,
        region: faker.location.state(),
        country: faker.location.country(),
        phone: faker.phone.number("(###) ###-####"),
        fax: faker.phone.number("(###) ###-####"),
      });
    }
    return rows;
  });

  // one bulk statement: recipientId always points to an earlier employee, and Postgres
  // checks the self-referencing foreign key at the end of the statement
  await seed("employees", employees, () => {
    const rows: EmployeeInsert[] = [];
    for (let employeeId = 1; employeeId <= config.employees; employeeId++) {
      rows.push({
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        title: faker.person.jobTitle(),
        titleOfCourtesy: faker.helpers.arrayElement(titlesOfCourtesy),
        birthDate: faker.date.birthdate(),
        hireDate: faker.date.past(),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        postalCode: faker.location.zipCode(),
        country: faker.location.country(),
        homePhone: faker.phone.number("(###) ###-####"),
        extension: getRandomInt(428, 5467),
        notes: faker.person.bio(),
        recipientId: employeeId > 1 ? getRandomInt(1, employeeId - 1) : null,
      });
    }
    return rows;
  });

  await seed("orders", orders, () => {
    const rows: OrderInsert[] = [];
    const startOrderDate = new Date("2016");
    for (let orderId = 1; orderId <= config.orders; orderId++) {
      const orderDate = new Date(startOrderDate); // own copy per order (was a shared, mutated Date)

      const requiredDate = new Date(orderDate);
      requiredDate.setHours(orderDate.getHours() + 30 * 24);

      const shippedDate = new Date(orderDate);
      shippedDate.setHours(orderDate.getHours() + 10 * 24);

      rows.push({
        orderDate,
        requiredDate,
        shippedDate,
        shipVia: getRandomInt(1, 3),
        freight: Number(`${getRandomInt(0, 1000)}.${getRandomInt(10, 99)}`),
        shipName: faker.location.streetAddress(),
        shipCity: faker.location.city(),
        shipRegion: faker.location.state(),
        shipPostalCode: faker.location.zipCode(),
        shipCountry: faker.location.country(),
        customerId: getRandomInt(1, config.customers),
        employeeId: getRandomInt(1, config.employees),
      });

      startOrderDate.setMinutes(startOrderDate.getMinutes() + 1);
    }
    return rows;
  });

  await seed("suppliers", suppliers, () => {
    const rows: SupplierInsert[] = [];
    for (let supplierId = 1; supplierId <= config.suppliers; supplierId++) {
      rows.push({
        companyName: faker.company.name(),
        contactName: faker.person.fullName(),
        contactTitle: faker.person.jobTitle(),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        postalCode: faker.location.zipCode(),
        region: faker.location.state(),
        country: faker.location.country(),
        phone: faker.phone.number("(###) ###-####"),
      });
    }
    return rows;
  });

  const productPrices = new Map<number, number>();
  await seed("products", products, () => {
    const rows: ProductInsert[] = [];
    for (let productId = 1; productId <= config.products; productId++) {
      const unitPrice = getRandomInt(0, 1)
        ? getRandomInt(3, 300)
        : Number(`${getRandomInt(3, 300)}.${getRandomInt(5, 99)}`);

      rows.push({
        name: faker.company.name(),
        quantityPerUnit: faker.helpers.arrayElement(quantityPerUnit),
        unitPrice,
        unitsInStock: getRandomInt(0, 125),
        unitsOnOrder: faker.helpers.arrayElement(unitsOnOrders),
        reorderLevel: faker.helpers.arrayElement(reorderLevels),
        discontinued: getRandomInt(0, 1),
        supplierId: getRandomInt(1, config.suppliers),
      });

      productPrices.set(productId, unitPrice);
    }
    return rows;
  });

  await seed("order details", details, () => {
    const rows: DetailInsert[] = [];
    const productCount = weightedRandom([
      { weight: 0.6, value: [1, 2, 3, 4] },
      { weight: 0.2, value: [5, 6, 7, 8, 9, 10] },
      { weight: 0.15, value: [11, 12, 13, 14, 15, 16, 17] },
      { weight: 0.05, value: [18, 19, 20, 21, 22, 23, 24, 25] },
    ]);

    for (let orderId = 1; orderId <= config.orders; orderId++) {
      const count = productCount();
      for (let i = 0; i < count; i++) {
        const productId = getRandomInt(1, config.products);
        rows.push({
          unitPrice: productPrices.get(productId)!,
          quantity: getRandomInt(1, 130),
          discount: getRandomInt(0, 1) ? 0 : faker.helpers.arrayElement(discounts),
          orderId,
          productId,
        });
      }
    }
    return rows;
  });

  const total = timings.reduce((a, t) => ({ rows: a.rows + t.rows, gen: a.gen + t.generateMs, ins: a.ins + t.insertMs }), { rows: 0, gen: 0, ins: 0 });
  console.log(`\ndone (insert mode: ${insertMode})`);
  console.table(
    timings.map((t) => ({ table: t.table, rows: t.rows, "generate ms": Math.round(t.generateMs), "insert ms": Math.round(t.insertMs), "rows/s": Math.round(t.rows / (t.insertMs / 1000)) })),
  );
  console.log(`total: ${total.rows} rows, generate ${Math.round(total.gen)} ms, insert ${Math.round(total.ins)} ms (${Math.round(total.rows / (total.ins / 1000))} rows/s)`);
}

main("micro")
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL ERROR:", err);
    process.exit(1); // the old seed swallowed errors and then hung on the open pool
  });
