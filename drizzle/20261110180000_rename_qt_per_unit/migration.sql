-- schema.ts maps quantityPerUnit to "quantity_per_unit" (snakeCase); the first migration named it "qt_per_unit"
ALTER TABLE "products" RENAME COLUMN "qt_per_unit" TO "quantity_per_unit";
