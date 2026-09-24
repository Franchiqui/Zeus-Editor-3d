# ZEIA — Guía de implementación

Implementación de referencia de la **Zeus Editor 3D Integration API (ZEIA)** descrita en
`README.md` / `documentation.md`. Todo el código vive en **`api.ts`** (un solo archivo, ~2.3k líneas).

## Ejecutar

```bash
npm install          # dependencias (express, zod, swagger-ui-express, cors, dotenv, pocketbase)
npm run dev          # ts-node-dev con recarga en caliente
# o
npm run build && node dist/api.js   # compilado a dist/
```

Al arrancar imprime las URLs:

| Recurso | URL |
|---|---|
| API (base) | `http://localhost:3012/v1` |
| Swagger UI | `http://localhost:3012/api-docs` |
| OpenAPI 3.1 | `http://localhost:3012/openapi.json` |
| Health | `http://localhost:3012/health` |
| WebSocket | `ws://localhost:3012/ws/session/{id}` |
| SSE eventos | `http://localhost:3012/v1/events/stream` |

## Verificación

Smoke test integral (60 comprobaciones sobre arranque real del servidor):

```bash
node smoke-test.js     # -> "=== RESULTADO: 60 OK, 0 FALLOS ==="
```

Comprueba: system, pestañas/prompts, proyectos/sesiones, objetos, movimientos/animaciones
(con render asíncrono), plugins, efectos, exportación (con descarga), orquestación IA,
webhooks, auth, OpenAPI (58 rutas), handshake WebSocket y formato de error RFC 7807.

## Qué se implementa

- **6.1 Auth** — `POST /auth/token`, `POST /auth/refresh`, `POST|GET|DELETE /auth/api-keys`.
  Tokens opacos bearer (store en memoria) + API keys `zc_*`.
- **6.2 Proyectos y sesiones** — CRUD de proyectos + `POST /projects/{id}/sessions`, `DELETE /sessions/{id}`.
- **6.3 Pestañas y prompts (núcleo IA)** — 10 pestañas (`modeling, materials, lighting, animation,
  rigging, effects, plugins, render, export, scripting`) con `tools`, `prompt`, `prompt/render` y `schema`.
- **6.4 Plantillas** — CRUD + `apply`, `clone`, `versions` (versionado incremental).
- **6.5 Objetos 3D** — objetos por escena, `duplicate`, `parent` y `objects/batch`.
- **6.6 Movimiento y animación** — motions (keyframes, easing), animaciones, tracks, keyframes,
  `play`, `render` (job asíncrono) y `status`.
- **6.7 Plugins** — catálogo seed + `install/uninstall/enable/disable`, registro de manifest y `capabilities`.
- **6.8 Efectos** — catálogo + instancias, `apply`, `preview`.
- **6.9 Exportación** — gltf/glb/fbx/obj/usdz/mp4 con job asíncrono y `download`.
- **6.10 Orquestación IA** — `ai/plan` (parser de intención ES/EN → plan de acciones),
  `ai/execute` (con validación de tab/`tabs_allowed` y aprobación de acciones destructivas),
  `ai/context` y `ai/feedback`.
- **6.11 Webhooks y eventos** — registro de webhooks con entrega fire-and-forget,
  SSE `events/stream` y **WebSocket** `ws/session/{id}` (implementación mínima sin dependencias).
- **Errores** — RFC 7807 (`application/problem+json`) en 400/401/403/404/409/422/429/500.
- **Compatibilidad** — se mantienen los endpoints scaffold originales `GET/POST/PUT/DELETE /api/api_agente_3d-api`.

## Extra

- **OpenAPI 3.1** generado en código y servido en Swagger UI (`/api-docs`).
- **PocketBase opcional** — si defines `POCKETBASE_URL`, cada mutación se registra en la colección
  `zeia_audit` (best-effort, nunca bloquea). Sin `POCKETBASE_URL`, la API es 100 % en memoria.
- **Seguridad configurable** por entorno (ver `.env.example`).

## Notas de diseño

- Persistencia **en memoria** (fuente de verdad) con datos seed; ideal como puente/mock fiable.
- `ai/execute` marca estados y emite eventos (`object.created`, `plugin.installed`, `animation.rendered`, …).
- Los jobs de render/export simulan progreso según `ZEIA_JOB_SECONDS`.
