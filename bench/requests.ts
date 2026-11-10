// The benchmark request mix, generated deterministically at runtime (replaces the old
// src/generate.ts → data/requests.json). Ids are drawn from the seeded tables (1..N).
// Pure function of (seed, iter): every run and every target gets the identical sequence.
// Imports random.ts directly (not the bunload index) so Node tools like src/test.ts can use it.
import { mix, type Route } from '../bunload/src/random';

// keep in sync with src/seed.ts
export const sizes = {
  nano: { employees: 50, customers: 1000, orders: 5000, products: 500, suppliers: 100 },
  micro: { employees: 200, customers: 10000, orders: 50000, products: 5000, suppliers: 1000 },
} as const;

// prettier-ignore
const customerSearches = [
  've', 'ey', 'or', 'bb', 'te', 'ab', 'ca', 'ki', 'ap', 'be', 'ct', 'hi', 'er', 'pr', 'pi', 'en', 'au',
  'ra', 'ti', 'ke', 'ou', 'ur', 'me', 'ea', 'op', 'at', 'ne', 'na', 'os', 'ri', 'on', 'ha', 'il', 'to',
  'as', 'io', 'di', 'zy', 'az', 'la', 'ko', 'st', 'gh', 'ug', 'ac', 'cc', 'ch', 'hu', 're', 'an',
];
// prettier-ignore
const productSearches = [
  'ha', 'ey', 'or', 'po', 'te', 'ab', 'er', 'ke', 'ap', 'be', 'en', 'au', 'ra', 'ti', 'su', 'sa', 'hi',
  'nu', 'ge', 'pi', 'ou', 'ur', 'me', 'ea', 'tu', 'at', 'ne', 'na', 'os', 'ri', 'on', 'ka', 'il', 'to',
  'as', 'io', 'di', 'za', 'fa', 'la', 'ko', 'st', 'gh', 'ug', 'ac', 'cc', 'ch', 'pa', 're', 'an',
];

export interface RequestsOptions {
  seed?: number;
  size?: keyof typeof sizes;
  /** include /search-* endpoints (the published benchmarks exclude them). Default false. */
  search?: boolean;
}

/** Page offsets: page = 1 + floor(pages * rand), offset = (page - 1) * limit. */
const page = (total: number, limit: number) => (r: { next(): number }) =>
  Math.floor((total / limit) * r.next()) * limit;

export function routes({ size = 'micro', search = false }: RequestsOptions = {}): Route[] {
  const n = sizes[size];
  const customersPage = page(10000, 50);
  const employeesPage = page(100, 20);
  const suppliersPage = page(10000, 50); // kept from the original generator: only 1000 suppliers → mostly empty pages
  const productsPage = page(1000, 50);
  const ordersPage = page(830, 50);
  const s = search ? 1 : 0;
  // weights = request counts of the original 1M-request file
  return [
    { weight: 20_000, path: (r) => `/customer-by-id?id=${r.int(1, n.customers)}` },
    { weight: 5_000 * s, path: (r) => `/search-customer?term=${r.pick(customerSearches)}` },
    { weight: 50_000 * s, path: (r) => `/search-product?term=${r.pick(productSearches)}` },
    { weight: 5_000, path: (r) => `/employee-with-recipient?id=${r.int(1, n.employees)}` },
    { weight: 30_000, path: (r) => `/supplier-by-id?id=${r.int(1, n.suppliers)}` },
    { weight: 100_000, path: (r) => `/product-with-supplier?id=${r.int(1, n.products)}` },
    { weight: 100_000, path: (r) => `/order-with-details?id=${r.int(1, n.orders)}` },
    { weight: 100_000, path: (r) => `/order-with-details-and-products?id=${r.int(1, n.orders)}` },
    { weight: 2_000, path: (r) => `/customers?limit=50&offset=${customersPage(r)}` },
    { weight: 1_000, path: (r) => `/employees?limit=20&offset=${employeesPage(r)}` },
    { weight: 1_000, path: (r) => `/suppliers?limit=50&offset=${suppliersPage(r)}` },
    { weight: 3_000, path: (r) => `/products?limit=50&offset=${productsPage(r)}` },
    { weight: 10_000, path: (r) => `/orders-with-details?limit=50&offset=${ordersPage(r)}` },
  ];
}

/** `path(iter)` for run(): deterministic drizzle-benchmarks request mix. */
export const requests = (opts: RequestsOptions = {}) => mix(routes(opts), { seed: opts.seed ?? 1 });
