import React, { useEffect, useMemo, useState } from 'react';
import { FilterState, InsightAnomaly, InsightResponse, MetaEntity } from '../types';
import { apiService } from '../services/apiService';

const SectionList: React.FC<{ title: string; items: string[]; emptyLabel?: string }> = ({ title, items, emptyLabel }) => (
  <div>
    <h4 className="font-semibold text-slate-800 mb-2">{title}</h4>
    {items?.length ? (
      <ul className="list-disc pl-5 space-y-1 text-slate-700">
        {items.map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-slate-500">{emptyLabel || 'Sin datos'}</p>
    )}
  </div>
);

export const TabInsights: React.FC<{ filters: FilterState }> = ({ filters }) => {
  const [represasMeta, setRepresasMeta] = useState<MetaEntity[]>([]);
  const [selectedRepresas, setSelectedRepresas] = useState<string[]>(filters.represas || []);
  const [fechaIni, setFechaIni] = useState(filters.fechaIni);
  const [fechaFin, setFechaFin] = useState(filters.fechaFin);
  const [idioma, setIdioma] = useState<'es' | 'en'>('es');
  const [nivelDetalle, setNivelDetalle] = useState<'breve' | 'normal' | 'tecnico'>('normal');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InsightResponse | null>(null);

  useEffect(() => {
    apiService.getMetaRepresas().then((data) => {
      setRepresasMeta(data);
      if (!selectedRepresas.length && data.length) {
        setSelectedRepresas(data.slice(0, 3).map((d) => d.id.toString()));
      }
    }).catch(() => setError('No se pudieron cargar las represas'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedRepresas(filters.represas || []);
    setFechaIni(filters.fechaIni);
    setFechaFin(filters.fechaFin);
  }, [filters]);

  const anomalies: InsightAnomaly[] = useMemo(() => {
    if (!result) return [];
    return (result.insights.anomalias || result.insights['anomalías'] || []) as InsightAnomaly[];
  }, [result]);

  const buildCopy = () => {
    if (!result) return '';
    const i = result.insights;
    const blocks = [
      `Resumen: ${i.resumen}`,
      `Hallazgos:\n- ${i.hallazgos?.join('\n- ') || 'Sin hallazgos'}`,
      `Riesgos:\n- ${i.riesgos?.join('\n- ') || 'Sin riesgos'}`,
      `Recomendaciones:\n- ${i.recomendaciones?.join('\n- ') || 'Sin recomendaciones'}`,
      `Anomalías:\n- ${(anomalies || []).map((a) => `${a.represa} ${a.fecha}: ${a.motivo}`).join('\n- ') || 'Sin anomalías'}`,
      `Preguntas sugeridas:\n- ${i.preguntasSugeridas?.join('\n- ') || 'Sin sugerencias'}`,
    ];
    return blocks.join('\n\n');
  };

  const copyToClipboard = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildCopy());
      setError(null);
    } catch (err) {
      setError('No se pudo copiar el texto. Intenta seleccionar y copiar manualmente.');
    }
  };

  const generateReport = async () => {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      if (!fechaIni || !fechaFin) throw new Error('Selecciona un rango de fechas válido.');
      if (!selectedRepresas.length) throw new Error('Elige al menos una represa.');

      const response = await apiService.generateInsights({
        fecha_ini: fechaIni,
        fecha_fin: fechaFin,
        represas: selectedRepresas,
        idioma,
        nivelDetalle,
      });
      setResult(response);
    } catch (err: any) {
      setError(err?.message || 'No se pudo generar insights');
    } finally {
      setLoading(false);
    }
  };

  const selectedLabels = selectedRepresas
    .map((id) => represasMeta.find((r) => r.id.toString() === id)?.nombre || id)
    .join(', ');

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <i className="fas fa-brain text-purple-600"></i> Insights IA
            </h2>
            <p className="text-sm text-slate-500">Selecciona represas y rango de fechas para generar hallazgos automáticos.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={generateReport}
              disabled={loading}
              className={`px-4 py-2 rounded-md font-semibold shadow ${loading ? 'bg-indigo-300 cursor-not-allowed text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
            >
              {loading ? <span><i className="fas fa-spinner fa-spin mr-2"></i>Generando...</span> : <span><i className="fas fa-magic mr-2"></i>Generar Insights</span>}
            </button>
            <button
              onClick={generateReport}
              disabled={loading}
              className="px-4 py-2 rounded-md font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <i className="fas fa-rotate-right mr-2"></i>Reintentar
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Represas</label>
            <div className="border border-slate-200 rounded-md p-2 max-h-40 overflow-y-auto space-y-1">
              {represasMeta.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedRepresas.includes(r.id.toString())}
                    onChange={() => {
                      setSelectedRepresas((prev) =>
                        prev.includes(r.id.toString())
                          ? prev.filter((x) => x !== r.id.toString())
                          : [...prev, r.id.toString()]
                      );
                    }}
                  />
                  <span className="truncate">{r.nombre}</span>
                </label>
              ))}
              {represasMeta.length === 0 && <p className="text-sm text-slate-400">Cargando...</p>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Rango de fechas</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={fechaIni}
                onChange={(e) => setFechaIni(e.target.value)}
                className="border border-slate-200 rounded-md px-2 py-1 text-sm"
              />
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                className="border border-slate-200 rounded-md px-2 py-1 text-sm"
              />
            </div>
            <p className="text-xs text-slate-500">Represas seleccionadas: {selectedLabels || 'Ninguna'}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Idioma</label>
              <select
                value={idioma}
                onChange={(e) => setIdioma(e.target.value as 'es' | 'en')}
                className="w-full border border-slate-200 rounded-md px-2 py-1 text-sm"
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Detalle</label>
              <select
                value={nivelDetalle}
                onChange={(e) => setNivelDetalle(e.target.value as 'breve' | 'normal' | 'tecnico')}
                className="w-full border border-slate-200 rounded-md px-2 py-1 text-sm"
              >
                <option value="breve">Breve</option>
                <option value="normal">Normal</option>
                <option value="tecnico">Técnico</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm flex items-start gap-2">
            <i className="fas fa-circle-exclamation mt-0.5"></i>
            <div>
              <p className="font-semibold">Error</p>
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 text-center text-slate-600">
          <i className="fas fa-circle-notch fa-spin mr-2"></i>Generando insights...
        </div>
      )}

      {!loading && !result && !error && (
        <div className="bg-white rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-500">
          Selecciona filtros y pulsa <strong>Generar Insights</strong> para ver el análisis.
        </div>
      )}

      {result && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-800">Resumen ejecutivo</h3>
              <p className="text-xs text-slate-500">
                {result.meta.fecha_ini} → {result.meta.fecha_fin} · {result.meta.represas.join(', ')} · Modelo {result.meta.modelo}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyToClipboard}
                disabled={loading}
                className="px-3 py-1.5 border border-slate-200 rounded-md text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                <i className="fas fa-copy mr-1"></i>Copiar
              </button>
              <button
                onClick={generateReport}
                disabled={loading}
                className="px-3 py-1.5 border border-slate-200 rounded-md text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                <i className="fas fa-rotate mr-1"></i>Reintentar
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <p className="text-slate-700 leading-relaxed">{result.insights.resumen}</p>

            <SectionList title="Hallazgos" items={result.insights.hallazgos || []} emptyLabel="Sin hallazgos destacados" />
            <SectionList title="Riesgos" items={result.insights.riesgos || []} emptyLabel="Sin riesgos detectados" />
            <SectionList title="Recomendaciones" items={result.insights.recomendaciones || []} emptyLabel="Sin recomendaciones" />

            <div>
              <h4 className="font-semibold text-slate-800 mb-2">Anomalías</h4>
              {anomalies.length ? (
                <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
                  {anomalies.map((a, idx) => (
                    <li key={`${a.represa}-${a.fecha}-${idx}`} className="p-3 flex justify-between items-center text-sm">
                      <div>
                        <p className="font-medium text-slate-800">{a.represa}</p>
                        <p className="text-slate-600">{a.motivo}</p>
                      </div>
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">{a.fecha}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Sin anomalías reportadas.</p>
              )}
            </div>

            <SectionList
              title="Preguntas sugeridas"
              items={result.insights.preguntasSugeridas || []}
              emptyLabel="Sin preguntas sugeridas"
            />
          </div>

          <div className="bg-yellow-50 px-6 py-3 border-t border-yellow-100 flex items-start gap-3 text-sm text-yellow-800">
            <i className="fas fa-exclamation-triangle mt-1"></i>
            <p>
              Este reporte es generado por IA. Si faltan datos o hay valores atípicos, verifica con las series originales antes de tomar decisiones.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
