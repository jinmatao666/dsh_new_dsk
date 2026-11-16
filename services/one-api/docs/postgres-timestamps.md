# PostgreSQL timestamp decoding

The service writes application-local wall time to legacy `timestamp without time zone` columns. The pgx default decoder labels those fields UTC, causing credit history to add eight hours again when displayed in Beijing time. `model/postgres_time.go` registers a timestamp scanner on every PostgreSQL connection that interprets these wall-clock fields in `time.Local`, matching their writers. Deploy the service with `TZ=Asia/Shanghai`, as in the supplied compose configuration.

The scanner does not alter `timestamptz` values or integer Unix timestamps used by model logs. It does not rewrite historical rows. Existing naive fields must contain application-local wall time; UTC wall-clock imports require separate verification before this policy is applied. MySQL and SQLite are unchanged.

`TestPostgresLocalTimestamp` exercises binary and text encoding, null timestamps and unchanged zoned instants. Deployment verification should issue a new administrator grant and compare its ledger time with the service clock, then verify an existing model log retains its original time.
