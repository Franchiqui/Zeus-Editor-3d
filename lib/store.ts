import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import pb from '@/lib/pocketbase';

// Define the auth state interface
export type ModelRecord = { id: string; nombre_modelo?: string; proveedor?: string; id_modelo?: string; is_vision?: boolean; [key: string]: unknown };

interface AuthState {
  user: any | null;
  isLoading: boolean;
  selectedModel: ModelRecord | null;
  /** Modelo de visión (is_vision) para delegación del chat; coexiste con selectedModel */
  selectedVisionModel: ModelRecord | null;
  /** Prompt del sistema definido por el usuario en el chat (persistido). '' = desactivado. */
  systemPrompt: string;
  init: () => void;
  setUser: (user: any | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  setSelectedModel: (model: ModelRecord | null) => void;
  setSelectedVisionModel: (model: ModelRecord | null) => void;
  setSystemPrompt: (prompt: string) => void;
  logout: () => void;
}

// Create the main store
export const useStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        isLoading: true,
        selectedModel: null,
        selectedVisionModel: null,
        systemPrompt: '',
        init: () => {
          if (pb.authStore.isValid) {
            set({ user: pb.authStore.model, isLoading: false });
          } else {
            set({ user: null, isLoading: false });
          }
        },
        setUser: (user) => set({ user, isLoading: false }),
        setIsLoading: (isLoading) => set({ isLoading }),
        setSelectedModel: (model) => set({ selectedModel: model }),
        setSelectedVisionModel: (model) => set({ selectedVisionModel: model }),
        setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
        logout: () => {
          pb.authStore.clear();
          set({ user: null, selectedModel: null, selectedVisionModel: null, systemPrompt: '' });
        },
      }),
      {
        name: 'main-store',
        partialize: (state) => ({
          user: state.user,
          selectedModel: state.selectedModel,
          selectedVisionModel: state.selectedVisionModel,
          systemPrompt: state.systemPrompt,
        }),
      }
    )
  )
);