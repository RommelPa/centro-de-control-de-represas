const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db/pool');
const { GoogleGenAI } = require('@google/genai');

// --- UTILS ---
const formatData = (recordset) => ({ ok: true, data: recordset });

const formatError = (res, err) => {
  // Dev-friendly error details (no stack to client)
  console.error('❌ API ERROR:', err);

  const details =
    err?.originalError?.info?.message ||
    err?.message ||
    String(err);

  res.status(500).json({
    ok: false,
    error: 'Internal Server Error',
    details,
  });
};

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

const requireDateRange = (req, res) => {
  const { fecha_ini, fecha_fin } = req.query;
  const d1 = parseISODate(fecha_ini);
  const d2 = parseISODate(fecha_fin);
  if (!d1 || !d2) {
    res.status(400).json({ ok: false, error: 'fecha_ini y fecha_fin son requeridas (YYYY-MM-DD)' });
    return null;
  }
  if (d1 > d2) {
    res.status(400).json({ ok: false, error: 'fecha_ini debe ser <= fecha_fin' });
    return null;
  }
  return { d1, d2 };
};

const isCsvNums = (s) => !s || /^[0-9]+(,[0-9]+)*$/.test(String(s).trim());

// Auto-downsample to keep responses fast and charts usable
const normalizeGranularity = (req, rangeDays) => {
  const g = String(req.query.granularity || '').toLowerCase().trim();
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

// --- HEALTH ---
router.get('/health', async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1');
    res.json({ ok: true, data: { status: 'OK', db: 'Connected' } });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'DB Disconnected' });
  }
});

// --- METADATA ---
router.get('/meta/represas', async (req, res) => {
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
  } catch (err) { formatError(res, err); }
});

router.get('/meta/centrales', async (req, res) => {
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
  } catch (err) { formatError(res, err); }
});

router.get('/meta/canales', async (req, res) => {
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
  } catch (err) { formatError(res, err); }
});

// --- REPRESAS ---
router.get('/represas/kpis', async (req, res) => {
  const { fecha_ini, fecha_fin, represas } = req.query;
  const dr = requireDateRange(req, res);
  if (!dr) return;
  if (!isCsvNums(represas)) return res.status(400).json({ ok: false, error: 'represas debe ser CSV numérico' });

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, fecha_ini);
    request.input('fecha_fin', sql.Date, fecha_fin);
    request.input('represas_csv', sql.VarChar, represas || '');
    request.input('all_represas', sql.Bit, represas ? 0 : 1);

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
  } catch (err) { formatError(res, err); }
});

router.get('/represas/series', async (req, res) => {
  const { fecha_ini, fecha_fin, represas, variables } = req.query;
  const dr = requireDateRange(req, res);
  if (!dr) return;
  if (!isCsvNums(represas)) return res.status(400).json({ ok: false, error: 'represas debe ser CSV numérico' });
  if (!isCsvNums(variables)) return res.status(400).json({ ok: false, error: 'variables debe ser CSV numérico' });

  const rangeDays = daysBetweenInclusive(dr.d1, dr.d2);
  const granularity = normalizeGranularity(req, rangeDays);

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, fecha_ini);
    request.input('fecha_fin', sql.Date, fecha_fin);
    request.input('represas_csv', sql.VarChar, represas || '');
    request.input('variables_csv', sql.VarChar, variables || '');
    request.input('all_represas', sql.Bit, represas ? 0 : 1);
    request.input('all_vars', sql.Bit, variables ? 0 : 1);

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
  } catch (err) { formatError(res, err); }
});

// --- CENTRALES ---
router.get('/centrales/series', async (req, res) => {
  const { fecha_ini, fecha_fin, centrales, variables } = req.query;
  const dr = requireDateRange(req, res);
  if (!dr) return;
  if (!isCsvNums(centrales)) return res.status(400).json({ ok: false, error: 'centrales debe ser CSV numérico' });
  if (!isCsvNums(variables)) return res.status(400).json({ ok: false, error: 'variables debe ser CSV numérico' });

  const rangeDays = daysBetweenInclusive(dr.d1, dr.d2);
  const granularity = normalizeGranularity(req, rangeDays);

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, fecha_ini);
    request.input('fecha_fin', sql.Date, fecha_fin);
    request.input('centrales_csv', sql.VarChar, centrales || '');
    request.input('variables_csv', sql.VarChar, variables || '');
    request.input('all_centrales', sql.Bit, centrales ? 0 : 1);
    request.input('all_vars', sql.Bit, variables ? 0 : 1);

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
  } catch (err) { formatError(res, err); }
});

// --- CANALES ---
router.get('/canales/series', async (req, res) => {
  const { fecha_ini, fecha_fin, canales } = req.query;
  const dr = requireDateRange(req, res);
  if (!dr) return;
  if (!isCsvNums(canales)) return res.status(400).json({ ok: false, error: 'canales debe ser CSV numérico' });

  const rangeDays = daysBetweenInclusive(dr.d1, dr.d2);
  const granularity = normalizeGranularity(req, rangeDays);

  try {
    const pool = await poolPromise;
    const request = pool.request();
    request.input('fecha_ini', sql.Date, fecha_ini);
    request.input('fecha_fin', sql.Date, fecha_fin);
    request.input('canales_csv', sql.VarChar, canales || '');
    request.input('all_canales', sql.Bit, canales ? 0 : 1);

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
  } catch (err) { formatError(res, err); }
});

// --- INSIGHTS (GEMINI) ---
router.post('/insights', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: 'Missing GOOGLE_API_KEY' });

    const { prompt, context } = req.body || {};
    if (!prompt) return res.status(400).json({ ok: false, error: 'prompt is required' });

    const ai = new GoogleGenAI({ apiKey });

    const system = `
Eres un analista experto en operación de represas y generación hidroeléctrica.
Responde en español, con viñetas claras y recomendaciones accionables.
Si falta información, indica supuestos y pide datos específicos.
    `.trim();

    const user = `
PROMPT:
${prompt}

CONTEXTO (si aplica):
${JSON.stringify(context || {}, null, 2)}
    `.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
    });

    res.json({
      ok: true,
      data: {
        analysis: response.text,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Gemini Error:', err);
    res.status(500).json({ ok: false, error: 'Failed to generate insights' });
  }
});

module.exports = router;