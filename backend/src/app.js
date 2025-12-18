require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const requireApiKey = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const errorHandler = require('./middleware/error-handler');
const rateLimiter = require('./middleware/rate-limit');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const origins = allowedOrigins.length ? allowedOrigins : defaultOrigins;

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // CLI/postman
    if (origins.includes(origin)) return callback(null, true);
    const err = new Error('Not allowed by CORS');
    err.status = 403;
    return callback(err);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
};

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

app.use(rateLimiter);

app.use('/api/v1', requireApiKey, apiRoutes);

app.use((req, res, next) => {
  const err = new Error('Endpoint not found');
  err.status = 404;
  next(err);
});

app.use(errorHandler);

module.exports = { app };
