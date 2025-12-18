const limitPerMin = Number(process.env.INSIGHTS_RATE_LIMIT_PER_MIN || 10);
const windowMs = 60 * 1000;
const buckets = new Map();
const MAX_BUCKETS = 500;

const cleanup = () => {
  const now = Date.now();
  for (const [ip, info] of buckets.entries()) {
    if (info.reset < now) {
      buckets.delete(ip);
    }
  }
};

const insightsRateLimit = (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = buckets.get(ip);

  if (!entry || entry.reset < now) {
    buckets.set(ip, { count: 1, reset: now + windowMs });
    if (buckets.size > MAX_BUCKETS) cleanup();
    return next();
  }

  entry.count += 1;
  if (entry.count > limitPerMin) {
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many insight requests, please slow down.',
    });
  }

  if (buckets.size > MAX_BUCKETS) cleanup();
  next();
};

module.exports = insightsRateLimit;
