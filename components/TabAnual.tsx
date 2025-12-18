import React, { useEffect, useMemo, useState } from "react";
import { FilterState } from "../types";
import { apiService } from "../services/apiService";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

type SeriesRow = { fecha: string; [key: string]: any };

function normalizeFecha(f: string) {
  if (!f) return "";
  return String(f).includes("T") ? String(f).split("T")[0] : String(f);
}

function daysInMonthUTC(year: number, month0: number) {
  // month0: 0..11
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function detectGranularity(rows: SeriesRow[]) {
  // Heurística: si el delta mediano entre puntos es ~1 día => daily, si es >= ~25 => monthly
  const dates = rows
    .map((r) => normalizeFecha(r.fecha))
    .filter(Boolean)
    .slice(0, 40)
    .map((d) => new Date(d + "T00:00:00Z").getTime())
    .sort((a, b) => a - b);

  if (dates.length < 3) return "daily";

  const deltas = [];
  for (let i = 1; i < dates.length; i++) {
    const dd = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
    if (Number.isFinite(dd) && dd > 0) deltas.push(dd);
  }
  deltas.sort((a, b) => a - b);
  const mid = deltas[Math.floor(deltas.length / 2)] ?? 1;

  return mid >= 25 ? "monthly" : "daily";
}

function pickCaudalKey(rows: SeriesRow[]) {
  const candidates = ["DESCARGA", "REBOSE"];
  for (const k of candidates) {
    if (rows.some((r) => typeof r?.[k] === "number")) return k;
  }
  return null;
}

function formatMm3(x: number) {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("es-BO", { maximumFractionDigits: 2 });
}

function formatQ(x: number) {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("es-BO", { maximumFractionDigits: 2 });
}

export const TabAnual: React.FC<{ filters: FilterState }> = ({ filters }) => {
  const nowYear = new Date().getFullYear();
  const [startYear, setStartYear] = useState(nowYear - 5);
  const [endYear, setEndYear] = useState(nowYear);
  const [volUtilMode, setVolUtilMode] = useState<"end" | "avg">("end");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesRow[]>([]);

  // Rango anual para consultar series
  const queryFilters = useMemo(() => {
    const fy0 = Math.min(startYear, endYear);
    const fy1 = Math.max(startYear, endYear);
    return {
      ...filters,
      fechaIni: `${fy0}-01-01`,
      fechaFin: `${fy1}-12-31`,
    };
  }, [filters, startYear, endYear]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    apiService
      // Si tu apiService ya acepta granularity, puedes pasarla,
      // pero esto funciona igual si no: (apiService as any).getRepresasSeries(queryFilters, "month")
      .getRepresasSeries(queryFilters as any)
      .then((rows: any) => {
        const data = (rows?.data ?? rows ?? []) as SeriesRow[];
        const normalized = data.map((r) => ({ ...r, fecha: normalizeFecha(r.fecha) }));
        if (!alive) return;
        setSeries(normalized);
      })
      .catch((e: any) => {
        if (!alive) return;
        setError(e?.message ?? "Error cargando series");
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [queryFilters]);

  const annualRows = useMemo(() => {
    if (!series.length) return [];

    const gran = detectGranularity(series);
    const caudalKey = pickCaudalKey(series);

    // Agrupar por año
    type Acc = {
      secSum: number;
      qSecSum: number;
      volM3Sum: number;
      volUtilSum: number;
      volUtilCount: number;
      volUtilLast: number | null;
      lastDate: string | null;
    };

    const byYear = new Map<number, Acc>();

    for (const r of series) {
      const fecha = normalizeFecha(r.fecha);
      if (!fecha) continue;

      const d = new Date(fecha + "T00:00:00Z");
      const y = d.getUTCFullYear();
      const m0 = d.getUTCMonth();

      const q = caudalKey ? Number(r[caudalKey]) : NaN;
      const volUtil = Number(r["VOL_UTIL"]);

      let seconds = 86400;
      if (gran === "monthly") {
        seconds = daysInMonthUTC(y, m0) * 86400;
      }

      const acc = byYear.get(y) ?? {
        secSum: 0,
        qSecSum: 0,
        volM3Sum: 0,
        volUtilSum: 0,
        volUtilCount: 0,
        volUtilLast: null,
        lastDate: null,
      };

      if (Number.isFinite(q)) {
        acc.secSum += seconds;
        acc.qSecSum += q * seconds;
        acc.volM3Sum += q * seconds;
      }

      if (Number.isFinite(volUtil)) {
        acc.volUtilSum += volUtil;
        acc.volUtilCount += 1;

        // "end": tomar el último valor del año
        if (!acc.lastDate || fecha > acc.lastDate) {
          acc.lastDate = fecha;
          acc.volUtilLast = volUtil;
        }
      }

      byYear.set(y, acc);
    }

    const out = Array.from(byYear.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, a]) => {
        const qAvg = a.secSum > 0 ? a.qSecSum / a.secSum : NaN;
        const volAnnualMm3 = a.volM3Sum / 1e6;

        const volUtilEnd = a.volUtilLast ?? NaN;
        const volUtilAvg = a.volUtilCount ? a.volUtilSum / a.volUtilCount : NaN;

        return {
          year: String(year),
          caudal_prom: qAvg,
          vol_anual_mm3: volAnnualMm3,
          vol_util: volUtilMode === "end" ? volUtilEnd : volUtilAvg,
        };
      });

    return out;
  }, [series, volUtilMode]);

  const caudalKey = useMemo(() => pickCaudalKey(series), [series]);

  return (
    <div className="space-y-6">
      {/* Header / Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Dashboard Anual (Represas)</h2>
            <p className="text-sm text-slate-500">
              Calcula caudal promedio anual ({caudalKey ?? "—"}), volumen anual (Mm³) e indicador de volumen útil.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Año inicio</label>
              <input
                type="number"
                className="w-28 border border-slate-300 rounded px-2 py-1 text-sm"
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Año fin</label>
              <input
                type="number"
                className="w-28 border border-slate-300 rounded px-2 py-1 text-sm"
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Vol. útil</label>
              <select
                className="border border-slate-300 rounded px-2 py-1 text-sm"
                value={volUtilMode}
                onChange={(e) => setVolUtilMode(e.target.value as any)}
              >
                <option value="end">Fin de año</option>
                <option value="avg">Promedio anual</option>
              </select>
            </div>
          </div>
        </div>

        {loading && <div className="mt-3 text-sm text-slate-500">Cargando…</div>}
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        {!loading && !error && !annualRows.length && (
          <div className="mt-3 text-sm text-slate-500">Sin datos para el rango seleccionado.</div>
        )}
      </div>

      {/* KPI Cards */}
      {annualRows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs uppercase font-semibold text-slate-500">Años</div>
            <div className="text-2xl font-bold text-slate-800">{annualRows.length}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs uppercase font-semibold text-slate-500">Volumen anual último año (Mm³)</div>
            <div className="text-2xl font-bold text-slate-800">
              {formatMm3(annualRows[annualRows.length - 1]?.vol_anual_mm3)}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs uppercase font-semibold text-slate-500">Caudal prom. último año (m³/s)</div>
            <div className="text-2xl font-bold text-slate-800">
              {formatQ(annualRows[annualRows.length - 1]?.caudal_prom)}
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {annualRows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-800 mb-2">
            Caudal promedio, Volumen anual y Volumen útil por año
          </h3>

          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={annualRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
                <YAxis yAxisId="left" stroke="#64748b" fontSize={12} />
                <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "10px",
                    border: "none",
                    boxShadow: "0 8px 20px rgba(0,0,0,0.10)",
                  }}
                  formatter={(value: any, name: any) => {
                    if (name === "vol_anual_mm3") return [formatMm3(Number(value)), "Volumen anual (Mm³)"];
                    if (name === "caudal_prom") return [formatQ(Number(value)), `Caudal prom. (${caudalKey ?? "m³/s"})`];
                    if (name === "vol_util") return [formatMm3(Number(value)), "Vol. útil (Mm³)"];
                    return [value, name];
                  }}
                />
                <Legend />

                {/* Barras: Volumen anual */}
                <Bar yAxisId="right" dataKey="vol_anual_mm3" name="Volumen anual (Mm³)" fill="#93c5fd" />

                {/* Línea: Caudal promedio */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="caudal_prom"
                  name={`Caudal prom. (${caudalKey ?? "m³/s"})`}
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                />

                {/* Línea: Volumen útil */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="vol_util"
                  name={`Vol. útil (Mm³) (${volUtilMode === "end" ? "fin de año" : "promedio"})`}
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tabla */}
      {annualRows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-800">Resumen anual</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2">Año</th>
                  <th className="text-left px-4 py-2">Caudal prom. (m³/s)</th>
                  <th className="text-left px-4 py-2">Volumen anual (Mm³)</th>
                  <th className="text-left px-4 py-2">Vol. útil (Mm³)</th>
                </tr>
              </thead>
              <tbody>
                {annualRows.map((r) => (
                  <tr key={r.year} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.year}</td>
                    <td className="px-4 py-2">{formatQ(r.caudal_prom)}</td>
                    <td className="px-4 py-2">{formatMm3(r.vol_anual_mm3)}</td>
                    <td className="px-4 py-2">{formatMm3(r.vol_util)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 text-xs text-slate-500 border-t border-slate-200">
            Nota: si tienes múltiples represas seleccionadas, la serie puede venir como promedio (según tu pivot del frontend).
          </div>
        </div>
      )}
    </div>
  );
};