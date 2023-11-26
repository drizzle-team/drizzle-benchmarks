import fs from "fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { customers, employees, orders, products, suppliers } from "./schema";
import { sql } from "drizzle-orm";
import "dotenv/config";

// prettier-ignore
export const customerSearches = [
  "ve", "ey", "or", "bb", "te",
  "ab", "ca", "ki", "ap", "be",
  "ct", "hi", "er", "pr", "pi",
  "en", "au", "ra", "ti", "ke",
  "ou", "ur", "me", "ea", "op",
  "at", "ne", "na", "os", "ri",
  "on", "ha", "il", "to", "as",
  "io", "di", "zy", "az", "la",
  "ko", "st", "gh", "ug", "ac",
  "cc", "ch", "hu", "re", "an",
];

// prettier-ignore
export const productSearches = [
  "ha", "ey", "or", "po", "te",
  "ab", "er", "ke", "ap", "be",
  "en", "au", "ra", "ti", "su",
  "sa", "hi", "nu", "ge", "pi",
  "ou", "ur", "me", "ea", "tu",
  "at", "ne", "na", "os", "ri",
  "on", "ka", "il", "to", "as",
  "io", "di", "za", "fa", "la",
  "ko", "st", "gh", "ug", "ac",
  "cc", "ch", "pa", "re", "an",
];

export const generateIds = (from: number, to: number) => {
  const ids = Array.from({ length: to - from + 1 }, (_, i) => i + from);
  return ids;
};

const rand = (idx: number) => 0 | (Math.random() * idx);

function shuffle(arr: any[]) {
  let last = arr.length;
  while (last > 0) {
    const n = rand(last);
    const m = --last;
    let tmp = arr[n];
    arr[n] = arr[m];
    arr[m] = tmp;
  }
}

const main = async () => {
  const client = postgres(process.env.DATABASE_URL);
  const db = drizzle(client, { logger: false });

  const [
    { minId: employeesMinId, maxId: employeesMaxId, count: employeesCount },
  ] = await db
    .select({
      minId: sql<number>`min(${employees.id})::int`,
      maxId: sql<number>`max(${employees.id})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(employees);

  const [
    { minId: customersMinId, maxId: customersMaxId, count: customersCount },
  ] = await db
    .select({
      minId: sql<number>`min(${customers.id})::int`,
      maxId: sql<number>`max(${customers.id})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(customers);

  const [
    { minId: suppliersMinId, maxId: suppliersMaxId, count: suppliersCount },
  ] = await db
    .select({
      minId: sql<number>`min(${suppliers.id})::int`,
      maxId: sql<number>`max(${suppliers.id})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(suppliers);

  const [{ minId: productsMinId, maxId: productsMaxId, count: productsCount }] =
    await db
      .select({
        minId: sql<number>`min(${products.id})::int`,
        maxId: sql<number>`max(${products.id})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(products);

  const [{ minId: ordersMinId, maxId: ordersMaxId, count: ordersCount }] =
    await db
      .select({
        minId: sql<number>`min(${orders.id})::int`,
        maxId: sql<number>`max(${orders.id})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders);

  const employeeIds = generateIds(employeesMinId, employeesMaxId);
  const customerIds = generateIds(customersMinId, customersMaxId);
  const supplierIds = generateIds(suppliersMinId, suppliersMaxId);
  const productIds = generateIds(productsMinId, productsMaxId);
  const orderIds = generateIds(ordersMinId, ordersMaxId);

  const requests: string[] = [];
  const requests2: string[] = [];

  // 20k requests to fetch customers by id
  for (let i = 1; i < 2e4; i += 1) {
    const idx = i % customerIds.length;
    const id = customerIds[idx];
    requests.push(`/customer-by-id?id=${id}`);
    // requests2.push(`/customer-by-id?id=${id}`);
  }
  shuffle(requests);
  shuffle(requests2);

  // 5k requests to serch customers
  const searchCustomersRequests = [];
  for (let i = 0; i < 5e3; i++) {
    const idx = i % customerSearches.length;
    const term = customerSearches[idx];
    requests.push(`/search-customer?term=${term}`);
    searchCustomersRequests.push(`/search-customer?term=${term}`);
  }
  shuffle(requests);
  shuffle(requests2);

  // 50k requests to search products
  const searchProductRequests = [];
  for (let i = 0; i < 5e4; i++) {
    const idx = i % productSearches.length;
    const term = productSearches[idx];
    requests.push(`/search-product?term=${term}`);
    searchProductRequests.push(`/search-product?term=${term}`);
  }
  shuffle(requests);

  // 5k requests to get employee by id with recipient
  for (let i = 0; i < 5e3; i++) {
    const idx = i % employeeIds.length;
    const id = employeeIds[idx];
    requests.push(`/employee-with-recipient?id=${id}`);
    // requests2.push(`/employee-with-recipient?id=${id}`);
  }
  shuffle(requests);
  shuffle(requests2);

  // 30k requests to get suppliers
  for (let i = 0; i < 3e4; i++) {
    const idx = i % supplierIds.length;
    const id = supplierIds[idx];
    requests.push(`/supplier-by-id?id=${id}`);
    // requests2.push(`/supplier-by-id?id=${id}`);
  }
  shuffle(requests2);

  const productsWithSuppliers = [];
  // 100k requests to get product by id with supplier
  for (let i = 0; i < 1e5; i++) {
    const idx = i % productIds.length;
    const id = productIds[idx];
    requests.push(`/product-with-supplier?id=${id}`);
    productsWithSuppliers.push(`/product-with-supplier?id=${id}`);
    // requests2.push(`/product-with-supplier?id=${id}`)
  }
  shuffle(requests);
  shuffle(requests2);

  // 100k requests to get order with details
  for (let i = 0; i < 1e5; i++) {
    const idx = i % orderIds.length;
    const id = orderIds[idx];
    requests.push(`/order-with-details?id=${id}`);
    // requests2.push(`/order-with-details?id=${id}`);
  }
  shuffle(requests);
  shuffle(requests2);

  const ordersFull = [];
  // 100k requests to get order with details and products
  for (let i = 0; i < 1e5; i++) {
    const idx = i % orderIds.length;
    const id = orderIds[idx];
    requests.push(`/order-with-details-and-products?id=${id}`);
    ordersFull.push(`/order-with-details-and-products?id=${id}`);
    // requests2.push(`/order-with-details-and-products?id=${id}`)
  }
  shuffle(requests);
  shuffle(requests2);

  // 2k paginated customers
  const totalCount = 10000;
  for (let i = 0; i < 2e3; i++) {
    const limit = 50;
    const pages = totalCount / limit;
    const page = 1 + Math.floor(pages * Math.random());
    const offset = page * limit - limit;

    requests.push(`/customers?limit=${limit}&offset=${offset}`);
    // requests2.push(`/customers?limit=${limit}&offset=${offset}`);
  }
  shuffle(requests);
  shuffle(requests2);

  // 1k paginated employees
  const totalCount2 = 100;
  for (let i = 0; i < 1e3; i++) {
    const limit = 20;
    const pages = totalCount2 / limit;
    const page = 1 + Math.floor(pages * Math.random());
    const offset = page * limit - limit;

    requests.push(`/employees?limit=${limit}&offset=${offset}`);
    // requests2.push(`/employees?limit=${limit}&offset=${offset}`);
  }
  shuffle(requests);
  shuffle(requests2);

  // 1k paginated suppliers
  const totalCount3 = 10000;
  for (let i = 0; i < 1e3; i++) {
    const limit = 50;
    const pages = totalCount3 / limit;
    const page = 1 + Math.floor(pages * Math.random());
    const offset = page * limit - limit;

    requests.push(`/suppliers?limit=${limit}&offset=${offset}`);
    // requests2.push(`/suppliers?limit=${limit}&offset=${offset}`);
  }
  shuffle(requests2);

  // 3k paginated products
  const totalCount4 = 1000;
  for (let i = 0; i < 3e3; i++) {
    const limit = 50;
    const pages = totalCount4 / limit;
    const page = 1 + Math.floor(pages * Math.random());
    const offset = page * limit - limit;

    requests.push(`/products?limit=${limit}&offset=${offset}`);
    // requests2.push(`/products?limit=${limit}&offset=${offset}`);
  }
  shuffle(requests);
  shuffle(requests2);

  // 10k paginated orders-with-details
  const totalCount5 = 830;
  for (let i = 0; i < 1e4; i++) {
    const limit = 50;
    const pages = totalCount5 / limit;
    const page = 1 + Math.floor(pages * Math.random());
    const offset = page * limit - limit;

    requests.push(`/orders-with-details?limit=${limit}&offset=${offset}`);
    requests2.push(`/orders-with-details?limit=${limit}&offset=${offset}`);
  }
  shuffle(requests);
  shuffle(requests2);

  shuffle(requests);
  shuffle(requests);
  shuffle(requests);
  shuffle(requests);
  shuffle(requests);
  shuffle(requests);
  shuffle(requests);
  shuffle(requests);
  shuffle(requests);

  console.log(requests.length, "shuffled requests");

  fs.writeFileSync("./data/requests.json", JSON.stringify(requests));
  fs.writeFileSync("./data/requests2.json", JSON.stringify(requests2));
  fs.writeFileSync(
    "./data/search-customers.json",
    JSON.stringify(searchCustomersRequests)
  );
  fs.writeFileSync(
    "./data/serch-products.json",
    JSON.stringify(searchProductRequests)
  );
  fs.writeFileSync("./data/orders.json", JSON.stringify(ordersFull));
  fs.writeFileSync(
    "./data/products.json",
    JSON.stringify(productsWithSuppliers)
  );

  process.exit(0);
};
main();
