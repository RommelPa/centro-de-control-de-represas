const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const candidatePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
];

let loadedFrom = null;

for (const envPath of candidatePaths) {
  if (!fs.existsSync(envPath)) continue;
  dotenv.config({ path: envPath });
  loadedFrom = envPath;
  break;
}

if (!loadedFrom) {
  dotenv.config();
}

let loggedPresence = false;

const getGeminiApiKey = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!loggedPresence && process.env.NODE_ENV !== 'production') {
    loggedPresence = true;
    console.log('GEMINI_API_KEY presente?', Boolean(apiKey));
  }

  if (!apiKey) {
    const err = new Error('Gemini API key inválida o ausente');
    err.code = 'INVALID_API_KEY';
    err.status = 503;
    throw err;
  }

  return apiKey;
};

module.exports = { getGeminiApiKey, loadedFrom };
