const crypto = require('crypto');

const expectedKey = process.env.API_KEY ? Buffer.from(process.env.API_KEY) : null;

const requireApiKey = (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const apiKey = req.get('x-api-key');
  if (!apiKey || !expectedKey) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const provided = Buffer.from(apiKey);

  if (provided.length !== expectedKey.length) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    if (!crypto.timingSafeEqual(expectedKey, provided)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  next();
};

module.exports = requireApiKey;
