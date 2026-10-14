'use client';

import * as React from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from 'sonner';
import { useStore } from '@/lib/store';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const initStore = useStore((state) => state.init);

  React.useEffect(() => {
    initStore();
  }, [initStore]);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <Toaster />
      {/* Los avisos del editor 3D usan `toast` de SONNER — su Toaster no
          estaba montado y TODOS los toast.success/error de Editor3D fueron
          no-ops invisibles (2026-10-14). El de shadcn queda intacto. */}
      <SonnerToaster position="bottom-right" />
    </ThemeProvider>
  );
};