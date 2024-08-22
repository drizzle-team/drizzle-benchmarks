import { InferModel, relations } from 'drizzle-orm';
import { sqliteTable, foreignKey, integer, index, text, numeric } from 'drizzle-orm/sqlite-core';

export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({
    autoIncrement: true,
  }),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name').notNull(),
  contactTitle: text('contact_title').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  postalCode: text('postal_code'),
  region: text('region'),
  country: text('country').notNull(),
  phone: text('phone').notNull(),
  fax: text('fax'),
});

export const employees = sqliteTable(
  'employees',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),
    lastName: text('last_name').notNull(),
    firstName: text('first_name'),
    title: text('title').notNull(),
    titleOfCourtesy: text('title_of_courtesy').notNull(),
    birthDate: integer('birth_date', { mode: 'timestamp' }).notNull(),
    hireDate: integer('hire_date', { mode: 'timestamp' }).notNull(),
    address: text('address').notNull(),
    city: text('city').notNull(),
    postalCode: text('postal_code').notNull(),
    country: text('country').notNull(),
    homePhone: text('home_phone').notNull(),
    extension: integer('extension').notNull(),
    notes: text('notes').notNull(),
    recipientId: integer('recipient_id'),
  },
  (table) => ({
    recipientFk: foreignKey({
      columns: [table.recipientId],
      foreignColumns: [table.id],
    }),
    recepientIdx: index('recepient_idx').on(table.recipientId),
  }),
);

export const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({
    autoIncrement: true,
  }),
  orderDate: integer('order_date', { mode: 'timestamp' }).notNull(),
  requiredDate: integer('required_date', { mode: 'timestamp' }).notNull(),
  shippedDate: integer('shipped_date', { mode: 'timestamp' }),
  shipVia: integer('ship_via').notNull(),
  freight: numeric('freight').notNull(),
  shipName: text('ship_name').notNull(),
  shipCity: text('ship_city').notNull(),
  shipRegion: text('ship_region'),
  shipPostalCode: text('ship_postal_code'),
  shipCountry: text('ship_country').notNull(),

  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),

  employeeId: integer('employee_id')
    .notNull()
    .references(() => employees.id, { onDelete: 'cascade' }),
});

export const suppliers = sqliteTable('suppliers', {
  id: integer('id').primaryKey({
    autoIncrement: true,
  }),
  companyName: text('company_name').notNull(),
  contactName: text('contact_name').notNull(),
  contactTitle: text('contact_title').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  region: text('region'),
  postalCode: text('postal_code').notNull(),
  country: text('country').notNull(),
  phone: text('phone').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),
    name: text('name').notNull(),
    quantityPerUnit: text('qt_per_unit').notNull(),
    unitPrice: numeric('unit_price').notNull(),
    unitsInStock: integer('units_in_stock').notNull(),
    unitsOnOrder: integer('units_on_order').notNull(),
    reorderLevel: integer('reorder_level').notNull(),
    discontinued: integer('discontinued').notNull(),

    supplierId: integer('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
  },
  (table) => {
    return {
      supplierIdx: index('supplier_idx').on(table.supplierId),
    };
  },
);

export const details = sqliteTable(
  'order_details',
  {
    unitPrice: numeric('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    discount: numeric('discount').notNull(),

    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),

    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => {
    return {
      orderIdIdx: index('order_id_idx').on(t.orderId),
      productIdIdx: index('product_id_idx').on(t.productId),
    };
  },
);

export const ordersRelations = relations(orders, (r) => {
  return {
    details: r.many(details),
    // products: r.many(products)
  };
});

export const detailsRelations = relations(details, (r) => {
  return {
    order: r.one(orders, {
      fields: [details.orderId],
      references: [orders.id],
    }),
    product: r.one(products, {
      fields: [details.productId],
      references: [products.id],
    }),
  };
});

export const employeesRelations = relations(employees, (r) => {
  return {
    recipient: r.one(employees, {
      fields: [employees.recipientId],
      references: [employees.id],
    }),
  };
});

export const productsRelations = relations(products, (r) => {
  return {
    supplier: r.one(suppliers, {
      fields: [products.supplierId],
      references: [suppliers.id],
    }),
  };
});

export type Customer = InferModel<typeof customers>;
export type CustomerInsert = InferModel<typeof customers, 'insert'>;
export type Employee = InferModel<typeof employees>;
export type EmployeeInsert = InferModel<typeof employees, 'insert'>;
export type Order = InferModel<typeof orders>;
export type OrderInsert = InferModel<typeof orders, 'insert'>;
export type Supplier = InferModel<typeof suppliers>;
export type SupplierInsert = InferModel<typeof suppliers, 'insert'>;
export type Product = InferModel<typeof products>;
export type ProductInsert = InferModel<typeof products, 'insert'>;
export type Detail = InferModel<typeof details>;
export type DetailInsert = InferModel<typeof details, 'insert'>;
