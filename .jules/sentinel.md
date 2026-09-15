## 2026-09-14 - CSRF Defense on Unsafe Methods
**Vulnerability:** Unsafe HTTP methods (POST, PUT, DELETE, PATCH) lacked origin or referer verification (BL-07), relying solely on `SameSite=Lax` cookies.
**Learning:** In Hono / Cloudflare Workers applications handling both browser forms and API/JSON requests, checking `Origin` or `Referer` headers against the target request origin provides robust CSRF defense without breaking non-browser API clients.
**Prevention:** Always mount a global CSRF validation middleware on state-changing HTTP methods before authentication and route handlers.
