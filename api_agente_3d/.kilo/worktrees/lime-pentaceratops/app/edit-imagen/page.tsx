'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ImageEditor from '@/components/editor/ImageEditor';
import { ImageEditState } from '@/types';
import MainNavbar from '@/components/layout/MainNavbar';

function ImageEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const imageUrl = searchParams.get('url') || '';
  const isLocalProject = searchParams.get('isLocalProject');
  const projectName = searchParams.get('projectName');
  const projectPath = searchParams.get('projectPath');

  const handleSave = (editState: ImageEditState) => {
    // TODO: Implement save logic
    console.log('Saving edit state:', editState);
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <MainNavbar />
      <div className="flex-1 overflow-hidden">
        <ImageEditor
          imageUrl={imageUrl}
          initialEditState={{
            brightness: 0,
            contrast: 0,
            saturation: 0,
            hue: 0,
            blur: 0,
          }}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

export default function EditImagenPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950 flex items-center justify-center text-white font-editor">Cargando editor...</div>}>
      <ImageEditorContent />
    </Suspense>
  );
}
