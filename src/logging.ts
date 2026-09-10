/**
 * Structured JSON logging, one line per event.
 *
 * The Python service used structlog with a bound trace context; a Worker has
 * no process-wide context to bind to (requests are concurrent on one isolate),
 * so the context is passed explicitly and carried on the Hono context instead.
 *
 * Shape is deliberately identical to the structlog output so existing log
 * queries keep working: {"event", "project_id", "trace_id", "level", "timestamp"}.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface TraceContext {
  traceId: string
  projectId: string
}

export function log(
  level: LogLevel,
  event: string,
  ctx: TraceContext,
  fields: Record<string, unknown> = {},
): void {
  const line = {
    event,
    project_id: ctx.projectId,
    trace_id: ctx.traceId,
    ...fields,
    level,
    timestamp: new Date().toISOString(),
  }
  // Workers' observability pipeline captures stdout/stderr; console.error keeps
  // warnings and errors on the stderr stream so they can be filtered separately.
  const sink = level === 'error' || level === 'warning' ? console.error : console.log
  sink(JSON.stringify(line))
}
