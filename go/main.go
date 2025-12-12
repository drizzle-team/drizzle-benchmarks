package main

import (
	"context"
	"os"
	"os/signal"
	"perf-drizzle/go/db"
	"syscall"
	"unsafe"

	"github.com/bytedance/sonic"
	"github.com/gofiber/fiber/v3"
	"github.com/valyala/fasthttp"
)

func b2s(b []byte) string {
	return *(*string)(unsafe.Pointer(&b))
}

func getInt32(c fiber.Ctx, key string) int32 {
	val := c.Request().URI().QueryArgs().Peek(key)
	if len(val) == 0 {
		return 0
	}

	n, err := fasthttp.ParseUint(val)
	if err != nil {
		return 0
	}

	return int32(n)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseUrl := os.Getenv("DATABASE_URL")
	if databaseUrl == "" {
		panic("DATABASE_URL is not set")
	}

	pg, err := db.NewDatabase(databaseUrl)
	if err != nil {
		panic(err)
	}

	app := fiber.New(fiber.Config{
		JSONEncoder: sonic.ConfigDefault.Marshal,
		JSONDecoder: sonic.ConfigDefault.Unmarshal,
	})

	app.Get("/customers", func(c fiber.Ctx) error {
		rows, err := pg.Customers(c.Context(), db.CustomersParams{
			Limit:  getInt32(c, "limit"),
			Offset: getInt32(c, "offset"),
		})
		if err != nil {
			return err
		}

		return c.JSON(rows)
	})

	app.Get("/customer-by-id", func(c fiber.Ctx) error {
		row, err := pg.CustomerById(c.Context(), getInt32(c, "id"))
		if err != nil {
			return err
		}

		return c.JSON(row)
	})

	app.Get("/search-customer", func(c fiber.Ctx) error {
		term := b2s(c.Request().URI().QueryArgs().Peek("term"))

		rows, err := pg.SearchCustomer(c.Context(), term+":*")
		if err != nil {
			return err
		}

		return c.JSON(rows)
	})

	app.Get("/employees", func(c fiber.Ctx) error {
		rows, err := pg.Employees(c.Context(), db.EmployeesParams{
			Limit:  getInt32(c, "limit"),
			Offset: getInt32(c, "offset"),
		})
		if err != nil {
			return err
		}

		return c.JSON(rows)
	})

	app.Get("/employee-with-recipient", func(c fiber.Ctx) error {
		row, err := pg.EmployeeWithRecipient(c.Context(), getInt32(c, "id"))
		if err != nil {
			return err
		}

		return c.JSON(row)
	})

	app.Get("/suppliers", func(c fiber.Ctx) error {
		rows, err := pg.Suppliers(c.Context(), db.SuppliersParams{
			Limit:  getInt32(c, "limit"),
			Offset: getInt32(c, "offset"),
		})
		if err != nil {
			return err
		}

		return c.JSON(rows)
	})

	app.Get("/supplier-by-id", func(c fiber.Ctx) error {
		row, err := pg.SupplierById(c.Context(), getInt32(c, "id"))
		if err != nil {
			return err
		}

		return c.JSON(row)
	})

	app.Get("/products", func(c fiber.Ctx) error {
		rows, err := pg.Products(c.Context(), db.ProductsParams{
			Limit:  getInt32(c, "limit"),
			Offset: getInt32(c, "offset"),
		})
		if err != nil {
			return err
		}

		return c.JSON(rows)
	})

	app.Get("/product-with-supplier", func(c fiber.Ctx) error {
		row, err := pg.ProductWithSupplier(c.Context(), getInt32(c, "id"))
		if err != nil {
			return err
		}

		return c.JSON(row)
	})

	app.Get("/search-product", func(c fiber.Ctx) error {
		term := b2s(c.Request().URI().QueryArgs().Peek("term"))

		rows, err := pg.SearchProduct(c.Context(), term+":*")
		if err != nil {
			return err
		}

		return c.JSON(rows)
	})

	app.Get("/orders-with-details", func(c fiber.Ctx) error {
		rows, err := pg.OrdersWithDetails(c.Context(), db.OrdersWithDetailsParams{
			Limit:  getInt32(c, "limit"),
			Offset: getInt32(c, "offset"),
		})
		if err != nil {
			return err
		}

		return c.JSON(rows)
	})

	app.Get("/order-with-details", func(c fiber.Ctx) error {
		row, err := pg.OrderWithDetails(c.Context(), getInt32(c, "id"))
		if err != nil {
			return err
		}

		return c.JSON(row)
	})

	app.Get("/order-with-details-and-products", func(c fiber.Ctx) error {
		row, err := pg.OrderWithDetailsAndProducts(c.Context(), getInt32(c, "id"))
		if err != nil {
			return err
		}

		return c.JSON(row)
	})

	go func() {
		if err := app.Listen(":3002"); err != nil {
			panic(err)
		}
	}()

	<-ctx.Done()

	pg.Close()
	app.Shutdown()
}
