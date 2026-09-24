'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { 
  Sparkles, 
  AlertCircle, 
  Save, 
  FolderOpen, 
  FileImage, 
  Download,
  Loader2,
  Check,
  X,
  HardDrive
} from 'lucide-react';
import { ImageUploader } from '@/components/gif-maker/ImageUploader';
import { WebcamCapture } from '@/components/gif-maker/WebcamCapture';
import { DrawingCanvas } from '@/components/gif-maker/DrawingCanvas';
import { FrameList } from '@/components/gif-maker/FrameList';
import { AnimationControls } from '@/components/gif-maker/AnimationControls';
import { GifPreview } from '@/components/gif-maker/GifPreview';
import { GifLibrary, GifLibraryRef } from '@/components/gif-maker/GifLibrary';
import { FrameData, GifOptions, generateGIF, imageDataToThumbnail, loadImageFromFile, deconstructGIF } from '@/lib/gif-utils';
import { rotateImageData, flipImageData } from '@/lib/image-utils';
import MainNavbar from '@/components/layout/MainNavbar';
import Footer from '@/components/layout/footer';
import pb from '@/lib/pocketbase';
import { useToast } from '@/hooks/use-toast';
import { getLocalPaths, listDirectory, getMediaUrl, readProject, writeFile, readFileBuffer } from '@/lib/electron-fs';
import { useAIEditorBridgeOptional } from '@/components/AIEditorBridgeContext';
import { useI18n } from '@/lib/i18n';

export default function GifMakerPage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [frames, setFrames] = useState<FrameData[]>([]);
  const gifLibraryRef = useRef<GifLibraryRef>(null);

  useEffect(() => {
    setMounted(true);
  }, []);
  const [defaultDuration, setDefaultDuration] = useState(500);
  const [options, setOptions] = useState<GifOptions>({
    width: 480,
    height: 360,
    quality: 10,
    loop: 0,
  });
  const [generatedGif, setGeneratedGif] = useState<Blob | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // --- Puente con el chat: permitir que el modelo "vea" los frames del GIF ---
  const aiBridge = useAIEditorBridgeOptional();
  useEffect(() => {
    if (!aiBridge) return;
    const unregisterImages = aiBridge.registerDocumentImages(() => {
      if (frames.length === 0) return null;
      const thumbs = frames.map((f) => f.thumbnail).filter((u): u is string => !!u && typeof u === 'string' && u.startsWith('data:'));
      return thumbs.length > 0 ? thumbs : null;
    });
    const unregisterContent = aiBridge.registerDocumentContent(() => {
      if (frames.length === 0) return null;
      const parts: string[] = [];
      parts.push(t('gifEditor.aiGifFrames', { count: frames.length }));
      parts.push(t('gifEditor.aiDimensions', { w: options.width, h: options.height }));
      parts.push(t('gifEditor.aiDuration', { ms: defaultDuration, loop: options.loop === 0 ? t('gifEditor.aiLoopInfinite') : options.loop }));
      parts.push(t('gifEditor.aiQuality', { quality: options.quality }));
      return parts.join('\n');
    });
    return () => { unregisterImages(); unregisterContent(); };
  }, [aiBridge, frames, options, defaultDuration, t]);

  // Estados para diálogos de carga/guardado
  const [isSaveProjectModalOpen, setIsSaveProjectModalOpen] = useState(false);
  const [isLoadProjectModalOpen, setIsLoadProjectModalOpen] = useState(false);
  const [isSaveGifModalOpen, setIsSaveGifModalOpen] = useState(false);
  const [isLoadGifModalOpen, setIsLoadGifModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localFiles, setLocalFiles] = useState<any[]>([]);
  const [projectName, setProjectName] = useState('');
  const [gifFileName, setGifFileName] = useState('');
  const [currentFolder, setCurrentFolder] = useState<'gif' | 'imagen'>('gif');
  const [activeTab, setActiveTab] = useState('upload');

  const handleAddTextToEditor = useCallback((textOverlay: any) => {
    // Si no estamos en la pestaña de dibujo, cambiamos a ella
    if (activeTab !== 'draw') {
      setActiveTab('draw');
    }

    // Usar la función global expuesta por DrawingCanvas
    // Esperamos un pequeño delay para que el componente se monte si cambiamos de pestaña
    setTimeout(() => {
      if ((window as any).addTextToCanvas) {
        (window as any).addTextToCanvas({
          text: textOverlay.text,
          color: textOverlay.color,
          fontFamily: textOverlay.fontFamily,
          fontSize: textOverlay.fontSize
        });
      }
    }, 150);
  }, [activeTab]);

  const handleImagesAdded = useCallback(
    (images: { id: string; imageData: ImageData; thumbnail: string }[]) => {
      const newFrames = images.map((img) => ({
        ...img,
        duration: defaultDuration,
      }));
      setFrames((prev) => [...prev, ...newFrames]);
      setGeneratedGif(null);
      setError(null);
    },
    [defaultDuration]
  );

  const handleFrameCaptured = useCallback(
    (frame: { id: string; imageData: ImageData; thumbnail: string }) => {
      setFrames((prev) => [...prev, { ...frame, duration: defaultDuration }]);
      setGeneratedGif(null);
      setError(null);
    },
    [defaultDuration]
  );

  const handleDeleteFrame = useCallback((id: string) => {
    setFrames((prev) => prev.filter((f) => f.id !== id));
    setGeneratedGif(null);
  }, []);

  const handleRotateFrame = useCallback((id: string) => {
    setFrames((prev) =>
      prev.map((f) => {
        if (f.id === id) {
          const rotated = rotateImageData(f.imageData, 90);
          return {
            ...f,
            imageData: rotated,
            thumbnail: imageDataToThumbnail(rotated),
          };
        }
        return f;
      })
    );
    setGeneratedGif(null);
  }, []);

  const handleFlipFrame = useCallback((id: string) => {
    setFrames((prev) =>
      prev.map((f) => {
        if (f.id === id) {
          const flipped = flipImageData(f.imageData, true);
          return {
            ...f,
            imageData: flipped,
            thumbnail: imageDataToThumbnail(flipped),
          };
        }
        return f;
      })
    );
    setGeneratedGif(null);
  }, []);

  const handleCleanSelection = useCallback((id: string) => {
    setFrames((prev) =>
      prev.map((f) => {
        if (f.id === id) {
          // Usar la misma función de limpieza que en GifPreview
          const cleanImageData = removeRectanglesFromImageData(f.imageData);
          return {
            ...f,
            imageData: cleanImageData,
            thumbnail: imageDataToThumbnail(cleanImageData),
          };
        }
        return f;
      })
    );
    setGeneratedGif(null);
  }, []);

  // Función para eliminar rectángulos de selección del ImageData
  function removeRectanglesFromImageData(imageData: ImageData): ImageData {
    const cleanData = new Uint8ClampedArray(imageData.data);
    const { width, height } = imageData;
    
    // Colores característicos de rectángulos que queremos eliminar
    const rectangleColors = [
      { r: 239, g: 68, b: 68 },   // Rojo (#ef4444) - modo crop
      { r: 245, g: 158, b: 11 },  // Naranja (#f59e0b) - modo selección
      { r: 59, g: 130, b: 246 },  // Azul (#3b82f6) - bordes de edición
      { r: 16, g: 185, b: 129 },  // Verde (#10b981) - bordes de texto
    ];

    // Detectar y eliminar píxeles de rectángulos
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = cleanData[idx];
        const g = cleanData[idx + 1];
        const b = cleanData[idx + 2];
        const a = cleanData[idx + 3];

        // Verificar si el píxel coincide con colores de rectángulo
        const isRectanglePixel = rectangleColors.some(color => 
          Math.abs(r - color.r) <= 5 && 
          Math.abs(g - color.g) <= 5 && 
          Math.abs(b - color.b) <= 5
        );

        if (isRectanglePixel) {
          // Hacer el píxel transparente
          cleanData[idx + 3] = 0;
        }
      }
    }

    // Crear nuevo ImageData limpio
    const cleanImageData = new ImageData(cleanData, width, height);
    return cleanImageData;
  }

  const handleSaveToLibrary = useCallback((gif: Blob) => {
    // Usar la referencia para abrir el modal de guardado
    if (gifLibraryRef.current) {
      gifLibraryRef.current.openSaveModal(gif);
    }
  }, []);

  const handleReorderFrames = useCallback((newFrames: FrameData[]) => {
    setFrames(newFrames);
    setGeneratedGif(null);
  }, []);

  const handleDefaultDurationChange = useCallback(
    (duration: number) => {
      setDefaultDuration(duration);
      setFrames((prev) => prev.map((f) => ({ ...f, duration })));
      setGeneratedGif(null);
    },
    []
  );

  const handleGenerateGif = useCallback(async () => {
    if (frames.length === 0) {
      setError(t('gifEditor.errAddFrame'));
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    setError(null);

    try {
      const gif = await generateGIF(frames, options, (p) => {
        setProgress(p);
      });

      setGeneratedGif(gif);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('gifEditor.errGenerateGif'));
      console.error('Error generating GIF:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [frames, options, t]);

  const handleDownload = useCallback(() => {
    if (!generatedGif) return;

    const url = URL.createObjectURL(generatedGif);
    const a = document.createElement('a');
    a.href = url;
    a.download = gifFileName ? (gifFileName.endsWith('.gif') ? gifFileName : `${gifFileName}.gif`) : `animated-${Date.now()}.gif`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generatedGif, gifFileName]);

  // FUNCIONES DE CARGA Y GUARDADO LOCAL
  const fetchLocalFiles = async (category: 'gif' | 'proyectos_gif' | 'imagen') => {
    setIsLoading(true);
    try {
      const paths = await getLocalPaths();
      const folder = paths?.[category];

      if (folder) {
        const files = await listDirectory(folder, category === 'gif' ? 'gif' : category === 'imagen' ? 'imagen' : 'proyectos');
        setLocalFiles(files || []);
      }
    } catch (e) {
      console.error(e);
      toast({ title: t('gifEditor.toastErrorTitle'), description: t('gifEditor.toastLoadFilesErrorDesc'), variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const saveProjectLocal = async () => {
    if (!projectName.trim()) return;
    setIsSaving(true);
    try {
      const paths = await getLocalPaths();
      const targetFolder = paths?.proyectos_gif;

      if (!targetFolder) throw new Error(t('gifEditor.throwNoGifProjectsFolder'));

      const projectData = {
        tipo: 'edit_gif',
        version: '1.0',
        frames: frames.map(f => ({
          id: f.id,
          duration: f.duration,
          imageDataBase64: imageDataToBase64(f.imageData)
        })),
        options,
        defaultDuration
      };

      const destPath = `${targetFolder}\\${projectName}.zeus`;
      await writeFile(destPath, JSON.stringify(projectData));

      toast({ title: t('gifEditor.toastProjectSavedTitle'), description: t('gifEditor.toastProjectSavedDesc', { name: projectName }) });
      setIsSaveProjectModalOpen(false);
    } catch (e) {
      toast({ title: t('gifEditor.toastErrorTitle'), description: e instanceof Error ? e.message : t('gifEditor.toastSaveProjectErrorDesc'), variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const saveGifLocal = async () => {
    if (!generatedGif || !gifFileName.trim()) return;
    setIsSaving(true);
    try {
      const paths = await getLocalPaths();
      const targetFolder = paths?.gif;

      if (!targetFolder) throw new Error(t('gifEditor.throwNoGifsFolder'));

      const fileName = gifFileName.endsWith('.gif') ? gifFileName : `${gifFileName}.gif`;
      const destPath = `${targetFolder}\\${fileName}`;
      await writeFile(destPath, new Uint8Array(await generatedGif.arrayBuffer()));

      toast({ title: t('gifEditor.toastGifSavedTitle'), description: t('gifEditor.toastGifSavedDesc', { name: fileName }) });
      setIsSaveGifModalOpen(false);
    } catch (e) {
      toast({ title: t('gifEditor.toastErrorTitle'), description: e instanceof Error ? e.message : t('gifEditor.toastSaveGifErrorDesc'), variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const loadProjectLocal = async (projectFile: any) => {
    setIsLoading(true);
    try {
      const projectData = await readProject(projectFile.path);
      if (!projectData) throw new Error(t('gifEditor.throwReadProject'));
      if (projectData.tipo !== 'edit_gif') throw new Error(t('gifEditor.throwInvalidGifProject'));

      // Reconstruir los frames desde base64
      const restoredFrames = await Promise.all(projectData.frames.map(async (f: any) => {
        const imageData = await base64ToImageData(f.imageDataBase64);
        return {
          id: f.id,
          duration: f.duration,
          imageData,
          thumbnail: imageDataToThumbnail(imageData)
        };
      }));

      setFrames(restoredFrames);
      setOptions(projectData.options || options);
      setDefaultDuration(projectData.defaultDuration || defaultDuration);
      setProjectName(projectFile.name.replace('.zeus', ''));
      setGeneratedGif(null);
      setIsLoadProjectModalOpen(false);
      toast({ title: t('gifEditor.toastProjectLoadedTitle'), description: t('gifEditor.toastProjectLoadedDesc', { name: projectFile.name }) });
    } catch (e) {
      toast({ title: t('gifEditor.toastErrorTitle'), description: e instanceof Error ? e.message : t('gifEditor.toastLoadProjectErrorDesc'), variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const loadGifAsFrames = async (gifFile: any) => {
    setIsLoading(true);
    try {
      const buffer = await readFileBuffer(gifFile.path);
      if (!buffer) throw new Error(t('gifEditor.throwReadGif'));

      const blob = new Blob([new Uint8Array(buffer)]);
      const extractedFrames = await deconstructGIF(blob);

      setFrames((prev) => [...prev, ...extractedFrames]);
      setGeneratedGif(null);

      toast({
        title: t('gifEditor.toastGifImportedTitle'),
        description: t('gifEditor.toastGifImportedDesc', { count: extractedFrames.length, name: gifFile.name })
      });
      setIsLoadGifModalOpen(false);
    } catch (e) {
      toast({
        title: t('gifEditor.toastImportErrorTitle'),
        description: e instanceof Error ? e.message : t('gifEditor.toastImportErrorDesc'),
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadFileAsFrame = async (file: any) => {
    try {
      const buffer = await readFileBuffer(file.path);
      if (!buffer) throw new Error(t('gifEditor.throwReadFile'));

      const blob = new Blob([new Uint8Array(buffer)]);
      const imageFile = new File([blob], file.name, { type: blob.type || 'image/jpeg' });
      const imageData = await loadImageFromFile(imageFile);

      handleFrameCaptured({
        id: Math.random().toString(36).substring(7),
        imageData,
        thumbnail: imageDataToThumbnail(imageData)
      });

      toast({ title: t('gifEditor.toastImageAddedTitle'), description: t('gifEditor.toastImageAddedDesc', { name: file.name }) });
    } catch (e) {
      toast({ title: t('gifEditor.toastErrorTitle'), description: t('gifEditor.toastLoadImageErrorDesc'), variant: 'destructive' });
    }
  };

  const exportFramesAsImages = async () => {
    if (frames.length === 0) return;
    setIsSaving(true);
    try {
      const paths = await getLocalPaths();
      const targetFolder = paths?.imagen;

      if (!targetFolder) throw new Error(t('gifEditor.throwNoImagesFolder'));

      const baseName = projectName || 'frames-export';

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const canvas = document.createElement('canvas');
        canvas.width = frame.imageData.width;
        canvas.height = frame.imageData.height;
        const ctx = canvas.getContext('2d');
        ctx?.putImageData(frame.imageData, 0, 0);

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) continue;

        const fileName = `${baseName}-frame-${i + 1}.png`;
        const destPath = `${targetFolder}\\${fileName}`;
        const buffer = new Uint8Array(await blob.arrayBuffer());
        await writeFile(destPath, buffer);
      }

      toast({
        title: t('gifEditor.toastExportDoneTitle'),
        description: t('gifEditor.toastExportDoneDesc', { count: frames.length })
      });
    } catch (e) {
      toast({
        title: t('gifEditor.toastExportErrorTitle'),
        description: e instanceof Error ? e.message : t('gifEditor.toastExportErrorDesc'),
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  // HELPERS PARA CONVERSIÓN DE IMAGEN
  const imageDataToBase64 = (imageData: ImageData): string => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx?.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const base64ToImageData = (base64: string): Promise<ImageData> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        resolve(ctx!.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = reject;
      img.src = base64;
    });
  };

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden text-white font-editor">
      <MainNavbar activeTab="editor" />
      
      {/* BARRA DE ACCIONES SUPERIOR */}
      <div className="bg-gray-900/50 border-b border-gray-800 px-6 py-3 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-xl">
            <FileImage className="w-4 h-4 text-green-400" />
            <span className="text-xs font-bold text-green-300 uppercase tracking-widest">
              {projectName || t('gifEditor.newGifProject')}
            </span>
          </div>
          
          <div className="h-6 w-px bg-gray-800 mx-2" />
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => { fetchLocalFiles('proyectos_gif'); setIsLoadProjectModalOpen(true); }}
              className="text-gray-400 hover:text-white hover:bg-gray-800 gap-2 rounded-xl"
            >
              <FolderOpen className="w-4 h-4" />
              <span className="text-xs font-bold uppercase">{t('gifEditor.openProject')}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { fetchLocalFiles('proyectos_gif'); setIsSaveProjectModalOpen(true); }}
              className="text-gray-400 hover:text-white hover:bg-gray-800 gap-2 rounded-xl"
            >
              <Save className="w-4 h-4" />
              <span className="text-xs font-bold uppercase">{t('gifEditor.saveProject')}</span>
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => { setCurrentFolder('gif'); fetchLocalFiles('gif'); setIsLoadGifModalOpen(true); }}
            className="border-gray-800 bg-gray-950 hover:bg-gray-800 text-gray-400 hover:text-white gap-2 rounded-xl"
          >
            <HardDrive className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-tighter">{t('gifEditor.loadLocal')}</span>
          </Button>
          
          <Button 
            variant="default" 
            size="sm" 
            disabled={!generatedGif}
            onClick={() => setIsSaveGifModalOpen(true)}
            className="bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-black gap-2 rounded-xl shadow-lg shadow-green-900/20 px-6 font-bold"
          >
            <Download className="w-4 h-4" />
            <span className="text-xs font-bold uppercase">{t('gifEditor.saveFinalGif')}</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-4">
              <Sparkles className="w-8 h-8 text-green-400" />
              <h1 className="text-4xl font-black bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">Zeus Studio GIF</h1>
            </div>
            <p className="text-gray-400 max-w-2xl mx-auto font-medium">
              {t('gifEditor.heroSubtitle')}
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 space-y-6 sticky top-6">
              <Card className="bg-gray-900 border-gray-800 text-white shadow-2xl">
                <CardHeader>
                  <CardTitle className="text-white">{t('gifEditor.addFramesTitle')}</CardTitle>
                  <CardDescription className="text-gray-400">
                    {t('gifEditor.addFramesDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 bg-gray-800 border-gray-700 p-1">
                      <TabsTrigger value="upload" className="data-[state=active]:bg-green-600 data-[state=active]:text-black font-bold text-gray-400 transition-all">{t('gifEditor.tabUpload')}</TabsTrigger>
                      <TabsTrigger value="webcam" className="data-[state=active]:bg-green-600 data-[state=active]:text-black font-bold text-gray-400 transition-all">{t('gifEditor.tabWebcam')}</TabsTrigger>
                      <TabsTrigger value="draw" className="data-[state=active]:bg-green-600 data-[state=active]:text-black font-bold text-gray-400 transition-all">{t('gifEditor.tabDraw')}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="upload" className="mt-6">
                      <ImageUploader onImagesAdded={handleImagesAdded} />
                    </TabsContent>
                    <TabsContent value="webcam" className="mt-6">
                      <WebcamCapture onFrameCaptured={handleFrameCaptured} />
                    </TabsContent>
                    <TabsContent value="draw" className="mt-6">
                      <DrawingCanvas onFrameCreated={handleFrameCaptured} textStyle={options.textOverlay} />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <Card className="bg-gray-900 border-gray-800 text-white shadow-2xl">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-white">{t('gifEditor.framesTitle', { count: frames.length })}</CardTitle>
                    <CardDescription className="text-gray-400">
                      {t('gifEditor.framesDesc')}
                    </CardDescription>
                  </div>
                  {frames.length > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={exportFramesAsImages}
                      disabled={isSaving}
                      className="border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500 hover:text-black transition-all gap-2"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileImage className="w-4 h-4" />}
                      <span className="font-bold uppercase text-[10px]">{t('gifEditor.exportToImages')}</span>
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <FrameList
                    frames={frames}
                    onReorder={handleReorderFrames}
                    onDelete={handleDeleteFrame}
                    onRotate={handleRotateFrame}
                    onFlip={handleFlipFrame}
                    onCleanSelection={handleCleanSelection}
                  />
                </CardContent>
              </Card>

              {/* Biblioteca de GIFs */}
              <GifLibrary ref={gifLibraryRef} />

              {error && (
                <Alert variant="destructive" className="bg-red-900/20 border-red-900 text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {isGenerating && (
                <Card className="bg-gray-900 border-gray-800 shadow-2xl">
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="flex justify-between text-sm text-gray-400 font-bold uppercase tracking-widest">
                        <span>{t('gifEditor.generating')}</span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                      <Progress value={progress} className="bg-gray-800 h-3 [&>div]:bg-gradient-to-r [&>div]:from-green-500 [&>div]:to-yellow-500 shadow-inner" />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <GifPreview
                frames={frames}
                generatedGif={generatedGif}
                isGenerating={isGenerating}
                onGenerate={handleGenerateGif}
                onDownload={handleDownload}
                onSaveToLibrary={handleSaveToLibrary}
              />

              <AnimationControls
                options={options}
                onOptionsChange={setOptions}
                defaultDuration={defaultDuration}
                onDefaultDurationChange={handleDefaultDurationChange}
                onAddText={handleAddTextToEditor}
              />
            </div>
          </div>

          <div className="mt-12 text-center text-xs text-gray-500 font-bold uppercase tracking-widest opacity-50">
            <p>{t('gifEditor.processingNote')}</p>
          </div>
        </div>
        <Footer />
      </div>

      {/* MODALES DE CARGA Y GUARDADO */}
      <Modal isOpen={isSaveProjectModalOpen} onClose={() => setIsSaveProjectModalOpen(false)} title={t('gifEditor.saveProjectModalTitle')}>
        <div className="space-y-6 p-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">{t('gifEditor.projectNameLabel')}</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={t('gifEditor.projectNamePlaceholder')}
              className="w-full bg-gray-900 border-2 border-gray-800 rounded-2xl p-4 text-white text-lg outline-none focus:border-green-500 transition-all shadow-inner"
              autoFocus
            />
          </div>

          {/* LISTA DE PROYECTOS EXISTENTES PARA ACTUALIZAR */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block">{t('gifEditor.updateExistingLabel')}</label>
            <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar border-t border-gray-800 pt-3">
              {isLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>
              ) : localFiles.length > 0 ? (
                localFiles.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => setProjectName(file.name.replace('.zeus', ''))}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-all border ${
                      projectName === file.name.replace('.zeus', '') 
                      ? 'bg-green-500/10 border-green-500 text-green-400' 
                      : 'bg-gray-900 hover:bg-gray-800 border-gray-800 text-gray-400'
                    }`}
                  >
                    <FileImage className="w-4 h-4" />
                    <span className="text-xs font-bold truncate flex-1 text-left">{file.name}</span>
                    {projectName === file.name.replace('.zeus', '') && <Check className="w-4 h-4" />}
                  </button>
                ))
              ) : (
                <p className="text-[10px] text-gray-600 italic text-center py-4">{t('gifEditor.noProjects')}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <Button variant="ghost" onClick={() => setIsSaveProjectModalOpen(false)} disabled={isSaving}>{t('gifEditor.cancel')}</Button>
            <Button
              onClick={saveProjectLocal}
              disabled={isSaving || !projectName.trim()}
              className="bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-black font-bold px-8 h-12 rounded-xl shadow-lg"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              {localFiles.some(f => f.name.replace('.zeus', '') === projectName) ? t('gifEditor.updateProject') : t('gifEditor.saveToProjects')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isSaveGifModalOpen} onClose={() => setIsSaveGifModalOpen(false)} title={t('gifEditor.saveGifModalTitle')}>
        <div className="space-y-6 p-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">{t('gifEditor.gifFileNameLabel')}</label>
            <input
              type="text"
              value={gifFileName}
              onChange={(e) => setGifFileName(e.target.value)}
              placeholder={t('gifEditor.gifFileNamePlaceholder')}
              className="w-full bg-gray-900 border-2 border-gray-800 rounded-2xl p-4 text-white text-lg outline-none focus:border-green-500 transition-all shadow-inner"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 mt-8">
            <Button variant="ghost" onClick={() => setIsSaveGifModalOpen(false)} disabled={isSaving}>{t('gifEditor.cancel')}</Button>
            <Button
              onClick={saveGifLocal}
              disabled={isSaving || !gifFileName.trim()}
              className="bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-black font-bold px-8 h-12 rounded-xl shadow-lg"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
              {t('gifEditor.saveToGifFolder')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isLoadProjectModalOpen} onClose={() => setIsLoadProjectModalOpen(false)} title={t('gifEditor.loadProjectModalTitle')}>
        <div className="space-y-4 p-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-10 h-10 animate-spin text-green-500" /></div>
          ) : localFiles.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {localFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => loadProjectLocal(file)}
                  className="flex items-center gap-4 p-4 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-2xl transition-all group"
                >
                  <div className="p-3 bg-green-500/10 rounded-xl group-hover:bg-green-500/20 transition-colors">
                    <FileImage className="w-6 h-6 text-green-400" />
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{file.name}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{t('gifEditor.zeusProject')}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-700 group-hover:text-green-400 transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-10" />
              <p className="font-bold">{t('gifEditor.noProjectsFound')}</p>
            </div>
          )}
        </div>
      </Modal>

      <Modal isOpen={isLoadGifModalOpen} onClose={() => setIsLoadGifModalOpen(false)} title={t('gifEditor.loadGifModalTitle')}>
        <div className="space-y-4 p-4">
          <div className="flex gap-2 p-1 bg-gray-800 rounded-xl">
            <button
              onClick={() => { setCurrentFolder('gif'); fetchLocalFiles('gif'); }}
              className={`flex-1 py-2 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${currentFolder === 'gif' ? 'bg-green-600 text-black' : 'text-gray-400 hover:text-white'}`}
            >
              {t('gifEditor.gifFolder')}
            </button>
            <button
              onClick={() => { setCurrentFolder('imagen'); fetchLocalFiles('imagen'); }}
              className={`flex-1 py-2 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${currentFolder === 'imagen' ? 'bg-green-600 text-black' : 'text-gray-400 hover:text-white'}`}
            >
              {t('gifEditor.imageFolder')}
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-10 h-10 animate-spin text-green-500" /></div>
          ) : localFiles.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {localFiles.map((file) => (
                <div
                  key={file.id}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-2 group hover:border-green-500/50 transition-all"
                >
                  <div className="aspect-square bg-black rounded-xl overflow-hidden mb-3 relative">
                    <img
                      src={getMediaUrl(file.path)}
                      className="w-full h-full object-contain"
                      alt={file.name}
                    />
                  </div>
                  <div className="px-2 pb-2">
                    <p className="text-xs text-white font-bold truncate mb-1" title={file.name}>{file.name}</p>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => currentFolder === 'gif' ? loadGifAsFrames(file) : loadFileAsFrame(file)}
                      className="w-full text-[10px] font-black uppercase text-green-400 hover:text-black hover:bg-green-600 rounded-lg h-7 font-bold"
                    >
                      {currentFolder === 'gif' ? t('gifEditor.importAction') : t('gifEditor.addFrameAction')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <FileImage className="w-12 h-12 mx-auto mb-4 opacity-10" />
              <p className="font-bold">{t('gifEditor.noFilesInFolder')}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// Icono auxiliar que faltaba importar correctamente si lucide no lo tiene directamente
function ChevronRight(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}
