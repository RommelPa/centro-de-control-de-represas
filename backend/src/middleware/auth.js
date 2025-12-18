const requireApiKey = (req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const apiKey = req.get('x-api-key');
  if (!apiKey) {
    return res.status(401).json({ ok: false, error: 'Missing API key' });
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(403).json({ ok: false, error: 'Invalid API key' });
  }

  next();
};

module.exports = requireApiKey;
