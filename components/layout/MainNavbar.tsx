'use client';

import '@fontsource/audiowide';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Search, X, Minus, Square, Video, Music, Image as ImageIcon, File, ChevronRight, Settings, ChevronDown, Code2, GraduationCap, Type, Box } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { useStore } from '@/lib/store';
import { isElectron as checkIsElectron } from '@/lib/electron-fs';
import { MODELOS_COLLECTION_NAME } from '@/lib/collections';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useI18n } from '@/lib/i18n';


interface MainNavbarProps {
  activeTab?: 'dashboard' | 'files' | 'projects' | 'editor';
  onTabChange?: (tab: 'dashboard' | 'files' | 'projects' | 'editor') => void;
  onLogout?: () => void;
  collections?: any[];
  selectedCollectionName?: string | 'all';
  onCollectionChange?: (collection: string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  isElectron?: boolean;
}

export default function MainNavbar({
  activeTab = 'editor',
  onTabChange,
  onLogout,
  collections = [],
  selectedCollectionName = 'all',
  onCollectionChange,
  searchQuery = '',
  onSearchChange,
  isElectron = false
}: MainNavbarProps) {
  const router = useRouter();
  const [isEditorPage, setIsEditorPage] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isModelConfigOpen, setIsModelConfigOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; nombre_modelo?: string; name?: string; proveedor?: string; is_vision?: boolean }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const logoutStore = useStore(state => state.logout);
  const { selectedModel, setSelectedModel } = useStore();
  const { t } = useI18n();



  useEffect(() => {
    setMounted(true);
    setIsEditorPage(window.location.pathname.includes('/edit-'));
  }, []);

  const fetchModels = async () => {
    setModelsLoading(true);
    const userId = pb.authStore.model?.id;
    try {
      const url = userId ? `/api/modelos?user=${userId}` : '/api/modelos';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.records) ? data.records : [];
        setModels(list);
      } else {
        // Fallback: cargar desde PocketBase con la sesión del usuario (igual que archivos/colecciones)
        if (pb.authStore.isValid && userId) {
          const filter = `user = "${userId}"`;
          const records = await pb.collection(MODELOS_COLLECTION_NAME).getFullList({ 
            sort: '-created',
            filter
          });
          setModels(records as { id: string; nombre_modelo?: string; name?: string; proveedor?: string; is_vision?: boolean }[]);
        } else {
          setModels([]);
        }
      }
    } catch {
      if (pb.authStore.isValid && userId) {
        try {
          const filter = `user = "${userId}"`;
          const records = await pb.collection(MODELOS_COLLECTION_NAME).getFullList({ 
            sort: '-created',
            filter
          });
          setModels(records as { id: string; nombre_modelo?: string; name?: string; proveedor?: string; is_vision?: boolean }[]);
        } catch {
          setModels([]);
        }
      } else {
        setModels([]);
      }
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (mounted) fetchModels();
  }, [mounted]);

  useEffect(() => {
    if (!isModelConfigOpen) fetchModels();
  }, [isModelConfigOpen]);

  // Si el modelo seleccionado no está en la lista (ej. otra base de datos en producción), limpiarlo
  useEffect(() => {
    if (!selectedModel || models.length === 0) return;
    const exists = models.some((m) => m.id === selectedModel.id);
    if (!exists) setSelectedModel(null);
  }, [models, selectedModel?.id, setSelectedModel]);

  if (!mounted) {
    return (
      <header
        className="w-full flex-shrink-0 bg-gray-950 border-b border-white/20 shadow-[0_1px_0_0_rgba(255,255,255,0.1)]"
        style={{ height: '3rem' }}
      />
    );
  }

  const handleLogout = () => {
    pb.authStore.clear();
    document.cookie = 'pb_auth=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/;';
    logoutStore();
    onLogout?.();
    router.replace('/auth');
    if (typeof window !== 'undefined') {
      window.location.assign('/auth');
    }
  };

  return (
    <>
    <header
      className="electron-drag-region relative select-none w-full flex-shrink-0 bg-gray-950 border-b border-white/20 shadow-[0_1px_0_0_rgba(255,255,255,0.1)]"
      style={{
        height: '3rem',
        border: 'none',
        boxShadow: '0 1px 0 rgba(255,255,255,0.1), 0 1px 3px rgba(0,0,0,0.3)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className="w-full h-full px-6 flex items-center justify-between">
        
        {/* Logo y título (Izquierda - ancho fijo para balancear) */}
        <div className="flex items-center gap-4 shrink-0 min-w-[240px]">
          <img src="/installer-icon.ico" alt="Zeus" className="w-8 h-8 object-contain pointer-events-none" />
          <div className="flex flex-col hidden sm:flex pointer-events-none">
            <h1 className="text-xl bg-gradient-to-r from-green-400 to-yellow-500 bg-clip-text text-transparent leading-none tracking-tight" style={{ fontFamily: "'Audiowide', 'Arial Black', sans-serif", fontWeight: 400, letterSpacing: '0.02em' }}>
              Zeus Media Studio IA
            </h1>
            <span className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mt-0.5">Multi Editor Suite</span>
          </div>
        </div>

        {/* Contenedor Central - Navegación y Buscador (Centrado relativo a la UI) */}
        <div
          className="flex items-center gap-8 lg:gap-12 flex-1 justify-center -ml-12"
        >
          <nav className="hidden md:flex items-center gap-6">
            {(['dashboard', 'files', 'projects'] as const).map((tab) => {
              const isActive = isEditorPage ? false : activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => {
                    if (onTabChange && !isEditorPage) {
                      onTabChange(tab);
                    } else if (isEditorPage) {
                      sessionStorage.setItem('zeus_pending_tab', tab);
                      router.push('/');
                    }
                  }}
                  className={`capitalize transition-colors font-medium text-sm ${isActive ? 'text-green-400' : 'text-gray-400 hover:text-white'}`}
                >
                  {tab === 'dashboard' ? t('nav.tabDashboard') : tab === 'files' ? t('nav.tabFiles') : t('nav.tabProjects')}
                </button>
              );
            })}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={`capitalize transition-colors font-medium text-sm flex items-center gap-1 ${isEditorPage ? 'text-green-400' : 'text-gray-400 hover:text-white'}`}>
                  {t('nav.editor')} <ChevronRight className="w-3 h-3 rotate-90" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-gray-900 border-gray-800 text-white min-w-[150px]">
     
                <DropdownMenuItem onClick={() => router.push('/edit-3d')} className="hover:bg-green-600 cursor-pointer flex gap-2"><Box className="w-4 h-4 text-cyan-400" /> {t('nav.editor3D')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          {/* Buscador y Estado de Modelo */}
          <div className="flex items-center gap-4">
            <div className="flex items-center bg-gray-800/50 border border-gray-700 rounded-full px-4 py-1.5 focus-within:border-green-500/50 transition-all shadow-inner">
              <select
                value={selectedCollectionName}
                onChange={(e) => onCollectionChange?.(e.target.value)}
                className="bg-transparent text-[10px] font-bold uppercase tracking-wider text-gray-400 outline-none border-r border-gray-700 pr-3 mr-3 cursor-pointer hover:text-green-400 transition-colors"
              >
                <option value="all" className="bg-gray-900">{t('nav.allCollections')}</option>
                {collections.map(col => <option key={col.id} value={col.id} className="bg-gray-900">{(col.name || col.id).toUpperCase()}</option>)}
              </select>
              <input
                type="text"
                placeholder={t('nav.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="bg-transparent text-sm text-white placeholder:text-gray-600 outline-none w-28 md:w-40 lg:w-56 select-text"
              />
              <Search className="w-4 h-4 text-green-500 ml-2" />
            </div>

            <div className="flex items-center gap-3 border-l border-gray-700 pl-4">
              <button
                onClick={() => setIsModelConfigOpen(true)}
                className="p-2 bg-gray-800/50 hover:bg-green-500/20 border border-gray-700 hover:border-green-500/50 rounded-lg text-gray-400 hover:text-green-500 transition-all group"
                title={t('nav.configModels')}
              >
                <Settings className="w-4 h-4" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-gray-300 hover:text-white hover:border-green-500/50 transition-all min-w-[120px] justify-between"
                    title={t('nav.modelInUse')}
                    disabled={modelsLoading}
                  >
                    <span className="truncate text-sm font-medium">
                      {String(selectedModel?.nombre_modelo ?? selectedModel?.name ?? t('nav.modelFallback'))}
                    </span>
                    <ChevronDown className="w-4 h-4 shrink-0 text-gray-500" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-gray-900 border-gray-800 text-white min-w-[200px]" align="end">
                  {models.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => setSelectedModel({ id: m.id, nombre_modelo: m.nombre_modelo ?? m.name, proveedor: m.proveedor })}
                      className={`cursor-pointer ${selectedModel?.id === m.id ? 'bg-green-600/30 text-green-300' : 'hover:bg-gray-700'}`}
                    >
                      {m.nombre_modelo || m.name || m.id}
                      {selectedModel?.id === m.id && ' ✓'}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Perfil y Logout (Derecha - balanceado) */}
        <div
          className="flex items-center gap-3 shrink-0 min-w-[140px] justify-end mr-3"
        >
          <div className="flex flex-col items-end hidden lg:flex">
            {mounted && (
              <>
                <span className="text-[10px] font-bold text-white leading-none">{pb.authStore.model?.email}</span>
                <span className="text-[9px] text-gray-500 capitalize mt-0.5">{pb.authStore.model?.name || t('nav.userFallback')}</span>
              </>
            )}
          </div>
          <button onClick={handleLogout} className="p-2 bg-gray-800/50 hover:bg-red-500/20 border border-gray-700 hover:border-red-500/50 rounded-lg text-gray-400 hover:text-red-500 transition-all group" title={t('nav.logout')}>
            <X className="w-4 h-4 group-hover:rotate-90 transition-transform" />
          </button>
        </div>

        {/* Controles de ventana (solo Electron) */}
        {checkIsElectron() && (
          <div
            className="flex items-center gap-1 shrink-0 ml-2"
          >
            <button
              onClick={() => window.electronAPI?.windowMinimize()}
              className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-all"
              title={t('nav.minimize')}
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => window.electronAPI?.windowMaximize()}
              className="p-2 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-all"
              title={t('nav.maximize')}
            >
              <Square className="w-4 h-4" />
            </button>
            <button
              onClick={() => window.electronAPI?.windowClose()}
              className="p-2 hover:bg-red-500/20 hover:text-red-500 rounded-lg text-gray-400 transition-all"
              title={t('nav.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>

    </>
  );
}
