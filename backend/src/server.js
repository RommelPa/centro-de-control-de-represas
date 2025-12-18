require('dotenv').config();
console.log("PORT ENV =", process.env.PORT);
console.log("CORS_ORIGIN ENV =", process.env.CORS_ORIGIN);
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const requireApiKey = require('./middleware/auth');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));
app.options('*', cors());
app.use(express.json());
app.use(morgan('tiny'));

// Auth for all /api routes
app.use('/api/v1', requireApiKey, apiRoutes);
// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint not found' });
});

app.listen(PORT, () => {
});