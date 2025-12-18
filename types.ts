export interface FilterState {
  fechaIni: string;
  fechaFin: string;
  mes?: string;
  represas: string[];
  centrales: string[];
  canales: string[];
}

export interface KPI {
  label: string;
  value: string | number;
  unit: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export interface ChartData {
  fecha: string;
  [key: string]: string | number;
}

export interface RepresaKPI {
  id_represa: number;
  represa: string;
  VOL_BRUTO: number;
  VOL_UTIL: number;
  COTA: number;
  DESCARGA: number;
  REBOSE: number;
  PRECIP: number;
}

export interface InsightResponse {
  analysis: string;
  timestamp: string;
}

export interface MetaEntity {
  id: number;
  nombre: string;
}