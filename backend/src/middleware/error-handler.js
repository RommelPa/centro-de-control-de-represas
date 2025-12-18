const isProduction = process.env.NODE_ENV === 'production';

const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;
  const code = err.code || (isServerError ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const message = isServerError ? 'Internal Server Error' : err.message || 'Request failed';

  if (isServerError) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  }

  const payload = { ok: false, code, message };

  if (!isProduction && err.details) {
    payload.details = err.details;
  }

  res.status(status).json(payload);
};

module.exports = errorHandler;
