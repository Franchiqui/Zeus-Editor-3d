'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import EditorHTML from '@/components/editor/EditorHTML';
import MainNavbar from '@/components/layout/MainNavbar';

function EditorHTMLContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isLocalProject = searchParams.get('isLocalProject') === 'true';
  const projectName = searchParams.get('projectName') || '';
  const projectPath = searchParams.get('projectPath') || '';

  const handleSave = () => {
    // Handled inside EditorHTML
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <MainNavbar />
      <div className="flex-1 overflow-hidden">
        <EditorHTML
          isLocalProject={isLocalProject}
          projectName={projectName}
          projectPath={projectPath}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

export default function EditHtmlPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950 flex items-center justify-center text-white font-editor">Cargando editor...</div>}>
      <EditorHTMLContent />
    </Suspense>
  );
}
