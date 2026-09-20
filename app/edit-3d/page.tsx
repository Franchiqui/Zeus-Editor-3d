'use client';

import MainNavbar from '@/components/layout/MainNavbar';
import dynamic from 'next/dynamic';
import { useI18n } from '@/lib/i18n';

const Editor3D = dynamic(() => import('@/components/editor/Editor3D'), {
  ssr: false,
  loading: () => {
    const LoadingContent = () => {
      const { t } = useI18n();
      return (
        <div className="h-screen w-screen bg-gray-950 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent mx-auto mb-4" />
            <p className="text-gray-400">{t('editor3D.loading')}</p>
          </div>
        </div>
      );
    };
    return <LoadingContent />;
  },
});

export default function Edit3DPage() {
  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col overflow-hidden font-editor">
      <MainNavbar />
      <div className="flex-1 overflow-hidden">
        <Editor3D />
      </div>
    </div>
  );
}