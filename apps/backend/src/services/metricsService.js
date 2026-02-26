/**
 * Simple in-memory metrics collector.
 *
 * Tracks request counts, latencies, compile stats, and system info.
 * Exposed via GET /api/health/metrics.
 */

const startTime = Date.now();

const counters = {
  requests: 0,
  errors: 0,
  compiles: 0,
  compileFails: 0,
  logins: 0,
  registers: 0,
};

const latencyBuckets = {
  // Route prefix -> { count, totalMs }
};

export function recordRequest(method, url, statusCode, durationMs) {
  counters.requests++;
  if (statusCode >= 500) counters.errors++;

  // Bucket by route prefix
  const key = `${method} ${bucketize(url)}`;
  if (!latencyBuckets[key]) {
    latencyBuckets[key] = { count: 0, totalMs: 0, maxMs: 0 };
  }
  const b = latencyBuckets[key];
  b.count++;
  b.totalMs += durationMs;
  if (durationMs > b.maxMs) b.maxMs = durationMs;
}

export function recordCompile(success) {
  counters.compiles++;
  if (!success) counters.compileFails++;
}

export function recordLogin() { counters.logins++; }
export function recordRegister() { counters.registers++; }

export function getMetrics() {
  const mem = process.memoryUsage();
  const uptimeMs = Date.now() - startTime;

  // Top routes by request count
  const routes = Object.entries(latencyBuckets)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([route, stats]) => ({
      route,
      count: stats.count,
      avgMs: Math.round(stats.totalMs / stats.count),
      maxMs: Math.round(stats.maxMs),
    }));

  return {
    uptime: {
      ms: uptimeMs,
      human: formatUptime(uptimeMs),
    },
    counters,
    memory: {
      rss: formatBytes(mem.rss),
      heapUsed: formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
      external: formatBytes(mem.external),
    },
    routes,
    nodeVersion: process.version,
    pid: process.pid,
  };
}

function bucketize(url) {
  // Normalize UUIDs and query strings
  return url
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/[0-9a-f]{24,}/gi, '/:id');
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
