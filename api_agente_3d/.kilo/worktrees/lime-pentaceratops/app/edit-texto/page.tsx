'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DocumentEditor from '@/components/editor/DocumentEditor';
import MainNavbar from '@/components/layout/MainNavbar';

function DocumentEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('all');

  const documentUrl = searchParams.get('url') || '';
  const fileName = searchParams.get('name') || 'documento.txt';
  const isLocalProject = searchParams.get('isLocalProject');
  const projectName = searchParams.get('projectName');
  const projectPath = searchParams.get('projectPath');

  const handleSave = (content: string) => {
    // TODO: Implement save logic
    console.log('Saving content:', content);
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <MainNavbar 
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCollectionName={selectedCollection}
        onCollectionChange={setSelectedCollection}
      />
      <div className="flex-1 overflow-hidden">
        <DocumentEditor
          documentUrl={documentUrl}
          fileName={fileName}
          initialContent=""
          isLocalProject={isLocalProject === 'true'}
          projectName={projectName || ''}
          projectPath={projectPath || ''}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

export default function EditTextoPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950 flex items-center justify-center text-white font-editor">Cargando editor...</div>}>
      <DocumentEditorContent />
    </Suspense>
  );
}