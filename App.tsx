import React, { useState } from 'react';
import { Filters } from './components/Filters';
import { TabRepresas } from './components/TabRepresas';
import { TabCentrales } from './components/TabCentrales';
import { TabInsights } from './components/TabInsights';
import { FilterState } from './types';
import { TabAnual } from './components/TabAnual';
import { TabSimulador } from './components/TabSimulador';

// Default dates: last 7 days
const today = new Date();
const lastWeek = new Date();
lastWeek.setDate(today.getDate() - 7);
const now = new Date();
const mes = now.toISOString().slice(0, 7);
const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

const initialFilters: FilterState = {
  mes,
  fechaIni: start.toISOString().slice(0, 10),
  fechaFin: end.toISOString().slice(0, 10),
  represas: [],
  centrales: [],
  canales: [],
};

function App() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [activeTab, setActiveTab] = useState<'represas' | 'centrales' | 'canales' | 'anual' | 'simulador' | 'insights'>('represas');
  const [isConnected, setIsConnected] = useState(true); // Assuming connected for UX

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans">
      {/* Sidebar Filters */}
      <Filters filters={filters} onFilterChange={setFilters} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white">
              <i className="fas fa-water"></i>
            </div>
            <h1 className="text-xl font-bold text-slate-800">Centro de Control de Represas</h1>
          </div>
        </header>

        {/* Tabs Navigation */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 pt-4 flex space-x-1 overflow-x-auto">
          {[
            { id: 'represas', label: 'Represas', icon: 'fa-database' },
            { id: 'centrales', label: 'Centrales', icon: 'fa-bolt' },
            { id: 'canales', label: 'Canales', icon: 'fa-grip-lines' },
            { id: 'anual', label: 'Anual', icon: 'fa-chart-column' },
            { id: 'simulador', label: 'Simulador', icon: 'fa-sliders' },
            { id: 'insights', label: 'Insights IA', icon: 'fa-stars text-purple-500' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === tab.id
                  ? 'bg-white border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              <i className={`fas ${tab.icon}`}></i>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <main className="flex-1 overflow-y-auto p-6 bg-slate-100">
          {activeTab === 'represas' && <TabRepresas filters={filters} />}
          {activeTab === 'centrales' && <TabCentrales filters={filters} />}
          {activeTab === 'canales' && <div className="p-10 text-center text-slate-400">Módulo de Canales en desarrollo...</div>}
          {activeTab === 'anual' && <TabAnual filters={filters} />}
          {activeTab === 'simulador' && <TabSimulador filters={filters} />}
          {activeTab === 'insights' && <TabInsights filters={filters} />}
        </main>
      </div>
    </div>
  );
}

export default App;