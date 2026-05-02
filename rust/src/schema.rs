// @generated automatically by Diesel CLI.

diesel::table! {
    customers (id) {
        id -> Int4,
        company_name -> Text,
        contact_name -> Varchar,
        contact_title -> Varchar,
        address -> Varchar,
        city -> Varchar,
        postal_code -> Nullable<Varchar>,
        region -> Nullable<Varchar>,
        country -> Varchar,
        phone -> Varchar,
        fax -> Nullable<Varchar>,
    }
}

diesel::table! {
    employees (id) {
        id -> Int4,
        last_name -> Varchar,
        first_name -> Nullable<Varchar>,
        title -> Varchar,
        title_of_courtesy -> Varchar,
        birth_date -> Date,
        hire_date -> Date,
        address -> Varchar,
        city -> Varchar,
        postal_code -> Varchar,
        country -> Varchar,
        home_phone -> Varchar,
        extension -> Int4,
        notes -> Text,
        recipient_id -> Nullable<Int4>,
    }
}

diesel::table! {
    order_details (id) {
        unit_price -> Float8,
        quantity -> Int4,
        discount -> Float8,
        order_id -> Int4,
        product_id -> Int4,
        id -> Int8,
    }
}

diesel::table! {
    orders (id) {
        id -> Int4,
        order_date -> Date,
        required_date -> Date,
        shipped_date -> Nullable<Date>,
        ship_via -> Int4,
        freight -> Float8,
        ship_name -> Varchar,
        ship_city -> Varchar,
        ship_region -> Nullable<Varchar>,
        ship_postal_code -> Nullable<Varchar>,
        ship_country -> Varchar,
        customer_id -> Int4,
        employee_id -> Int4,
    }
}

diesel::table! {
    products (id) {
        id -> Int4,
        name -> Text,
        qt_per_unit -> Varchar,
        unit_price -> Float8,
        units_in_stock -> Int4,
        units_on_order -> Int4,
        reorder_level -> Int4,
        discontinued -> Int4,
        supplier_id -> Int4,
    }
}

diesel::table! {
    suppliers (id) {
        id -> Int4,
        company_name -> Varchar,
        contact_name -> Varchar,
        contact_title -> Varchar,
        address -> Varchar,
        city -> Varchar,
        region -> Nullable<Varchar>,
        postal_code -> Varchar,
        country -> Varchar,
        phone -> Varchar,
    }
}

diesel::joinable!(order_details -> orders (order_id));
diesel::joinable!(order_details -> products (product_id));
diesel::joinable!(orders -> customers (customer_id));
diesel::joinable!(orders -> employees (employee_id));
diesel::joinable!(products -> suppliers (supplier_id));

diesel::allow_tables_to_appear_in_same_query!(
    customers,
    employees,
    order_details,
    orders,
    products,
    suppliers,
);
