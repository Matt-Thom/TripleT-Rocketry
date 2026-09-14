## 2026-09-14 - Parallelizing Independent D1 Queries in Route Handlers
**Learning:** Route handlers fetching multiple aggregate metrics sequentially add significant IO latency due to sequential database queries. Combining independent query promises with `Promise.all` allows D1/SQLite queries to execute concurrently.
**Action:** When creating dashboard or summary endpoints with multiple independent query counts/joins, wrap them in `Promise.all` to minimize query round-trip latency.
