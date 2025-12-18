# Centro de Control de Represas

Aplicación full-stack para monitoreo hidrológico y generación de insights con IA.

## Requisitos

* Node.js v18+
* SQL Server
* API Key de Google Gemini

## Estructura

* `/src` (Root) -> Frontend React
* `/backend` -> Backend Node.js/Express

## Instalación

### Backend
1. Entrar a `cd backend`
2. `npm install`
3. Crear `.env` (ver ejemplo abajo)
4. `npm start`

### Frontend
1. `npm install`
2. `npm run dev`

## Configuración (.env Backend)

Usa `backend/.env.example` como referencia rápida.

Variables clave:
- `API_KEY`: clave que el frontend envía en `x-api-key`.
- `GEMINI_API_KEY`: clave de Google Gemini (no exponer en frontend).
- `GEMINI_MODEL`: modelo (ej. `gemini-2.0-flash`).
- `INSIGHTS_RATE_LIMIT_PER_MIN`: límite por minuto para `/insights`.
- `INSIGHTS_MAX_RANGE_DAYS`: rango máximo de fechas permitido (por defecto 366).

Ejemplo mínimo:
```env
PORT=3000
SQL_SERVER=localhost
SQL_DATABASE=REPRESAS
SQL_ENCRYPT=false
SQL_TRUST_CERT=true
API_KEY=my-secret-key-123
GEMINI_API_KEY=tu-api-key
```

## Configuración (.env Frontend)

El frontend utiliza una variable para la URL de la API (o usa un proxy en Vite).

## Ejemplos de API (Curl)

**Health Check:**
```bash
curl -H "x-api-key: my-secret-key-123" http://localhost:3000/api/v1/health
```

**Obtener Series de Represas:**
```bash
curl -H "x-api-key: my-secret-key-123" \
  "http://localhost:3000/api/v1/represas/series?fecha_ini=2023-10-01&fecha_fin=2023-10-07&represas=1,2"
```

**Generar Insights (IA):**
```bash
curl -X POST -H "x-api-key: my-secret-key-123" -H "Content-Type: application/json" \
  -d '{
    "fecha_ini": "2024-01-01",
    "fecha_fin": "2024-01-15",
    "represas": ["1", "2"],
    "idioma": "es",
    "nivelDetalle": "normal"
  }' \
  http://localhost:3000/api/v1/insights
```

**Ejemplo de respuesta (placeholders):**
```json
{
  "ok": true,
  "meta": {
    "fecha_ini": "2024-01-01",
    "fecha_fin": "2024-01-15",
    "represas": ["Represa A", "Represa B"],
    "modelo": "gemini-2.0-flash",
    "cache": false
  },
  "insights": {
    "resumen": "Las represas muestran niveles estables con ligera alza de caudales.",
    "hallazgos": ["Aumento de precipitación en la semana 2."],
    "riesgos": ["Posible rebose si continúa la tendencia."],
    "recomendaciones": ["Revisar compuertas y alertas tempranas."],
    "anomalías": [
      { "represa": "Represa A", "fecha": "2024-01-08", "motivo": "Cota fuera de rango esperado" }
    ],
    "preguntasSugeridas": ["¿Qué represa concentra mayor riesgo de rebose?"]
  }
}
```
