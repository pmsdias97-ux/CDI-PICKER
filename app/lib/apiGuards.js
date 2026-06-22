// Lightweight server-side guards for API routes.
// Note: the rate limiter is in-memory and per-instance. On serverless it resets
// between cold starts and isn't shared across instances, so it's basic abuse
// protection — not a hard global quota. Good enough for ~40 players/day.

export const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

export function isValidTicker(t) {
  return TICKER_RE.test(String(t || "").trim().toUpperCase());
}

export function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

const buckets = new Map();

// Sliding-window limiter: allow `max` requests per `windowMs` per key.
export function rateLimit(key, { max = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
    return { ok: false, retryAfter };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true };
}

export function rateLimited(request, name, opts) {
  return rateLimit(`${name}:${clientIp(request)}`, opts);
}

// Constant-time string comparison to avoid timing leaks on the admin password.
export function safeEqual(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

export function checkAdminPassword(password) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // not configured => deny
  return safeEqual(password, expected);
}
