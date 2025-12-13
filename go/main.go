package main

import (
	"context"
	"math"
	"os"
	"os/signal"
	"perf-drizzle/go/db"
	"sync"
	"syscall"
	"unsafe"

	"github.com/bytedance/sonic"
	"github.com/gofiber/fiber/v3"
	"github.com/shirou/gopsutil/v4/cpu"
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

type CPUData struct {
	Usage float64
	Total float64
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
		JSONEncoder: sonic.ConfigFastest.Marshal,
		JSONDecoder: sonic.ConfigFastest.Unmarshal,
	})

	var (
		temp []CPUData
		mu   sync.Mutex
	)

	app.Get("/stats", func(c fiber.Ctx) error {
		times, err := cpu.Times(true)
		if err != nil {
			return err
		}

		currentUsage := make([]CPUData, len(times))
		for i, t := range times {
			usage := t.User + t.Nice + t.System + t.Irq
			total := usage + t.Idle

			currentUsage[i] = CPUData{
				Usage: usage,
				Total: total,
			}
		}

		result := []int{}

		mu.Lock()
		if len(temp) > 0 {
			for i, cpu := range currentUsage {
				if i >= len(temp) {
					break
				}

				usageDiff := cpu.Usage - temp[i].Usage
				totalDiff := cpu.Total - temp[i].Total

				if totalDiff > 0 {
					percentage := (100 * usageDiff) / totalDiff
					result = append(result, int(math.Round(percentage)))
				} else {
					result = append(result, 0)
				}
			}
		}

		temp = currentUsage
		mu.Unlock()

		return c.JSON(result)
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
