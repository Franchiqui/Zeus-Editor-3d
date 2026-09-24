import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const isLocal = request.url.startsWith('http://localhost');
  const mainServer = isLocal ? 'http://localhost:4001' : 'http://localhost:4001'; // Todo apunta al bridge
  const bridgeServer = 'http://localhost:4001'; // El bridge es el servidor principal
  
  console.log('DEBUG API DOCS:', { isLocal, mainServer, bridgeServer, url: request.url });
  
  // Versión simple para debug
  if (!isLocal) {
    return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Zeus API Docs - Production</title>
    <style>
        body { background: #10204d; color: white; padding: 20px; font-family: Arial; }
        .server { background: #1e293b; padding: 15px; margin: 10px 0; border-radius: 8px; }
        .endpoint { background: #0f172a; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #3b82f6; }
    </style>
</head>
<body>
    <h1>🌐 Zeus Media Studio API - Production</h1>
    
    <div class="server">
        <h3>📍 Servidor Configurado</h3>
        <p><strong>Main Server:</strong> ${mainServer}</p>
        <p><strong>Bridge Server:</strong> ${bridgeServer}</p>
        <p><strong>Request URL:</strong> ${request.url}</p>
        <p><strong>Importante:</strong> Todos los endpoints apuntan al bridge (puerto 4001)</p>
    </div>
    
    <h2>📋 Endpoints Principales</h2>
    
    <div class="endpoint">
        <h3>GET /api/files</h3>
        <p>Listar archivos de una carpeta</p>
        <a href="${mainServer}/api/files?folder=Archivos_ZEUS/Imagen" style="color: #3b82f6;">Probar endpoint</a>
    </div>
    
    <div class="endpoint">
        <h3>GET /api/chat</h3>
        <p>Obtener conversaciones</p>
        <a href="${mainServer}/api/chat" style="color: #3b82f6;">Probar endpoint</a>
    </div>
    
    <div class="endpoint">
        <h3>GET /api/collections</h3>
        <p>Listar colecciones</p>
        <a href="${mainServer}/api/collections" style="color: #3b82f6;">Probar endpoint</a>
    </div>
    
    <h2>🎬 Editor de Video (Todo en el Bridge)</h2>
    
    <div class="endpoint" style="border-left-color: #10b981;">
        <h3>GET /api/v1/projects</h3>
        <p>Listar proyectos</p>
        <a href="${bridgeServer}/api/v1/projects" style="color: #10b981;">Probar endpoint</a>
    </div>
    
    <div class="endpoint" style="border-left-color: #10b981;">
        <h3>GET /api/v1/assets</h3>
        <p>Listar assets multimedia</p>
        <a href="${bridgeServer}/api/v1/assets" style="color: #10b981;">Probar endpoint</a>
    </div>
    
    <div style="margin-top: 30px; padding: 20px; background: #0f172a; border-radius: 8px;">
        <h3>🔍 Información</h3>
        <p>Todo está configurado para usar el servidor bridge en el puerto 4001.</p>
        <p>Asegúrate de tener el servidor bridge corriendo en ${bridgeServer}</p>
    </div>
</body>
</html>`, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  const swaggerHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation - Zeus Media Studio</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@3.52.5/swagger-ui.css" />
    <style>
        html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
        *, *:before, *:after { box-sizing: inherit; }
        body { 
            margin: 0; 
            background: #10204d !important; 
            color: #ffffff !important;
        }
        .swagger-ui .topbar {
            background: #1e293b !important;
            border-bottom: 1px solid #334155 !important;
        }
        .swagger-ui .topbar .download-url-wrapper .select-label {
            color: #ffffff !important;
        }
        .swagger-ui .info {
            margin: 50px 0 !important;
        }
        .swagger-ui .info .title {
            color: #ffffff !important;
        }
        .swagger-ui .info .description {
            color: #94a3b8 !important;
        }
        .swagger-ui .scheme-container {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 8px !important;
            margin: 20px 0 !important;
        }
        .swagger-ui .scheme-container .schemes {
            background: transparent !important;
        }
        .swagger-ui .opblock {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 8px !important;
            margin: 10px 0 !important;
            box-shadow: none !important;
        }
        .swagger-ui .opblock .opblock-summary {
            border-color: #334155 !important;
            background: #1e293b !important;
        }
        .swagger-ui .opblock .opblock-summary-description {
            color: #94a3b8 !important;
        }
        .swagger-ui .opblock.opblock-get {
            border-color: #10b981 !important;
            background: rgba(16, 185, 129, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-post {
            border-color: #3b82f6 !important;
            background: rgba(59, 130, 246, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-put {
            border-color: #f59e0b !important;
            background: rgba(245, 158, 11, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-delete {
            border-color: #ef4444 !important;
            background: rgba(239, 68, 68, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-patch {
            border-color: #8b5cf6 !important;
            background: rgba(139, 92, 246, 0.1) !important;
        }
        .swagger-ui .opblock .opblock-summary-method {
            color: #ffffff !important;
            background: #3b82f6 !important;
            border-radius: 4px !important;
        }
        .swagger-ui .opblock.opblock-get .opblock-summary-method {
            background: #10b981 !important;
        }
        .swagger-ui .opblock.opblock-post .opblock-summary-method {
            background: #3b82f6 !important;
        }
        .swagger-ui .opblock.opblock-put .opblock-summary-method {
            background: #f59e0b !important;
        }
        .swagger-ui .opblock.opblock-delete .opblock-summary-method {
            background: #ef4444 !important;
        }
        .swagger-ui .opblock.opblock-patch .opblock-summary-method {
            background: #8b5cf6 !important;
        }
        .swagger-ui .opblock .opblock-section-header {
            background: #0f172a !important;
            border-bottom: 1px solid #334155 !important;
        }
        .swagger-ui .opblock.opblock-get .opblock-section-header {
            background: rgba(16, 185, 129, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-post .opblock-section-header {
            background: rgba(59, 130, 246, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-put .opblock-section-header {
            background: rgba(245, 158, 11, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-delete .opblock-section-header {
            background: rgba(239, 68, 68, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-patch .opblock-section-header {
            background: rgba(139, 92, 246, 0.1) !important;
        }
        .swagger-ui .opblock.opblock-get .opblock-section-header h4 {
            color: #10b981 !important;
        }
        .swagger-ui .opblock.opblock-post .opblock-section-header h4 {
            color: #3b82f6 !important;
        }
        .swagger-ui .opblock.opblock-put .opblock-section-header h4 {
            color: #f59e0b !important;
        }
        .swagger-ui .opblock.opblock-delete .opblock-section-header h4 {
            color: #ef4444 !important;
        }
        .swagger-ui .opblock.opblock-patch .opblock-section-header h4 {
            color: #8b5cf6 !important;
        }
        .swagger-ui .opblock .opblock-body {
            background: #0f172a !important;
        }
        .swagger-ui .opblock .opblock-body .highlight-code {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 4px !important;
        }
        .swagger-ui .opblock .opblock-body pre {
            color: #e2e8f0 !important;
        }
        .swagger-ui .opblock .opblock-body .tab li {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            color: #94a3b8 !important;
        }
        .swagger-ui .opblock .opblock-body .tab li.active {
            background: #0f172a !important;
            border-bottom: 1px solid #334155 !important;
            color: #ffffff !important;
        }
        .swagger-ui .opblock .opblock-body .tab-content {
            background: #0f172a !important;
            border: 1px solid #334155 !important;
            border-top: none !important;
        }
        .swagger-ui .opblock .opblock-body table {
            background: #0f172a !important;
            border: 1px solid #334155 !important;
        }
        .swagger-ui .opblock .opblock-body table thead tr {
            background: #1e293b !important;
            border-bottom: 1px solid #334155 !important;
        }
        .swagger-ui .opblock .opblock-body table thead tr th {
            color: #ffffff !important;
            border-bottom: 1px solid #334155 !important;
        }
        .swagger-ui .opblock .opblock-body table tbody tr {
            border-bottom: 1px solid #334155 !important;
        }
        .swagger-ui .opblock .opblock-body table tbody tr td {
            color: #94a3b8 !important;
            border-bottom: 1px solid #334155 !important;
        }
        .swagger-ui .opblock .opblock-body table tbody tr:last-child td {
            border-bottom: none !important;
        }
        .swagger-ui .parameter__name {
            color: #ffffff !important;
        }
        .swagger-ui .parameter__type {
            color: #3b82f6 !important;
        }
        .swagger-ui .model-box {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 8px !important;
        }
        .swagger-ui .model .model-title {
            color: #ffffff !important;
        }
        .swagger-ui .model .property-type {
            color: #3b82f6 !important;
        }
        .swagger-ui .prop-type {
            color: #3b82f6 !important;
        }
        .swagger-ui .response-col_description {
            color: #94a3b8 !important;
        }
        .swagger-ui .table-container {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 8px !important;
        }
        .swagger-ui .servers {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 8px !important;
            margin: 20px 0 !important;
        }
        .swagger-ui .servers .servers-title {
            color: #ffffff !important;
        }
        .swagger-ui .servers .servers-select label {
            color: #94a3b8 !important;
        }
        .swagger-ui .servers .servers-select select {
            background: #0f172a !important;
            border: 1px solid #334155 !important;
            color: #ffffff !important;
        }
        .swagger-ui .servers .servers-select select option {
            background: #0f172a !important;
            color: #ffffff !important;
        }
        .swagger-ui .loading-container {
            background: #10204d !important;
        }
        .swagger-ui .loading-container .loading {
            color: #ffffff !important;
        }
        .swagger-ui .btn {
            background: #3b82f6 !important;
            border: 1px solid #3b82f6 !important;
            color: #ffffff !important;
            border-radius: 6px !important;
        }
        .swagger-ui .btn:hover {
            background: #2563eb !important;
            border-color: #2563eb !important;
        }
        .swagger-ui .execute {
            background: #10b981 !important;
            border: 1px solid #10b981 !important;
        }
        .swagger-ui .execute:hover {
            background: #059669 !important;
            border-color: #059669 !important;
        }
        .swagger-ui .select-label {
            color: #ffffff !important;
        }
        .swagger-ui .select {
            background: #0f172a !important;
            border: 1px solid #334155 !important;
            color: #ffffff !important;
        }
        .swagger-ui .select option {
            background: #0f172a !important;
            color: #ffffff !important;
        }
        .swagger-ui textarea,
        .swagger-ui input[type=text],
        .swagger-ui input[type=password] {
            background: #0f172a !important;
            border: 1px solid #334155 !important;
            color: #ffffff !important;
            border-radius: 6px !important;
        }
        .swagger-ui textarea:focus,
        .swagger-ui input[type=text]:focus,
        .swagger-ui input[type=password]:focus {
            border-color: #3b82f6 !important;
            outline: none !important;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
        }
        .swagger-ui .highlight-code {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 6px !important;
        }
        .swagger-ui .highlight-code pre {
            color: #e2e8f0 !important;
        }
        .swagger-ui .version-stamp {
            color: #94a3b8 !important;
        }
        .swagger-ui .version-stamp a {
            color: #3b82f6 !important;
        }
        .swagger-ui .info .contact {
            color: #94a3b8 !important;
        }
        .swagger-ui .info .contact a {
            color: #3b82f6 !important;
        }
        .swagger-ui .info .license {
            color: #94a3b8 !important;
        }
        .swagger-ui .info .license a {
            color: #3b82f6 !important;
        }
        .swagger-ui .info .version {
            color: #94a3b8 !important;
        }
        .swagger-ui .info .base-url {
            color: #94a3b8 !important;
        }
        .swagger-ui .info .base-url code {
            color: #3b82f6 !important;
            background: #1e293b !important;
            padding: 2px 6px !important;
            border-radius: 4px !important;
        }
        .swagger-ui .info .title {
            color: #ffffff !important;
            font-size: 36px !important;
            font-weight: 700 !important;
            margin-bottom: 10px !important;
        }
        .swagger-ui .info .description {
            color: #94a3b8 !important;
            font-size: 16px !important;
            line-height: 1.6 !important;
            margin-bottom: 20px !important;
        }
        .swagger-ui .opblock-tag {
            color: #ffffff !important;
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            border-radius: 8px !important;
            margin: 20px 0 10px 0 !important;
            padding: 10px 15px !important;
        }
        .swagger-ui .opblock-tag:hover {
            background: #334155 !important;
        }
        .swagger-ui .opblock-tag small {
            color: #94a3b8 !important;
        }
        .swagger-ui .opblock-tag a {
            color: #ffffff !important;
        }
        .swagger-ui .opblock-tag a:hover {
            color: #3b82f6 !important;
        }
        .swagger-ui .opblock .opblock-summary {
            cursor: pointer !important;
        }
        .swagger-ui .opblock .opblock-summary:hover {
            background: #334155 !important;
        }
        .swagger-ui .opblock .opblock-summary .opblock-summary-description {
            color: #94a3b8 !important;
            font-size: 14px !important;
            margin-left: 10px !important;
        }
        .swagger-ui .opblock .opblock-summary .opblock-summary-path {
            color: #3b82f6 !important;
            font-family: monospace !important;
            font-size: 14px !important;
        }
        .swagger-ui .opblock .opblock-summary .opblock-summary-path__deprecated {
            color: #ef4444 !important;
            text-decoration: line-through !important;
        }
        .swagger-ui .opblock .opblock-summary .opblock-summary-operation-id {
            color: #94a3b8 !important;
            font-size: 12px !important;
        }
        .swagger-ui .opblock .opblock-summary .opblock-summary-control {
            background: #1e293b !important;
            border: 1px solid #334155 !important;
            color: #ffffff !important;
        }
        .swagger-ui .opblock .opblock-summary .opblock-summary-control:hover {
            background: #334155 !important;
        }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@3.52.5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@3.52.5/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const spec = {
                "openapi": "3.0.0",
                "info": {
                    "title": "Zeus Media Studio API",
                    "description": "API completa para gestionar archivos, chat, modelos de IA, TTS y proyectos de Zeus Media Studio",
                    "version": "1.0.0",
                    "contact": {
                        "name": "Zeus IA",
                        "url": "https://www.zeus-ia.com"
                    }
                },
                "servers": [
                    {
                        "url": "${mainServer}",
                        "description": "${isLocal ? 'Servidor de desarrollo local' : 'Servidor de producción - Zeus Media Studio'}"
                    }
                ],
                "paths": {
                    "/api/files": {
                        "get": {
                            "summary": "Listar archivos de una carpeta",
                            "description": "Obtiene una lista de archivos y carpetas de una ruta específica",
                            "parameters": [
                                {
                                    "name": "folder",
                                    "in": "query",
                                    "description": "Ruta de la carpeta a listar (relativa a public/)",
                                    "required": false,
                                    "schema": {
                                        "type": "string",
                                        "default": "Archivos_ZEUS/Imagen"
                                    }
                                }
                            ],
                            "responses": {
                                "200": { "description": "HTML con la lista de archivos" }
                            }
                        },
                        "post": {
                            "summary": "Listar archivos (JSON)",
                            "description": "Obtiene una lista de archivos en formato JSON",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "folderPath": { "type": "string" }
                                            },
                                            "required": ["folderPath"]
                                        }
                                    }
                                }
                            },
                            "responses": {
                                "200": {
                                    "description": "Lista de archivos en formato JSON",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "object",
                                                "properties": {
                                                    "files": {
                                                        "type": "array",
                                                        "items": { "$ref": "#/components/schemas/FileInfo" }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/chat": {
                        "get": {
                            "summary": "Obtener conversaciones y mensajes",
                            "description": "Recupera el historial de chat",
                            "parameters": [
                                { "name": "conversationId", "in": "query", "schema": { "type": "string" } },
                                { "name": "modelRecordId", "in": "query", "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { "description": "Conversaciones y mensajes" }
                            }
                        },
                        "post": {
                            "summary": "Enviar mensaje al chat",
                            "description": "Envía un mensaje a la IA y obtiene respuesta",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/ChatRequest" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Respuesta de la IA" }
                            }
                        },
                        "delete": {
                            "summary": "Eliminar conversaciones",
                            "description": "Elimina conversaciones y mensajes",
                            "parameters": [
                                { "name": "conversationId", "in": "query", "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { "description": "Conversaciones eliminadas" }
                            }
                        },
                        "patch": {
                            "summary": "Actualizar conversación",
                            "description": "Actualiza el título de una conversación",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "conversationId": { "type": "string" },
                                                "title": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Conversación actualizada" }
                            }
                        }
                    },
                    "/api/modelos": {
                        "get": {
                            "summary": "Listar modelos de IA",
                            "description": "Obtiene los modelos configurados por usuario",
                            "parameters": [
                                { "name": "user", "in": "query", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { 
                                    "description": "Lista de modelos",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "object",
                                                "properties": {
                                                    "records": { "type": "array", "items": { "$ref": "#/components/schemas/Model" } }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "post": {
                            "summary": "Crear modelo de IA",
                            "description": "Añade un nuevo modelo de IA",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/ModelCreate" }
                                    }
                                }
                            },
                            "responses": {
                                "201": { "description": "Modelo creado" }
                            }
                        },
                        "patch": {
                            "summary": "Actualizar modelo",
                            "description": "Modifica un modelo existente",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "id": { "type": "string" },
                                                "provider": { "type": "string" },
                                                "nombre_modelo": { "type": "string" },
                                                "id_modelo": { "type": "string" },
                                                "clave_api": { "type": "string" },
                                                "url": { "type": "string" },
                                                "max_token": { "type": "number" },
                                                "temperatura": { "type": "number" }
                                            }
                                        }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Modelo actualizado" }
                            }
                        },
                        "delete": {
                            "summary": "Eliminar modelo",
                            "description": "Elimina un modelo de IA",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "id": { "type": "string" }
                                            }
                                        }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Modelo eliminado" }
                            }
                        }
                    },
                    "/api/collections": {
                        "get": {
                            "summary": "Listar colecciones de PocketBase",
                            "description": "Obtiene todas las colecciones disponibles en PocketBase",
                            "responses": {
                                "200": { 
                                    "description": "Lista de colecciones",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "object",
                                                "properties": {
                                                    "items": {
                                                        "type": "array",
                                                        "items": { "$ref": "#/components/schemas/Collection" }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/text-to-speech": {
                        "get": {
                            "summary": "Obtener voces disponibles",
                            "description": "Lista todas las voces disponibles para TTS",
                            "responses": {
                                "200": { 
                                    "description": "Lista de voces",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "object",
                                                "properties": {
                                                    "voices": {
                                                        "type": "array",
                                                        "items": { "$ref": "#/components/schemas/Voice" }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "post": {
                            "summary": "Generar audio desde texto",
                            "description": "Convierte texto a voz usando Azure Neural TTS",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "text": { "type": "string", "description": "Texto a convertir" },
                                                "voice": { "type": "string", "description": "Voz a usar" },
                                                "rate": { "type": "string", "description": "Velocidad de habla" },
                                                "pitch": { "type": "string", "description": "Tono de voz" },
                                                "volume": { "type": "string", "description": "Volumen" }
                                            },
                                            "required": ["text"]
                                        }
                                    }
                                }
                            },
                            "responses": {
                                "200": { 
                                    "description": "Archivo de audio generado",
                                    "content": {
                                        "audio/mpeg": { "schema": { "type": "string", "format": "binary" } }
                                    }
                                }
                            }
                        }
                    },
                    "/api/rutas": {
                        "get": {
                            "summary": "Obtener rutas configuradas",
                            "description": "Recupera las rutas de carpetas configuradas para un usuario",
                            "parameters": [
                                { "name": "user", "in": "query", "required": true, "schema": { "type": "string" } },
                                { "name": "category", "in": "query", "schema": { "type": "string", "enum": ["video", "imagen", "audio", "gif", "documentos", "efectos", "proyectos"] } }
                            ],
                            "responses": {
                                "200": { 
                                    "description": "Rutas y archivos",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "object",
                                                "properties": {
                                                    "files": { "type": "array", "items": { "$ref": "#/components/schemas/FileInfo" } },
                                                    "paths": { "type": "object" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "// Editor de Video API (Unificado en puerto 3000)": {
                        "get": {
                            "summary": "Información del Editor de Video",
                            "description": "Documentación de la API del editor de video Zeus - Ahora en puerto 3003"
                        }
                    },
                    "/api/v1/projects": {
                        "get": {
                            "summary": "Listar proyectos del editor",
                            "description": "Obtiene todos los proyectos del editor de video",
                            "responses": {
                                "200": { 
                                    "description": "Lista de proyectos",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": { "$ref": "#/components/schemas/Project" }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "post": {
                            "summary": "Crear proyecto",
                            "description": "Crea un nuevo proyecto de video",
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/ProjectCreate" }
                                    }
                                }
                            },
                            "responses": {
                                "201": { "description": "Proyecto creado" }
                            }
                        }
                    },
                    "/api/v1/projects/{id}": {
                        "get": {
                            "summary": "Obtener proyecto",
                            "description": "Recupera un proyecto específico",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { 
                                    "description": "Datos del proyecto",
                                    "content": {
                                        "application/json": {
                                            "schema": { "$ref": "#/components/schemas/Project" }
                                        }
                                    }
                                }
                            }
                        },
                        "put": {
                            "summary": "Actualizar proyecto",
                            "description": "Modifica un proyecto existente",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/ProjectUpdate" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Proyecto actualizado" }
                            }
                        },
                        "delete": {
                            "summary": "Eliminar proyecto",
                            "description": "Elimina un proyecto",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { "description": "Proyecto eliminado" }
                            }
                        }
                    },
                    "/api/v1/projects/{projectId}/timeline": {
                        "get": {
                            "summary": "Obtener timeline del proyecto",
                            "description": "Recupera la línea de tiempo de un proyecto",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { 
                                    "description": "Timeline del proyecto",
                                    "content": {
                                        "application/json": {
                                            "schema": { "$ref": "#/components/schemas/Timeline" }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/v1/projects/{projectId}/timeline/clips": {
                        "post": {
                            "summary": "Insertar clip en timeline",
                            "description": "Añade un nuevo clip a la línea de tiempo",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/Clip" }
                                    }
                                }
                            },
                            "responses": {
                                "201": { "description": "Clip insertado" }
                            }
                        }
                    },
                    "/api/v1/projects/{projectId}/timeline/clips/{clipId}": {
                        "put": {
                            "summary": "Actualizar clip",
                            "description": "Modifica un clip existente",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } },
                                { "name": "clipId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/Clip" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Clip actualizado" }
                            }
                        },
                        "delete": {
                            "summary": "Eliminar clip",
                            "description": "Elimina un clip de la línea de tiempo",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } },
                                { "name": "clipId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { "description": "Clip eliminado" }
                            }
                        }
                    },
                    "/api/v1/assets": {
                        "get": {
                            "summary": "Listar assets",
                            "description": "Obtiene todos los assets multimedia",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "responses": {
                                "200": { 
                                    "description": "Lista de assets",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": { "$ref": "#/components/schemas/Asset" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/v1/assets/{id}": {
                        "get": {
                            "summary": "Obtener asset",
                            "description": "Recupera un asset específico",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { 
                                    "description": "Datos del asset",
                                    "content": {
                                        "application/json": {
                                            "schema": { "$ref": "#/components/schemas/Asset" }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/v1/assets/upload": {
                        "post": {
                            "summary": "Subir asset",
                            "description": "Sube un nuevo archivo multimedia",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/AssetUpload" }
                                    }
                                }
                            },
                            "responses": {
                                "201": { "description": "Asset subido" }
                            }
                        }
                    },
                    "/api/v1/effects": {
                        "get": {
                            "summary": "Listar efectos",
                            "description": "Obtiene todos los efectos disponibles",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "responses": {
                                "200": { 
                                    "description": "Lista de efectos",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": { "$ref": "#/components/schemas/Effect" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/v1/projects/{projectId}/effects": {
                        "post": {
                            "summary": "Aplicar efecto",
                            "description": "Aplica un efecto a un proyecto",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/Effect" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Efecto aplicado" }
                            }
                        }
                    },
                    "/api/v1/transitions": {
                        "get": {
                            "summary": "Listar transiciones",
                            "description": "Obtiene todas las transiciones disponibles",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "responses": {
                                "200": { 
                                    "description": "Lista de transiciones",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": { "$ref": "#/components/schemas/Transition" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/v1/projects/{projectId}/transitions": {
                        "post": {
                            "summary": "Aplicar transición",
                            "description": "Aplica una transición a un proyecto",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/Transition" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Transición aplicada" }
                            }
                        }
                    },
                    "/api/v1/projects/{projectId}/text": {
                        "post": {
                            "summary": "Añadir texto",
                            "description": "Añade texto a un proyecto",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/TextElement" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Texto añadido" }
                            }
                        }
                    },
                    "/api/v1/styles": {
                        "get": {
                            "summary": "Listar estilos de texto",
                            "description": "Obtiene todos los estilos de texto disponibles",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "responses": {
                                "200": { 
                                    "description": "Lista de estilos",
                                    "content": {
                                        "application/json": {
                                            "schema": {
                                                "type": "array",
                                                "items": { "$ref": "#/components/schemas/TextStyle" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/v1/ai/script": {
                        "post": {
                            "summary": "Generar script con IA",
                            "description": "Genera un script automático para el video",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/ScriptRequest" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Script generado" }
                            }
                        }
                    },
                    "/api/v1/ai/suggestions": {
                        "post": {
                            "summary": "Obtener sugerencias de IA",
                            "description": "Obtiene sugerencias de mejora del video",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/SuggestionRequest" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Sugerencias obtenidas" }
                            }
                        }
                    },
                    "/api/v1/ai/auto-edit": {
                        "post": {
                            "summary": "Edición automática con IA",
                            "description": "Realiza una edición automática del video",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/AutoEditRequest" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Edición automática completada" }
                            }
                        }
                    },
                    "/api/v1/files": {
                        "post": {
                            "summary": "Listar archivos del editor",
                            "description": "Lista archivos del sistema del editor",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "folderPath": { "type": "string" }
                                            },
                                            "required": ["folderPath"]
                                        }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Archivos listados" }
                            }
                        }
                    },
                    "/api/v1/projects/{projectId}/export": {
                        "post": {
                            "summary": "Exportar proyecto",
                            "description": "Exporta un proyecto a formato de video",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "projectId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "requestBody": {
                                "required": true,
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/ExportRequest" }
                                    }
                                }
                            },
                            "responses": {
                                "200": { "description": "Exportación iniciada" }
                            }
                        }
                    },
                    "/api/v1/exports/{jobId}": {
                        "get": {
                            "summary": "Obtener estado de exportación",
                            "description": "Revisa el estado de un trabajo de exportación",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "jobId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { 
                                    "description": "Estado de la exportación",
                                    "content": {
                                        "application/json": {
                                            "schema": { "$ref": "#/components/schemas/ExportStatus" }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    "/api/v1/exports/{jobId}/download": {
                        "get": {
                            "summary": "Descargar exportación",
                            "description": "Descarga el video exportado",
                            "servers": [{ "url": "${bridgeServer}" }],
                            "parameters": [
                                { "name": "jobId", "in": "path", "required": true, "schema": { "type": "string" } }
                            ],
                            "responses": {
                                "200": { "description": "Archivo de video" }
                            }
                        }
                    }
                },
                "components": {
                    "schemas": {
                        "FileInfo": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "path": { "type": "string" },
                                "size": { "type": "integer" },
                                "isDirectory": { "type": "boolean" },
                                "modified": { "type": "string", "format": "date-time" },
                                "extension": { "type": "string" }
                            }
                        },
                        "ChatRequest": {
                            "type": "object",
                            "properties": {
                                "provider": { "type": "string", "description": "Id canónico del proveedor. Se acepta texto libre (se normaliza en el servidor).", "enum": ["OpenAI", "Deepseek", "OllamaCloud", "Ollama", "llama.cpp", "OpenAI-Compatible"] },
                                "model": { "type": "string" },
                                "modelRecordId": { "type": "string" },
                                "history": { "type": "array", "items": { "$ref": "#/components/schemas/ChatMessage" } },
                                "newMessage": { "$ref": "#/components/schemas/ChatMessage" },
                                "conversationId": { "type": "string" },
                                "projectId": { "type": "string" },
                                "title": { "type": "string" },
                                "images": { "type": "array", "items": { "type": "string" } },
                                "systemContext": { "type": "string" }
                            },
                            "required": ["provider", "model", "newMessage"]
                        },
                        "ChatMessage": {
                            "type": "object",
                            "properties": {
                                "role": { "type": "string", "enum": ["user", "assistant"] },
                                "content": { "type": "string" }
                            },
                            "required": ["role", "content"]
                        },
                        "Model": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "provider": { "type": "string" },
                                "nombre_modelo": { "type": "string" },
                                "id_modelo": { "type": "string" },
                                "max_token": { "type": "number" },
                                "temperatura": { "type": "number" },
                                "user": { "type": "string" }
                            }
                        },
                        "ModelCreate": {
                            "type": "object",
                            "properties": {
                                "provider": { "type": "string" },
                                "nombre_modelo": { "type": "string" },
                                "id_modelo": { "type": "string" },
                                "clave_api": { "type": "string" },
                                "url": { "type": "string" },
                                "max_token": { "type": "number" },
                                "temperatura": { "type": "number" },
                                "user": { "type": "string" }
                            },
                            "required": ["nombre_modelo"]
                        },
                        "Collection": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "name": { "type": "string" },
                                "type": { "type": "string" }
                            }
                        },
                        "Voice": {
                            "type": "object",
                            "properties": {
                                "Name": { "type": "string", "description": "ID de la voz" },
                                "Gender": { "type": "string", "enum": ["Male", "Female"] }
                            }
                        },
                        "Project": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "name": { "type": "string" },
                                "description": { "type": "string" },
                                "created": { "type": "string", "format": "date-time" },
                                "modified": { "type": "string", "format": "date-time" },
                                "duration": { "type": "number" },
                                "status": { "type": "string", "enum": ["draft", "editing", "rendering", "completed"] }
                            }
                        },
                        "ProjectCreate": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "description": { "type": "string" },
                                "settings": { "type": "object" }
                            },
                            "required": ["name"]
                        },
                        "ProjectUpdate": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "description": { "type": "string" },
                                "settings": { "type": "object" }
                            }
                        },
                        "Timeline": {
                            "type": "object",
                            "properties": {
                                "projectId": { "type": "string" },
                                "duration": { "type": "number" },
                                "tracks": { "type": "array", "items": { "$ref": "#/components/schemas/Track" } },
                                "clips": { "type": "array", "items": { "$ref": "#/components/schemas/Clip" } }
                            }
                        },
                        "Track": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "type": { "type": "string", "enum": ["video", "audio", "text", "effects"] },
                                "name": { "type": "string" },
                                "locked": { "type": "boolean" },
                                "muted": { "type": "boolean" }
                            }
                        },
                        "Clip": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "trackId": { "type": "string" },
                                "name": { "type": "string" },
                                "startTime": { "type": "number" },
                                "duration": { "type": "number" },
                                "type": { "type": "string", "enum": ["video", "audio", "image", "text"] },
                                "src": { "type": "string" },
                                "volume": { "type": "number" },
                                "opacity": { "type": "number" }
                            }
                        },
                        "Asset": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "name": { "type": "string" },
                                "type": { "type": "string", "enum": ["video", "audio", "image", "effect", "transition"] },
                                "src": { "type": "string" },
                                "size": { "type": "number" },
                                "duration": { "type": "number" },
                                "metadata": { "type": "object" }
                            }
                        },
                        "AssetUpload": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "type": { "type": "string" },
                                "data": { "type": "string", "description": "Base64 o file data" }
                            },
                            "required": ["name", "type", "data"]
                        },
                        "Effect": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "name": { "type": "string" },
                                "type": { "type": "string" },
                                "parameters": { "type": "object" },
                                "preview": { "type": "string" }
                            }
                        },
                        "Transition": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "name": { "type": "string" },
                                "duration": { "type": "number" },
                                "parameters": { "type": "object" },
                                "preview": { "type": "string" }
                            }
                        },
                        "TextElement": {
                            "type": "object",
                            "properties": {
                                "content": { "type": "string" },
                                "style": { "type": "string" },
                                "position": { "$ref": "#/components/schemas/Position" },
                                "animation": { "type": "string" },
                                "duration": { "type": "number" },
                                "startTime": { "type": "number" }
                            },
                            "required": ["content"]
                        },
                        "Position": {
                            "type": "object",
                            "properties": {
                                "x": { "type": "number" },
                                "y": { "type": "number" },
                                "z": { "type": "number" }
                            }
                        },
                        "TextStyle": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "name": { "type": "string" },
                                "font": { "type": "string" },
                                "size": { "type": "number" },
                                "color": { "type": "string" },
                                "bold": { "type": "boolean" },
                                "italic": { "type": "boolean" },
                                "underline": { "type": "boolean" }
                            }
                        },
                        "ScriptRequest": {
                            "type": "object",
                            "properties": {
                                "topic": { "type": "string" },
                                "duration": { "type": "number" },
                                "style": { "type": "string" },
                                "keywords": { "type": "array", "items": { "type": "string" } }
                            },
                            "required": ["topic", "duration"]
                        },
                        "SuggestionRequest": {
                            "type": "object",
                            "properties": {
                                "projectId": { "type": "string" },
                                "type": { "type": "string", "enum": ["editing", "effects", "music", "color"] },
                                "preferences": { "type": "object" }
                            },
                            "required": ["projectId", "type"]
                        },
                        "AutoEditRequest": {
                            "type": "object",
                            "properties": {
                                "style": { "type": "string" },
                                "duration": { "type": "number" },
                                "music": { "type": "boolean" },
                                "transitions": { "type": "boolean" },
                                "effects": { "type": "boolean" }
                            }
                        },
                        "ExportRequest": {
                            "type": "object",
                            "properties": {
                                "format": { "type": "string", "enum": ["mp4", "avi", "mov", "webm"] },
                                "resolution": { "type": "string", "enum": ["720p", "1080p", "4k"] },
                                "quality": { "type": "string", "enum": ["low", "medium", "high", "ultra"] },
                                "framerate": { "type": "number" }
                            },
                            "required": ["format", "resolution"]
                        },
                        "ExportStatus": {
                            "type": "object",
                            "properties": {
                                "jobId": { "type": "string" },
                                "status": { "type": "string", "enum": ["pending", "processing", "completed", "failed"] },
                                "progress": { "type": "number" },
                                "estimatedTime": { "type": "number" },
                                "outputFile": { "type": "string" },
                                "error": { "type": "string" }
                            }
                        }
                    }
                }
            };

            SwaggerUIBundle({
                url: '',
                spec: spec,
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout",
                defaultModelsExpandDepth: -1
            });
        }
    </script>
</body>
</html>`;

  return new Response(swaggerHtml, {
    headers: { 'Content-Type': 'text/html' }
  });
}
