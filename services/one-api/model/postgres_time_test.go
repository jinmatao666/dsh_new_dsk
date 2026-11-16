package model

import (
	"github.com/jackc/pgx/v5/pgtype"
	"testing"
	"time"
)

func TestPostgresLocalTimestamp(t *testing.T) {
	local := time.FixedZone("Asia/Shanghai", 8*60*60)
	want := time.Date(2026, 11, 13, 15, 5, 9, 0, local)
	for _, format := range []int16{pgtype.TextFormatCode, pgtype.BinaryFormatCode} {
		m := pgtype.NewMap()
		m.RegisterType(&pgtype.Type{Name: "timestamp", OID: pgtype.TimestampOID, Codec: localTimestampCodec{location: local}})
		raw, err := m.Encode(pgtype.TimestampOID, format, pgtype.Timestamp{Time: want, Valid: true}, nil)
		if err != nil {
			t.Fatal(err)
		}
		var got pgtype.Timestamp
		if err := m.Scan(pgtype.TimestampOID, format, raw, &got); err != nil {
			t.Fatal(err)
		}
		if !got.Time.Equal(want) {
			t.Fatalf("format %d: got %v, want %v", format, got.Time, want)
		}
		// Ordinary timestamptz still preserves the instant even when its offset is UTC.
		raw, err = m.Encode(pgtype.TimestamptzOID, format, pgtype.Timestamptz{Time: want.UTC(), Valid: true}, nil)
		if err != nil {
			t.Fatal(err)
		}
		var zoned pgtype.Timestamptz
		if err := m.Scan(pgtype.TimestamptzOID, format, raw, &zoned); err != nil {
			t.Fatal(err)
		}
		if !zoned.Time.Equal(want) {
			t.Fatalf("zoned timestamp changed: %v", zoned.Time)
		}
		if err := m.Scan(pgtype.TimestampOID, format, nil, &got); err != nil || got.Valid {
			t.Fatalf("null timestamp: %v %v", got, err)
		}
	}
}
