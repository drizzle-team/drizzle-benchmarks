import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  CustomerInsert,
  customers,
  DetailInsert,
  details,
  employees,
  OrderInsert,
  orders,
  ProductInsert,
  products,
  SupplierInsert,
  suppliers,
} from "./schema";
import { faker } from "@faker-js/faker";
import "dotenv/config";

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

  try {
    const client = postgres(process.env.DATABASE_URL!);
    const db = drizzle({ client, logger: false });

    const migrationsClient = postgres(process.env.DATABASE_URL!, { max: 1 });
    const migrationDB: PostgresJsDatabase = drizzle({ client: migrationsClient });
    await migrate(migrationDB, { migrationsFolder: "drizzle" });

    console.log("seeding customers...");
    let customerModels: CustomerInsert[] = [];
    for (let customerId = 1; customerId <= config.customers; customerId++) {
      customerModels.push({
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

      if (customerModels.length > 5_000) {
        await db.insert(customers).values(customerModels).execute();
        customerModels = [];
      }
    }

    if (customerModels.length) {
      await db.insert(customers).values(customerModels).execute();
    }

    console.log("seeding employees...");
    for (let employeeId = 1; employeeId <= config.employees; employeeId++) {
      await db
        .insert(employees)
        .values({
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
        })
        .execute();
    }

    console.log("locading orders...");
    let startOrderDate = new Date("2016");

    let orderModels: OrderInsert[] = [];
    for (let orderId = 1; orderId <= config.orders; orderId++) {
      const orderDate = startOrderDate;

      const requiredDate = new Date(orderDate);
      requiredDate.setHours(orderDate.getHours() + 30 * 24);

      const shippedDate = new Date(orderDate);
      shippedDate.setHours(orderDate.getHours() + 10 * 24);

      orderModels.push({
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

      if (orderModels.length > 5_000) {
        await db.insert(orders).values(orderModels).execute();
        orderModels = [];
      }
    }

    if (orderModels.length) {
      await db.insert(orders).values(orderModels).execute();
    }

    console.log("seeding suppliers...");
    let supplierModels: SupplierInsert[] = [];
    for (let supplierId = 1; supplierId <= config.suppliers; supplierId++) {
      supplierModels.push({
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

      if (supplierModels.length > 5_000) {
        await db.insert(suppliers).values(supplierModels).execute();
        supplierModels = [];
      }
    }

    if (supplierModels.length) {
      await db.insert(suppliers).values(supplierModels).execute();
    }

    console.log("seeding products...");
    let productModels: ProductInsert[] = [];
    const productPrices = new Map<number, number>();
    for (let productId = 1; productId <= config.products; productId++) {
      const unitPrice = getRandomInt(0, 1)
        ? getRandomInt(3, 300)
        : Number(`${getRandomInt(3, 300)}.${getRandomInt(5, 99)}`);

      productModels.push({
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

      if (productModels.length > 5_000) {
        await db.insert(products).values(productModels).execute();
        productModels = [];
      }
    }

    if (productModels.length) {
      await db.insert(products).values(productModels).execute();
    }

    console.log("seeding order details...");
    let detailModels: DetailInsert[] = [];
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
        const unitPrice = productPrices.get(productId);

        detailModels.push({
          unitPrice: unitPrice!,
          quantity: getRandomInt(1, 130),
          discount: getRandomInt(0, 1)
            ? 0
            : faker.helpers.arrayElement(discounts),
          orderId: orderId,
          productId,
        });

        if (detailModels.length > 5_000) {
          await db.insert(details).values(detailModels).execute();
          detailModels = [];
        }
      }
    }

    if (detailModels.length) {
      await db.insert(details).values(detailModels).execute();
    }

    console.log("done!");
    process.exit(0);
  } catch (err: any) {
    console.log("FATAL ERROR:", err);
  }
}

main("micro");
