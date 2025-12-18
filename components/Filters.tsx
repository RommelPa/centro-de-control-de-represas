import React, { useEffect, useState } from 'react';
import { FilterState, MetaEntity } from '../types';
import { apiService } from '../services/apiService';

interface FiltersProps {
  filters: FilterState;
  onFilterChange: (f: FilterState) => void;
}

export const Filters: React.FC<FiltersProps> = ({ filters, onFilterChange }) => {
  const [represasMeta, setRepresasMeta] = useState<MetaEntity[]>([]);
  const [centralesMeta, setCentralesMeta] = useState<MetaEntity[]>([]);
  const [canalesMeta, setCanalesMeta] = useState<MetaEntity[]>([]);
  const [localFilters, setLocalFilters] = useState<FilterState>(filters);

  useEffect(() => {
    apiService.getMetaRepresas().then(data => {
      setRepresasMeta(data);
      // Select all by default for demo
      if (data.length > 0 && filters.represas.length === 0) {
        setLocalFilters(prev => ({ ...prev, represas: data.map(d => d.id.toString()) }));
      }
    });
    apiService.getMetaCentrales().then(setCentralesMeta);
    apiService.getMetaCanales().then(setCanalesMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (key: keyof FilterState, value: any) => {
    setLocalFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleMultiSelect = (key: 'represas' | 'centrales' | 'canales', id: string) => {
    const current = localFilters[key];
    const newSelection = current.includes(id) 
      ? current.filter(x => x !== id)
      : [...current, id];
    handleChange(key, newSelection);
  };

  const applyFilters = () => {
    onFilterChange(localFilters);
  };

  const monthToRange = (monthYYYYMM: string) => {
  const [y, m] = monthYYYYMM.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // último día del mes
  return {
    fechaIni: start.toISOString().slice(0, 10),
    fechaFin: end.toISOString().slice(0, 10),
  };
  };

  return (
    <aside className="w-full md:w-64 bg-slate-850 text-slate-100 p-4 flex-shrink-0 border-r border-slate-700 overflow-y-auto h-full">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-blue-400">
        <i className="fas fa-filter"></i> Filtros
      </h2>

      <div className="space-y-6">
        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-2">
            Mes
          </label>

          <div className="flex flex-col gap-2">
            <input
              type="month"
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
              value={localFilters.mes ?? localFilters.fechaIni.slice(0, 7)}
              onChange={(e) => {
                const mes = e.target.value; // "YYYY-MM"
                const { fechaIni, fechaFin } = monthToRange(mes);
                setLocalFilters((prev) => ({ ...prev, mes, fechaIni, fechaFin }));
              }}
            />

            {/* opcional: mostrar el rango calculado */}
            <div className="text-xs text-slate-400">
              {localFilters.fechaIni} → {localFilters.fechaFin}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-2">Represas</label>
          <div className="max-h-32 overflow-y-auto space-y-1 bg-slate-800 p-2 rounded border border-slate-700">
            {represasMeta.map(r => (
              <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-700 p-1 rounded">
                <input 
                  type="checkbox" 
                  checked={localFilters.represas.includes(r.id.toString())}
                  onChange={() => handleMultiSelect('represas', r.id.toString())}
                  className="rounded text-blue-500 focus:ring-0 bg-slate-600 border-slate-500"
                />
                <span className="truncate">{r.nombre}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-400 mb-2">Centrales</label>
          <div className="max-h-32 overflow-y-auto space-y-1 bg-slate-800 p-2 rounded border border-slate-700">
            {centralesMeta.map(c => (
              <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-700 p-1 rounded">
                <input 
                  type="checkbox" 
                  checked={localFilters.centrales.includes(c.id.toString())}
                  onChange={() => handleMultiSelect('centrales', c.id.toString())}
                  className="rounded text-blue-500 focus:ring-0 bg-slate-600 border-slate-500"
                />
                <span className="truncate">{c.nombre}</span>
              </label>
            ))}
          </div>
        </div>

        <button 
          onClick={applyFilters}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded transition-colors shadow-lg shadow-blue-900/50"
        >
          Aplicar Filtros
        </button>
      </div>
    </aside>
  );
};