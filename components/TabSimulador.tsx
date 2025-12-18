import React, { useEffect, useMemo, useState } from "react";
import { FilterState } from "../types";
import { apiService } from "../services/apiService";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";

type SeriesRow = { fecha: string; [key: string]: any };

function normalizeFecha(f: string) {
  if (!f) return "";
  return String(f).includes("T") ? String(f).split("T")[0] : String(f);
}

function daysInMonthUTC(year: number, month0: number) {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function detectGranularity(rows: SeriesRow[]) {
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

export const TabSimulador: React.FC<{ filters: FilterState }> = ({ filters }) => {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [deltaPct, setDeltaPct] = useState(10); // +10% por defecto
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseSeries, setBaseSeries] = useState<SeriesRow[]>([]);

  const queryFilters = useMemo(
    () => ({
      ...filters,
      fechaIni: `${year}-01-01`,
      fechaFin: `${year}-12-31`,
    }),
    [filters, year]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    apiService
      .getRepresasSeries(queryFilters as any)
      .then((rows: any) => {
        const data = (rows?.data ?? rows ?? []) as SeriesRow[];
        const normalized = data.map((r) => ({ ...r, fecha: normalizeFecha(r.fecha) }));
        if (!alive) return;
        setBaseSeries(normalized);
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

  const caudalKey = useMemo(() => pickCaudalKey(baseSeries), [baseSeries]);

  const { overlaySeries, annualCompare } = useMemo(() => {
    if (!baseSeries.length || !caudalKey) {
      return { overlaySeries: [], annualCompare: null as any };
    }

    const gran = detectGranularity(baseSeries);
    const factor = 1 + deltaPct / 100;

    // Overlay: serie base vs escenario
    const overlay = baseSeries
      .filter((r) => typeof r[caudalKey] === "number")
      .map((r) => {
        const q = Number(r[caudalKey]);
        return {
          fecha: r.fecha,
          base: q,
          escenario: q * factor,
        };
      });

    // Agregados anuales (solo para este año)
    let secSum = 0;
    let qSecSumBase = 0;
    let qSecSumScen = 0;
    let volM3Base = 0;
    let volM3Scen = 0;

    for (const r of baseSeries) {
      const fecha = normalizeFecha(r.fecha);
      if (!fecha) continue;
      const d = new Date(fecha + "T00:00:00Z");
      const y = d.getUTCFullYear();
      const m0 = d.getUTCMonth();
      if (y !== year) continue;

      const q = Number(r[caudalKey]);
      if (!Number.isFinite(q)) continue;

      let seconds = 86400;
      if (gran === "monthly") seconds = daysInMonthUTC(y, m0) * 86400;

      secSum += seconds;

      qSecSumBase += q * seconds;
      qSecSumScen += q * factor * seconds;

      volM3Base += q * seconds;
      volM3Scen += q * factor * seconds;
    }

    const qAvgBase = secSum ? qSecSumBase / secSum : NaN;
    const qAvgScen = secSum ? qSecSumScen / secSum : NaN;

    const volMm3Base = volM3Base / 1e6;
    const volMm3Scen = volM3Scen / 1e6;

    const compare = {
      year: String(year),
      vol_base: volMm3Base,
      vol_esc: volMm3Scen,
      delta_vol: volMm3Scen - volMm3Base,
      q_base: qAvgBase,
      q_esc: qAvgScen,
      delta_q: qAvgScen - qAvgBase,
    };

    return { overlaySeries: overlay, annualCompare: compare };
  }, [baseSeries, caudalKey, deltaPct, year]);

  return (
    <div className="space-y-6">
      {/* Header / Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Simulador (Represas)</h2>
            <p className="text-sm text-slate-500">
              Escenario “what-if”: aumentar/disminuir caudal ({caudalKey ?? "DESCARGA"}) y ver impacto en volumen anual.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Año</label>
              <input
                type="number"
                className="w-28 border border-slate-300 rounded px-2 py-1 text-sm"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm text-slate-600">
                Δ Caudal: <span className="font-semibold">{deltaPct}%</span>
              </label>
              <input
                type="range"
                min={-50}
                max={100}
                step={1}
                value={deltaPct}
                onChange={(e) => setDeltaPct(Number(e.target.value))}
                className="w-64"
              />
            </div>
          </div>
        </div>

        {loading && <div className="mt-3 text-sm text-slate-500">Cargando…</div>}
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        {!loading && !error && !baseSeries.length && (
          <div className="mt-3 text-sm text-slate-500">Sin datos para el año seleccionado.</div>
        )}
        {!loading && !error && baseSeries.length > 0 && !caudalKey && (
          <div className="mt-3 text-sm text-amber-700">
            No encuentro una variable de caudal (DESCARGA/REBOSE) en la serie. Revisa tu endpoint /represas/series.
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {annualCompare && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs uppercase font-semibold text-slate-500">Caudal prom. base (m³/s)</div>
            <div className="text-2xl font-bold text-slate-800">{formatQ(annualCompare.q_base)}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs uppercase font-semibold text-slate-500">Caudal prom. escenario (m³/s)</div>
            <div className="text-2xl font-bold text-slate-800">{formatQ(annualCompare.q_esc)}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs uppercase font-semibold text-slate-500">Volumen anual base (Mm³)</div>
            <div className="text-2xl font-bold text-slate-800">{formatMm3(annualCompare.vol_base)}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="text-xs uppercase font-semibold text-slate-500">Δ Volumen (Mm³)</div>
            <div className="text-2xl font-bold text-slate-800">{formatMm3(annualCompare.delta_vol)}</div>
          </div>
        </div>
      )}

      {/* Overlay chart */}
      {overlaySeries.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-800 mb-2">
            Serie temporal: Caudal Base vs Escenario
          </h3>

          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overlaySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="fecha" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "10px",
                    border: "none",
                    boxShadow: "0 8px 20px rgba(0,0,0,0.10)",
                  }}
                  formatter={(value: any, name: any) => {
                    const label = name === "base" ? "Base (m³/s)" : "Escenario (m³/s)";
                    return [formatQ(Number(value)), label];
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="base" name="Base (m³/s)" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line
                  type="monotone"
                  dataKey="escenario"
                  name={`Escenario (m³/s) (${deltaPct >= 0 ? "+" : ""}${deltaPct}%)`}
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Bar compare */}
      {annualCompare && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-800 mb-2">Comparación anual (Mm³)</h3>

          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[annualCompare]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "10px",
                    border: "none",
                    boxShadow: "0 8px 20px rgba(0,0,0,0.10)",
                  }}
                  formatter={(value: any, name: any) => {
                    const label = name === "vol_base" ? "Volumen base (Mm³)" : "Volumen escenario (Mm³)";
                    return [formatMm3(Number(value)), label];
                  }}
                />
                <Legend />
                <Bar dataKey="vol_base" name="Volumen base (Mm³)" fill="#93c5fd" />
                <Bar dataKey="vol_esc" name="Volumen escenario (Mm³)" fill="#86efac" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Nota: este simulador asume que el “caudal” es una serie promedio y calcula volumen integrando Q·Δt.
          </div>
        </div>
      )}
    </div>
  );
}; 