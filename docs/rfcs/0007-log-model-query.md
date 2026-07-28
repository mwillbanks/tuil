# RFC 0007: Log model and query

Status: accepted

All inputs normalize into an OpenTelemetry-compatible record with explicit
source provenance. Redaction precedes storage and export. Queries parse into a
typed expression with positioned errors; bounded retention is mandatory.

Records preserve the original payload, timestamp, severity, body, attributes,
resource, scope, trace/span IDs, source, and diagnostics. Malformed input stays
visible. Redaction runs before indexing, subscriptions, rendering, copy, or
export. Query text compiles to an AST; field access is allowlisted and regular
expressions are bounded.

RFC 3164/5424 and OTEL fixtures cover preservation, malformed recovery,
redaction, precedence, retention, export, and 100,000-record search.

## Ownership and compatibility

Logging owns normalization, policy, indexing, and querying. Log viewer owns
virtualized presentation. Parser additions cannot change normalized field
meaning or bypass redaction and retention.
