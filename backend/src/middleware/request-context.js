const { randomUUID } = require('crypto');

const requestContext = (req, res, next) => {
  const incomingId = req.get('x-request-id');
  const requestId = incomingId && String(incomingId).trim().length ? incomingId.trim() : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  req.log = (...args) => {
    console.log(`[${new Date().toISOString()}][${requestId}]`, ...args);
  };

  req.logError = (...args) => {
    console.error(`[${new Date().toISOString()}][${requestId}]`, ...args);
  };

  next();
};

module.exports = requestContext;
