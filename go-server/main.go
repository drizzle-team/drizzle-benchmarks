package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valyala/fasthttp"
)

var pool *pgxpool.Pool

// Models
type Customer struct {
	ID           int     `json:"id"`
	CompanyName  string  `json:"companyName"`
	ContactName  string  `json:"contactName"`
	ContactTitle string  `json:"contactTitle"`
	Address      string  `json:"address"`
	City         string  `json:"city"`
	PostalCode   *string `json:"postalCode"`
	Region       *string `json:"region"`
	Country      string  `json:"country"`
	Phone        string  `json:"phone"`
	Fax          *string `json:"fax"`
}

type Employee struct {
	ID              int        `json:"id"`
	LastName        string     `json:"lastName"`
	FirstName       *string    `json:"firstName"`
	Title           string     `json:"title"`
	TitleOfCourtesy string     `json:"titleOfCourtesy"`
	BirthDate       time.Time  `json:"birthDate"`
	HireDate        time.Time  `json:"hireDate"`
	Address         string     `json:"address"`
	City            string     `json:"city"`
	PostalCode      string     `json:"postalCode"`
	Country         string     `json:"country"`
	HomePhone       string     `json:"homePhone"`
	Extension       int        `json:"extension"`
	Notes           string     `json:"notes"`
	RecipientID     *int       `json:"recipientId"`
	Recipient       *Employee  `json:"recipient,omitempty"`
}

type Supplier struct {
	ID           int     `json:"id"`
	CompanyName  string  `json:"companyName"`
	ContactName  string  `json:"contactName"`
	ContactTitle string  `json:"contactTitle"`
	Address      string  `json:"address"`
	City         string  `json:"city"`
	Region       *string `json:"region"`
	PostalCode   string  `json:"postalCode"`
	Country      string  `json:"country"`
	Phone        string  `json:"phone"`
}

type Product struct {
	ID              int       `json:"id"`
	Name            string    `json:"name"`
	QuantityPerUnit string    `json:"quantityPerUnit"`
	UnitPrice       float64   `json:"unitPrice"`
	UnitsInStock    int       `json:"unitsInStock"`
	UnitsOnOrder    int       `json:"unitsOnOrder"`
	ReorderLevel    int       `json:"reorderLevel"`
	Discontinued    int       `json:"discontinued"`
	SupplierID      int       `json:"supplierId"`
	Supplier        *Supplier `json:"supplier,omitempty"`
}

type OrderWithDetails struct {
	ID            int        `json:"id"`
	ShippedDate   *time.Time `json:"shippedDate"`
	ShipName      string     `json:"shipName"`
	ShipCity      string     `json:"shipCity"`
	ShipCountry   string     `json:"shipCountry"`
	ProductsCount int        `json:"productsCount"`
	QuantitySum   int        `json:"quantitySum"`
	TotalPrice    float64    `json:"totalPrice"`
}

type OrderDetail struct {
	UnitPrice float64  `json:"unitPrice"`
	Quantity  int      `json:"quantity"`
	Discount  float64  `json:"discount"`
	OrderID   int      `json:"orderId"`
	ProductID int      `json:"productId"`
	Product   *Product `json:"product,omitempty"`
}

type Order struct {
	ID        int           `json:"id"`
	Details   []OrderDetail `json:"details,omitempty"`
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU())

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5435/postgres"
	}

	config, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatal("Unable to parse DATABASE_URL:", err)
	}

	// Optimize pool settings for high concurrency
	config.MaxConns = int32(runtime.NumCPU() * 4)
	config.MinConns = int32(runtime.NumCPU() * 2)
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 30 * time.Minute
	config.HealthCheckPeriod = time.Minute
	config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe

	pool, err = pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		log.Fatal("Unable to create connection pool:", err)
	}
	defer pool.Close()

	// Test connection
	if err := pool.Ping(context.Background()); err != nil {
		log.Fatal("Unable to ping database:", err)
	}

	fmt.Printf("Go server starting on :3000 with %d CPUs\n", runtime.NumCPU())

	// Use fasthttp for maximum performance
	if err := fasthttp.ListenAndServe(":3000", requestHandler); err != nil {
		log.Fatal("Error in ListenAndServe:", err)
	}
}

func requestHandler(ctx *fasthttp.RequestCtx) {
	path := string(ctx.Path())

	ctx.Response.Header.Set("Content-Type", "application/json")

	switch path {
	case "/customers":
		handleCustomers(ctx)
	case "/customer-by-id":
		handleCustomerByID(ctx)
	case "/search-customer":
		handleSearchCustomer(ctx)
	case "/employees":
		handleEmployees(ctx)
	case "/employee-with-recipient":
		handleEmployeeWithRecipient(ctx)
	case "/suppliers":
		handleSuppliers(ctx)
	case "/supplier-by-id":
		handleSupplierByID(ctx)
	case "/products":
		handleProducts(ctx)
	case "/product-with-supplier":
		handleProductWithSupplier(ctx)
	case "/search-product":
		handleSearchProduct(ctx)
	case "/orders-with-details":
		handleOrdersWithDetails(ctx)
	case "/order-with-details":
		handleOrderWithDetails(ctx)
	case "/order-with-details-and-products":
		handleOrderWithDetailsAndProducts(ctx)
	default:
		ctx.SetStatusCode(404)
		ctx.WriteString(`{"error": "not found"}`)
	}
}

func handleCustomers(ctx *fasthttp.RequestCtx) {
	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))

	rows, err := pool.Query(context.Background(), `
		SELECT id, company_name, contact_name, contact_title, address, city,
		       postal_code, region, country, phone, fax
		FROM customers ORDER BY id ASC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	customers := make([]Customer, 0)
	for rows.Next() {
		var c Customer
		err := rows.Scan(&c.ID, &c.CompanyName, &c.ContactName, &c.ContactTitle,
			&c.Address, &c.City, &c.PostalCode, &c.Region, &c.Country, &c.Phone, &c.Fax)
		if err != nil {
			continue
		}
		customers = append(customers, c)
	}

	json.NewEncoder(ctx).Encode(customers)
}

func handleCustomerByID(ctx *fasthttp.RequestCtx) {
	id := string(ctx.QueryArgs().Peek("id"))

	var c Customer
	err := pool.QueryRow(context.Background(), `
		SELECT id, company_name, contact_name, contact_title, address, city,
		       postal_code, region, country, phone, fax
		FROM customers WHERE id = $1`, id).Scan(
		&c.ID, &c.CompanyName, &c.ContactName, &c.ContactTitle,
		&c.Address, &c.City, &c.PostalCode, &c.Region, &c.Country, &c.Phone, &c.Fax)
	if err != nil {
		if err == pgx.ErrNoRows {
			ctx.WriteString("null")
			return
		}
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}

	json.NewEncoder(ctx).Encode(c)
}

func handleSearchCustomer(ctx *fasthttp.RequestCtx) {
	term := string(ctx.QueryArgs().Peek("term")) + ":*"

	rows, err := pool.Query(context.Background(), `
		SELECT id, company_name, contact_name, contact_title, address, city,
		       postal_code, region, country, phone, fax
		FROM customers
		WHERE to_tsvector('english', company_name) @@ to_tsquery('english', $1)`, term)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	customers := make([]Customer, 0)
	for rows.Next() {
		var c Customer
		err := rows.Scan(&c.ID, &c.CompanyName, &c.ContactName, &c.ContactTitle,
			&c.Address, &c.City, &c.PostalCode, &c.Region, &c.Country, &c.Phone, &c.Fax)
		if err != nil {
			continue
		}
		customers = append(customers, c)
	}

	json.NewEncoder(ctx).Encode(customers)
}

func handleEmployees(ctx *fasthttp.RequestCtx) {
	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))

	rows, err := pool.Query(context.Background(), `
		SELECT id, last_name, first_name, title, title_of_courtesy, birth_date,
		       hire_date, address, city, postal_code, country, home_phone,
		       extension, notes, recipient_id
		FROM employees ORDER BY id ASC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	employees := make([]Employee, 0)
	for rows.Next() {
		var e Employee
		err := rows.Scan(&e.ID, &e.LastName, &e.FirstName, &e.Title, &e.TitleOfCourtesy,
			&e.BirthDate, &e.HireDate, &e.Address, &e.City, &e.PostalCode, &e.Country,
			&e.HomePhone, &e.Extension, &e.Notes, &e.RecipientID)
		if err != nil {
			continue
		}
		employees = append(employees, e)
	}

	json.NewEncoder(ctx).Encode(employees)
}

func handleEmployeeWithRecipient(ctx *fasthttp.RequestCtx) {
	id := string(ctx.QueryArgs().Peek("id"))

	rows, err := pool.Query(context.Background(), `
		SELECT e.id, e.last_name, e.first_name, e.title, e.title_of_courtesy, e.birth_date,
		       e.hire_date, e.address, e.city, e.postal_code, e.country, e.home_phone,
		       e.extension, e.notes, e.recipient_id,
		       r.id, r.last_name, r.first_name, r.title, r.title_of_courtesy, r.birth_date,
		       r.hire_date, r.address, r.city, r.postal_code, r.country, r.home_phone,
		       r.extension, r.notes, r.recipient_id
		FROM employees e
		LEFT JOIN employees r ON e.recipient_id = r.id
		WHERE e.id = $1`, id)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	employees := make([]Employee, 0)
	for rows.Next() {
		var e Employee
		var rID, rExtension *int
		var rLastName, rTitle, rTitleOfCourtesy, rAddress, rCity, rPostalCode, rCountry, rHomePhone, rNotes *string
		var rFirstName *string
		var rBirthDate, rHireDate *time.Time
		var rRecipientID *int

		err := rows.Scan(&e.ID, &e.LastName, &e.FirstName, &e.Title, &e.TitleOfCourtesy,
			&e.BirthDate, &e.HireDate, &e.Address, &e.City, &e.PostalCode, &e.Country,
			&e.HomePhone, &e.Extension, &e.Notes, &e.RecipientID,
			&rID, &rLastName, &rFirstName, &rTitle, &rTitleOfCourtesy,
			&rBirthDate, &rHireDate, &rAddress, &rCity, &rPostalCode, &rCountry,
			&rHomePhone, &rExtension, &rNotes, &rRecipientID)
		if err != nil {
			continue
		}

		if rID != nil {
			e.Recipient = &Employee{
				ID:              *rID,
				LastName:        *rLastName,
				FirstName:       rFirstName,
				Title:           *rTitle,
				TitleOfCourtesy: *rTitleOfCourtesy,
				BirthDate:       *rBirthDate,
				HireDate:        *rHireDate,
				Address:         *rAddress,
				City:            *rCity,
				PostalCode:      *rPostalCode,
				Country:         *rCountry,
				HomePhone:       *rHomePhone,
				Extension:       *rExtension,
				Notes:           *rNotes,
				RecipientID:     rRecipientID,
			}
		}
		employees = append(employees, e)
	}

	json.NewEncoder(ctx).Encode(employees)
}

func handleSuppliers(ctx *fasthttp.RequestCtx) {
	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))

	rows, err := pool.Query(context.Background(), `
		SELECT id, company_name, contact_name, contact_title, address, city,
		       region, postal_code, country, phone
		FROM suppliers ORDER BY id ASC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	suppliers := make([]Supplier, 0)
	for rows.Next() {
		var s Supplier
		err := rows.Scan(&s.ID, &s.CompanyName, &s.ContactName, &s.ContactTitle,
			&s.Address, &s.City, &s.Region, &s.PostalCode, &s.Country, &s.Phone)
		if err != nil {
			continue
		}
		suppliers = append(suppliers, s)
	}

	json.NewEncoder(ctx).Encode(suppliers)
}

func handleSupplierByID(ctx *fasthttp.RequestCtx) {
	id := string(ctx.QueryArgs().Peek("id"))

	var s Supplier
	err := pool.QueryRow(context.Background(), `
		SELECT id, company_name, contact_name, contact_title, address, city,
		       region, postal_code, country, phone
		FROM suppliers WHERE id = $1`, id).Scan(
		&s.ID, &s.CompanyName, &s.ContactName, &s.ContactTitle,
		&s.Address, &s.City, &s.Region, &s.PostalCode, &s.Country, &s.Phone)
	if err != nil {
		if err == pgx.ErrNoRows {
			ctx.WriteString("null")
			return
		}
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}

	json.NewEncoder(ctx).Encode(s)
}

func handleProducts(ctx *fasthttp.RequestCtx) {
	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))

	rows, err := pool.Query(context.Background(), `
		SELECT id, name, qt_per_unit, unit_price, units_in_stock,
		       units_on_order, reorder_level, discontinued, supplier_id
		FROM products ORDER BY id ASC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	products := make([]Product, 0)
	for rows.Next() {
		var p Product
		err := rows.Scan(&p.ID, &p.Name, &p.QuantityPerUnit, &p.UnitPrice,
			&p.UnitsInStock, &p.UnitsOnOrder, &p.ReorderLevel, &p.Discontinued, &p.SupplierID)
		if err != nil {
			continue
		}
		products = append(products, p)
	}

	json.NewEncoder(ctx).Encode(products)
}

func handleProductWithSupplier(ctx *fasthttp.RequestCtx) {
	id := string(ctx.QueryArgs().Peek("id"))

	rows, err := pool.Query(context.Background(), `
		SELECT p.id, p.name, p.qt_per_unit, p.unit_price, p.units_in_stock,
		       p.units_on_order, p.reorder_level, p.discontinued, p.supplier_id,
		       s.id, s.company_name, s.contact_name, s.contact_title, s.address,
		       s.city, s.region, s.postal_code, s.country, s.phone
		FROM products p
		LEFT JOIN suppliers s ON p.supplier_id = s.id
		WHERE p.id = $1`, id)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	products := make([]Product, 0)
	for rows.Next() {
		var p Product
		var s Supplier
		err := rows.Scan(&p.ID, &p.Name, &p.QuantityPerUnit, &p.UnitPrice,
			&p.UnitsInStock, &p.UnitsOnOrder, &p.ReorderLevel, &p.Discontinued, &p.SupplierID,
			&s.ID, &s.CompanyName, &s.ContactName, &s.ContactTitle,
			&s.Address, &s.City, &s.Region, &s.PostalCode, &s.Country, &s.Phone)
		if err != nil {
			continue
		}
		p.Supplier = &s
		products = append(products, p)
	}

	json.NewEncoder(ctx).Encode(products)
}

func handleSearchProduct(ctx *fasthttp.RequestCtx) {
	term := string(ctx.QueryArgs().Peek("term")) + ":*"

	rows, err := pool.Query(context.Background(), `
		SELECT id, name, qt_per_unit, unit_price, units_in_stock,
		       units_on_order, reorder_level, discontinued, supplier_id
		FROM products
		WHERE to_tsvector('english', name) @@ to_tsquery('english', $1)`, term)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	products := make([]Product, 0)
	for rows.Next() {
		var p Product
		err := rows.Scan(&p.ID, &p.Name, &p.QuantityPerUnit, &p.UnitPrice,
			&p.UnitsInStock, &p.UnitsOnOrder, &p.ReorderLevel, &p.Discontinued, &p.SupplierID)
		if err != nil {
			continue
		}
		products = append(products, p)
	}

	json.NewEncoder(ctx).Encode(products)
}

func handleOrdersWithDetails(ctx *fasthttp.RequestCtx) {
	limit, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("limit")))
	offset, _ := strconv.Atoi(string(ctx.QueryArgs().Peek("offset")))

	rows, err := pool.Query(context.Background(), `
		SELECT o.id, o.shipped_date, o.ship_name, o.ship_city, o.ship_country,
		       count(od.product_id)::int as products_count,
		       sum(od.quantity)::int as quantity_sum,
		       sum(od.quantity * od.unit_price)::real as total_price
		FROM orders o
		LEFT JOIN order_details od ON od.order_id = o.id
		GROUP BY o.id
		ORDER BY o.id ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	orders := make([]OrderWithDetails, 0)
	for rows.Next() {
		var o OrderWithDetails
		err := rows.Scan(&o.ID, &o.ShippedDate, &o.ShipName, &o.ShipCity, &o.ShipCountry,
			&o.ProductsCount, &o.QuantitySum, &o.TotalPrice)
		if err != nil {
			continue
		}
		orders = append(orders, o)
	}

	json.NewEncoder(ctx).Encode(orders)
}

func handleOrderWithDetails(ctx *fasthttp.RequestCtx) {
	id := string(ctx.QueryArgs().Peek("id"))

	rows, err := pool.Query(context.Background(), `
		SELECT o.id, o.shipped_date, o.ship_name, o.ship_city, o.ship_country,
		       count(od.product_id)::int as products_count,
		       sum(od.quantity)::int as quantity_sum,
		       sum(od.quantity * od.unit_price)::real as total_price
		FROM orders o
		LEFT JOIN order_details od ON od.order_id = o.id
		WHERE o.id = $1
		GROUP BY o.id
		ORDER BY o.id ASC`, id)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer rows.Close()

	orders := make([]OrderWithDetails, 0)
	for rows.Next() {
		var o OrderWithDetails
		err := rows.Scan(&o.ID, &o.ShippedDate, &o.ShipName, &o.ShipCity, &o.ShipCountry,
			&o.ProductsCount, &o.QuantitySum, &o.TotalPrice)
		if err != nil {
			continue
		}
		orders = append(orders, o)
	}

	json.NewEncoder(ctx).Encode(orders)
}

func handleOrderWithDetailsAndProducts(ctx *fasthttp.RequestCtx) {
	id := string(ctx.QueryArgs().Peek("id"))

	// First get the order
	rows, err := pool.Query(context.Background(), `
		SELECT o.id
		FROM orders o
		WHERE o.id = $1`, id)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}

	orders := make([]Order, 0)
	for rows.Next() {
		var o Order
		err := rows.Scan(&o.ID)
		if err != nil {
			continue
		}
		orders = append(orders, o)
	}
	rows.Close()

	if len(orders) == 0 {
		json.NewEncoder(ctx).Encode(orders)
		return
	}

	// Get details with products
	detailRows, err := pool.Query(context.Background(), `
		SELECT od.unit_price, od.quantity, od.discount, od.order_id, od.product_id,
		       p.id, p.name, p.qt_per_unit, p.unit_price, p.units_in_stock,
		       p.units_on_order, p.reorder_level, p.discontinued, p.supplier_id
		FROM order_details od
		LEFT JOIN products p ON od.product_id = p.id
		WHERE od.order_id = $1`, id)
	if err != nil {
		ctx.SetStatusCode(500)
		ctx.WriteString(`{"error": "` + err.Error() + `"}`)
		return
	}
	defer detailRows.Close()

	details := make([]OrderDetail, 0)
	for detailRows.Next() {
		var d OrderDetail
		var p Product
		err := detailRows.Scan(&d.UnitPrice, &d.Quantity, &d.Discount, &d.OrderID, &d.ProductID,
			&p.ID, &p.Name, &p.QuantityPerUnit, &p.UnitPrice,
			&p.UnitsInStock, &p.UnitsOnOrder, &p.ReorderLevel, &p.Discontinued, &p.SupplierID)
		if err != nil {
			continue
		}
		d.Product = &p
		details = append(details, d)
	}

	orders[0].Details = details
	json.NewEncoder(ctx).Encode(orders)
}
