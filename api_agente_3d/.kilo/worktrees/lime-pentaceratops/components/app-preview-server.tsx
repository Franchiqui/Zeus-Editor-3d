'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '@/lib/i18n';

const PREVIEW_SERVER_URL = 'http://localhost:3032';
const POLL_INTERVAL = 2000;
const MAX_POLL_ATTEMPTS = 60; // 2 minutos

interface AppPreviewServerProps {
  zipUrl: string;
  appName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AppPreviewServer({ zipUrl, appName, isOpen, onClose }: AppPreviewServerProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'uploading' | 'building' | 'ready' | 'error'>('idle');
  const [progressMsg, setProgressMsg] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (abortRef.current) abortRef.current.abort();
    setPhase('idle');
    setProgressMsg('');
    setPreviewUrl('');
    setErrorMsg('');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      reset();
      return;
    }

    let cancelled = false;
    abortRef.current = new AbortController();

    async function run() {
      try {
        // 1. Descargar ZIP desde PocketBase
        setPhase('downloading');
        setProgressMsg(t('app.downloadingApp'));
        const zipResp = await fetch(zipUrl, { signal: abortRef.current!.signal });
        if (!zipResp.ok) throw new Error(`No se pudo descargar el ZIP: HTTP ${zipResp.status}`);
        const zipBlob = await zipResp.blob();

        // 2. Subir al preview server
        setPhase('uploading');
        setProgressMsg('Enviando al servidor de vista previa...');
        const formData = new FormData();
        formData.append('zipFile', zipBlob, `${appName}.zip`);
        formData.append('existingProjectId', `app-library-${Date.now()}`);

        const uploadResp = await fetch(`${PREVIEW_SERVER_URL}/api/upload`, {
          method: 'POST',
          body: formData,
          signal: abortRef.current!.signal,
        });

        if (!uploadResp.ok) {
          const text = await uploadResp.text().catch(() => '');
          throw new Error(`El servidor de preview respondió ${uploadResp.status}: ${text}`);
        }

        const uploadData = await uploadResp.json();
        const projectId = uploadData.projectId;
        if (!projectId) throw new Error('El servidor no devolvió un projectId');

        // 3. Polling de estado
        setPhase('building');
        setProgressMsg('Instalando dependencias y compilando... Esto puede tardar unos minutos la primera vez.');

        let attempts = 0;
        const checkStatus = async () => {
          if (cancelled) return;
          attempts++;

          try {
            const statusResp = await fetch(`${PREVIEW_SERVER_URL}/api/project-status/${projectId}`, {
              signal: abortRef.current!.signal,
            });
            if (!statusResp.ok) {
              if (attempts >= MAX_POLL_ATTEMPTS) {
                throw new Error(t('app.timeoutServer'));
              }
              pollRef.current = setTimeout(checkStatus, POLL_INTERVAL);
              return;
            }

            const status = await statusResp.json();

            if (status.status === 'ready' && status.url) {
              setPreviewUrl(status.url);
              setPhase('ready');
              setProgressMsg('');
              return;
            }

            if (status.status === 'error') {
              throw new Error(status.error || 'Error desconocido en el servidor de preview');
            }

            if (attempts >= MAX_POLL_ATTEMPTS) {
              throw new Error('Tiempo de espera agotado. El servidor no pudo preparar la vista previa.');
            }

            // Aún construyendo
            setProgressMsg(`Construyendo... (${attempts}/${MAX_POLL_ATTEMPTS})`);
            pollRef.current = setTimeout(checkStatus, POLL_INTERVAL);
          } catch (err: any) {
            if (err.name === 'AbortError') return;
            throw err;
          }
        };

        await checkStatus();
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('[PreviewServer] Error:', err);
        setPhase('error');
        setErrorMsg(err?.message || 'Error inesperado al cargar la vista previa');
      }
    }

    run();

    return () => {
      cancelled = true;
      reset();
    };
  }, [isOpen, zipUrl, appName, reset]);

  if (!isOpen) return null;

  const isLoading = phase !== 'ready' && phase !== 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-[1516px] h-[92vh] mx-4 bg-gray-900 rounded-xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <h2 className="ml-2 text-sm font-semibold text-gray-200 truncate max-w-md">
              {phase === 'ready' ? appName : `Preparando: ${appName}`}
            </h2>
          </div>
          <button
            onClick={() => previewUrl && window.open(previewUrl, '_blank')}
            disabled={!previewUrl}
            className="text-gray-400 hover:text-white transition-colors p-1 mr-2 disabled:opacity-30 disabled:cursor-not-allowed"
            title="{t('app.openNewTab')}"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
            title="Cerrar vista previa"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 relative bg-gray-950">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-10">
              <div className="animate-spin rounded-full h-14 w-14 border-t-2 border-b-2 border-red-500 mb-6"></div>
              <p className="text-white text-lg font-medium mb-2">
                {phase === 'downloading' && t('app.downloadingApp')}
                {phase === 'uploading' && 'Enviando al servidor...'}
                {phase === 'building' && 'Compilando proyecto...'}
              </p>
              <p className="text-gray-400 text-sm max-w-md text-center px-4">{progressMsg}</p>
              <p className="text-gray-600 text-xs mt-4">No cierres esta ventana</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-10 px-6">
              <svg className="h-16 w-16 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-red-400 text-lg font-medium mb-2">Error al cargar la vista previa</p>
              <p className="text-gray-500 text-sm text-center max-w-lg">{errorMsg}</p>
              <div className="mt-4 text-gray-600 text-xs text-center max-w-md">
                {t('app.serverRunningHint')} <strong>http://localhost:3032</strong>
              </div>
            </div>
          )}

          {phase === 'ready' && previewUrl && (
            <iframe
              src={previewUrl}
              title={`Vista previa de ${appName}`}
              className="w-full h-full border-0 bg-gray-950"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          )}
        </div>
      </div>
    </div>
  );
}
