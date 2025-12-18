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

```env
PORT=3000
SQL_SERVER=localhost
SQL_DATABASE=REPRESAS
SQL_USER=sa
SQL_PASSWORD=your_password
SQL_ENCRYPT=false
SQL_TRUST_CERT=true
API_KEY=my-secret-key-123
CORS_ORIGIN=http://localhost:5173
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
  -d '{"filters": {"fechaIni": "2023-10-01", "fechaFin": "2023-10-07"}, "contextData": []}' \
  http://localhost:3000/api/v1/insights
```