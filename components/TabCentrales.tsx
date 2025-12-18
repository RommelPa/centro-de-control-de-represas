import React, { useEffect, useState } from 'react';
import { FilterState, ChartData } from '../types';
import { apiService } from '../services/apiService';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export const TabCentrales: React.FC<{ filters: FilterState }> = ({ filters }) => {
  const [series, setSeries] = useState<ChartData[]>([]);
  
  useEffect(() => {
    apiService.getCentralesSeries(filters).then(setSeries);
  }, [filters]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white p-4 rounded-lg shadow border-t-4 border-amber-500">
          <h3 className="text-lg font-bold text-slate-700 mb-4 flex justify-between items-center">
            Generación: Programado vs Turbinado
            <button className="text-xs bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded text-slate-600 transition">
              <i className="fas fa-download mr-1"></i> CSV
            </button>
          </h3>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="fecha" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} label={{ value: 'Caudal (m³/s)', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend verticalAlign="top" height={36}/>
                <Line type="step" dataKey="QPROG_CHV" name="Q. Programado" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="QTURB_CHV" name="Q. Turbinado" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};