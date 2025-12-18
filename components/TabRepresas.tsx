import React, { useEffect, useState } from 'react';
import { FilterState, RepresaKPI, ChartData } from '../types';
import { apiService } from '../services/apiService';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export const TabRepresas: React.FC<{ filters: FilterState }> = ({ filters }) => {
  const [kpis, setKpis] = useState<RepresaKPI[]>([]);
  const [series, setSeries] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiService.getRepresasKPI(filters),
      apiService.getRepresasSeries(filters)
    ]).then(([kpiData, seriesData]) => {
      setKpis(kpiData);
      setSeries(seriesData);
      setLoading(false);
    });
  }, [filters]);

  if (loading) return <div className="p-10 text-center text-slate-400">Cargando datos de represas...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((represa) => (
          <div key={represa.id_represa} className="bg-white rounded-lg shadow border-l-4 border-blue-500 p-4">
            <h3 className="text-lg font-bold text-slate-700 mb-3 flex justify-between">
              {represa.represa}
              <i className="fas fa-water text-blue-300"></i>
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-500 text-xs uppercase">Vol. Útil</p>
                <p className="font-mono font-bold text-lg">{represa.VOL_UTIL?.toFixed(1)} <span className="text-xs font-normal text-slate-400">Mm³</span></p>
              </div>
              <div>
                <p className="text-slate-500 text-xs uppercase">Cota</p>
                <p className="font-mono font-bold text-lg">{represa.COTA?.toFixed(2)} <span className="text-xs font-normal text-slate-400">msnm</span></p>
              </div>
              <div>
                <p className="text-slate-500 text-xs uppercase">Descarga</p>
                <p className="font-mono font-bold text-lg">{represa.DESCARGA?.toFixed(1)} <span className="text-xs font-normal text-slate-400">m³/s</span></p>
              </div>
              <div>
                <p className="text-slate-500 text-xs uppercase">Precip.</p>
                <p className="font-mono font-bold text-lg text-blue-600">{represa.PRECIP?.toFixed(1)} <span className="text-xs font-normal text-slate-400">mm</span></p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-lg font-bold text-slate-700 mb-4">Evolución Volumen Útil y Cota</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="fecha" stroke="#64748b" fontSize={12} />
              <YAxis yAxisId="left" stroke="#3b82f6" fontSize={12} />
              <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={12} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Legend />
              <Area yAxisId="left" type="monotone" dataKey="VOL_UTIL" name="Vol. Útil (Mm³)" stroke="#3b82f6" fill="#93c5fd" fillOpacity={0.3} />
              <Area yAxisId="right" type="monotone" dataKey="COTA" name="Cota (msnm)" stroke="#10b981" fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};