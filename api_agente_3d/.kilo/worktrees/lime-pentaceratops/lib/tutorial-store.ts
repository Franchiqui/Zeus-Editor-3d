import { create } from 'zustand';

// Estado transient (no persistido) del tutorial actualmente seleccionado.
// Lo comparten page.tsx (que lo actualiza) y el Navbar (que lo muestra
// centrado en la barra de navegación), aunque sean componentes hermanos.
interface TutorialTitleState {
  title: string | null;
  setTitle: (title: string | null) => void;
}

export const useTutorialTitle = create<TutorialTitleState>((set) => ({
  title: null,
  setTitle: (title) => set({ title }),
}));