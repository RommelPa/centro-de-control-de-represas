const { poolPromise, sql } = require('../db/pool');

const VARIABLE_CODES = ['VOL_BRUTO', 'VOL_UTIL', 'COTA', 'DESCARGA', 'REBOSE', 'PRECIP'];
const MAX_PAYLOAD_BYTES = Number(process.env.INSIGHTS_MAX_PAYLOAD_BYTES || 14000);
const MAX_DAILY_ROWS = Number(process.env.INSIGHTS_MAX_DAILY_ROWS || 1500);

const wrapDbError = (error) => {
  const err = new Error('Error al consultar la base de datos');
  err.status = 500;
  err.code = 'DB_ERROR';
  err.cause = error;
  return err;
};

const normalizeGranularity = (rangeDays) => {
  if (rangeDays > 365) return 'month';
  if (rangeDays > 120) return 'week';
  return 'day';
};

const toNumberArray = (arr) => {
  return Array.from(
    new Set(
      (arr || [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v))
    )
  );
};

const fetchDailyData = async ({ fecha_ini, fecha_fin, represaIds, granularity }) => {
  const pool = await poolPromise;
  const request = pool.request();
  request.input('fecha_ini', sql.Date, fecha_ini);
  request.input('fecha_fin', sql.Date, fecha_fin);
  request.input('represas_csv', sql.VarChar, represaIds.join(','));

  VARIABLE_CODES.forEach((code, idx) => {
    request.input(`v${idx}`, sql.VarChar, code);
  });

  const varPlaceholders = VARIABLE_CODES.map((_, idx) => `@v${idx}`).join(', ');

  let dateSelect = 'f.fecha';
  let groupBy = 'f.fecha, r.id_represa, r.nombre, v.codigo';
  let orderBy = 'fecha, r.nombre, v.codigo';

  if (granularity === 'week') {
    dateSelect = 'MIN(f.fecha)';
    groupBy = 'DATEPART(ISO_YEAR, f.fecha), DATEPART(ISO_WEEK, f.fecha), r.id_represa, r.nombre, v.codigo';
    orderBy = 'MIN(f.fecha), r.nombre, v.codigo';
  } else if (granularity === 'month') {
    dateSelect = 'DATEFROMPARTS(YEAR(f.fecha), MONTH(f.fecha), 1)';
    groupBy = 'YEAR(f.fecha), MONTH(f.fecha), r.id_represa, r.nombre, v.codigo';
    orderBy = 'DATEFROMPARTS(YEAR(f.fecha), MONTH(f.fecha), 1), r.nombre, v.codigo';
  }

  const query = `
    WITH fechas AS (
      SELECT id_fecha, fecha
      FROM dbo.dim_fecha
      WHERE fecha BETWEEN @fecha_ini AND @fecha_fin
    ),
    rep AS (
      SELECT DISTINCT TRY_CAST(value AS INT) AS id
      FROM string_split(@represas_csv, ',')
      WHERE TRY_CAST(value AS INT) IS NOT NULL
    )
    SELECT
      ${dateSelect} AS fecha,
      r.id_represa,
      r.nombre AS represa,
      v.codigo AS variable,
      AVG(h.valor) AS valor
    FROM dbo.hecho_represa_diario h
    JOIN fechas f           ON f.id_fecha = h.id_fecha
    JOIN dbo.dim_represa r  ON r.id_represa = h.id_represa
    JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
    WHERE EXISTS (SELECT 1 FROM rep x WHERE x.id = h.id_represa)
      AND v.codigo IN (${varPlaceholders})
    GROUP BY ${groupBy}
    ORDER BY ${orderBy};
  `;

  const result = await request.query(query);
  return result.recordset || [];
};

const fetchRepresaNames = async (represaIds) => {
  const pool = await poolPromise;
  const request = pool.request();
  request.input('represas_csv', sql.VarChar, represaIds.join(','));
  const query = `
    SELECT id_represa, nombre
    FROM dbo.dim_represa
    WHERE id_represa IN (
      SELECT DISTINCT TRY_CAST(value AS INT)
      FROM string_split(@represas_csv, ',')
      WHERE TRY_CAST(value AS INT) IS NOT NULL
    )
    ORDER BY nombre
  `;
  const result = await request.query(query);
  return result.recordset || [];
};

const summarize = (rows, rangeDays, fecha_ini, fecha_fin) => {
  const statsByKey = new Map();
  const dailyByRepresa = new Map();

  for (const row of rows) {
    const { id_represa, represa, variable } = row;
    const valor = Number(row.valor);
    const fecha = new Date(row.fecha).toISOString().slice(0, 10);
    const key = `${id_represa}::${variable}`;
    const stat = statsByKey.get(key) || {
      represaId: id_represa,
      represa,
      variable,
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      values: [],
      first: null,
      last: null,
    };

    if (Number.isFinite(valor)) {
      stat.count += 1;
      stat.sum += valor;
      stat.min = Math.min(stat.min, valor);
      stat.max = Math.max(stat.max, valor);
      stat.values.push({ fecha, valor });
      if (!stat.first) stat.first = { fecha, valor };
      stat.last = { fecha, valor };
    }

    statsByKey.set(key, stat);

    // daily average per represa (not variable) to keep table small
    const dailyKey = `${fecha}::${id_represa}`;
    const day = dailyByRepresa.get(dailyKey) || { fecha, represa, represaId: id_represa, sum: 0, count: 0 };
    if (Number.isFinite(valor)) {
      day.sum += valor;
      day.count += 1;
    }
    dailyByRepresa.set(dailyKey, day);
  }

  const represaStats = new Map();
  for (const stat of statsByKey.values()) {
    const avg = stat.count > 0 ? stat.sum / stat.count : null;
    const values = stat.values.map((v) => v.valor);
    const mean = avg || 0;
    const variance = values.length
      ? values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length
      : 0;
    const stdev = Math.sqrt(variance);
    const outliers = stat.values
      .filter((v) => stdev > 0 && Math.abs(v.valor - mean) >= 2.5 * stdev)
      .sort((a, b) => Math.abs(b.valor - mean) - Math.abs(a.valor - mean))
      .slice(0, 5);

    const variationAbs = stat.last && stat.first && Number.isFinite(stat.last.valor) && Number.isFinite(stat.first.valor)
      ? stat.last.valor - stat.first.valor
      : null;
    const variationPct = stat.last && stat.first && Number.isFinite(stat.last.valor) && Number.isFinite(stat.first.valor) && stat.first.valor !== 0
      ? ((stat.last.valor - stat.first.valor) / Math.abs(stat.first.valor)) * 100
      : null;

    const trend =
      variationAbs === null || Math.abs(variationAbs) < (stdev || 0.01)
        ? 'estable'
        : variationAbs > 0
          ? 'sube'
          : 'baja';

    const represaKey = stat.represaId;
    const missingForVar = Math.max(rangeDays - new Set(stat.values.map((v) => v.fecha)).size, 0);

    const entry = represaStats.get(represaKey) || {
      represaId: stat.represaId,
      represa: stat.represa,
      variables: [],
      missingDays: missingForVar,
    };

    entry.missingDays = Math.max(entry.missingDays, missingForVar);
    entry.variables.push({
      variable: stat.variable,
      promedio: avg,
      minimo: stat.min === Number.POSITIVE_INFINITY ? null : stat.min,
      maximo: stat.max === Number.NEGATIVE_INFINITY ? null : stat.max,
      tendencia: trend,
      variacionAbsoluta: variationAbs,
      variacionPorcentual: variationPct,
      outliers,
    });

    represaStats.set(represaKey, entry);
  }

  const daily = Array.from(dailyByRepresa.values())
    .map((d) => ({
      fecha: d.fecha,
      represa: d.represa,
      valorPromedio: d.count > 0 ? d.sum / d.count : null,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  let truncated = false;
  let compactDaily = daily;
  if (daily.length > MAX_DAILY_ROWS) {
    compactDaily = daily.filter((_, idx) => idx % Math.ceil(daily.length / MAX_DAILY_ROWS) === 0);
    truncated = true;
  }

  const stats = {
    rango: { fecha_ini, fecha_fin, dias: rangeDays },
    represas: Array.from(represaStats.values()),
    daily: compactDaily,
    truncado: truncated,
  };

  // enforce payload size
  const payloadSize = Buffer.byteLength(JSON.stringify(stats), 'utf8');
  if (payloadSize > MAX_PAYLOAD_BYTES) {
    stats.daily = [];
    stats.truncado = true;
  }

  return stats;
};

const buildInsightsDataset = async ({ fecha_ini, fecha_fin, represas, rangeDays }) => {
  const represaIds = toNumberArray(represas);
  try {
    const [names, daily] = await Promise.all([
      fetchRepresaNames(represaIds),
      fetchDailyData({ fecha_ini, fecha_fin, represaIds, granularity: normalizeGranularity(rangeDays) }),
    ]);

    const stats = summarize(daily, rangeDays, fecha_ini, fecha_fin);

    return {
      stats,
      meta: {
        represas: names,
        granularity: normalizeGranularity(rangeDays),
      },
    };
  } catch (error) {
    throw wrapDbError(error);
  }
};

module.exports = { buildInsightsDataset };
