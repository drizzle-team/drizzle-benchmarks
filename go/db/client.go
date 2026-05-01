package db

import (
	"context"
	"fmt"
	"time"

	"github.com/bytedance/sonic"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Client struct {
	*Queries
	pool *pgxpool.Pool
}

func NewDatabase(databaseUrl string) (*Client, error) {
	config, err := pgxpool.ParseConfig(databaseUrl)
	if err != nil {
		return nil, err
	}

	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		sonicCodec := &pgtype.JSONCodec{
			Marshal:   sonic.Marshal,
			Unmarshal: sonic.Unmarshal,
		}

		tm := conn.TypeMap()

		tm.RegisterType(&pgtype.Type{
			Name:  "json",
			OID:   pgtype.JSONOID,
			Codec: sonicCodec,
		})

		tm.RegisterType(&pgtype.Type{
			Name:  "jsonb",
			OID:   pgtype.JSONBOID,
			Codec: sonicCodec,
		})

		return nil
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err = pool.Ping(ctx); err != nil {
		pool.Close()

		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return &Client{pool: pool, Queries: New(pool)}, nil
}

func (db *Client) Close() {
	db.pool.Close()
}
