const isProduction = process.env.NODE_ENV === 'production';

const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isServerError = status >= 500;
  const code = err.code || (isServerError ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const message = err.message || (isServerError ? 'Internal Server Error' : 'Request failed');
  const requestId = req.requestId || 'unknown';

  const shouldLog =
    isServerError ||
    code === 'UPSTREAM_AI_ERROR' ||
    code === 'DB_ERROR' ||
    code === 'RATE_LIMITED' ||
    status >= 400;

  if (shouldLog) {
    const causeMessage = err.cause?.message || null;
    const logPayload = {
      status,
      code,
      message: err.message,
      requestId,
      path: req.originalUrl,
      method: req.method,
      cause: causeMessage,
    };

    if (err.stack && isServerError) {
      logPayload.stack = err.stack;
    }

    if (err.cause?.stack && isServerError) {
      logPayload.causeStack = err.cause.stack;
    }

    console.error(`[${new Date().toISOString()}][${requestId}]`, logPayload);
  }

  res.setHeader('x-request-id', requestId);

  const payload = { ok: false, code, message, requestId };

  if (!isProduction && err.details) {
    payload.details = err.details;
  }

  res.status(status).json(payload);
};

module.exports = errorHandler;
