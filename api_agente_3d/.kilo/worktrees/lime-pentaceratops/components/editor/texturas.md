a/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx → b/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx
@@ -102,6 +102,9 @@
      const [fontVersion, setFontVersion] = useState(0);
      // --- Opacidad del texto suave (1 = sólido) ---
      const [textOpacity, setTextOpacity] = useState(1);
+     // --- Textura cargada ---
+     const [texture, setTexture] = useState<string | null>(null);
+     const textureInputRef = useRef<HTMLInputElement | null>(null);
 
      // --- Modo de salida del texto: vóxeles 3D, malla suave o vista plana ---
   const [textMode, setTextMode] = useState<'voxel' | 'plane' | 'smooth'>(

----------------------------------------------------------

a/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx → b/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx
@@ -328,9 +328,43 @@
   }, []);
 
   // Abre el selector de archivos del sistema
-  const openLocalFontPicker = useCallback(() => {
-    localFontInputRef.current?.click();
-  }, []);
+    const openLocalFontPicker = useCallback(() => {
+      localFontInputRef.current?.click();
+    }, []);
+
+    // Carga una textura desde el almacenamiento del dispositivo
+    const handleTextureFile = useCallback(async (file: File) => {
+      if (!file) return;
+      try {
+        // Lee el archivo como ArrayBuffer y conviértelo a base64
+        const buffer = await file.arrayBuffer();
+        const bytes = new Uint8Array(buffer);
+        let binary = '';
+        const chunk = 0x8000;
+        for (let i = 0; i < bytes.length; i += chunk) {
+          const slice = bytes.subarray(i, i + chunk);
+          for (let j = 0; j < slice.length; j++) {
+            binary += String.fromCharCode(slice[j]);
+          }
+        }
+        const base64 = btoa(binary);
+        const dataUrl = `data:image/${file.type};base64,${base64}`;
+      
+        // Actualiza el estado con la textura
+        setTexture(dataUrl);
+      
+        // También actualizamos los vértices editados a null para forzar una regeneración
+        setEditedVertices(null);
+      } catch (error) {
+        console.error('Error al cargar la textura:', error);
+        // En una implementación real, mostraríamos un mensaje de error al usuario
+      }
+    }, []);
+
+    // Abre el selector de archivos del sistema para texturas
+    const openTexturePicker = useCallback(() => {
+      textureInputRef.current?.click();
+    }, []);
 
   const allFonts = useMemo(
     () => [...FONT_OPTIONS, ...customFonts],
---------------------------------------------------


a/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx → b/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx
@@ -102,6 +102,9 @@
      const [fontVersion, setFontVersion] = useState(0);
      // --- Opacidad del texto suave (1 = sólido) ---
      const [textOpacity, setTextOpacity] = useState(1);
+     // --- Textura cargada ---
+     const [texture, setTexture] = useState<string | null>(null);
+     const textureInputRef = useRef<HTMLInputElement | null>(null);
 
      // --- Modo de salida del texto: vóxeles 3D, malla suave o vista plana ---
   const [textMode, setTextMode] = useState<'voxel' | 'plane' | 'smooth'>(

     -------------------------------------------------------------


a/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx → b/F:\Zeus Media Studio-3D\components\editor\Editor3D.tsx
@@ -328,9 +328,43 @@
   }, []);
 
   // Abre el selector de archivos del sistema
-  const openLocalFontPicker = useCallback(() => {
-    localFontInputRef.current?.click();
-  }, []);
+    const openLocalFontPicker = useCallback(() => {
+      localFontInputRef.current?.click();
+    }, []);
+
+    // Carga una textura desde el almacenamiento del dispositivo
+    const handleTextureFile = useCallback(async (file: File) => {
+      if (!file) return;
+      try {
+        // Lee el archivo como ArrayBuffer y conviértelo a base64
+        const buffer = await file.arrayBuffer();
+        const bytes = new Uint8Array(buffer);
+        let binary = '';
+        const chunk = 0x8000;
+        for (let i = 0; i < bytes.length; i += chunk) {
+          const slice = bytes.subarray(i, i + chunk);
+          for (let j = 0; j < slice.length; j++) {
+            binary += String.fromCharCode(slice[j]);
+          }
+        }
+        const base64 = btoa(binary);
+        const dataUrl = `data:image/${file.type};base64,${base64}`;
+      
+        // Actualiza el estado con la textura
+        setTexture(dataUrl);
+      
+        // También actualizamos los vértices editados a null para forzar una regeneración
+        setEditedVertices(null);
+      } catch (error) {
+        console.error('Error al cargar la textura:', error);
+        // En una implementación real, mostraríamos un mensaje de error al usuario
+      }
+    }, []);
+
+    // Abre el selector de archivos del sistema para texturas
+    const openTexturePicker = useCallback(() => {
+      textureInputRef.current?.click();
+    }, []);
 
   const allFonts = useMemo(
     () => [...FONT_OPTIONS, ...customFonts],

---------------------------------------------------------------
## COLOR FIGURA:

  const [figureColor, setFigureColor] = useState('#121ca7');