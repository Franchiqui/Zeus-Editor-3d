'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import EditorIconos from '@/components/editor/EditorIconos';
import MainNavbar from '@/components/layout/MainNavbar';
import { IconLibraryProvider, useIconLibraryContext } from '@/context/icon-library-context';
import { Library, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconConfigModal } from '@/components/layout/IconConfigModal';
import { useI18n } from '@/lib/i18n';

function IconToolbar() {
  const { t } = useI18n();
  const iconLibraryContext = useIconLibraryContext();
  const isModalOpen = iconLibraryContext?.isModalOpen ?? false;
  const toggleModal = iconLibraryContext?.toggleModal ?? (() => {});
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-900/50 border-b border-blue-500/30">
      <span className="text-lg font-bold text-blue-400">{t('editorIconos.title')}</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={toggleModal} className="flex items-center gap-2 text-blue-300 hover:text-blue-100 hover:bg-blue-500/10">
          <Library className="h-4 w-4" />
          {t('editorIconos.library')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)} className="flex items-center gap-2 text-blue-300 hover:text-blue-100 hover:bg-blue-500/10">
          <Settings className="h-4 w-4" />
          {t('editorIconos.configure')}
        </Button>
      </div>
      <IconConfigModal isOpen={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}

function EditorIconosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleCancel = () => {
    router.back();
  };

  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <IconLibraryProvider>
        <MainNavbar activeTab="editor" />
        <IconToolbar />
        <div className="flex-1 overflow-hidden">
          <EditorIconos />
        </div>
      </IconLibraryProvider>
    </div>
  );
}

export default function EditIconoPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-gray-950 flex items-center justify-center text-white font-editor">Cargando editor...</div>}>
      <EditorIconosContent />
    </Suspense>
  );
}