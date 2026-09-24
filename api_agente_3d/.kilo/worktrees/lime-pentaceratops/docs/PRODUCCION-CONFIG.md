# Configuración para Producción - Zeus Media Studio

## 🎯 **Objetivo**
Conectar la aplicación desplegada en `https://studio.zeus-ia.com` con tu servidor local que contiene los archivos.

## 🔧 **Configuración Actual**

### Variables de Entorno
```env
# Servidor local para archivos (cuando está desplegada)
NEXT_PUBLIC_LOCAL_SERVER_URL="http://localhost:3003"
NEXT_PUBLIC_LOCAL_BRIDGE_URL="http://localhost:4001"
```

### Lógica de Conexión
```javascript
// Función para obtener la URL base según el entorno
function getBaseUrl(): string {
  // Desarrollo: usa localhost:3003
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:3003';
  }
  // Producción: usa el servidor local configurado
  return process.env.NEXT_PUBLIC_LOCAL_SERVER_URL;
}
```

## 📋 **Endpoints que deben apuntar al servidor local**

### 1. **API de Archivos**
- ** Desarrollo**: `http://localhost:3003/api/files`
- ** Producción**: `http://localhost:3003/api/files`

### 2. **API del Editor de Video**
- ** Desarrollo**: `http://localhost:4001/api/v1/*`
- ** Producción**: `http://localhost:4001/api/v1/*`

### 3. **Upload de Archivos**
- ** Desarrollo**: `http://localhost:4001/api/local/upload`
- ** Producción**: `http://localhost:4001/api/local/upload`

## 🚀 **Pasos para Producción**

### 1. **Iniciar Servidor Local**
```bash
# Inicia tu servidor local con todos los archivos
npm run dev  # o tu comando específico
```

### 2. **Verificar Acceso**
Asegúrate de que:
- ✅ Servidor corriendo en `http://localhost:3003`
- ✅ Bridge corriendo en `http://localhost:4001`
- ✅ Archivos `Archivos_ZEUS/` accesibles
- ✅ Firewall permite conexiones locales

### 3. **Probar Endpoints**
```bash
# Test desde la aplicación desplegada
curl http://localhost:3003/api/files
curl http://localhost:4001/api/v1/projects
```

## 🔒 **Consideraciones de Seguridad**

### CORS
Asegúrate que tu servidor local permita requests desde `https://studio.zeus-ia.com`:

```javascript
// En tu servidor local
app.use(cors({
  origin: ['https://studio.zeus-ia.com', 'http://localhost:3003'],
  credentials: true
}));
```

### Firewall
Configura tu firewall para permitir:
- Puerto 3003 (API principal)
- Puerto 4001 (Bridge del editor)

## 🌐 **Arquitectura Final**

```
📱 Usuario navega en:
    https://studio.zeus-ia.com
         ↓
🌐 Aplicación Next.js (Vercel)
         ↓
🏠 Servidor Local (Tu máquina)
    ├── http://localhost:3003 (API de archivos)
    ├── http://localhost:4001 (Bridge editor)
    └── 📁 Archivos_ZEUS/ (Archivos multimedia)
```

## 🛠️ **Ejemplo de Uso**

```javascript
// En tu componente
const response = await fetch(`${BASE_URL}/api/files?folder=Archivos_ZEUS/Imagen`);
const files = await response.json();

// Para el editor de video
const project = await api.getProjects(); // Usa LOCAL_BRIDGE_URL
```

## 📝 **Notas Importantes**

- El servidor local debe estar siempre encendido para que funcione la aplicación en producción
- Considera usar un servicio como ngrok si necesitas acceso externo
- Los archivos no se suben a Vercel, quedan en tu máquina local
- La velocidad depende de tu conexión a internet

## 🔄 **Alternativas Futuras**

1. **CDN Externo**: Subir archivos a S3, Cloudinary, etc.
2. **Servidor Dedicado**: Contratar un VPS para los archivos
3. **P2P**: Usar WebRTC para conexión directa
