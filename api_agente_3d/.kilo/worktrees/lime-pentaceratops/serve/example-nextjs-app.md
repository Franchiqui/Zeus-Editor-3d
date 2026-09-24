# 📦 Ejemplo de Aplicación Next.js para Pruebas

Para probar el servidor de vista previa, puedes crear una aplicación Next.js simple siguiendo estos pasos:

## 🚀 Crear aplicación de ejemplo

1. **Crear un nuevo proyecto Next.js:**
   ```bash
   npx create-next-app@latest mi-app-ejemplo
   cd mi-app-ejemplo
   ```

2. **Modificar el archivo `pages/index.js` (o `app/page.js` si usas App Router):**

   ```jsx
   export default function Home() {
     return (
       <div style={{ padding: '2rem', fontFamily: 'Arial, sans-serif' }}>
         <h1 data-component-id="titulo-principal">¡Hola desde Next.js!</h1>
         <div className="contenedor-principal">
           <p data-testid="descripcion">Esta es una aplicación de ejemplo para probar el servidor de vista previa.</p>
           <button 
             className="boton-ejemplo" 
             onClick={() => alert('¡Botón clickeado!')}
             style={{
               background: '#0070f3',
               color: 'white',
               padding: '10px 20px',
               border: 'none',
               borderRadius: '5px',
               cursor: 'pointer'
             }}
           >
             Botón de Ejemplo
           </button>
         </div>
         <footer id="pie-pagina" style={{ marginTop: '2rem', color: '#666' }}>
           <p>Pie de página de ejemplo</p>
         </footer>
       </div>
     )
   }
   ```

3. **Comprimir en ZIP:**
   - Selecciona todos los archivos del proyecto (incluyendo `package.json`, `next.config.js`, carpetas `pages/` o `app/`, etc.)
   - Crea un archivo ZIP con todo el contenido
   - **Importante:** No comprimas la carpeta padre, sino el contenido directamente

## 🎯 Selectores de ejemplo para probar

Una vez que subas la aplicación, puedes probar estos selectores en la herramienta de componentes:

| Selector | Descripción |
|----------|-------------|
| `h1` | Título principal |
| `.contenedor-principal` | Contenedor principal |
| `[data-testid='descripcion']` | Párrafo de descripción |
| `.boton-ejemplo` | Botón de ejemplo |
| `#pie-pagina` | Pie de página |
| `[data-component-id='titulo-principal']` | Título con ID específico |

## 📋 Estructura mínima requerida

Tu ZIP debe contener al menos:

```
mi-app-ejemplo.zip
├── package.json          # Con Next.js como dependencia
├── next.config.js        # (opcional)
├── pages/               # O app/ si usas App Router
│   └── index.js
├── public/              # (opcional)
└── styles/              # (opcional)
```

## ✅ Verificación

Antes de subir, asegúrate de que:
- [ ] El `package.json` incluye `"next"` en dependencies
- [ ] La aplicación funciona localmente con `npm run dev`
- [ ] El ZIP contiene todos los archivos necesarios
- [ ] No incluyes `node_modules/` en el ZIP

¡Listo para probar tu servidor de vista previa! 🚀