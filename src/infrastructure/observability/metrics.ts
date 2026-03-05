import client from "prom-client";

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const bulkRecords = new client.Counter({
  name: "bulk_records_total",
  help: "Processed import records by entity and outcome",
  labelNames: ["entity", "status"] as const,
  registers: [register],
});

export const bulkJobsRunning = new client.Gauge({
  name: "bulk_jobs_running",
  help: "Number of currently running bulk jobs",
  registers: [register],
});

export const bulkJobDurationSeconds = new client.Histogram({
  name: "bulk_job_duration_seconds",
  help: "End-to-end bulk job duration in seconds",
  labelNames: ["entity", "type"] as const,
  buckets: [1, 5, 15, 30, 60, 120, 300, 600],
  registers: [register],
});

export const bulkExportRows = new client.Counter({
  name: "bulk_export_rows_total",
  help: "Rows written by export operations",
  labelNames: ["entity", "type"] as const, // type: streaming | async
  registers: [register],
});

export const bulkJobErrors = new client.Counter({
  name: "bulk_job_errors_total",
  help: "Per-record import errors by entity and error code",
  labelNames: ["entity", "code"] as const,
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});
