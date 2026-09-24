# Api_Agente_3D API

# API REST — Zeus Editor 3D Integration API (ZEIA)

## 1. Descripción General

**Zeus Editor 3D Integration API (ZEIA)** es una API REST de nivel empresarial diseñada para actuar como puente bidireccional entre modelos de inteligencia artificial (LLM, modelos generativos 3D, motores de animación procedural) y el entorno de edición **Zeus Editor 3D**. Su propósito es permitir que un modelo externo pueda **crear plantillas por pestaña, generar objetos, aplicar movimientos, instalar plugins, gestionar efectos y producir animaciones completas**, todo ello mediante endpoints normalizados y prompts contextuales que describen el funcionamiento específico de cada pestaña del editor.

La API abstrae la complejidad del editor en recursos REST coherentes, expone un **catálogo de herramientas por pestaña** y entrega a los modelos un **prompt de sistema dinámico** que documenta las capacidades reales de cada sección (Modelado, Materiales, Animación, Plugins, Efectos, Render, etc.), garantizando que las acciones generadas por IA sean válidas, seguras y ejecutables.

---

## 2. Propósito

| Objetivo | Descripción |
|---|---|
| **Automatización asistida por IA** | Permitir que modelos generativos operen Zeus Editor 3D sin intervención manual. |
| **Estandarización de operaciones** | Unificar todas las herramientas del editor bajo contratos REST consistentes. |
| **Plantillas reutilizables** | Generar y versionar plantillas por pestaña (workspace templates). |
| **Orquestación de pipelines 3D** | Encadenar generación → movimiento → efectos → animación → exportación. |
| **Extensibilidad** | Soportar plugins y efectos de terceros mediante un registro dinámico. |
| **Contexto para IA** | Proveer prompts específicos por pestaña para guiar al modelo en cada dominio. |

---

## 3. Casos de Uso Principales

1. **Generación de escenas desde lenguaje natural** — Un LLM recibe "crea una escena de bosque con niebla" y la API traduce a objetos, materiales y efectos.
2. **Creación de plantillas por pestaña** — El modelo define plantillas de trabajo (ej. plantilla de rigging, plantilla de iluminación) que se reutilizan en proyectos.
3. **Animación procedural** — Generar keyframes, curvas de animación y trayectorias a partir de descripciones.
4. **Instalación y configuración de plugins** — El modelo detecta necesidades y solicita plugins compatibles vía API.
5. **Aplicación de efectos post-proceso** — Bloom, DOF, motion blur, partículas, etc., aplicados por pipeline.
6. **Exportación multi-formato** — GLTF, FBX, OBJ, USDZ, MP4 con parámetros controlados por IA.
7. **Asistente contextual por pestaña** — El modelo consulta el prompt de la pestaña activa antes de ejecutar acciones.

---

## 4. Arquitectura y Stack Técnico

### 4.1 Arquitectura
```
┌─────────────────┐     HTTPS/JSON      ┌──────────────────────┐
│  AI Model / LLM │ ──────────────────► │  ZEIA Gateway (REST) │
└─────────────────┘                     └──────────┬───────────┘
                                                   │
                        ┌──────────────────────────┼──────────────────────────┐
                        ▼                          ▼                          ▼
                ┌───────────────┐         ┌────────────────┐         ┌────────────────┐
                │ Template Svc  │         │ Scene/Object   │         │ Plugin/Effect  │
                │ (plantillas)  │         │ Service        │         │ Registry       │
                └───────┬───────┘         └────────┬───────┘         └────────┬───────┘
                        │                          │                          │
                        └──────────────┬───────────┴──────────────┬───────────┘
                                       ▼                          ▼
                              ┌──────────────────┐      ┌──────────────────┐
                              │ Animation Engine │      │ Zeus Editor Core │
                              │ (keyframes, rig) │      │ (WebSocket/WS)   │
                              └──────────────────┘      └──────────────────┘
```

### 4.2 Stack recomendado

| Capa | Tecnología |
|---|---|
| **Runtime API** | Node.js 20 (NestJS) o Python 3.12 (FastAPI) |
| **Protocolo** | REST (OpenAPI 3.1) + WebSocket para eventos en tiempo real |
| **Autenticación** | OAuth 2.0 / JWT (RS256) + API Keys para servicios |
| **Base de datos** | PostgreSQL 16 (metadatos) + Redis (caché/sesiones) |
| **Almacenamiento de assets** | S3-compatible (MinIO / AWS S3) |
| **Cola de trabajos** | RabbitMQ o Redis Streams (jobs asíncronos) |
| **Motor 3D** | Three.js / Babylon.js / Blender headless (según Zeus) |
| **Comunicación con editor** | WebSocket + IPC local (Electron) o gRPC interno |
| **Observabilidad** | OpenTelemetry + Prometheus + Grafana + Loki |
| **Documentación** | Swagger UI + Redoc |
| **CI/CD** | GitHub Actions + Docker + Kubernetes |

---

## 5. Modelo de Datos (Entidades Principales)

```json
// Project
{
  "id": "prj_01HX...",
  "name": "Bosque Encantado",
  "owner_id": "usr_123",
  "created_at": "2025-01-15T10:00:00Z",
  "tabs": ["modeling", "materials", "animation", "effects"],
  "active_template_id": "tpl_456"
}

// Template (por pestaña)
{
  "id": "tpl_456",
  "tab": "animation",
  "name": "Rig Humanoide Base",
  "schema": { "bones": [], "constraints": [] },
  "version": "1.2.0",
  "created_by": "ai:gpt-4o",
  "metadata": { "tags": ["rig", "humanoid"] }
}

// Object3D
{
  "id": "obj_789",
  "scene_id": "scn_001",
  "type": "mesh|light|camera|empty|particle",
  "geometry": { "primitive": "cube", "params": {...} },
  "transform": { "position": [0,0,0], "rotation": [0,0,0], "scale": [1,1,1] },
  "material_id": "mat_010",
  "parent_id": null,
  "tags": ["generated"]
}

// Motion
{
  "id": "mot_011",
  "object_id": "obj_789",
  "type": "translate|rotate|scale|path|physics",
  "keyframes": [
    { "t": 0.0, "value": [0,0,0], "easing": "easeInOut" },
    { "t": 2.5, "value": [10,0,0], "easing": "linear" }
  ],
  "loop": false
}

// Plugin
{
  "id": "plg_012",
  "name": "Volumetric Fog",
  "version": "3.1.0",
  "author": "Zeus Labs",
  "tab": "effects",
  "capabilities": ["fog", "volumetrics"],
  "status": "installed|available|disabled"
}

// Effect
{
  "id": "eff_013",
  "plugin_id": "plg_012",
  "name": "Dense Fog",
  "params": { "density": 0.8, "color": "#AABBCC" },
  "applied_to": ["scn_001"]
}

// Animation
{
  "id": "anm_014",
  "project_id": "prj_01HX...",
  "name": "Walk Cycle",
  "duration": 5.0,
  "fps": 30,
  "tracks": [ { "object_id": "obj_789", "motion_id": "mot_011" } ],
  "render_preset": "1080p_h264"
}

// PromptContext
{
  "tab": "animation",
  "system_prompt": "Eres un asistente experto en animación 3D...",
  "tools": ["create_keyframe", "set_easing", "add_constraint"],
  "constraints": { "max_duration": 600, "fps_range": [12, 120] }
}
```

---

## 6. Endpoints REST

Base URL: `https://api.zeus-editor.io/v1`

### 6.1 Autenticación
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/auth/token` | Obtener JWT (client_credentials / refresh) |
| POST | `/auth/refresh` | Renovar token |
| POST | `/auth/api-keys` | Crear API key para servicio IA |

### 6.2 Proyectos y Sesiones
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/projects` | Listar proyectos |
| POST | `/projects` | Crear proyecto |
| GET | `/projects/{id}` | Detalle de proyecto |
| PATCH | `/projects/{id}` | Actualizar metadatos |
| DELETE | `/projects/{id}` | Eliminar proyecto |
| POST | `/projects/{id}/sessions` | Abrir sesión con Zeus Editor |
| DELETE | `/sessions/{id}` | Cerrar sesión |

### 6.3 Pestañas y Prompts (Core IA)
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/tabs` | Listar pestañas disponibles (modeling, materials, animation, effects, plugins, render, etc.) |
| GET | `/tabs/{tab}` | Metadatos de la pestaña |
| GET | `/tabs/{tab}/tools` | Herramientas expuestas por la pestaña |
| GET | `/tabs/{tab}/prompt` | **Prompt de sistema específico** para el modelo |
| POST | `/tabs/{tab}/prompt/render` | Renderizar prompt con variables de contexto |
| GET | `/tabs/{tab}/schema` | JSON Schema de operaciones válidas |

### 6.4 Plantillas
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/templates` | Listar plantillas (filtro por `tab`) |
| POST | `/templates` | Crear plantilla (generada por IA o manual) |
| GET | `/templates/{id}` | Detalle |
| PUT | `/templates/{id}` | Reemplazar |
| PATCH | `/templates/{id}` | Actualizar parcial |
| DELETE | `/templates/{id}` | Eliminar |
| POST | `/templates/{id}/apply` | Aplicar plantilla a proyecto/escena |
| POST | `/templates/{id}/clone` | Clonar con variaciones |
| GET | `/templates/{id}/versions` | Historial de versiones |

### 6.5 Objetos 3D
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/scenes/{sceneId}/objects` | Listar objetos |
| POST | `/scenes/{sceneId}/objects` | Crear objeto (mesh, light, camera, empty, particle) |
| GET | `/objects/{id}` | Detalle |
| PATCH | `/objects/{id}` | Modificar transform/material |
| DELETE | `/objects/{id}` | Eliminar |
| POST | `/objects/{id}/duplicate` | Duplicar |
| POST | `/objects/{id}/parent` | Establecer jerarquía |
| POST | `/objects/batch` | Operaciones masivas (bulk) |

### 6.6 Movimiento y Animación
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/objects/{id}/motions` | Crear movimiento (translate/rotate/scale/path/physics) |
| GET | `/objects/{id}/motions` | Listar movimientos |
| PATCH | `/motions/{id}` | Actualizar keyframes |
| DELETE | `/motions/{id}` | Eliminar movimiento |
| POST | `/animations` | Crear animación (timeline) |
| GET | `/animations/{id}` | Detalle |
| POST | `/animations/{id}/tracks` | Añadir pista |
| POST | `/animations/{id}/keyframes` | Insertar keyframes |
| POST | `/animations/{id}/play` | Reproducir en editor |
| POST | `/animations/{id}/render` | Renderizar a video |
| GET | `/animations/{id}/status` | Estado de render (async) |

### 6.7 Plugins
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/plugins` | Catálogo de plugins |
| GET | `/plugins/{id}` | Detalle |
| POST | `/plugins/{id}/install` | Instalar |
| POST | `/plugins/{id}/uninstall` | Desinstalar |
| POST | `/plugins/{id}/enable` | Habilitar |
| POST | `/plugins/{id}/disable` | Deshabilitar |
| POST | `/plugins` | Registrar plugin propio (manifest) |
| GET | `/plugins/{id}/capabilities` | Capacidades expuestas |

### 6.8 Efectos
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/effects` | Catálogo de efectos |
| POST | `/effects` | Crear efecto (instancia) |
| POST | `/effects/{id}/apply` | Aplicar a escena/objeto |
| PATCH | `/effects/{id}` | Ajustar parámetros |
| DELETE | `/effects/{id}` | Eliminar |
| POST | `/effects/{id}/preview` | Previsualización rápida |

### 6.9 Exportación
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/exports` | Solicitar exportación (gltf, fbx, obj, usdz, mp4) |
| GET | `/exports/{id}` | Estado |
| GET | `/exports/{id}/download` | Descargar resultado |

### 6.10 Orquestación IA
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/ai/plan` | Enviar intención en lenguaje natural → plan de acciones |
| POST | `/ai/execute` | Ejecutar plan aprobado |
| GET | `/ai/context` | Contexto actual (pestaña activa, selección, historial) |
| POST | `/ai/feedback` | Enviar feedback para ajuste del modelo |

### 6.11 Webhooks y Eventos
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/webhooks` | Registrar webhook (eventos: object.created, animation.rendered, plugin.installed) |
| GET | `/events/stream` | SSE para eventos en tiempo real |
| WS | `/ws/session/{id}` | WebSocket bidireccional con el editor |

---

## 7. Ejemplo de Flujo Completo

**Objetivo:** "Crea una escena con un cubo animado y niebla volumétrica, expórtala a MP4."

```http
POST /v1/ai/plan
{
  "intent": "Crea una escena con un cubo animado y niebla volumétrica, expórtala a MP4",
  "project_id": "prj_01HX...",
  "tabs_allowed": ["modeling", "animation", "effects", "render"]
}
```

**Respuesta (plan):**
```json
{
  "plan_id": "pln_999",
  "steps": [
    { "action": "objects.create", "params": { "type": "mesh", "primitive": "cube" } },
    { "action": "motions.create", "params": { "type": "rotate", "duration": 5 } },
    { "action": "plugins.install", "params": { "id": "plg_volumetric_fog" } },
    { "action": "effects.apply", "params": { "name": "Dense Fog" } },
    { "action": "animations.render", "params": { "format": "mp4", "fps": 30 } }
  ]
}
```

```http
POST /v1/ai/execute
{ "plan_id": "pln_999", "auto_approve": true }
```

---

## 8. Seguridad

| Aspecto | Implementación |
|---|---|
| **Autenticación** | OAuth 2.0 (client_credentials, authorization_code) + JWT RS256 |
| **Autorización** | RBAC con scopes: `projects:read`, `objects:write`, `plugins:install`, `ai:execute` |
| **API Keys** | Para servicios IA, rotables, con IP allowlist |
| **Transporte** | TLS 1.3 obligatorio, HSTS |
| **Rate Limiting** | Por API key + por endpoint (token bucket) |
| **Validación** | JSON Schema estricto + sanitización de parámetros |
| **Sandbox de plugins** | Ejecución aislada (WASM o contenedor) con permisos declarados |
| **Auditoría** | Log inmutable de todas las acciones IA (quién, qué, cuándo) |
| **Cifrado en reposo** | AES-256 para assets y metadatos sensibles |
| **Cumplimiento** | GDPR, SOC 2 Type II (roadmap) |
| **Aprobación humana** | Modo `auto_approve: false` para acciones destructivas |

---

## 9. Prompt de Sistema por Pestaña (Ejemplo)

Cada pestaña expone un prompt especializado vía `GET /tabs/{tab}/prompt`. Ejemplo para **animation**:

```json
{
  "tab": "animation",
  "version": "1.0",
  "system_prompt": "Eres un asistente experto en animación 3D dentro de Zeus Editor 3D. Tu tarea es generar keyframes, curvas de easing y trayectorias coherentes. Reglas:\n1. Usa fps entre 12 y 120.\n2. Toda animación debe tener duración > 0.\n3. Prefiere easing 'easeInOut' salvo indicación contraria.\n4. No superes 500 keyframes por pista sin confirmación.\n5. Valida que el objeto referenciado exista antes de animar.",
  "tools": [
    { "name": "create_keyframe", "schema": { "t": "number", "value": "array", "easing": "string" } },
    { "name": "set_easing", "schema": { "curve": "string" } },
    { "name": "add_constraint", "schema": { "type": "string", "target": "string" } }
  ],
  "examples": [
    { "input": "haz que el cubo gire 360° en 3 segundos", "output": { "action": "motions.create", "type": "rotate", "duration": 3, "degrees": 360 } }
  ]
}
```

Pestañas soportadas inicialmente: `modeling`, `materials`, `lighting`, `animation`, `rigging`, `effects`, `plugins`, `render`, `export`, `scripting`.

---

## 10. Códigos de Estado y Errores

| Código | Significado |
|---|---|
| 200 / 201 / 204 | Éxito |
| 400 | Payload inválido (schema) |
| 401 | No autenticado |
| 403 | Sin permisos (scope) |
| 404 | Recurso no encontrado |
| 409 | Conflicto (versión, duplicado) |
| 422 | Acción IA inválida (viola constraints del prompt) |
| 429 | Rate limit excedido |
| 500 | Error interno |
| 503 | Editor Zeus no disponible |

Formato de error estándar (RFC 7807):
```json
{
  "type": "https://api.zeus-editor.io/errors/invalid-action",
  "title": "Acción no permitida en la pestaña actual",
  "status": 422,
  "detail": "La herramienta 'add_constraint' no está disponible en 'modeling'.",
  "instance": "/v1/ai/execute"
}
```

---

## 11. Roadmap Sugerido

| Fase | Entregable |
|---|---|
| **MVP** | Auth, proyectos, objetos, plantillas, prompt por pestaña |
| **Fase 2** | Animación, movimientos, render asíncrono |
| **Fase 3** | Plugins, efectos, sandbox |
| **Fase 4** | Orquestación IA (`/ai/plan`, `/ai/execute`), WebSocket en vivo |
| **Fase 5** | Marketplace de plantillas y plugins, multi-tenant |

---

## 12. Conclusión

La **Zeus Editor 3D Integration API (ZEIA)** proporciona una capa REST robusta, segura y extensible que permite a modelos de IA operar de forma autónoma y contextualizada sobre cada pestaña del editor. Su diseño basado en **prompts por pestaña**, **plantillas versionadas**, **registro dinámico de plugins/efectos** y **orquestación de pipelines de animación** la convierten en una base sólida para producción, lista para escalar hacia un ecosistema completo de creación 3D asistida por inteligencia artificial.

## Requisitos

- Node.js 18+

## Instalación

```bash
npm install
```

## Ejecución

```bash
npm run dev
```

o

```bash
npm start
```

Por defecto el servidor usa el puerto definido en tu código (suele ser 3012). Si incluye Swagger, prueba http://localhost:3012/api-docs según tu api.ts.

## Archivos

| Archivo | Contenido |
|--------|------------|
| api.ts | Código principal de la API |
| schemas.ts | Esquemas Zod exportados |
| documentation.md | Documentación OpenAPI / notas |
| endpoints.json | Metadatos de endpoints (JSON) |
