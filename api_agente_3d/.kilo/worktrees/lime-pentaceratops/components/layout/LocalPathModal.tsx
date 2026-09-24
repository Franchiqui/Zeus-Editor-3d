'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/modal';
import { selectFolder, getLocalPaths, saveLocalPaths } from '@/lib/electron-fs';
import { Folder, Video, Music, Image as ImageIcon, FileText, Layers, Sparkles, Code2, Lasso, Square, Type, Box } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface LocalPathModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  mode?: 'multimedia' | 'projects';
}

export function LocalPathModal({ isOpen, onClose, onSaved, mode = 'multimedia' }: LocalPathModalProps) {
  const { t } = useI18n();
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPaths = useCallback(async () => {
    try {
      const data = await getLocalPaths();
      setPaths(data || {});
    } catch (e) {
      console.error('Error cargando rutas locales:', e);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadPaths();
      setError(null);
    }
  }, [isOpen, loadPaths]);

  const handleSelectFolder = async (category: string) => {
    setError(null);
    const folder = await selectFolder();
    if (!folder) return;
    const next = { ...paths, [category]: folder };
    setPaths(next);
    setSaving(true);
    try {
      await saveLocalPaths(next);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (category: string, label: string, icon: any, placeholder: string) => {
    const currentPath = paths[category] || '';
    return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
          {icon}
          {label}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={currentPath}
            onChange={(e) => {
              const next = { ...paths, [category]: e.target.value };
              setPaths(next);
            }}
            onBlur={async () => {
              setSaving(true);
              try {
                await saveLocalPaths(paths);
                onSaved?.();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Error al guardar');
              } finally {
                setSaving(false);
              }
            }}
            placeholder={placeholder}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => handleSelectFolder(category)}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-white text-sm font-bold transition-all flex items-center gap-2"
          >
            <Folder className="w-4 h-4" />
            {currentPath ? t('app.change') : t('app.select')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'projects' ? t('app.cfgProjectsTitle') : t('app.cfgMultimediaTitle')}
      description={t('app.cfgDesc')}
      size="lg"
    >
      <div className="space-y-6 py-4">
        {error && (
          <div className="rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="grid gap-6">
          {mode === 'multimedia' ? (
            <>
              {renderRow('video', t('app.videosFolder'), <Video className="w-4 h-4 text-red-400" />, t('app.selectVideosFolder'))}
              {renderRow('audio', t('app.musicFolder'), <Music className="w-4 h-4 text-green-400" />, t('app.selectAudioFolder'))}
              {renderRow('imagen', t('app.imagesFolder'), <ImageIcon className="w-4 h-4 text-blue-400" />, t('app.selectImagesFolder'))}
              {renderRow('gif', t('app.gifFolder'), <ImageIcon className="w-4 h-4 text-purple-400" />, t('app.selectGifFolder'))}
              {renderRow('documentos', t('app.documentsFolder'), <FileText className="w-4 h-4 text-yellow-400" />, t('app.selectDocumentsFolder'))}
              {renderRow('mascaras', t('app.masksFolder'), <Lasso className="w-4 h-4 text-teal-400" />, t('app.selectMasksFolder'))}
              {renderRow('mascaras_seleccion', t('app.selectionFolder'), <Folder className="w-4 h-4 text-teal-400" />, t('app.selectSelectionFolder'))}
              <div className="mt-2 p-3 rounded-xl bg-teal-500/10 border border-teal-500/20">
                <p className="text-[11px] text-teal-300">
                  <strong>{t('app.noteLabel')}</strong> {t('app.noteSam2')}
                </p>
              </div>

              {/* Nueva sección para Objetos Locales */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-purple-400" />
                  {t('app.localObjects')}
                </h3>
                {renderRow('objetos', t('app.objectsFolder'), <Layers className="w-4 h-4 text-purple-400" />, t('app.selectObjectsFolder'))}
                {renderRow('objetos_3d', t('app.objects3dFolder'), <Box className="w-4 h-4 text-cyan-400" />, t('app.selectObjects3dFolder'))}
                {renderRow('proyectos_3d', t('app.projects3dFolder'), <Box className="w-4 h-4 text-emerald-400" />, t('app.selectProjects3dFolder'))}
                {renderRow('efectos', t('app.effectsFolder'), <Sparkles className="w-4 h-4 text-orange-400" />, t('app.selectEffectsFolder'))}
                <div className="mt-4 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                  <p className="text-[11px] text-purple-300">
                    <strong>{t('app.noteLabel')}</strong> {t('app.noteObjects')}
                  </p>
                </div>
              </div>

              {/* Nueva sección para Audio (Ritmos) */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Music className="w-5 h-5 text-green-400" />
                  {t('app.audioRhythms')}
                </h3>
                {renderRow('audio_electronica', t('app.electronic'), <Music className="w-4 h-4 text-cyan-400" />, t('app.selectElectronic'))}
                {renderRow('audio_cuerda', t('app.stringsRhythms'), <Music className="w-4 h-4 text-blue-400" />, t('app.selectStringsFolder'))}
                {renderRow('audio_percusion', t('app.percussion'), <Music className="w-4 h-4 text-yellow-400" />, t('app.selectPercussion'))}
                {renderRow('audio_viento', t('app.windRhythms'), <Music className="w-4 h-4 text-pink-400" />, t('app.selectWindFolder'))}
                <div className="mt-4 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <p className="text-[11px] text-green-300">
                    <strong>{t('app.noteLabel')}</strong> {t('app.noteRhythms')}
                  </p>
                </div>
              </div>

              {/* Nueva sección para Fuentes y Texturas */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Type className="w-5 h-5 text-orange-400" />
                  {t('app.fontsAndTextures')}
                </h3>
                {renderRow('fuentes', t('app.fuentesFolder'), <Type className="w-4 h-4 text-orange-400" />, t('app.selectFuentesFolder'))}
                {renderRow('texturas', t('app.texturasFolder'), <Square className="w-4 h-4 text-amber-400" />, t('app.selectTexturasFolder'))}
                <div className="mt-4 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
                  <p className="text-[11px] text-amber-300">
                    <strong>{t('app.noteLabel')}</strong> {t('app.noteFontsTextures')}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              {renderRow('proyectos_video', t('app.videoProjects'), <Video className="w-4 h-4 text-red-400" />, t('app.selectVideoProjects'))}
              {renderRow('proyectos_audio', t('app.audioProjects'), <Music className="w-4 h-4 text-green-400" />, t('app.selectAudioProjectsFolder'))}
              {renderRow('proyectos_imagen', t('app.imageProjects'), <ImageIcon className="w-4 h-4 text-blue-400" />, t('app.selectImageProjectsFolder'))}
              {renderRow('proyectos_gif', t('app.gifProjects'), <ImageIcon className="w-4 h-4 text-purple-400" />, t('app.selectGifProjectsFolder'))}
              {renderRow('proyectos_documentos', t('app.documentsProjects'), <FileText className="w-4 h-4 text-yellow-400" />, t('app.selectDocProjectsFolder'))}
              {renderRow('proyectos_html', t('app.htmlProjects'), <Code2 className="w-4 h-4 text-emerald-400" />, t('app.selectHtmlProjectsFolder'))}
              {renderRow('proyectos_objetos', t('app.objectsProjects'), <Layers className="w-4 h-4 text-purple-400" />, t('app.selectObjectsProjectsFolder'))}
              {renderRow('proyectos_efectos', t('app.effectsProjects'), <Sparkles className="w-4 h-4 text-orange-400" />, t('app.selectEffectsProjectsFolder'))}
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm font-bold transition-colors"
          >
            {t('app.ready')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
