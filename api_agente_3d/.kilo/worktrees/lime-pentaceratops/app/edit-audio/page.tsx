'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AudioEditor from '@/components/editor/AudioEditor';
import { AudioEditState } from '@/types';
import MainNavbar from '@/components/layout/MainNavbar';
import MusicPlayerModal from '@/components/MusicPlayerModal';
import React from 'react';

const JAMENDO_CLIENT_ID = '3256b81d';

function AudioEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urls = searchParams.getAll('url').filter(Boolean);
  const names = searchParams.getAll('name');
  const isLocalProject = searchParams.get('isLocalProject');
  const projectName = searchParams.get('projectName');
  const projectPath = searchParams.get('projectPath');
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [pendingTrack, setPendingTrack] = React.useState<{ url: string; fileName: string } | null>(null);

  const audioUrl = urls[0] || '';
  const initialQueue: { url: string; fileName: string }[] = urls.map((url, i) => ({
    url,
    fileName: names[i] || url.split('/').pop() || `audio-${i}`,
  }));

  const handleSave = (editState: AudioEditState) => {
    // TODO: Implement save logic   
    console.log('Saving edit state:', editState);
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="h-screen w-screen bg-gray-950 overflow-hidden flex flex-col font-editor">
      <MainNavbar />
      <div className="flex-1 overflow-hidden">
        <AudioEditor
          audioUrl={audioUrl}
          initialEditState={{ volume: 1, fadeInDuration: 0, fadeOutDuration: 0, trimStart: 0, trimEnd: 0 }}
          initialQueue={initialQueue.length > 0 ? initialQueue : undefined}
          onSave={handleSave}
          onCancel={handleCancel}
          onOpenMusicLibrary={() => setIsModalOpen(true)}
          pendingExternalTrack={pendingTrack}
          onExternalTrackAdded={() => setPendingTrack(null)}
        />
      </div>
      <MusicPlayerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        clientId={JAMENDO_CLIENT_ID}
        onAddToTimeline={(url, fileName) => setPendingTrack({ url, fileName })}
      />
    </div>
    
  );
}

export default function EditAudioPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950 flex items-center justify-center text-white font-editor">Cargando editor...</div>}>
      <AudioEditorContent />
    </Suspense>
    
  );
}
