require('dotenv').config();
const sql = require('mssql/msnodesqlv8');

const server = process.env.SQL_SERVER;      // ej: PC-PRACCOM\SQLEXPRESS
const database = process.env.SQL_DATABASE;  // REPRESAS

const connectionString =
  `Driver={ODBC Driver 17 for SQL Server};` +
  `Server=${server};` +
  `Database=${database};` +
  `Trusted_Connection=Yes;`;

// Perf/safety knobs
// - requestTimeout: evita cortes por queries grandes (ms)
// - pool: controla concurrencia
const REQUEST_TIMEOUT_MS = Number(process.env.SQL_REQUEST_TIMEOUT_MS || 120000);
const CONNECTION_TIMEOUT_MS = Number(process.env.SQL_CONNECTION_TIMEOUT_MS || 30000);
const POOL_MAX = Number(process.env.SQL_POOL_MAX || 10);
const POOL_MIN = Number(process.env.SQL_POOL_MIN || 0);
const POOL_IDLE_TIMEOUT_MS = Number(process.env.SQL_POOL_IDLE_TIMEOUT_MS || 30000);

const poolPromise = new sql.ConnectionPool({
  connectionString,
  requestTimeout: REQUEST_TIMEOUT_MS,
  connectionTimeout: CONNECTION_TIMEOUT_MS,
  pool: {
    max: POOL_MAX,
    min: POOL_MIN,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
  },
  options: {
    encrypt: String(process.env.SQL_ENCRYPT).toLowerCase() === 'true',
    trustServerCertificate: String(process.env.SQL_TRUST_CERT).toLowerCase() === 'true',
  },
})
  .connect()
  .then(pool => {
    return pool;
  })
  .catch(err => {
    throw err;
  });

module.exports = { sql, poolPromise };