module.exports = function requireApiKey(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const key = req.header('x-api-key');
  if (!key) return res.status(401).json({ ok: false, error: 'Missing API key' });

  if (key !== process.env.API_KEY) {
    return res.status(403).json({ ok: false, error: 'Invalid API key' });
  }

  next();
};

const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ ok: false, error: 'Missing API Key' });
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(403).json({ ok: false, error: 'Invalid API Key' });
  }

  next();
};

module.exports = requireApiKey;