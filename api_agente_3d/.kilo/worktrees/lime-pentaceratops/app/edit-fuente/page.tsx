'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import EditorFuentes from '@/components/editor/EditorFuentes';
import MainNavbar from '@/components/layout/MainNavbar';

function EditorFuentesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <MainNavbar activeTab="editor" />
      <div className="flex-1 overflow-hidden">
        <EditorFuentes />
      </div>
    </div>
  );
}

export default function EditFuentePage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950 flex items-center justify-center text-white font-editor">Cargando editor...</div>}>
      <EditorFuentesContent />
    </Suspense>
  );
}
