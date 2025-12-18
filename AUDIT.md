# AUDIT — Centro de Control de Represas

## Mapa de arquitectura
- Frontend (React + Vite, TypeScript) vive en la raíz del repo.
  - Entrada `index.tsx`, vistas principales en `App.tsx` con pestañas y componentes bajo `components/`.
  - Consumo de API centralizado en `services/apiService.ts` usando `VITE_API_URL` y `VITE_API_KEY`.
- Backend (Node.js + Express) en `/backend`.
  - `src/server.js` levanta Express y aplica middleware básicos.
  - Rutas en `src/routes/api.js` (`/api/v1/*`) consumen SQL Server a través de `src/db/pool.js`.
  - Autenticación por header `x-api-key` en `src/middleware/auth.js`.
  - Capa de datos: `src/db/pool.js` crea un pool global `mssql/msnodesqlv8` con timeouts configurables por env.
  - Endpoint IA (`/api/v1/insights`) usa `@google/genai` con `GOOGLE_API_KEY`.

Flujo general: UI → `services/apiService` → peticiones HTTP a `/api/v1/*` → middleware (`helmet`, `cors`, `auth`) → controladores en `routes/api.js` → queries parametrizadas a SQL Server vía pool compartido → respuesta JSON `{ ok, data }`.

## Hallazgos priorizados

### P0 (crítico)
1. **Exposición de configuración sensible en logs** — `backend/src/server.js` imprime variables de entorno (`PORT`, `CORS_ORIGIN`) al arrancar, filtrando secretos en logs. **Impacto**: fuga de configuración/secretos. **Propuesta**: eliminar logs de env y usar logging controlado.
2. **Comparación insegura de API key** — `backend/src/middleware/auth.js` compara con `===`, vulnerable a timing attacks y mensajes de error diferenciados. **Impacto**: facilita enumeración de claves. **Propuesta**: comparación en tiempo constante (`crypto.timingSafeEqual`), respuestas genéricas y sin logs de headers.
3. **CORS permisivo/mal configurado** — `server.js` usa un string único (`process.env.CORS_ORIGIN || 'http://localhost:3000'`) e ignora la lista predefinida; no valida orígenes dinámicamente. **Impacto**: riesgo de CSRF/exfiltración si el env queda abierto. **Propuesta**: lista blanca (CSV en env) y rechazo explícito de orígenes no permitidos.
4. **Sin rate limiting** — No hay protección contra abuso en endpoints sensibles (incluido IA). **Impacto**: DoS y costos elevados. **Propuesta**: `express-rate-limit` configurable por env.
5. **Manejo de errores inconsistente y verboso** — `formatError` devuelve `details` con mensajes internos (SQL) y no hay middleware global; fallos no controlados exponen información. **Impacto**: fuga de detalles internos y respuestas no uniformes. **Propuesta**: middleware global `{ ok:false, code, message }`, sin stack en producción.
6. **Validación insuficiente** — Endpoints usan validación manual básica; `/insights` acepta payload libre y las queries no se normalizan con un esquema. **Impacto**: entradas malformadas, posible presión al IA/DB. **Propuesta**: zod para query/body (fechas, CSV numérico, prompt obligatorio con límites).
7. **Higiene del repo** — `.gitignore` no incluye `.env`; no hay `.env.example` separado para frontend/backend. **Impacto**: riesgo de commitear secretos, DX pobre. **Propuesta**: añadir ignores y ejemplos con placeholders.

### P1
1. **Logging de DB/IA insuficiente y no estructurado** — Solo `console.error` en `formatError`; no hay trazas mínimas ni correlación. **Impacto**: difícil observabilidad y detección de abuso. **Propuesta**: logging estructurado (pino o similar) y sanitizado.
2. **Frontend sin cliente HTTP reutilizable** — `services/apiService.ts` usa `fetch` directo sin timeouts ni manejo de errores unificado. **Impacto**: UX inconsistente ante fallos. **Propuesta**: cliente API centralizado con timeouts y mapeo de errores.
3. **Sin CI** — No hay workflows de GitHub Actions para lint/test/build. **Impacto**: riesgo de regresiones. **Propuesta**: pipeline con cache de npm, lint/typecheck/build/test.
4. **Chunk único grande en build** — Vite reporta chunk >500 kB. **Impacto**: carga inicial lenta. **Propuesta**: code splitting/lazy routes donde aplique.

### P2
1. **Re-render potencial en componentes grandes** — `App.tsx` renderiza pestañas completas sin memoización selectiva. **Impacto**: consumo innecesario en vistas pesadas. **Propuesta**: memo/useCallback en componentes críticos tras medir.
2. **Documentación mínima** — README no explica scripts, troubleshooting ni variables de entorno por entorno. **Impacto**: curva de aprendizaje mayor. **Propuesta**: ampliar README en PR de DX.

## Checklist de seguridad (estado)
- [ ] Headers de seguridad reforzados (Helmet está, falta CSP/tuneo).
- [ ] Rate limiting configurable aplicado.
- [ ] CORS restringido a lista blanca.
- [ ] Autenticación por API key con comparación constante y errores genéricos.
- [ ] Validación de entrada con esquema (zod/joi) en todos los endpoints expuestos.
- [ ] Manejo de errores centralizado, sin stack/secretos en producción.
- [ ] Variables sensibles ignoradas en VCS y ejemplos `.env.example` presentes.
- [ ] Queries SQL parametrizadas y pool reutilizable (parcialmente OK).
- [ ] Tests de seguridad/smoke para middleware crítico.
