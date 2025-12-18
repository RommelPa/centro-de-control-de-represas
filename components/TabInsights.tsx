import React, { useState } from 'react';
import { FilterState, InsightResponse } from '../types';
import { apiService } from '../services/apiService';
import ReactMarkdown from 'react-markdown'; // Ensure this is installed or handle text rendering simply

// A simple markdown renderer in case libraries aren't available
const SimpleMarkdown = ({ text }: { text: string }) => {
  return (
    <div className="prose prose-sm max-w-none text-slate-700 space-y-4">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('###')) return <h3 key={i} className="text-lg font-bold text-slate-800 mt-4">{line.replace('###', '')}</h3>;
        if (line.startsWith('####')) return <h4 key={i} className="text-md font-semibold text-slate-800 mt-3">{line.replace('####', '')}</h4>;
        if (line.startsWith('*')) return <li key={i} className="ml-4 list-disc marker:text-blue-500">{line.replace('*', '')}</li>;
        return <p key={i} className="leading-relaxed">{line}</p>;
      })}
    </div>
  );
};

export const TabInsights: React.FC<{ filters: FilterState }> = ({ filters }) => {
  const [insight, setInsight] = useState<InsightResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const generateReport = async () => {
    setLoading(true);
    // Fetch some context data to send to AI
    const contextData = await apiService.getRepresasKPI(filters);
    const result = await apiService.generateInsights(filters, contextData);
    setInsight(result);
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="bg-gradient-to-r from-indigo-600 to-purple-700 rounded-lg p-6 text-white shadow-xl flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold mb-2"> <i className="fas fa-brain mr-2"></i>IA Assistant</h2>
          <p className="text-indigo-100 opacity-90">Genera reportes operativos automáticos basados en los datos visibles.</p>
        </div>
        <button 
          onClick={generateReport}
          disabled={loading}
          className={`px-6 py-3 rounded-full font-bold shadow-lg transition-all ${loading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-white text-indigo-700 hover:bg-indigo-50 hover:scale-105'}`}
        >
          {loading ? (
            <span><i className="fas fa-circle-notch fa-spin mr-2"></i>Analizando...</span>
          ) : (
            <span><i className="fas fa-magic mr-2"></i>Generar Reporte</span>
          )}
        </button>
      </div>

      {insight && (
        <div className="bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex justify-between items-center">
            <h3 className="font-bold text-slate-700">Resumen Ejecutivo</h3>
            <span className="text-xs text-slate-400">Generado: {new Date(insight.timestamp).toLocaleTimeString()}</span>
          </div>
          <div className="p-6">
            <SimpleMarkdown text={insight.analysis} />
          </div>
          <div className="bg-yellow-50 px-6 py-3 border-t border-yellow-100 flex items-start gap-3">
             <i className="fas fa-exclamation-triangle text-yellow-600 mt-1"></i>
             <p className="text-sm text-yellow-800">
               Este reporte es generado por IA. Por favor, verifique los datos críticos en los tableros de Represas y Centrales antes de tomar decisiones operativas.
             </p>
          </div>
        </div>
      )}
    </div>
  );
};