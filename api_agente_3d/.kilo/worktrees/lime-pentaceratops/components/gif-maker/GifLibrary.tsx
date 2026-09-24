'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Download, Trash2, Eye, Save, FolderOpen, Clock, User, HardDrive, Database } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { useToast } from '@/hooks/use-toast';
import { getLocalPaths, listDirectory, getMediaUrl } from '@/lib/electron-fs';
import { useI18n } from '@/lib/i18n';

interface GifRecord {
  id: string;
  titulo: string;
  field: string;
  user: string;
  created: string;
  updated: string;
  collectionId: string;
  collectionName: string;
}

interface GifLibraryProps {
  onGifSelect?: (gifUrl: string) => void;
}

export interface GifLibraryRef {
  openSaveModal: (gif: Blob) => void;
}

export const GifLibrary = forwardRef<GifLibraryRef, GifLibraryProps>(({ onGifSelect }, ref) => {
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const [gifs, setGifs] = useState<GifRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGif, setSelectedGif] = useState<GifRecord | null>(null);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [gifTitle, setGifTitle] = useState('');
  const [gifToSave, setGifToSave] = useState<Blob | null>(null);

  // Estado para GIFs locales
  const [activeSource, setActiveSource] = useState<'database' | 'local'>('local');
  const [localGifs, setLocalGifs] = useState<any[]>([]);
  const [loadingLocal, setLoadingLocal] = useState(false);

  useEffect(() => {
    loadGifs();
    loadLocalGifs();
  }, []);

  useImperativeHandle(ref, () => ({
    openSaveModal: (gif: Blob) => {
      setGifToSave(gif);
      setIsSaveModalOpen(true);
    }
  }));

  // Función para verificar si el usuario actual es el dueño del GIF
  const isGifOwner = (gif: GifRecord) => {
    const currentUserId = pb.authStore.model?.id;
    return gif.user === currentUserId;
  };

  const loadGifs = async () => {
    try {
      setLoading(true);
      const records = await pb.collection('gif').getFullList({
        sort: '-created',
        expand: 'user'
      });
      setGifs(records as GifRecord[]);
    } catch (error) {
      console.error('Error loading GIFs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLocalGifs = async () => {
    setLoadingLocal(true);
    try {
      const paths = await getLocalPaths();
      const folder = paths?.gif;
      if (folder) {
        const result: any = await listDirectory(folder, 'gif');
        setLocalGifs(Array.isArray(result) ? result : result?.files || []);
      }
    } catch (e) {
      console.error('Error cargando GIFs locales:', e);
    } finally {
      setLoadingLocal(false);
    }
  };

  const handleSaveGif = async () => {
    if (!gifToSave || !gifTitle.trim()) {
      toast({
        title: t('gifEditor.libToastErrorTitle'),
        description: t('gifEditor.libErrTitleRequired'),
        variant: 'destructive'
      });
      return;
    }

    try {
      const formData = new FormData();
      formData.append('titulo', gifTitle);
      formData.append('field', gifToSave);
      formData.append('user', pb.authStore.model?.id || '');

      await pb.collection('gif').create(formData);

      toast({
        title: t('gifEditor.libToastSavedTitle'),
        description: t('gifEditor.libToastSavedDesc')
      });

      setIsSaveModalOpen(false);
      setGifTitle('');
      setGifToSave(null);
      loadGifs(); // Recargar la biblioteca
    } catch (error) {
      console.error('Error saving GIF:', error);
      toast({
        title: t('gifEditor.libToastErrorTitle'),
        description: t('gifEditor.libToastSaveErrorDesc'),
        variant: 'destructive'
      });
    }
  };

  const handleDeleteGif = async (gifId: string) => {
    try {
      await pb.collection('gif').delete(gifId);
      toast({
        title: t('gifEditor.libToastDeletedTitle'),
        description: t('gifEditor.libToastDeletedDesc')
      });
      loadGifs(); // Recargar la biblioteca
    } catch (error) {
      console.error('Error deleting GIF:', error);
      toast({
        title: t('gifEditor.libToastErrorTitle'),
        description: t('gifEditor.libToastDeleteErrorDesc'),
        variant: 'destructive'
      });
    }
  };

  const handleDownloadGif = async (gif: GifRecord) => {
    try {
      const url = pb.files.getUrl(gif, gif.field);
      const response = await fetch(url);
      const blob = await response.blob();
      
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${gif.titulo || 'gif'}.gif`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading GIF:', error);
      toast({
        title: t('gifEditor.libToastErrorTitle'),
        description: t('gifEditor.libToastDownloadErrorDesc'),
        variant: 'destructive'
      });
    }
  };

  const openSaveModal = (gifBlob: Blob) => {
    setGifToSave(gifBlob);
    setIsSaveModalOpen(true);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isLoading = activeSource === 'database' ? loading : loadingLocal;

  if (isLoading && activeSource === 'database' && gifs.length === 0 && localGifs.length === 0) {
    return (
      <Card className="bg-gray-900 border-gray-800 text-white">
        <CardContent className="p-6">
          <div className="text-center text-gray-400">
            <FolderOpen className="w-8 h-8 mx-auto mb-2 animate-pulse" />
            <p>{t('gifEditor.libLoading')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-gray-900 border-gray-800 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <FolderOpen className="w-5 h-5" />
            {t('gifEditor.libTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Pestañas para cambiar entre fuentes */}
          <div className="flex gap-2 p-1 bg-gray-800 rounded-xl mb-4">
            <button
              onClick={() => setActiveSource('local')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeSource === 'local' ? 'bg-green-600 text-black' : 'text-gray-400 hover:text-white'}`}
            >
              <HardDrive className="w-4 h-4" />
              {t('gifEditor.libLocalFolder')}
            </button>
            <button
              onClick={() => setActiveSource('database')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${activeSource === 'database' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              <Database className="w-4 h-4" />
              {t('gifEditor.libDatabase')}
            </button>
          </div>

          {activeSource === 'local' ? (
            <>
              {localGifs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <HardDrive className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">{t('gifEditor.libNoLocalTitle')}</p>
                  <p className="text-sm mt-1">{t('gifEditor.libNoLocalHint')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {localGifs.map((file) => (
                    <div key={file.id} className="relative group">
                      <Card className="overflow-hidden bg-gray-800 border-gray-700 hover:border-green-500/50 transition-colors">
                        <div className="relative aspect-square bg-black">
                          <img
                            src={getMediaUrl(file.path)}
                            alt={file.name}
                            className="w-full h-full object-contain"
                          />
                          {/* Botones en hover */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                            {onGifSelect && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => onGifSelect(getMediaUrl(file.path))}
                                className="h-8 w-8 p-0 bg-blue-600/80 hover:bg-blue-600 text-white border-blue-500"
                                title={t('gifEditor.libUseThisGif')}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="p-3">
                          <h3 className="font-medium text-sm text-white truncate mb-1">
                            {file.name}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <Clock className="w-3 h-3" />
                            <span>{file.uploadedAt ? formatDate(file.uploadedAt) : t('gifEditor.libUnknownDate')}</span>
                          </div>
                          <div className="mt-2">
                            <Button
                              onClick={() => {
                                const a = document.createElement('a');
                                a.href = getMediaUrl(file.path);
                                a.download = file.name;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                              }}
                              variant="outline"
                              size="sm"
                              className="w-full border-green-600 text-green-600 hover:bg-green-600 hover:text-white text-xs font-medium py-1"
                            >
                              <Download className="w-3 h-3 mr-1" />
                              {t('gifEditor.libDownload')}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {gifs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">{t('gifEditor.libNoDbTitle')}</p>
                  <p className="text-sm mt-1">{t('gifEditor.libNoDbHint')}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {gifs.map((gif) => (
                    <div key={gif.id} className="relative group">
                      <Card className="overflow-hidden bg-gray-800 border-gray-700 hover:border-gray-600 transition-colors">
                        <div className="relative aspect-square">
                          <img
                            src={pb.files.getUrl(gif, gif.field)}
                            alt={gif.titulo}
                            className="w-full h-full object-cover"
                          />

                          {/* Botones adicionales en hover */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                            {onGifSelect && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => onGifSelect(pb.files.getUrl(gif, gif.field))}
                                className="h-8 w-8 p-0 bg-blue-600/80 hover:bg-blue-600 text-white border-blue-500"
                                title={t('gifEditor.libUseThisGif')}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                            {isGifOwner(gif) && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteGif(gif.id)}
                                className="h-8 w-8 p-0 bg-red-600/80 hover:bg-red-600 text-white border-red-500"
                                title={t('gifEditor.libDeleteGif')}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="p-3">
                          <h3 className="font-medium text-sm text-white truncate mb-1">
                            {gif.titulo || t('gifEditor.libUntitled')}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <Clock className="w-3 h-3" />
                            <span>{formatDate(gif.created)}</span>
                          </div>

                          {/* Botón de descarga debajo del título */}
                          <div className="mt-2">
                            <Button
                              onClick={() => handleDownloadGif(gif)}
                              variant="outline"
                              size="sm"
                              className="w-full border-green-600 text-green-600 hover:bg-green-600 hover:text-white text-xs font-medium py-1"
                            >
                              <Download className="w-3 h-3 mr-1" />
                              {t('gifEditor.libDownload')}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal para guardar GIF */}
      <Modal isOpen={isSaveModalOpen} onClose={() => setIsSaveModalOpen(false)}>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Save className="w-5 h-5" />
            {t('gifEditor.libSaveModalTitle')}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('gifEditor.libGifTitleLabel')}
              </label>
              <Input
                value={gifTitle}
                onChange={(e) => setGifTitle(e.target.value)}
                placeholder={t('gifEditor.libGifTitlePlaceholder')}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                maxLength={100}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleSaveGif}
                disabled={!gifTitle.trim() || !gifToSave}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                <Save className="w-4 h-4 mr-2" />
                {t('gifEditor.libSave')}
              </Button>
              <Button
                onClick={() => setIsSaveModalOpen(false)}
                variant="outline"
                className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
              >
                {t('gifEditor.libCancel')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
});

GifLibrary.displayName = 'GifLibrary';

// Exportar una función para que otros componentes puedan abrir el modal de guardar
export const useGifLibrary = () => {
  const [saveGifCallback, setSaveGifCallback] = useState<((gifBlob: Blob) => void) | null>(null);

  const openSaveModal = (gifBlob: Blob) => {
    // Esta función será conectada al componente GifLibrary
    if (saveGifCallback) {
      saveGifCallback(gifBlob);
    }
  };

  return { openSaveModal, setSaveGifCallback };
};
