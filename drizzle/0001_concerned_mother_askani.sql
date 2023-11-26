-- Custom SQL migration file, put you code below! --

CREATE INDEX IF NOT EXISTS "customers_company_name_idx" ON "customers" USING GIN (to_tsvector('english', "company_name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_name_idx" ON "products" USING GIN (to_tsvector('english', "name"));--> statement-breakpoint