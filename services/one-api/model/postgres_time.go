package model

import (
	"context"
	"time"

	"database/sql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/stdlib"
)

// Naive PostgreSQL timestamps contain application-local wall time, not UTC.
// Zoned timestamps and integer Unix timestamps retain their original codecs.
type localTimestampCodec struct {
	pgtype.TimestampCodec
	location *time.Location
}

func (c localTimestampCodec) PlanScan(m *pgtype.Map, oid uint32, format int16, target any) pgtype.ScanPlan {
	if _, ok := target.(pgtype.TimestampScanner); !ok {
		return nil
	}
	plan := c.TimestampCodec.PlanScan(m, oid, format, &pgtype.Timestamp{})
	if plan == nil {
		return nil
	}
	return localTimestampScan{plan: plan, location: c.location}
}

type localTimestampScan struct {
	plan     pgtype.ScanPlan
	location *time.Location
}

func (p localTimestampScan) Scan(src []byte, target any) error {
	var value pgtype.Timestamp
	if err := p.plan.Scan(src, &value); err != nil {
		return err
	}
	if value.Valid && value.InfinityModifier == pgtype.Finite {
		t := value.Time
		value.Time = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), p.location)
	}
	return target.(pgtype.TimestampScanner).ScanTimestamp(value)
}

func postgresConnection(dsn string) (*sql.DB, error) {
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	return stdlib.OpenDB(*config, stdlib.OptionAfterConnect(func(_ context.Context, conn *pgx.Conn) error {
		conn.TypeMap().RegisterType(&pgtype.Type{Name: "timestamp", OID: pgtype.TimestampOID,
			Codec: localTimestampCodec{location: time.Local}})
		return nil
	})), nil
}
