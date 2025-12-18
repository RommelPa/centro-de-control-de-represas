const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const maxHits = Number(process.env.RATE_LIMIT_MAX || 200);
const buckets = new Map();
const MAX_BUCKETS = 1000;

const cleanup = () => {
  const now = Date.now();
  for (const [ip, info] of buckets.entries()) {
    if (info.reset < now) {
      buckets.delete(ip);
    }
  }
};

const rateLimiter = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = buckets.get(ip);

  if (!entry || entry.reset < now) {
    buckets.set(ip, { count: 1, reset: now + windowMs });
    return next();
  }

  entry.count += 1;

  if (entry.count > maxHits) {
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later.',
    });
  }

  if (buckets.size > MAX_BUCKETS) {
    cleanup();
  }

  next();
};

module.exports = rateLimiter;
