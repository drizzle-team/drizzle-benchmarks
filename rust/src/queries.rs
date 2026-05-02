use diesel::{
    dsl::{count, sum},
    prelude::*,
    sql_types::{Double, Text},
};
use diesel_async::{AsyncPgConnection, RunQueryDsl};
use serde::Serialize;

use crate::models::{Customer, Employee, Product, Supplier};
use crate::schema::{customers, employees, order_details, orders, products, suppliers};

#[derive(Queryable, Debug, Serialize)]
pub struct P11Row {
    pub id: i32,
    pub shipped_date: Option<chrono::NaiveDate>,
    pub ship_name: String,
    pub ship_city: String,
    pub ship_country: String,
    pub products_count: i64,
    pub quantity_sum: Option<i64>,
    pub total_price: Option<f64>,
}

pub async fn p11(
    conn: &mut AsyncPgConnection,
    limit_: i64,
    offset_: i64,
) -> QueryResult<Vec<P11Row>> {
    let qty_f64 = order_details::quantity
        .nullable()
        .cast::<diesel::sql_types::Nullable<Double>>();

    let unit_price = order_details::unit_price.nullable();

    let total_price_expr = sum(qty_f64 * unit_price);

    orders::table
        .left_join(order_details::table.on(order_details::order_id.eq(orders::id)))
        .group_by(orders::id)
        .select((
            orders::id,
            orders::shipped_date,
            orders::ship_name,
            orders::ship_city,
            orders::ship_country,
            count(order_details::product_id.nullable()),
            sum(order_details::quantity.nullable()),
            total_price_expr,
        ))
        .order_by(orders::id.asc())
        .limit(limit_)
        .offset(offset_)
        .load(conn)
        .await
}

// p1: Get customers with limit/offset, ordered by id asc
pub async fn p1(
    conn: &mut AsyncPgConnection,
    limit_: i64,
    offset_: i64,
) -> QueryResult<Vec<Customer>> {
    customers::table
        .order_by(customers::id.asc())
        .limit(limit_)
        .offset(offset_)
        .load(conn)
        .await
}

// p2: Find first customer by id
pub async fn p2(conn: &mut AsyncPgConnection, id_: i32) -> QueryResult<Option<Customer>> {
    customers::table
        .filter(customers::id.eq(id_))
        .first(conn)
        .await
        .optional()
}

// p3: Full-text search on customers.company_name
#[derive(QueryableByName, Debug, Serialize)]
#[diesel(table_name = customers)]
pub struct CustomerSearchResult {
    pub id: i32,
    pub company_name: String,
    pub contact_name: String,
    pub contact_title: String,
    pub address: String,
    pub city: String,
    pub postal_code: Option<String>,
    pub region: Option<String>,
    pub country: String,
    pub phone: String,
    pub fax: Option<String>,
}

pub async fn p3(
    conn: &mut AsyncPgConnection,
    term: &str,
) -> QueryResult<Vec<CustomerSearchResult>> {
    diesel::sql_query(
        "SELECT * FROM customers WHERE to_tsvector('english', company_name) @@ to_tsquery('english', $1)"
    )
    .bind::<Text, _>(term)
    .load(conn)
    .await
}

// p4: Get employees with limit/offset, ordered by id asc
pub async fn p4(
    conn: &mut AsyncPgConnection,
    limit_: i64,
    offset_: i64,
) -> QueryResult<Vec<Employee>> {
    employees::table
        .order_by(employees::id.asc())
        .limit(limit_)
        .offset(offset_)
        .load(conn)
        .await
}

// p5: Get employee with recipient (self-join), filtered by id
#[derive(Queryable, Debug, Serialize)]
pub struct EmployeeWithRecipient {
    pub id: i32,
    pub last_name: String,
    pub first_name: Option<String>,
    pub title: String,
    pub title_of_courtesy: String,
    pub birth_date: chrono::NaiveDate,
    pub hire_date: chrono::NaiveDate,
    pub address: String,
    pub city: String,
    pub postal_code: String,
    pub country: String,
    pub home_phone: String,
    pub extension: i32,
    pub notes: String,
    pub recipient_id: Option<i32>,
    // Recipient fields (nullable because of LEFT JOIN)
    pub recipient_employee_id: Option<i32>,
    pub recipient_last_name: Option<String>,
    pub recipient_first_name: Option<String>,
    pub recipient_title: Option<String>,
    pub recipient_title_of_courtesy: Option<String>,
    pub recipient_birth_date: Option<chrono::NaiveDate>,
    pub recipient_hire_date: Option<chrono::NaiveDate>,
    pub recipient_address: Option<String>,
    pub recipient_city: Option<String>,
    pub recipient_postal_code: Option<String>,
    pub recipient_country: Option<String>,
    pub recipient_home_phone: Option<String>,
    pub recipient_extension: Option<i32>,
    pub recipient_notes: Option<String>,
    pub recipient_recipient_id: Option<i32>,
}

pub async fn p5(
    conn: &mut AsyncPgConnection,
    id_: i32,
) -> QueryResult<Option<EmployeeWithRecipient>> {
    let recipient = diesel::alias!(employees as recipient);

    employees::table
        .left_join(
            recipient.on(employees::recipient_id.eq(recipient.field(employees::id).nullable())),
        )
        .filter(employees::id.eq(id_))
        .select((
            employees::id,
            employees::last_name,
            employees::first_name,
            employees::title,
            employees::title_of_courtesy,
            employees::birth_date,
            employees::hire_date,
            employees::address,
            employees::city,
            employees::postal_code,
            employees::country,
            employees::home_phone,
            employees::extension,
            employees::notes,
            employees::recipient_id,
            recipient.field(employees::id).nullable(),
            recipient.field(employees::last_name).nullable(),
            recipient.field(employees::first_name).nullable(),
            recipient.field(employees::title).nullable(),
            recipient.field(employees::title_of_courtesy).nullable(),
            recipient.field(employees::birth_date).nullable(),
            recipient.field(employees::hire_date).nullable(),
            recipient.field(employees::address).nullable(),
            recipient.field(employees::city).nullable(),
            recipient.field(employees::postal_code).nullable(),
            recipient.field(employees::country).nullable(),
            recipient.field(employees::home_phone).nullable(),
            recipient.field(employees::extension).nullable(),
            recipient.field(employees::notes).nullable(),
            recipient.field(employees::recipient_id).nullable(),
        ))
        .first(conn)
        .await
        .optional()
}

// p6: Get suppliers with limit/offset, ordered by id asc
pub async fn p6(
    conn: &mut AsyncPgConnection,
    limit_: i64,
    offset_: i64,
) -> QueryResult<Vec<Supplier>> {
    suppliers::table
        .order_by(suppliers::id.asc())
        .limit(limit_)
        .offset(offset_)
        .load(conn)
        .await
}

// p7: Find first supplier by id
pub async fn p7(conn: &mut AsyncPgConnection, id_: i32) -> QueryResult<Option<Supplier>> {
    suppliers::table
        .filter(suppliers::id.eq(id_))
        .first(conn)
        .await
        .optional()
}

// p8: Get products with limit/offset, ordered by id asc
pub async fn p8(
    conn: &mut AsyncPgConnection,
    limit_: i64,
    offset_: i64,
) -> QueryResult<Vec<Product>> {
    products::table
        .order_by(products::id.asc())
        .limit(limit_)
        .offset(offset_)
        .load(conn)
        .await
}

// p9: Get product with supplier (join), filtered by id
#[derive(Queryable, Debug, Serialize)]
pub struct ProductWithSupplier {
    pub id: i32,
    pub name: String,
    pub qt_per_unit: String,
    pub unit_price: f64,
    pub units_in_stock: i32,
    pub units_on_order: i32,
    pub reorder_level: i32,
    pub discontinued: i32,
    pub supplier_id: i32,
    // Supplier fields
    pub supplier_supplier_id: i32,
    pub supplier_company_name: String,
    pub supplier_contact_name: String,
    pub supplier_contact_title: String,
    pub supplier_address: String,
    pub supplier_city: String,
    pub supplier_region: Option<String>,
    pub supplier_postal_code: String,
    pub supplier_country: String,
    pub supplier_phone: String,
}

pub async fn p9(
    conn: &mut AsyncPgConnection,
    id_: i32,
) -> QueryResult<Option<ProductWithSupplier>> {
    products::table
        .inner_join(suppliers::table)
        .filter(products::id.eq(id_))
        .select((
            products::id,
            products::name,
            products::qt_per_unit,
            products::unit_price,
            products::units_in_stock,
            products::units_on_order,
            products::reorder_level,
            products::discontinued,
            products::supplier_id,
            suppliers::id,
            suppliers::company_name,
            suppliers::contact_name,
            suppliers::contact_title,
            suppliers::address,
            suppliers::city,
            suppliers::region,
            suppliers::postal_code,
            suppliers::country,
            suppliers::phone,
        ))
        .first(conn)
        .await
        .optional()
}

// p10: Full-text search on products.name
#[derive(QueryableByName, Debug, Serialize)]
#[diesel(table_name = products)]
pub struct ProductSearchResult {
    pub id: i32,
    pub name: String,
    pub qt_per_unit: String,
    pub unit_price: f64,
    pub units_in_stock: i32,
    pub units_on_order: i32,
    pub reorder_level: i32,
    pub discontinued: i32,
    pub supplier_id: i32,
}

pub async fn p10(
    conn: &mut AsyncPgConnection,
    term: &str,
) -> QueryResult<Vec<ProductSearchResult>> {
    diesel::sql_query(
        "SELECT * FROM products WHERE to_tsvector('english', name) @@ to_tsquery('english', $1)",
    )
    .bind::<Text, _>(term)
    .load(conn)
    .await
}

// p12: Get single order with details by id
pub async fn p12(conn: &mut AsyncPgConnection, id_: i32) -> QueryResult<Option<P11Row>> {
    let qty_f64 = order_details::quantity
        .nullable()
        .cast::<diesel::sql_types::Nullable<Double>>();

    let unit_price = order_details::unit_price.nullable();

    let total_price_expr = sum(qty_f64 * unit_price);

    orders::table
        .left_join(order_details::table.on(order_details::order_id.eq(orders::id)))
        .filter(orders::id.eq(id_))
        .group_by(orders::id)
        .select((
            orders::id,
            orders::shipped_date,
            orders::ship_name,
            orders::ship_city,
            orders::ship_country,
            count(order_details::product_id.nullable()),
            sum(order_details::quantity.nullable()),
            total_price_expr,
        ))
        .first(conn)
        .await
        .optional()
}

// p13: Get order with details and products by id
#[derive(Queryable, Debug, Serialize)]
pub struct OrderDetail {
    pub unit_price: f64,
    pub quantity: i32,
    pub discount: f64,
    pub order_id: i32,
    pub product_id: i32,
    pub id: i64,
    // Product fields
    pub product_product_id: i32,
    pub product_name: String,
    pub product_qt_per_unit: String,
    pub product_unit_price: f64,
    pub product_units_in_stock: i32,
    pub product_units_on_order: i32,
    pub product_reorder_level: i32,
    pub product_discontinued: i32,
    pub product_supplier_id: i32,
}

#[derive(Debug, Serialize)]
pub struct OrderWithDetailsAndProducts {
    pub id: i32,
    pub order_date: chrono::NaiveDate,
    pub required_date: chrono::NaiveDate,
    pub shipped_date: Option<chrono::NaiveDate>,
    pub ship_via: i32,
    pub freight: f64,
    pub ship_name: String,
    pub ship_city: String,
    pub ship_region: Option<String>,
    pub ship_postal_code: Option<String>,
    pub ship_country: String,
    pub customer_id: i32,
    pub employee_id: i32,
    pub details: Vec<OrderDetail>,
}

pub async fn p13(
    conn: &mut AsyncPgConnection,
    id_: i32,
) -> QueryResult<Option<OrderWithDetailsAndProducts>> {
    use crate::models::Order;

    let order: Option<Order> = orders::table
        .filter(orders::id.eq(id_))
        .first(conn)
        .await
        .optional()?;

    let order = match order {
        Some(o) => o,
        None => return Ok(None),
    };

    let details: Vec<OrderDetail> = order_details::table
        .inner_join(products::table)
        .filter(order_details::order_id.eq(id_))
        .select((
            order_details::unit_price,
            order_details::quantity,
            order_details::discount,
            order_details::order_id,
            order_details::product_id,
            order_details::id,
            products::id,
            products::name,
            products::qt_per_unit,
            products::unit_price,
            products::units_in_stock,
            products::units_on_order,
            products::reorder_level,
            products::discontinued,
            products::supplier_id,
        ))
        .load(conn)
        .await?;

    Ok(Some(OrderWithDetailsAndProducts {
        id: order.id,
        order_date: order.order_date,
        required_date: order.required_date,
        shipped_date: order.shipped_date,
        ship_via: order.ship_via,
        freight: order.freight,
        ship_name: order.ship_name,
        ship_city: order.ship_city,
        ship_region: order.ship_region,
        ship_postal_code: order.ship_postal_code,
        ship_country: order.ship_country,
        customer_id: order.customer_id,
        employee_id: order.employee_id,
        details,
    }))
}
