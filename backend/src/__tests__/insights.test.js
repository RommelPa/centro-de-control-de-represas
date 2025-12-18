const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'fake-key';
process.env.INSIGHTS_RATE_LIMIT_PER_MIN = '5';

const { app } = require('../app');
const aiService = require('../services/ai');
const dataService = require('../services/insights-data');

const startServer = (appInstance) =>
  new Promise((resolve) => {
    const server = appInstance.listen(0, () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });

test('POST /api/v1/insights rejects fecha_fin < fecha_ini', async () => {
  const { server, url } = await startServer(app);
  try {
    const res = await fetch(`${url}/api/v1/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({
        fecha_ini: '2024-05-10',
        fecha_fin: '2024-05-01',
        represas: ['1'],
      }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/v1/insights rejects empty represas', async () => {
  const { server, url } = await startServer(app);
  try {
    const res = await fetch(`${url}/api/v1/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({
        fecha_ini: '2024-05-01',
        fecha_fin: '2024-05-10',
        represas: [],
      }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/v1/insights requires API key', async () => {
  const { server, url } = await startServer(app);
  try {
    const res = await fetch(`${url}/api/v1/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha_ini: '2024-05-01',
        fecha_fin: '2024-05-10',
        represas: ['1'],
      }),
    });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/v1/insights returns insights with mocked services', async () => {
  const originalAI = aiService.generateInsights;
  const originalData = dataService.buildInsightsDataset;

  aiService.generateInsights = async () => ({
    resumen: 'OK',
    hallazgos: ['hallazgo'],
    riesgos: ['riesgo'],
    recomendaciones: ['recomendacion'],
    anomalias: [{ represa: 'Demo', fecha: '2024-05-02', motivo: 'fuera de rango' }],
    preguntasSugeridas: ['¿Qué represa tiene mayor variación?'],
    modelo: 'mock-model',
  });

  dataService.buildInsightsDataset = async () => ({
    stats: {
      rango: { fecha_ini: '2024-05-01', fecha_fin: '2024-05-10', dias: 10 },
      represas: [],
      daily: [],
      truncado: false,
    },
    meta: { represas: [{ id_represa: 1, nombre: 'Demo' }], granularity: 'day' },
  });

  const { server, url } = await startServer(app);

  try {
    const res = await fetch(`${url}/api/v1/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({
        fecha_ini: '2024-05-01',
        fecha_fin: '2024-05-10',
        represas: ['1'],
        idioma: 'es',
      }),
    });

    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.meta.modelo, 'mock-model');
    assert(Array.isArray(json.insights.hallazgos));
    assert.strictEqual(json.insights.hallazgos[0], 'hallazgo');
  } finally {
    aiService.generateInsights = originalAI;
    dataService.buildInsightsDataset = originalData;
    server.close();
  }
});

test('POST /api/v1/insights rejects invalid date format and includes requestId', async () => {
  const { server, url } = await startServer(app);
  try {
    const res = await fetch(`${url}/api/v1/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({
        fecha_ini: '2024/05/01',
        fecha_fin: '2024-05-10',
        represas: ['1'],
      }),
    });
    const json = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(json.ok, false);
    assert.ok(json.requestId);
    assert.ok(res.headers.get('x-request-id'));
  } finally {
    server.close();
  }
});

test('POST /api/v1/insights returns 200 with mocked Gemini and requestId header', async () => {
  const originalAI = aiService.generateInsights;
  const originalData = dataService.buildInsightsDataset;

  aiService.generateInsights = async () => ({
    resumen: 'OK',
    hallazgos: ['h1'],
    riesgos: ['r1'],
    recomendaciones: ['rec1'],
    anomalias: [],
    preguntasSugeridas: [],
    modelo: 'mock-model-2',
  });

  dataService.buildInsightsDataset = async () => ({
    stats: { rango: { fecha_ini: '2024-05-01', fecha_fin: '2024-05-10', dias: 10 }, represas: [], daily: [], truncado: false },
    meta: { represas: [{ id_represa: 1, nombre: 'Demo 2' }], granularity: 'day' },
  });

  const { server, url } = await startServer(app);

  try {
    const res = await fetch(`${url}/api/v1/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({
        fecha_ini: '2024-05-01',
        fecha_fin: '2024-05-10',
        represas: ['1'],
      }),
    });

    const json = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('x-request-id'));
    assert.strictEqual(json.meta.modelo, 'mock-model-2');
    assert.strictEqual(json.insights.resumen, 'OK');
  } finally {
    aiService.generateInsights = originalAI;
    dataService.buildInsightsDataset = originalData;
    server.close();
  }
});
