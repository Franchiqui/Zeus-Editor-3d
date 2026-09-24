'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import VideoEditor from '@/components/editor/VideoEditor';
import MainNavbar from '@/components/layout/MainNavbar';
import { getPresentationTransfer } from '@/lib/aiPresentationTransfer';
import { getAnimationTransfer } from '@/lib/aiAnimationTransfer';
import type { AIAnimationData } from '@/components/editor/VideoEditor';

const AI_SCRIPT_KEY = 'zeus_ai_script';

export type AIPresentationData = {
  presentation: {
    title: string;
    coverSvg?: string;
    slides: Array<{
      title: string;
      description: string;
      assignedImageName: string;
      durationSec: number;
      textWidth?: number;
      textAlign?: 'left' | 'center' | 'right';
      titleFontSize?: number;
      titleColor?: string;
      titleFontFamily?: string;
      descriptionFontSize?: number;
      descriptionColor?: string;
      descriptionFontFamily?: string;
    }>;
    gradientFrom?: string;
    gradientTo?: string;
  };
  imageDataUrls: Record<string, string>;
  audioDataUrl?: string;
  backgroundDataUrl?: string;
};

function VideoEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const videoUrl = searchParams.get('url') || '';
  const videoName = searchParams.get('name');
  const isProject = searchParams.get('isProject') === 'true';
  const [aiScript, setAiScript] = useState<string | undefined>(undefined);
  const [aiPresentation, setAiPresentation] = useState<AIPresentationData | undefined>(undefined);
  const [aiAnimation, setAiAnimation] = useState<AIAnimationData | undefined>(undefined);
  const [initialProject, setInitialProject] = useState<any>(null);
  const [loading, setLoading] = useState(isProject);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem(AI_SCRIPT_KEY);
    if (stored) {
      setAiScript(stored);
      sessionStorage.removeItem(AI_SCRIPT_KEY);
    }
    const presTransfer = getPresentationTransfer();
    if (presTransfer) {
      setAiPresentation({
        presentation: presTransfer.presentation,
        imageDataUrls: presTransfer.imageDataUrls || {},
        audioDataUrl: presTransfer.audioDataUrl,
        backgroundDataUrl: presTransfer.backgroundDataUrl,
      });
    }
    const animTransfer = getAnimationTransfer();
    if (animTransfer?.animation) {
      setAiAnimation({
        animation: animTransfer.animation,
        mediaUrls: animTransfer.mediaUrls || {},
      });
    }

    // CARGAR PROYECTO LOCAL SI ES NECESARIO
    if (isProject && videoUrl) {
      const loadLocalProject = async () => {
        try {
          const res = await fetch(videoUrl);
          if (res.ok) {
            const data = await res.json();
            setInitialProject(data);
          }
        } catch (e) {
          console.error("Error cargando proyecto local:", e);
        } finally {
          setLoading(false);
        }
      };
      loadLocalProject();
    }
  }, [isProject, videoUrl]);

  const handleSave = (editState: any) => {
    console.log('Saving edit state:', editState);
  };

  const handleCancel = () => {
    router.back();
  };

  if (loading) {
    return (
      <div className="h-screen w-screen bg-gray-950 flex flex-col items-center justify-center text-white gap-6 font-editor">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Abriendo Proyecto Local</h2>
          <p className="text-gray-400">Recuperando tus archivos desde el Servidor Bridge...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <MainNavbar />
      <div className="flex-1 overflow-hidden">
        <VideoEditor
          videoUrl={initialProject ? initialProject.videoUrl : videoUrl}
          projectName={videoName || undefined}
          aiScript={aiScript}
          aiPresentation={aiPresentation}
          aiAnimation={aiAnimation}
          initialEditState={initialProject || {
            trimStart: 0,
            trimEnd: 0,
            brightness: 0,
            contrast: 0,
            saturation: 0,
            hue: 0,
            blur: 0,
            textClips: [],
            timeline: {
              duration: 300, // Default duration, will be adjusted by editor
              currentTime: 0,
              zoom: 100,
              tracks: [
                {
                  id: 'video-1',
                  type: 'video' as const,
                  name: 'Pista de Vídeo',
                  clips: videoUrl && !isProject ? [
                    {
                      id: `clip-${Date.now()}`,
                      mediaFileId: videoUrl,
                      type: 'video',
                      label: videoName || 'Vídeo principal',
                      startTime: 0,
                      duration: 0, // Will be updated by editor on load
                      sourceStartTime: 0,
                      sourceDuration: 0,
                      playbackRate: 1,
                      volume: 1
                    }
                  ] : [],
                  isLocked: false
                },
                {
                  id: 'audio-1',
                  type: 'audio' as const,
                  name: 'Audio Principal',
                  clips: [],
                  isMuted: false,
                  isLocked: false,
                  volume: 1
                },
                {
                  id: 'text-1',
                  type: 'text' as const,
                  name: 'Texto/Superposiciones',
                  clips: [],
                  isLocked: false
                }
              ]
            }
          }}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

export default function EditVideoPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950 flex items-center justify-center text-white font-editor">Cargando editor...</div>}>
      <VideoEditorContent />
    </Suspense>
  );
}
