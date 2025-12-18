const express = require('express');
const { z } = require('zod');
const router = express.Router();
const { poolPromise, sql } = require('../db/pool');
const { getGeminiApiKey } = require('../config/env');
const aiService = require('../services/ai');
const insightsData = require('../services/insights-data');
const insightsRateLimit = require('../middleware/insights-rate-limit');

// --- UTILS ---
const formatData = (recordset) => ({ ok: true, data: recordset });
const MAX_INSIGHTS_RANGE_DAYS = Number(process.env.INSIGHTS_MAX_RANGE_DAYS || 366);

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const parseISODate = (s) => {
  if (!isISODate(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const daysBetweenInclusive = (a, b) => {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.floor(ms / (24 * 3600 * 1000)) + 1;
};

const requireDateRange = (fecha_ini, fecha_fin, next) => {
  const d1 = parseISODate(fecha_ini);
  const d2 = parseISODate(fecha_fin);
  if (!d1 || !d2) {
    const err = new Error('fecha_ini y fecha_fin son requeridas (YYYY-MM-DD)');
    err.status = 400;
    return next(err);
  }
  if (d1 > d2) {
    const err = new Error('fecha_ini debe ser <= fecha_fin');
    err.status = 400;
    return next(err);
  }
  return { d1, d2 };
};

const isCsvNums = (s) => !s || /^[0-9]+(,[0-9]+)*$/.test(String(s).trim());

// Auto-downsample to keep responses fast and charts usable
const normalizeGranularity = (params, rangeDays) => {
  const g = String(params?.granularity || '').toLowerCase().trim();
  if (g === 'day' || g === 'week' || g === 'month') return g;
  // Auto mode
  if (rangeDays > 365) return 'month';
  if (rangeDays > 90) return 'week';
  return 'day';
};

// Tiny in-memory cache for metadata (avoid repeated DB hits)
const cache = new Map();
const cacheGet = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  return hit.val;
};
const cacheSet = (key, val, ttlMs = 5 * 60 * 1000) => {
  cache.set(key, { val, exp: Date.now() + ttlMs });
};

const validate = (schema, data, next) => {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const err = new Error('Parámetros inválidos');
    err.status = 400;
    err.details = parsed.error.format();
    next(err);
    return null;
  }
  return parsed.data;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const csvNumberSchema = z.string().regex(/^[0-9]+(,[0-9]+)*$/);
const insightsSchema = z.object({
  fecha_ini: dateSchema,
  fecha_fin: dateSchema,
  represas: z.array(z.string().min(1)).min(1),
  idioma: z.enum(['es', 'en']).optional().default('es'),
  nivelDetalle: z.enum(['breve', 'normal', 'tecnico']).optional().default('normal'),
});

// --- HEALTH ---
router.get('/health', async (req, res, next) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1');
    res.json({ ok: true, data: { status: 'OK', db: 'Connected' } });
  } catch (err) {
    err.status = 503;
    next(err);
  }
});

// --- METADATA ---
router.get('/meta/represas', async (req, res, next) => {
  try {
    const key = 'meta:represas';
    const cached = cacheGet(key);
    if (cached) return res.json(formatData(cached));

    const pool = await poolPromise;
    const result = await pool.request().query(
      'SELECT id_represa as id, nombre FROM dbo.dim_represa ORDER BY nombre'
    );
    cacheSet(key, result.recordset);
    res.json(formatData(result.recordset));
  } catch (err) { next(err); }
});

router.get('/meta/centrales', async (req, res, next) => {
  try {
    const key = 'meta:centrales';
    const cached = cacheGet(key);
    if (cached) return res.json(formatData(cached));

    const pool = await poolPromise;
    const result = await pool.request().query(
      'SELECT id_central as id, nombre FROM dbo.dim_central ORDER BY nombre'
    );
    cacheSet(key, result.recordset);
    res.json(formatData(result.recordset));
  } catch (err) { next(err); }
});

router.get('/meta/canales', async (req, res, next) => {
  try {
    const key = 'meta:canales';
    const cached = cacheGet(key);
    if (cached) return res.json(formatData(cached));

    const pool = await poolPromise;
    const result = await pool.request().query(
      'SELECT id_canal as id, nombre FROM dbo.dim_canal ORDER BY nombre'
    );
    cacheSet(key, result.recordset);
    res.json(formatData(result.recordset));
  } catch (err) { next(err); }
});

// --- REPRESAS ---
router.get('/represas/kpis', async (req, res, next) => {
  const parsed = validate(
    z.object({
      fecha_ini: dateSchema,
      fecha_fin: dateSchema,
      represas: csvNumberSchema.optional(),
    }),
    req.query,
    next
  );
  if (!parsed) return;

  const dr = requireDateRange(parsed.fecha_ini, parsed.fecha_fin, next);
  if (!dr) return;

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, parsed.fecha_ini);
    request.input('fecha_fin', sql.Date, parsed.fecha_fin);
    request.input('represas_csv', sql.VarChar, parsed.represas || '');
    request.input('all_represas', sql.Bit, parsed.represas ? 0 : 1);

    // Optimizations:
    // - Find latest id_fecha in range once (uses dim_fecha(fecha) index)
    // - Parse CSV once into table variable and use EXISTS instead of IN + string_split per row
    const query = `
      DECLARE @id_fecha_ult INT = (
        SELECT TOP 1 id_fecha
        FROM dbo.dim_fecha
        WHERE fecha BETWEEN @fecha_ini AND @fecha_fin
        ORDER BY fecha DESC
      );

      DECLARE @rep TABLE (id INT PRIMARY KEY);
      IF (@all_represas = 0)
      BEGIN
        INSERT INTO @rep(id)
        SELECT DISTINCT TRY_CAST(value AS INT)
        FROM string_split(@represas_csv, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL;
      END

      SELECT r.id_represa, r.nombre AS represa,
        MAX(CASE WHEN v.codigo='VOL_BRUTO' THEN h.valor END) AS VOL_BRUTO,
        MAX(CASE WHEN v.codigo='VOL_UTIL'  THEN h.valor END) AS VOL_UTIL,
        MAX(CASE WHEN v.codigo='COTA'      THEN h.valor END) AS COTA,
        MAX(CASE WHEN v.codigo='DESCARGA'  THEN h.valor END) AS DESCARGA,
        MAX(CASE WHEN v.codigo='REBOSE'    THEN h.valor END) AS REBOSE,
        MAX(CASE WHEN v.codigo='PRECIP'    THEN h.valor END) AS PRECIP
      FROM dbo.hecho_represa_diario h
      JOIN dbo.dim_represa r  ON r.id_represa = h.id_represa
      JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
      WHERE h.id_fecha = @id_fecha_ult
        AND (
          @all_represas = 1
          OR EXISTS (SELECT 1 FROM @rep x WHERE x.id = h.id_represa)
        )
      GROUP BY r.id_represa, r.nombre
      ORDER BY r.nombre;
    `;

    const result = await request.query(query);
    res.json(formatData(result.recordset));
  } catch (err) { next(err); }
});

router.get('/represas/series', async (req, res, next) => {
  const parsed = validate(
    z.object({
      fecha_ini: dateSchema,
      fecha_fin: dateSchema,
      represas: csvNumberSchema.optional(),
      variables: csvNumberSchema.optional(),
      granularity: z.enum(['day', 'week', 'month']).optional(),
    }),
    req.query,
    next
  );
  if (!parsed) return;

  const dr = requireDateRange(parsed.fecha_ini, parsed.fecha_fin, next);
  if (!dr) return;

  const rangeDays = daysBetweenInclusive(dr.d1, dr.d2);
  const granularity = normalizeGranularity({ query: parsed }, rangeDays);

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, parsed.fecha_ini);
    request.input('fecha_fin', sql.Date, parsed.fecha_fin);
    request.input('represas_csv', sql.VarChar, parsed.represas || '');
    request.input('variables_csv', sql.VarChar, parsed.variables || '');
    request.input('all_represas', sql.Bit, parsed.represas ? 0 : 1);
    request.input('all_vars', sql.Bit, parsed.variables ? 0 : 1);

    const base = `
      WITH fechas AS (
        SELECT id_fecha, fecha
        FROM dbo.dim_fecha
        WHERE fecha BETWEEN @fecha_ini AND @fecha_fin
      ),
      rep AS (
        SELECT DISTINCT TRY_CAST(value AS INT) AS id
        FROM string_split(@represas_csv, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL
      ),
      vars AS (
        SELECT DISTINCT TRY_CAST(value AS INT) AS id
        FROM string_split(@variables_csv, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL
      )
    `;

    const filters = `
      WHERE (
        @all_represas = 1
        OR EXISTS (SELECT 1 FROM rep x WHERE x.id = h.id_represa)
      )
      AND (
        @all_vars = 1
        OR EXISTS (SELECT 1 FROM vars x WHERE x.id = h.id_variable)
      )
    `;

    // day/week/month query variants
    let query;
    if (granularity === 'month') {
      query = base + `
      SELECT
        DATEFROMPARTS(YEAR(f.fecha), MONTH(f.fecha), 1) AS fecha,
        r.id_represa,
        r.nombre AS represa,
        v.id_variable,
        v.codigo AS variable,
        AVG(h.valor) AS valor
      FROM dbo.hecho_represa_diario h
      JOIN fechas f          ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_represa r ON r.id_represa = h.id_represa
      JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
      ${filters}
      GROUP BY YEAR(f.fecha), MONTH(f.fecha), r.id_represa, r.nombre, v.id_variable, v.codigo
      ORDER BY fecha, r.nombre, v.codigo;
      `;
    } else if (granularity === 'week') {
      query = base + `
      SELECT
        MIN(f.fecha) AS fecha,
        r.id_represa,
        r.nombre AS represa,
        v.id_variable,
        v.codigo AS variable,
        AVG(h.valor) AS valor
      FROM dbo.hecho_represa_diario h
      JOIN fechas f           ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_represa r  ON r.id_represa = h.id_represa
      JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
      ${filters}
      GROUP BY YEAR(f.fecha), DATEPART(ISO_WEEK, f.fecha), r.id_represa, r.nombre, v.id_variable, v.codigo
      ORDER BY fecha, r.nombre, v.codigo;
      `;
    } else {
      query = base + `
      SELECT
        f.fecha,
        r.id_represa,
        r.nombre AS represa,
        v.id_variable,
        v.codigo AS variable,
        h.valor
      FROM dbo.hecho_represa_diario h
      JOIN fechas f           ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_represa r  ON r.id_represa = h.id_represa
      JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
      ${filters}
      ORDER BY f.fecha, r.nombre, v.codigo;
      `;
    }

    const result = await request.query(query);
    res.json(formatData(result.recordset));
  } catch (err) { next(err); }
});

// --- CENTRALES ---
router.get('/centrales/series', async (req, res, next) => {
  const parsed = validate(
    z.object({
      fecha_ini: dateSchema,
      fecha_fin: dateSchema,
      centrales: csvNumberSchema.optional(),
      variables: csvNumberSchema.optional(),
      granularity: z.enum(['day', 'week', 'month']).optional(),
    }),
    req.query,
    next
  );
  if (!parsed) return;

  const dr = requireDateRange(parsed.fecha_ini, parsed.fecha_fin, next);
  if (!dr) return;

  const rangeDays = daysBetweenInclusive(dr.d1, dr.d2);
  const granularity = normalizeGranularity({ query: parsed }, rangeDays);

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, parsed.fecha_ini);
    request.input('fecha_fin', sql.Date, parsed.fecha_fin);
    request.input('centrales_csv', sql.VarChar, parsed.centrales || '');
    request.input('variables_csv', sql.VarChar, parsed.variables || '');
    request.input('all_centrales', sql.Bit, parsed.centrales ? 0 : 1);
    request.input('all_vars', sql.Bit, parsed.variables ? 0 : 1);

    const base = `
      WITH fechas AS (
        SELECT id_fecha, fecha
        FROM dbo.dim_fecha
        WHERE fecha BETWEEN @fecha_ini AND @fecha_fin
      ),
      cen AS (
        SELECT DISTINCT TRY_CAST(value AS INT) AS id
        FROM string_split(@centrales_csv, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL
      ),
      vars AS (
        SELECT DISTINCT TRY_CAST(value AS INT) AS id
        FROM string_split(@variables_csv, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL
      )
    `;

    const filters = `
      WHERE (
        @all_centrales = 1
        OR EXISTS (SELECT 1 FROM cen x WHERE x.id = h.id_central)
      )
      AND (
        @all_vars = 1
        OR EXISTS (SELECT 1 FROM vars x WHERE x.id = h.id_variable)
      )
    `;

    let query;
    if (granularity === 'month') {
      query = base + `
      SELECT
        DATEFROMPARTS(YEAR(f.fecha), MONTH(f.fecha), 1) AS fecha,
        c.id_central,
        c.nombre AS central,
        v.id_variable,
        v.codigo AS variable,
        AVG(h.valor) AS valor
      FROM dbo.hecho_central_diario h
      JOIN fechas f           ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_central c  ON c.id_central = h.id_central
      JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
      ${filters}
      GROUP BY YEAR(f.fecha), MONTH(f.fecha), c.id_central, c.nombre, v.id_variable, v.codigo
      ORDER BY fecha, c.nombre, v.codigo;
      `;
    } else if (granularity === 'week') {
      query = base + `
      SELECT
        MIN(f.fecha) AS fecha,
        c.id_central,
        c.nombre AS central,
        v.id_variable,
        v.codigo AS variable,
        AVG(h.valor) AS valor
      FROM dbo.hecho_central_diario h
      JOIN fechas f           ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_central c  ON c.id_central = h.id_central
      JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
      ${filters}
      GROUP BY DATEPART(ISO_YEAR, f.fecha), DATEPART(ISO_WEEK, f.fecha), c.id_central, c.nombre, v.id_variable, v.codigo
      ORDER BY fecha, c.nombre, v.codigo;
      `;
    } else {
      query = base + `
      SELECT
        f.fecha,
        c.id_central,
        c.nombre AS central,
        v.id_variable,
        v.codigo AS variable,
        h.valor
      FROM dbo.hecho_central_diario h
      JOIN fechas f           ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_central c  ON c.id_central = h.id_central
      JOIN dbo.dim_variable v ON v.id_variable = h.id_variable
      ${filters}
      ORDER BY f.fecha, c.nombre, v.codigo;
      `;
    }

    const result = await request.query(query);
    res.json(formatData(result.recordset));
  } catch (err) { next(err); }
});

// --- CANALES ---
router.get('/canales/series', async (req, res, next) => {
  const parsed = validate(
    z.object({
      fecha_ini: dateSchema,
      fecha_fin: dateSchema,
      canales: csvNumberSchema.optional(),
      granularity: z.enum(['day', 'week', 'month']).optional(),
    }),
    req.query,
    next
  );
  if (!parsed) return;

  const dr = requireDateRange(parsed.fecha_ini, parsed.fecha_fin, next);
  if (!dr) return;

  const rangeDays = daysBetweenInclusive(dr.d1, dr.d2);
  const granularity = normalizeGranularity({ query: parsed }, rangeDays);

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, parsed.fecha_ini);
    request.input('fecha_fin', sql.Date, parsed.fecha_fin);
    request.input('canales_csv', sql.VarChar, parsed.canales || '');
    request.input('all_canales', sql.Bit, parsed.canales ? 0 : 1);

    const base = `
      WITH fechas AS (
        SELECT id_fecha, fecha
        FROM dbo.dim_fecha
        WHERE fecha BETWEEN @fecha_ini AND @fecha_fin
      ),
      can AS (
        SELECT DISTINCT TRY_CAST(value AS INT) AS id
        FROM string_split(@canales_csv, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL
      )
    `;

    const filters = `
      WHERE (
        @all_canales = 1
        OR EXISTS (SELECT 1 FROM can x WHERE x.id = h.id_canal)
      )
    `;

    let query;
    if (granularity === 'month') {
      query = base + `
      SELECT
        DATEFROMPARTS(YEAR(f.fecha), MONTH(f.fecha), 1) AS fecha,
        ca.id_canal,
        ca.nombre AS canal,
        CAST(NULL AS INT) AS id_variable,
        'CAUDAL_M3S' AS variable,
        AVG(h.caudal_m3s) AS valor
      FROM dbo.hecho_canal_diario h
      JOIN fechas f         ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_canal ca ON ca.id_canal = h.id_canal
      ${filters}
      GROUP BY YEAR(f.fecha), MONTH(f.fecha), ca.id_canal, ca.nombre
      ORDER BY fecha, ca.nombre;
      `;
    } else if (granularity === 'week') {
      query = base + `
      SELECT
        MIN(f.fecha) AS fecha,
        ca.id_canal,
        ca.nombre AS canal,
        CAST(NULL AS INT) AS id_variable,
        'CAUDAL_M3S' AS variable,
        AVG(h.caudal_m3s) AS valor
      FROM dbo.hecho_canal_diario h
      JOIN fechas f         ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_canal ca ON ca.id_canal = h.id_canal
      ${filters}
      GROUP BY DATEPART(ISO_YEAR, f.fecha), DATEPART(ISO_WEEK, f.fecha), ca.id_canal, ca.nombre
      ORDER BY fecha, ca.nombre;
      `;
    } else {
      query = base + `
      SELECT
        f.fecha,
        ca.id_canal,
        ca.nombre AS canal,
        CAST(NULL AS INT) AS id_variable,
        'CAUDAL_M3S' AS variable,
        h.caudal_m3s AS valor
      FROM dbo.hecho_canal_diario h
      JOIN fechas f         ON f.id_fecha = h.id_fecha
      JOIN dbo.dim_canal ca ON ca.id_canal = h.id_canal
      ${filters}
      ORDER BY f.fecha, ca.nombre;
      `;
    }

    const result = await request.query(query);
    res.json(formatData(result.recordset));
  } catch (err) { next(err); }
});

// --- INSIGHTS (GEMINI) ---
router.post('/insights', insightsRateLimit, async (req, res, next) => {
  const parsed = validate(insightsSchema, req.body || {}, next);
  if (!parsed) return;

  const dr = requireDateRange(parsed.fecha_ini, parsed.fecha_fin, next);
  if (!dr) return;

  const rangeDays = daysBetweenInclusive(dr.d1, dr.d2);
  if (rangeDays > MAX_INSIGHTS_RANGE_DAYS) {
    const err = new Error(`El rango máximo permitido es de ${MAX_INSIGHTS_RANGE_DAYS} días`);
    err.status = 400;
    return next(err);
  }

  const represasNumeric = (parsed.represas || [])
    .map((r) => Number(r))
    .filter((n) => Number.isFinite(n));

  if (!represasNumeric.length) {
    const err = new Error('represas no puede estar vacío');
    err.status = 400;
    return next(err);
  }

  try {
    const apiKey = getGeminiApiKey();

    const dataset = await insightsData.buildInsightsDataset({
      fecha_ini: parsed.fecha_ini,
      fecha_fin: parsed.fecha_fin,
      represas: represasNumeric,
      rangeDays,
    });

    const insights = await aiService.generateInsights({
      apiKey,
      stats: {
        ...dataset.stats,
        meta: dataset.meta,
        idioma: parsed.idioma || 'es',
        nivelDetalle: parsed.nivelDetalle || 'normal',
      },
      idioma: parsed.idioma || 'es',
      nivelDetalle: parsed.nivelDetalle || 'normal',
    });

    res.json({
      ok: true,
      meta: {
        fecha_ini: parsed.fecha_ini,
        fecha_fin: parsed.fecha_fin,
        represas: dataset.meta.represas.map((r) => r.nombre),
        modelo: insights.modelo,
        cache: false,
      },
      insights: {
        resumen: insights.resumen,
        hallazgos: insights.hallazgos,
        riesgos: insights.riesgos,
        recomendaciones: insights.recomendaciones,
        anomalías: insights.anomalias || [],
        preguntasSugeridas: insights.preguntasSugeridas || [],
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
