import { defineRelations } from "drizzle-orm-beta";
import * as schema from "./schema-beta";

export const relations = defineRelations(schema, (r) => ({
    orders: {
        details: r.many.details()
    },
    details: {
        order: r.one.orders({
            from: r.details.orderId,
            to: r.orders.id,
        }),
        product: r.one.products({
            from: r.details.productId,
            to: r.products.id,
        }),
    },
    employees: {
        recipient: r.one.employees({
            from: r.employees.recipientId,
            to: r.employees.id,
        }),
    },
    products: {
        supplier: r.one.suppliers({
            from: r.products.supplierId,
            to: r.suppliers.id,
        }),
    }
}));
