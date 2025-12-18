import { FilterState, InsightResponse, RepresaKPI, ChartData, MetaEntity } from '../types';

// --- Config ---
const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

if (!API_KEY) {
  console.warn('⚠️ VITE_API_KEY no está definido');
}

const headers: HeadersInit = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

// --- Helper fetch (SIN mocks) ---
const apiFetch = async <T>(endpoint: string): Promise<T> => {
  const url = `${API_URL}${endpoint}`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `API ${endpoint} failed → ${res.status} ${res.statusText}\n${text}`
    );
  }

  const json = await res.json();

  if (!json || json.ok !== true) {
    throw new Error(
      `API ${endpoint} returned ok=false → ${JSON.stringify(json)}`
    );
  }

  return json.data as T;
};

// --- Querystring helper ---
const qs = (params: Record<string, string | undefined>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v && v.trim() !== '') sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
};

const normalizeFecha = (f: string) => (f?.includes('T') ? f.split('T')[0] : f);

const pivotTallSeries = (rows: any[]): ChartData[] => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const r0 = rows[0];
  const isTall = r0 && 'variable' in r0 && 'valor' in r0;

  // Si ya viene wide, solo normaliza fecha
  if (!isTall) {
    return rows.map((r) => ({ ...r, fecha: normalizeFecha(r.fecha) }));
  }

  // Tall → Wide (promedia si hay varias entidades seleccionadas)
  const acc = new Map<string, Record<string, { sum: number; count: number }>>();

  for (const r of rows) {
    const fecha = normalizeFecha(String(r.fecha));
    const variable = String(r.variable);
    const valor = Number(r.valor);

    if (!Number.isFinite(valor)) continue;

    const byVar = acc.get(fecha) ?? {};
    const cell = byVar[variable] ?? { sum: 0, count: 0 };
    cell.sum += valor;
    cell.count += 1;
    byVar[variable] = cell;

    acc.set(fecha, byVar);
  }

  const out: ChartData[] = [];
  for (const [fecha, byVar] of acc) {
    const row: any = { fecha };
    for (const [k, v] of Object.entries(byVar)) {
      row[k] = v.sum / v.count;
    }
    out.push(row);
  }

  out.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  return out;
};

// --- Guards ---
const hasDateRange = (filters: FilterState) =>
  Boolean(filters.fechaIni && filters.fechaFin);

// --- API Service ---
export const apiService = {
  // ===== Metadata =====
  getMetaRepresas: () =>
    apiFetch<MetaEntity[]>('/meta/represas'),

  getMetaCentrales: () =>
    apiFetch<MetaEntity[]>('/meta/centrales'),

  getMetaCanales: () =>
    apiFetch<MetaEntity[]>('/meta/canales'),

  // ===== Represas =====
  getRepresasKPI: (filters: FilterState) => {
    if (!hasDateRange(filters)) return Promise.resolve([]);
    return apiFetch<RepresaKPI[]>(
      `/represas/kpis${qs({
        fecha_ini: filters.fechaIni,
        fecha_fin: filters.fechaFin,
        represas: filters.represas?.length ? filters.represas.join(',') : undefined,
      })}`
    );
  },

  getRepresasSeries: (filters: FilterState, granularity?: 'day' | 'week' | 'month') => {
    if (!hasDateRange(filters)) return Promise.resolve([]);
    return apiFetch<any[]>(
      `/represas/series${qs({
        fecha_ini: filters.fechaIni,
        fecha_fin: filters.fechaFin,
        represas: filters.represas?.length ? filters.represas.join(',') : undefined,
        granularity,
      })}`
    ).then(pivotTallSeries);
  },

  getCentralesSeries: (filters: FilterState, granularity?: 'day' | 'week' | 'month') => {
    if (!hasDateRange(filters)) return Promise.resolve([]);
    return apiFetch<any[]>(
      `/centrales/series${qs({
        fecha_ini: filters.fechaIni,
        fecha_fin: filters.fechaFin,
        centrales: filters.centrales?.length ? filters.centrales.join(',') : undefined,
        granularity,
      })}`
    ).then(pivotTallSeries);
  },

  getCanalesSeries: (filters: FilterState, granularity?: 'day' | 'week' | 'month') => {
    if (!hasDateRange(filters)) return Promise.resolve([]);
    return apiFetch<any[]>(
      `/canales/series${qs({
        fecha_ini: filters.fechaIni,
        fecha_fin: filters.fechaFin,
        canales: filters.canales?.length ? filters.canales.join(',') : undefined,
        granularity,
      })}`
    ).then(pivotTallSeries);
  },

  // ===== Insights =====
  generateInsights: async (payload: {
    fecha_ini: string;
    fecha_fin: string;
    represas: string[];
    idioma?: 'es' | 'en';
    nivelDetalle?: 'breve' | 'normal' | 'tecnico';
  }): Promise<InsightResponse> => {
    const res = await fetch(`${API_URL}/insights`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Insights API failed → ${res.status} ${res.statusText}\n${text}`
      );
    }

    const json = await res.json();

    if (!json || json.ok !== true) {
      throw new Error(
        `Insights API returned ok=false → ${JSON.stringify(json)}`
      );
    }

    return json as InsightResponse;
  },
};
