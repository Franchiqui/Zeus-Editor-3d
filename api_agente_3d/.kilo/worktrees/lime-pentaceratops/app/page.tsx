'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import pb, { resolveClientBaseUrl } from '@/lib/pocketbase';
import { setPresentationTransfer } from '@/lib/aiPresentationTransfer';
import { setAnimationTransfer } from '@/lib/aiAnimationTransfer';
import {
  Upload,
  Folder,
  Edit,
  Layers,
  Grid3x3,
  List,
  X,
  Eye,
  ChevronRight,
  Image as ImageIcon,
  Video,
  Music,
  File,
  FileText,
  Clock,
  HardDrive,
  Sparkles,
  Check,
  Play,
  Volume2,
  Maximize2,
  Trash2,
  Code2
} from 'lucide-react';
import MainNavbar from '@/components/layout/MainNavbar';
import { CreatePresentationModal } from '@/components/CreatePresentationModal';
import { LocalPathModal } from '@/components/layout/LocalPathModal';
import { useStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n';
import { normalizeProvider } from '@/lib/collections';
import { Modal } from '@/components/ui/modal';
import { getLocalPaths, listDirectory, deleteFile, copyFile, getMediaUrl, readFile, readProject, getFilePath, writeFile } from '@/lib/electron-fs';

const DEFAULT_IMAGE_SRC = (id: string) => `https://picsum.photos/seed/${id}/800/600`;

type MediaType = 'image' | 'video' | 'audio' | 'gif' | 'document' | 'list' | 'html';
type AppTab = 'dashboard' | 'files' | 'projects' | 'editor';

const FileTypeIconSvg = ({ type, size = 22 }: { type: MediaType | 'folder'; size?: number }) => {
  const s = size;
  const stroke = (t: MediaType | 'folder') => ({
    audio: '#22c55e',
    image: '#3b82f6',
    video: '#ef4444',
    gif: '#a855f7',
    document: '#eab308',
    list: '#d1d5db',
    folder: '#6b7280',
    html: '#10b981',
  }[t] || '#6b7280');
  const c = stroke(type);
  const style = { display: 'block', width: s, height: s, minWidth: s, minHeight: s, flexShrink: 0 };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
        {type === 'audio' && <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>}
        {type === 'image' && <><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>}
        {type === 'gif' && <><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>}
        {type === 'video' && <><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></>}
        {type === 'document' && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /></>}
        {type === 'html' && <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>}
        {type === 'list' && <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /></>}
        {type === 'folder' && <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />}
      </svg>
    </span>
  );
};

type MediaFile = {
  id: string;
  name: string;
  type: MediaType;
  size: number;
  uploadedAt: Date;
  isLocal?: boolean;
  path?: string;
};

const LocalImportForm = ({ 
  onImport, 
  onClose, 
  isImporting 
}: { 
  onImport: (file: File, category: string) => Promise<void>, 
  onClose: () => void, 
  isImporting: boolean 
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>('video');
  const { t } = useI18n();

  // Intentar pre-seleccionar categoría al elegir archivo
  useEffect(() => {
    if (file) {
      if (file.type === 'image/gif') setCategory('gif');
      else if (file.type.startsWith('image/')) setCategory('imagen');
      else if (file.type.startsWith('audio/')) setCategory('audio');
      else if (file.type.startsWith('video/')) setCategory('video');
      else setCategory('documentos');
    }
  }, [file]);

  const categories = [
    { id: 'video', name: t('importForm.categories.video'), icon: <Video className="w-4 h-4" />, color: 'bg-red-500' },
    { id: 'audio', name: t('importForm.categories.audio'), icon: <Music className="w-4 h-4" />, color: 'bg-green-500' },
    { id: 'imagen', name: t('importForm.categories.imagen'), icon: <ImageIcon className="w-4 h-4" />, color: 'bg-blue-500' },
    { id: 'gif', name: t('importForm.categories.gif'), icon: <ImageIcon className="w-4 h-4" />, color: 'bg-purple-500' },
    { id: 'documentos', name: t('importForm.categories.documentos'), icon: <File className="w-4 h-4" />, color: 'bg-yellow-500' },
  ];

  return (
    <div className="space-y-6 p-4">
      <div className="space-y-3">
        <label className="text-sm font-bold text-gray-400 uppercase tracking-wider text-[10px]">{t('importForm.step1')}</label>
        <div className="border-2 border-dashed border-gray-700 rounded-2xl p-8 text-center hover:border-blue-500 transition-colors cursor-pointer bg-gray-950/50" onClick={() => document.getElementById('local-file-input')?.click()}>
          <input id="local-file-input" type="file" className="hidden" onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} />
          {file ? (
            <div className="space-y-1">
              <div className="text-white font-bold text-lg truncate max-w-xs mx-auto">{file.name}</div>
              <div className="text-xs text-blue-400 font-bold uppercase tracking-tighter">{(file.size / (1024 * 1024)).toFixed(2)} MB</div>
            </div>
          ) : (
            <div className="text-gray-500">
              <Upload className="w-10 h-10 mx-auto mb-3 opacity-20 text-blue-400" />
              <p className="font-bold text-sm">{t('importForm.chooseFile')}</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-bold text-gray-400 uppercase tracking-wider text-[10px]">{t('importForm.step2')}</label>
        <div className="grid grid-cols-2 gap-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all font-bold text-sm ${
                category === cat.id 
                  ? 'border-blue-500 bg-blue-500/10 text-white' 
                  : 'border-gray-800 bg-gray-950/50 text-gray-500 hover:border-gray-700'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${category === cat.id ? cat.color : 'bg-gray-800'} text-white`}>
                {cat.icon}
              </div>
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-8">
        <button onClick={onClose} className="px-5 py-2.5 text-gray-400 hover:text-white transition-colors font-bold text-sm" disabled={isImporting}>{t('importForm.cancel')}</button>
        <button
          onClick={() => file && onImport(file, category)}
          disabled={isImporting || !file}
          className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl text-white font-bold shadow-lg shadow-blue-900/30 transition-all flex items-center gap-2 text-sm"
        >
          {isImporting ? t('importForm.importing') : t('importForm.confirm')}
        </button>
      </div>
    </div>
  );
};

export default function ZeusMediaStudio() {
  const router = useRouter();
  const { t } = useI18n();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');

  // Recuperar pestaña pendiente tras redirección desde editor
  useEffect(() => {
    const pendingTab = sessionStorage.getItem('zeus_pending_tab');
    if (pendingTab) {
      setActiveTab(pendingTab as AppTab);
      sessionStorage.removeItem('zeus_pending_tab');
    }
  }, []);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [localProjects, setLocalProjects] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isPBUploadModalOpen, setIsPBUploadModalOpen] = useState(false);
  const [isLocalPathModalOpen, setIsLocalPathModalOpen] = useState(false);
  const [localPathModalMode, setLocalPathModalMode] = useState<'multimedia' | 'projects'>('multimedia');
  const [createPresentationModalOpen, setCreatePresentationModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<MediaType | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<'all' | 'edit_video' | 'edit_audio' | 'edit_imagen' | 'edit_gif' | 'edit_documento' | 'edit_html'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    (async () => {
      // Asegura que pb.baseUrl apunte a la base activa (remota o local) antes de validar la cookie.
      await resolveClientBaseUrl();
      if (pb.authStore.isValid) {
        setIsAuthenticated(true);
      } else {
        router.replace('/auth');
      }
    })();
  }, [router]);

  const loadLocalFiles = useCallback(async () => {
    try {
      const paths = await getLocalPaths();
      if (!paths || Object.keys(paths).length === 0) return;

      const categories = ['video', 'imagen', 'audio', 'gif', 'documentos'];
      const allFiles: MediaFile[] = [];

      await Promise.all(
        categories.map(async (cat) => {
          const folder = paths[cat];
          if (!folder) return;

          try {
            const files = await listDirectory(folder, cat);
            const pathMap = JSON.parse(localStorage.getItem('zeus_local_paths') || '{}');

            files.forEach((f: any) => {
              if (f.path || f.name) {
                pathMap[f.id] = { path: f.path || '', name: f.name || '' };
              }

              let finalType: MediaType = 'video';
              if (cat === 'imagen') finalType = 'image';
              else if (cat === 'audio') finalType = 'audio';
              else if (cat === 'gif') finalType = 'gif';
              else if (cat === 'documentos') finalType = 'document';
              else finalType = 'video';

              allFiles.push({
                ...f,
                type: finalType,
                uploadedAt: new Date(f.uploadedAt),
                isLocal: true
              });
            });

            localStorage.setItem('zeus_local_paths', JSON.stringify(pathMap));
          } catch (e) {
            console.warn(`Error leyendo carpeta local para ${cat}:`, e);
          }
        })
      );

      setMediaFiles(allFiles);

      const projectCategories = [
        { key: 'proyectos_video', type: 'edit_video' },
        { key: 'proyectos_audio', type: 'edit_audio' },
        { key: 'proyectos_imagen', type: 'edit_imagen' },
        { key: 'proyectos_gif', type: 'edit_gif' },
        { key: 'proyectos_documentos', type: 'edit_documento' },
        { key: 'proyectos_html', type: 'edit_html' }
      ];

      const allLocalProjects: any[] = [];

      await Promise.all(
        projectCategories.map(async (cat) => {
          const folder = paths[cat.key];
          if (!folder) return;

          try {
            const files = await listDirectory(folder, 'proyectos');
            const formatted = (files || []).map((p: any) => ({
              ...p,
              titulo: p.name,
              tipo: cat.type,
              isLocal: true
            }));
            allLocalProjects.push(...formatted);
          } catch (e) {}
        })
      );

      setLocalProjects(allLocalProjects);
    } catch (e) {
      console.error('Error cargando archivos locales:', e);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadLocalFiles();
  }, [isAuthenticated, loadLocalFiles]);

  // Intentar cargar el video automáticamente con reintentos
  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    let retryCount = 0;
    const maxRetries = 3;

    const handleLoad = () => {
      setVideoLoaded(true);
      setVideoError(false);
    };

    const handleError = () => {
      console.error('Error loading video, retrying...');
      setVideoError(true);
      
      if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(() => {
          video.load();
          video.play().catch(err => console.error('Autoplay failed:', err));
        }, 1000 * retryCount);
      }
    };

    const attemptPlay = () => {
      video.load();
      video.play().catch(err => {
        console.error('Autoplay failed:', err);
        // Intentar reproducir con interacción del usuario
        const handleUserInteraction = () => {
          video.play().catch(e => console.error('Play after interaction failed:', e));
          document.removeEventListener('click', handleUserInteraction);
          document.removeEventListener('keydown', handleUserInteraction);
        };
        document.addEventListener('click', handleUserInteraction);
        document.addEventListener('keydown', handleUserInteraction);
      });
    };

    video.addEventListener('loadeddata', handleLoad);
    video.addEventListener('error', handleError);
    video.addEventListener('canplay', handleLoad);

    // Intentar reproducir después de un pequeño delay
    const timeout = setTimeout(attemptPlay, 500);

    return () => {
      video.removeEventListener('loadeddata', handleLoad);
      video.removeEventListener('error', handleError);
      video.removeEventListener('canplay', handleLoad);
      clearTimeout(timeout);
    };
  }, [isAuthenticated]);

  const handleDeleteLocalPath = async (filePath: string, isProject: boolean = false) => {
    if (!filePath) return;
    if (!confirm(isProject ? t('app.confirmDeleteProject') : t('app.confirmDeleteFile'))) {
      return;
    }

    const ok = await deleteFile(filePath);
    if (ok) {
      loadLocalFiles();
    } else {
      alert(t('app.errDeleteFile'));
    }
  };

  const handleLocalImport = async (file: File, selectedCategory?: string) => {
    setIsUploading(true);
    try {
      let category = selectedCategory || 'video';
      if (!selectedCategory) {
        if (file.type === 'image/gif') category = 'gif';
        else if (file.type.startsWith('image/')) category = 'imagen';
        else if (file.type.startsWith('audio/')) category = 'audio';
        else if (file.type.startsWith('text/') || file.type.includes('pdf')) category = 'documentos';
      }

      const paths = await getLocalPaths();
      const targetFolder = paths?.[category];
      if (!targetFolder) {
        alert(t('app.noFolder'));
        return;
      }

      const destPath = targetFolder.replace(/\\*$/, '') + '\\' + file.name;

      // Intentar copiar por ruta real (Electron)
      const sourcePath = getFilePath(file);
      if (sourcePath) {
        const ok = await copyFile(sourcePath, destPath);
        if (ok) {
          setIsPBUploadModalOpen(false);
          loadLocalFiles();
          return;
        }
      }

      // Fallback: leer buffer y escribir
      const buffer = new Uint8Array(await file.arrayBuffer());
      const ok = await writeFile(destPath, buffer);
      if (ok) {
        setIsPBUploadModalOpen(false);
        loadLocalFiles();
      } else {
        throw new Error(t('app.errSaveFile'));
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : t('app.errImport'));
    } finally {
      setIsUploading(false);
    }
  };

  const fileCategories = [
    { id: 'all', name: t('files.categories.all'), icon: <Folder className="w-4 h-4" /> },
    { id: 'video', name: t('files.categories.videos'), icon: <Video className="w-4 h-4" /> },
    { id: 'audio', name: t('files.categories.audios'), icon: <Music className="w-4 h-4" /> },
    { id: 'image', name: t('files.categories.images'), icon: <ImageIcon className="w-4 h-4" /> },
    { id: 'gif', name: t('files.categories.gifs'), icon: <ImageIcon className="w-4 h-4 text-purple-400" /> },
    { id: 'document', name: t('files.categories.documents'), icon: <FileText className="w-4 h-4" /> },
  ];

  const resolveMediaUrl = (file: MediaFile) => {
    if (file.isLocal && file.path) {
      return getMediaUrl(file.path);
    }
    return '';
  };

  const filteredMediaFiles = useMemo(() => {
    return mediaFiles.filter(f => {
      const matchesType = filterType === 'all' || f.type === filterType;
      const matchesSearch = searchQuery === '' || 
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.path && f.path.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesType && matchesSearch;
    });
  }, [mediaFiles, filterType, searchQuery]);

  const handleBulkDeleteSelected = useCallback(async () => {
    const filesToDelete = filteredMediaFiles.filter(f => selectedFiles.has(f.id) && f.path);
    if (!filesToDelete.length) return;
    if (!confirm(t('app.confirmBulkDelete', { n: filesToDelete.length }))) return;

    setIsBulkDeleting(true);
    try {
      await Promise.all(filesToDelete.map(({ path }) => {
        if (!path) return Promise.resolve();
        return deleteFile(path);
      }));

      setSelectedFiles(new Set());
      loadLocalFiles();
    } catch (e) {
      alert(e instanceof Error ? e.message : t('app.errBulkDelete'));
    } finally {
      setIsBulkDeleting(false);
    }
  }, [filteredMediaFiles, loadLocalFiles, selectedFiles]);

  const renderDashboard = () => (
    <div className="space-y-8">
      <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-green-900 via-yellow-900 to-emerald-900 px-10 py-6 shadow-2xl">
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <img src="/Zeus-Media.png" alt="Zeus" className="w-36 h-36 object-contain drop-shadow-lg" />
            <div className="flex flex-col gap-3">
              <div className="h-full w-full max-w-[480px] md:max-w-[520px]">
                <img
                  src="/Z-Gif.gif"
                  alt="Zeus Media Studio IA"
                  className="w-full h-auto object-contain"
                />
              </div>
              <p className="text-green-100 text-xl font-medium opacity-90">{t('dashboard.heroSubtitle')}</p>
            </div>
          </div>
          <button onClick={() => setCreatePresentationModalOpen(true)} className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold transition-all shadow-xl backdrop-blur-md">
            <Sparkles className="w-6 h-6 text-yellow-400" /> {t('dashboard.createPresentation')}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          { id: 'files', title: t('dashboard.cardFilesTitle'), icon: <Clock className="w-6 h-6" />, count: t('dashboard.cardFilesCount', { n: mediaFiles.length }) },
          { id: 'projects', title: t('dashboard.cardProjectsTitle'), icon: <Layers className="w-6 h-6" />, count: t('dashboard.cardProjectsCount', { n: localProjects.length }) },
          { id: 'storage', title: t('dashboard.cardStorageTitle'), icon: <HardDrive className="w-6 h-6" />, count: t('dashboard.cardStorageCount') }
        ].map(w => (
          <div key={w.id} onClick={() => w.id !== 'storage' && setActiveTab(w.id as any)} className="bg-gray-950/50 border border-gray-800 p-6 rounded-3xl cursor-pointer hover:border-blue-500 hover:bg-gray-950 transition-all group">
            <div className="p-3 bg-blue-500/10 rounded-2xl w-fit mb-6 group-hover:scale-110 transition-transform">{w.icon}</div>
            <h3 className="text-xl text-white font-bold mb-2">{w.title}</h3>
            <p className="text-gray-400 font-medium">{w.count}</p>
          </div>
        ))}
      </div>

      {/* Presentación en bucle (la misma del editor de vídeo al iniciarse) */}
      <div className="relative w-full max-w-[880px] mx-auto overflow-hidden group transition-colors my-8 flex justify-center">
        <div className="relative w-full max-w-[848px] aspect-[1024/760] overflow-hidden rounded-full">
          <video
            ref={videoRef}
            src="/VIDEO_HOME.mp4"
            autoPlay
            loop
            muted
            playsInline
            className={`w-full h-full object-contain transition-opacity duration-700 ${videoLoaded ? 'opacity-90' : 'opacity-0'}`}
            onError={() => setVideoError(true)}
            onLoadedData={() => setVideoLoaded(true)}
          />
          {!videoLoaded && !videoError && (
            <div className="absolute inset-0 bg-gray-950/80" />
          )}
          {videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80">
              <div className="text-gray-500 text-sm font-medium">{t('dashboard.videoError')}</div>
            </div>
          )}
          <div className="absolute inset-0 pointer-events-none" />
        </div>
      </div>

    </div>
  );

  const renderFileManager = () => {
    return (
      <div className="space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">{t('files.title')}</h2>
            <p className="text-gray-400">{t('files.description')}</p>
          </div>
          <div className="flex gap-4">
            {/* Selector de modo de vista */}
            <div className="flex items-center space-x-1 bg-gray-950 rounded-2xl p-1.5 border border-gray-800 mr-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-xl transition-all ${viewMode === 'grid' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}
                title={t('files.viewGrid')}
              >
                <Grid3x3 className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-xl transition-all ${viewMode === 'list' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}
                title={t('files.viewList')}
              >
                <List className="w-5 h-5" />
              </button>
            </div>

            <button onClick={() => { setLocalPathModalMode('multimedia'); setIsLocalPathModalOpen(true); }} className="px-6 py-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-2xl flex items-center gap-2 text-blue-400 font-bold transition-all"><Folder className="w-5 h-5" /> {t('files.configureFolders')}</button>
            <button onClick={() => setIsPBUploadModalOpen(true)} className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-2xl flex items-center gap-2 text-white font-bold transition-all shadow-lg shadow-green-900/20"><Upload className="w-5 h-5" /> {t('files.importFile')}</button>
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          {fileCategories.map(c => (
            <button key={c.id} onClick={() => setFilterType(c.id as any)} className={`px-6 py-2.5 rounded-full flex items-center gap-2 text-sm font-bold transition-all ${filterType === c.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'bg-gray-950 text-gray-400 hover:bg-gray-800'}`}>{c.icon} {c.name}</button>
          ))}
        </div>

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {filteredMediaFiles.map(f => (
              <motion.div 
                key={f.id} 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => { const next = new Set(selectedFiles); if (next.has(f.id)) next.delete(f.id); else next.add(f.id); setSelectedFiles(next); }} 
                onDoubleClick={() => setPreviewFile(f)} 
                className={`relative group cursor-pointer rounded-3xl overflow-hidden border transition-all duration-300 ${selectedFiles.has(f.id) ? 'border-blue-500 ring-4 ring-blue-500/20 bg-blue-500/5' : 'border-gray-800 hover:border-gray-600 hover:bg-gray-900/40 shadow-lg hover:shadow-2xl'}`}
              >
                <div className="aspect-square bg-gray-950 flex items-center justify-center relative group-hover:bg-gray-900 transition-colors duration-500">
                  {/* Visualización inteligente según el tipo de archivo */}
                  {f.type === 'image' || f.type === 'gif' ? (
                    <img src={resolveMediaUrl(f)} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                  ) : f.type === 'video' ? (
                    <div className="w-full h-full relative">
                      <video 
                        src={resolveMediaUrl(f)} 
                        className="w-full h-full object-cover"
                        muted
                        onMouseOver={(e) => e.currentTarget.play()}
                        onMouseOut={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-transparent transition-colors">
                        <Play className="w-12 h-12 text-white/40 group-hover:text-white/80 transition-all transform group-hover:scale-110" />
                      </div>
                    </div>
                  ) : f.type === 'audio' ? (
                    <div className="w-full h-full bg-gradient-to-br from-green-500/10 via-gray-900/50 to-emerald-500/10 flex flex-col items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-green-500/30 via-transparent to-transparent animate-pulse" />
                      <Music className="w-20 h-20 text-green-400/40 relative z-10" />
                      <div className="mt-4 w-2/3 h-1.5 bg-green-500/20 rounded-full overflow-hidden relative z-10">
                        <div className="w-full h-full bg-green-400 animate-[shimmer_2s_infinite]" />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-gray-600">
                      <FileTypeIconSvg type={f.type} size={80} />
                    </div>
                  )}
                  
                  {/* Icono de tipo de archivo - Esquina superior izquierda */}
                  <div className="absolute top-3 left-3 p-2 bg-black/60 backdrop-blur-md rounded-xl z-20 border border-white/10">
                    <FileTypeIconSvg type={f.type} size={16} />
                  </div>

                  {/* Checkmark si está seleccionado */}
                  {selectedFiles.has(f.id) && (
                    <div className="absolute top-3 right-3 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center z-20 shadow-lg border-2 border-white/20">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                  )}

                  {/* Overlay de acciones rápidas */}
                  <div className="absolute inset-0 bg-gray-950/80 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-4 backdrop-blur-sm z-30">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setPreviewFile(f); }}
                      className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-white transition-all transform hover:scale-110 active:scale-95 shadow-xl"
                      title={t('files.preview')}
                    >
                      <Eye className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        const url = resolveMediaUrl(f);
                        const params = new URLSearchParams({ url, name: f.name });
                        if (f.type === 'video') router.push(`/edit-video?${params}`);
                        else if (f.type === 'audio') router.push(`/edit-audio?${params}`);
                        else if (f.type === 'image') router.push(`/edit-imagen?${params}`);
                        else if (f.type === 'gif') router.push(`/edit-gif?${params}`);
                        else router.push(`/edit-texto?${params}`);
                      }}
                      className="p-4 bg-blue-600 hover:bg-blue-500 border border-blue-400/30 rounded-2xl text-white transition-all transform hover:scale-110 active:scale-95 shadow-2xl"
                      title={t('files.openInEditor')}
                    >
                      <Edit className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                {/* Pie de la tarjeta */}
                <div className="p-4 bg-gray-900/90 backdrop-blur-md border-t border-gray-800/50">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p className="text-sm font-bold text-white truncate flex-1" title={f.name}>{f.name}</p>
                    <span 
                      className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 tracking-tighter"
                      style={{ color: f.type === 'audio' ? '#22c55e' : f.type === 'video' ? '#ef4444' : f.type === 'image' ? '#3b82f6' : f.type === 'gif' ? '#a855f7' : '#eab308' }}
                    >
                      {f.type}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-gray-500 font-medium">
                      {f.size ? (f.size / (1024 * 1024)).toFixed(2) + ' MB' : '--'}
                    </p>
                    <p className="text-[9px] text-gray-600 uppercase font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                      {f.isLocal ? t('files.local') : t('files.cloud')}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2 bg-gray-800/40 rounded-[2rem] border border-gray-700/50 overflow-hidden shadow-xl">
            {selectedFiles.size > 0 && (
              <div className="flex justify-end px-8 py-3 border-b border-gray-700/40">
                <button
                  onClick={handleBulkDeleteSelected}
                  disabled={isBulkDeleting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-full bg-red-600 hover:bg-red-500 disabled:bg-red-400 transition-all text-white"
                >
                  <Trash2 className="w-4 h-4" />
                  {isBulkDeleting ? t('files.deleting') : t('files.deleteN', { n: selectedFiles.size })}
                </button>
              </div>
            )}
            <div className="grid grid-cols-12 px-8 py-4 border-b border-gray-700/50 bg-gray-800/30 text-[10px] font-black uppercase tracking-widest text-gray-400">
              <div className="col-span-6">{t('files.colName')}</div>
              <div className="col-span-2 text-center">{t('files.colType')}</div>
              <div className="col-span-2 text-center">{t('files.colSize')}</div>
              <div className="col-span-2 text-right">{t('files.colActions')}</div>
            </div>
            <div className="divide-y divide-gray-800/30 max-h-[60vh] overflow-y-auto custom-scrollbar">
              {filteredMediaFiles.map(f => (
                <div 
                  key={f.id} 
                  onClick={() => { const next = new Set(selectedFiles); if (next.has(f.id)) next.delete(f.id); else next.add(f.id); setSelectedFiles(next); }}
                  className={`grid grid-cols-12 items-center px-8 py-4 cursor-pointer transition-all hover:bg-blue-600/5 group/row ${selectedFiles.has(f.id) ? 'bg-blue-600/10' : ''}`}
                >
                  <div className="col-span-6 flex items-center gap-4 min-w-0">
                    <div className="p-2.5 bg-gray-950 rounded-xl group-hover/row:bg-blue-600/20 transition-colors">
                      <FileTypeIconSvg type={f.type} size={20} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-white font-bold truncate text-sm">{f.name}</span>
                      <span className="text-[10px] text-gray-500 truncate opacity-60 group-hover/row:opacity-100 transition-opacity">{f.path || t('files.locationLocal')}</span>
                    </div>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="px-3 py-1 border border-gray-700/50 rounded-full text-xs font-bold uppercase text-white/90 tracking-tighter group-hover/row:border-blue-500/30">
                      {f.type}
                    </span>
                  </div>
                  <div className="col-span-2 text-center text-xs font-medium text-gray-500">
                    {f.size ? (f.size / (1024 * 1024)).toFixed(2) + ' MB' : '--'}
                  </div>
                  <div className="col-span-2 flex justify-end gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setPreviewFile(f); }}
                      className="p-2 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-all"
                      title={t('files.preview')}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        const url = resolveMediaUrl(f);
                        const params = new URLSearchParams({ url, name: f.name });
                        if (f.type === 'video') router.push(`/edit-video?${params}`);
                        else if (f.type === 'audio') router.push(`/edit-audio?${params}`);
                        else if (f.type === 'image') router.push(`/edit-imagen?${params}`);
                        else if (f.type === 'gif') router.push(`/edit-gif?${params}`);
                        else router.push(`/edit-texto?${params}`);
                      }}
                      className="p-2 bg-blue-600/10 hover:bg-blue-600 rounded-lg text-blue-400 hover:text-white transition-all"
                      title={t('files.openInEditor')}
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeleteLocalPath(f.path || ''); }}
                      className="p-2 hover:bg-red-500/10 rounded-lg text-gray-500 hover:text-red-500 transition-all"
                      title={t('files.deleteFile')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderProjectsManager = () => {
    const projectCategories = [
      { id: 'all', name: t('projects.categories.all'), icon: <Folder className="w-4 h-4" /> },
      { id: 'edit_video', name: t('projects.categories.video'), icon: <Video className="w-4 h-4" /> },
      { id: 'edit_audio', name: t('projects.categories.audio'), icon: <Music className="w-4 h-4" /> },
      { id: 'edit_imagen', name: t('projects.categories.imagen'), icon: <ImageIcon className="w-4 h-4" /> },
      { id: 'edit_gif', name: t('projects.categories.gif'), icon: <ImageIcon className="w-4 h-4 text-purple-400" /> },
      { id: 'edit_documento', name: t('projects.categories.documentos'), icon: <FileText className="w-4 h-4" /> },
      { id: 'edit_html', name: t('projects.categories.html'), icon: <Code2 className="w-4 h-4 text-emerald-400" /> },
    ];

    const filtered = localProjects.filter(p => (projectFilter === 'all' || p.tipo === projectFilter) && (searchQuery === '' || p.titulo.toLowerCase().includes(searchQuery.toLowerCase())));
    
    const handleOpenProject = async (p: any) => {
      let projectPath = p.path;
      let projectName = p.name;

      // 1. Si es una carpeta, buscamos el archivo .zeus dentro
      if (p.isDirectory) {
        try {
          const files = await listDirectory(p.path, 'proyectos');
          const zeusFile = files.find((f: any) => f.name.endsWith('.zeus'));
          if (zeusFile) {
            projectPath = zeusFile.path;
            projectName = zeusFile.name;
          } else {
            alert(t('projects.noZeus'));
            return;
          }
        } catch (e) {
          alert(t('projects.errReadFolder'));
          return;
        }
      }

      // 2. DETECCIÓN INTELIGENTE DEL TIPO DE PROYECTO
      let projectType = p.tipo;

      try {
        const projectData = await readProject(projectPath);
        if (projectData?.tipo) {
          projectType = projectData.tipo;
          console.log('🔍 Tipo de proyecto detectado:', projectType);
        }
      } catch (e) {
        console.warn('No se pudo pre-leer el archivo .zeus para detectar el tipo:', e);
      }

      // 3. Preparar parámetros
      let params;
      if (p.isDirectory) {
        params = new URLSearchParams({
          projectPath: p.path,
          projectName: p.name,
          isLocalProject: 'true'
        });
      } else {
        const url = getMediaUrl(projectPath);
        params = new URLSearchParams({ url, name: projectName, isProject: 'true' });
      }

      // 4. Redirigir al editor correcto
      if (projectType === 'edit_imagen') {
        router.push(`/edit-imagen?${params}`);
      } else if (projectType === 'edit_gif') {
        router.push(`/edit-gif?${params}`);
      } else if (projectType === 'edit_audio') {
        router.push(`/edit-audio?${params}`);
      } else if (projectType === 'edit_documento') {
        router.push(`/edit-texto?${params}`);
      } else if (projectType === 'edit_html') {
        router.push(`/edit-html?${params}`);
      } else {
        router.push(`/edit-video?${params}`);
      }
    };

    return (
      <div className="space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">{t('projects.title')}</h2>
            <p className="text-gray-400">{t('projects.description')}</p>
          </div>
          <div className="flex gap-4">
            {/* Selector de modo de vista */}
            <div className="flex items-center space-x-1 bg-gray-950 rounded-2xl p-1.5 border border-gray-800 mr-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-xl transition-all ${viewMode === 'grid' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}
                title={t('files.viewGrid')}
              >
                <Grid3x3 className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-xl transition-all ${viewMode === 'list' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}
                title={t('files.viewList')}
              >
                <List className="w-5 h-5" />
              </button>
            </div>
            <button onClick={() => { setLocalPathModalMode('projects'); setIsLocalPathModalOpen(true); }} className="px-6 py-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-2xl flex items-center gap-2 text-blue-400 font-bold transition-all"><Folder className="w-5 h-5" /> {t('projects.configureRoot')}</button>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          {projectCategories.map(c => (
            <button 
              key={c.id} 
              onClick={() => setProjectFilter(c.id as any)} 
              className={`px-6 py-2.5 rounded-full flex items-center gap-2 text-sm font-bold transition-all ${projectFilter === c.id ? 'bg-green-600 text-white shadow-lg shadow-green-900/40' : 'bg-gray-900 text-gray-400 hover:bg-gray-800'}`}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8">
            {filtered.map(p => (
              <div key={p.id} className="bg-gray-800/40 border border-white/30 p-6 rounded-3xl hover:border-white/50 hover:bg-gray-800/60 transition-all group relative shadow-lg">
                <div className="aspect-video bg-gray-950 rounded-2xl flex items-center justify-center mb-6 shadow-inner group-hover:scale-[1.02] transition-transform relative overflow-hidden">
                  {/* Icono de tipo de proyecto (Esquina superior izquierda) */}
                  <div className="absolute top-3 left-3 p-2 bg-black/60 backdrop-blur-md rounded-xl z-20 border border-white/10">
                     <FileTypeIconSvg 
                       type={
                         p.tipo === 'edit_video' ? 'video' : 
                         p.tipo === 'edit_audio' ? 'audio' : 
                         p.tipo === 'edit_imagen' ? 'image' : 
                         p.tipo === 'edit_gif' ? 'gif' : 
                         p.tipo === 'edit_documento' ? 'document' : 
                         p.tipo === 'edit_html' ? 'html' : 'folder'
                       } 
                       size={16} 
                     />
                  </div>

                  {p.isDirectory ? (
                    <Folder className="w-16 h-16 text-blue-500/20" />
                  ) : (
                    <File className="w-16 h-16 text-purple-500/20" />
                  )}
                </div>
                <h4 className="text-xl text-white font-bold truncate mb-1">{p.titulo}</h4>
                <p className="text-xs text-gray-500 truncate mb-6 opacity-60">{p.path}</p>
                <button 
                  onClick={() => handleOpenProject(p)} 
                  className="w-full py-3 bg-green-600 hover:bg-green-700 rounded-2xl text-sm font-bold text-white transition-all shadow-lg shadow-green-900/20"
                >
                  {t('projects.openProject')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2 bg-gray-800/40 rounded-[2rem] border border-gray-700/50 overflow-hidden shadow-xl">
            <div className="grid grid-cols-12 px-8 py-4 border-b border-gray-700/50 bg-gray-800/30 text-[10px] font-black uppercase tracking-widest text-gray-400">
              <div className="col-span-6">{t('projects.colName')}</div>
              <div className="col-span-4 text-center">{t('projects.colLocation')}</div>
              <div className="col-span-2 text-right">{t('projects.colActions')}</div>
            </div>
            <div className="divide-y divide-gray-800/30 max-h-[60vh] overflow-y-auto custom-scrollbar">
              {filtered.map(p => (
                <div 
                  key={p.id} 
                  className="grid grid-cols-12 items-center px-8 py-4 hover:bg-green-600/5 group/row transition-all"
                >
                  <div className="col-span-6 flex items-center gap-4 min-w-0">
                    <div className="p-2.5 bg-gray-950 rounded-xl group-hover/row:bg-green-600/20 transition-colors">
                      {p.isDirectory ? <Folder className="w-5 h-5 text-blue-400" /> : <File className="w-5 h-5 text-purple-400" />}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-white font-bold truncate text-sm">{p.titulo}</span>
                      <span className="text-[10px] text-gray-500 truncate opacity-60">{t('projects.localProject')}</span>
                    </div>
                  </div>
                  <div className="col-span-4 text-center">
                    <span className="text-xs text-white/90 truncate font-medium">
                      {p.path}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-end gap-2">
                    <button 
                      onClick={() => handleOpenProject(p)}
                      className="px-4 py-2 bg-green-600/10 hover:bg-green-600 rounded-xl text-green-400 hover:text-white text-xs font-bold transition-all flex items-center gap-2"
                    >
                      <Edit className="w-3.5 h-3.5" /> {t('projects.open')}
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeleteLocalPath(p.path || '', true); }}
                      className="p-2 hover:bg-red-500/10 rounded-lg text-gray-500 hover:text-red-500 transition-all"
                      title={t('projects.deleteProject')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {!isAuthenticated ? (
        <div className="h-screen bg-gray-950 flex items-center justify-center"><div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden font-editor">
          <MainNavbar 
            activeTab={activeTab} 
            onTabChange={setActiveTab} 
            onLogout={() => { pb.authStore.clear(); router.push('/auth'); }} 
            searchQuery={searchQuery} 
            onSearchChange={setSearchQuery} 
            collections={fileCategories.filter(c => c.id !== 'all')}
            selectedCollectionName={filterType}
            onCollectionChange={(val) => setFilterType(val as any)}
          />
          <main className="flex-1 overflow-auto custom-scrollbar">
            <div className="max-w-7xl mx-auto px-8 py-12">
              {activeTab === 'dashboard' && renderDashboard()}
              {activeTab === 'files' && renderFileManager()}
              {activeTab === 'projects' && renderProjectsManager()}
            </div>
          </main>
          <AnimatePresence>
            {previewFile && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-gray-950/95 backdrop-blur-xl flex items-center justify-center p-12" onClick={() => setPreviewFile(null)}>
                <div className="bg-gray-950 border border-gray-800 rounded-[2.5rem] p-10 max-w-5xl w-full shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-8">
                    <h3 className="text-3xl font-extrabold tracking-tight">{previewFile.name}</h3>
                    <button onClick={() => setPreviewFile(null)} className="p-2 hover:bg-white/5 rounded-full transition-colors"><X className="w-8 h-8" /></button>
                  </div>
                  <div className="aspect-video bg-gray-950 rounded-3xl overflow-hidden flex items-center justify-center shadow-2xl ring-1 ring-white/10">
                    {previewFile.type === 'image' || previewFile.type === 'gif' ? (
                      <img src={resolveMediaUrl(previewFile)} className="max-h-full object-contain" />
                    ) : null}
                    {previewFile.type === 'video' && <video src={resolveMediaUrl(previewFile)} controls autoPlay className="w-full h-full" />}
                    {previewFile.type === 'audio' && <div className="text-center"><Music className="w-32 h-32 mx-auto text-blue-500 mb-6 animate-pulse" /><audio src={resolveMediaUrl(previewFile)} controls autoPlay className="mx-auto" /></div>}
                  </div>
                  <div className="mt-10 flex justify-end">
                    <button onClick={() => {
                      const url = resolveMediaUrl(previewFile);
                      const params = new URLSearchParams({ url, name: previewFile.name });
                      setPreviewFile(null);
                      if (previewFile.type === 'video') router.push(`/edit-video?${params}`);
                      else if (previewFile.type === 'audio') router.push(`/edit-audio?${params}`);
                      else if (previewFile.type === 'image') router.push(`/edit-imagen?${params}`);
                      else if (previewFile.type === 'gif') router.push(`/edit-gif?${params}`);
                      else router.push(`/edit-texto?${params}`);
                    }} className="px-10 py-4 bg-blue-600 hover:bg-blue-700 rounded-2xl font-bold text-lg shadow-xl shadow-blue-900/30 transition-all">{t('files.editPiece')}</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <Modal isOpen={isPBUploadModalOpen} onClose={() => setIsPBUploadModalOpen(false)} title={t('files.importTitle')}><LocalImportForm onImport={handleLocalImport} onClose={() => setIsPBUploadModalOpen(false)} isImporting={isUploading} /></Modal>
          <LocalPathModal isOpen={isLocalPathModalOpen} onClose={() => setIsLocalPathModalOpen(false)} mode={localPathModalMode} onSaved={loadLocalFiles} />
          <CreatePresentationModal isOpen={createPresentationModalOpen} onClose={() => setCreatePresentationModalOpen(false)} onSubmit={async (form) => {
            const selectedModel = useStore.getState().selectedModel;

            // Si es modo presentación, convertir imágenes a data URLs antes de enviar
            let imageDataUrls: Record<string, string> = {};
            let audioDataUrl = '';
            let backgroundDataUrl = '';
            if (form.mode === 'presentation') {
              const imageFiles = (form.files || []).filter(f => f.type.startsWith('image/'));
              await Promise.all(imageFiles.map(file => new Promise<void>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => { imageDataUrls[file.name] = reader.result as string; resolve(); };
                reader.onerror = () => resolve();
                reader.readAsDataURL(file);
              })));

              if (form.audioFile) {
                await new Promise<void>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => { audioDataUrl = reader.result as string; resolve(); };
                  reader.onerror = () => resolve();
                  reader.readAsDataURL(form.audioFile!);
                });
              }

              if (form.backgroundFile) {
                await new Promise<void>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => { backgroundDataUrl = reader.result as string; resolve(); };
                  reader.onerror = () => resolve();
                  reader.readAsDataURL(form.backgroundFile!);
                });
              }
            }

            // Los objetos File no se serializan bien a JSON; extraemos solo los datos necesarios
            const filesForApi = (form.files || []).map(f => ({ name: f.name, type: f.type, size: f.size }));
            if (form.audioFile) filesForApi.push({ name: form.audioFile.name, type: form.audioFile.type, size: form.audioFile.size });
            if (form.backgroundFile) filesForApi.push({ name: form.backgroundFile.name, type: form.backgroundFile.type, size: form.backgroundFile.size });

            const res = await fetch('/api/crear-animacion', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...form,
                files: filesForApi,
                durationSeconds: form.numSlides,
                modelRecordId: selectedModel?.id,
                provider: normalizeProvider((selectedModel?.proveedor as string) ?? '')
              })
            });
            const data = await res.json();

            if (data.error) {
              throw new Error(data.error);
            }

            if (form.mode === 'presentation') {
              if (data.presentation) {
                setPresentationTransfer({
                  presentation: data.presentation,
                  imageDataUrls,
                  audioDataUrl,
                  backgroundDataUrl,
                });
              } else {
                throw new Error('La IA no devolvió una presentación estructurada. Inténtalo de nuevo con instrucciones más claras.');
              }
            } else if (form.mode === 'animation') {
              if (data.animation) {
                // Construir object URLs por nombre de archivo (vídeo/imagen/audio).
                // Persisten en la navegación client-side de Next.js App Router hacia /edit-video.
                const mediaUrls: Record<string, string> = {};
                for (const file of (form.files || [])) {
                  if (
                    file.type.startsWith('video/') ||
                    file.type.startsWith('image/') ||
                    file.type.startsWith('audio/')
                  ) {
                    try {
                      mediaUrls[file.name] = URL.createObjectURL(file);
                    } catch (e) {
                      console.warn('No se pudo crear object URL para', file.name, e);
                    }
                  }
                }
                setAnimationTransfer({ animation: data.animation, mediaUrls });
              } else if (data.text) {
                // Fallback: la IA no devolvió JSON estructurado; mostrar el guion en el panel del editor.
                sessionStorage.setItem('zeus_ai_script', data.text);
              } else {
                throw new Error('La IA no devolvió una animación estructurada. Inténtalo de nuevo con instrucciones más claras.');
              }
            }

            return { showSuccessCard: true, title: form.title || 'tu pieza' };
          }} />
        </div>
      )}
    </>
  );
}
