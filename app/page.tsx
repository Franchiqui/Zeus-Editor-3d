'use client';

import dynamic from 'next/dynamic';
import UserTracker from '@/components/UserTracker';

const Editor3D = dynamic(() => import('@/components/editor/Editor3D'), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent mx-auto mb-4" />
        <p className="text-gray-400">Cargando Editor 3D...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <UserTracker />
      <div className="flex-1 overflow-hidden">
        <Editor3D />
      </div>
    </div>
  );
}
