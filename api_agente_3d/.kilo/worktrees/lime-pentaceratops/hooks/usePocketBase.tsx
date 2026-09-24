'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import PocketBase from 'pocketbase';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth';
import { useEditorStore } from '@/store/editor';

// Tipos para los datos de PocketBase
export interface IconRecord {
  id: string;
  title: string;
  description?: string;
  pngData: string;
  svgData?: string;
  tags?: string[];
  width: number;
  height: number;
  created: string;
  updated: string;
  user: string;
  collectionId: string;
  collectionName: string;
}

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  avatar?: string;
  verified: boolean;
  created: string;
  updated: string;
}

interface PocketBaseState {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
}

interface UsePocketBaseReturn {
  // Estado
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  lastSync: Date | null;
  
  // Autenticación
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, passwordConfirm: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  currentUser: UserRecord | null;
  
  // Operaciones CRUD para iconos
  saveIcon: (icon: Partial<IconRecord>) => Promise<boolean>;
  loadIcon: (iconId?: string) => Promise<IconRecord | null>;
  getIcons: (page?: number, perPage?: number) => Promise<IconRecord[]>;
  getIconById: (id: string) => Promise<IconRecord | null>;
  updateIcon: (id: string, data: Partial<IconRecord>) => Promise<boolean>;
  deleteIcon: (id: string) => Promise<boolean>;
  
  // Utilidades
  searchIcons: (query: string) => Promise<IconRecord[]>;
  getRecentIcons: (limit?: number) => Promise<IconRecord[]>;
  syncWithServer: () => Promise<void>;
  clearError: () => void;
  uploadImage: (file: File) => Promise<string | null>;
  getImageUrl: (record: any, filename: string) => string | null;
  refresh: () => Promise<void>;
  icons: IconRecord[];
  user: UserRecord | null;
}

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';

export function usePocketBase(): UsePocketBaseReturn {
  const router = useRouter();
  const { toast } = useToast();
  const { user, setUser, clearUser } = useAuthStore();
  const { setCurrentIcon } = useEditorStore();
  
  const [state, setState] = useState<PocketBaseState>({
    isConnected: false,
    isLoading: false,
    error: null,
    lastSync: null,
  });

  const [icons, setIconsState] = useState<IconRecord[]>([]);

  const [pb] = useState(() => new PocketBase(PB_URL));

  // Verificar conexión inicial
  useEffect(() => {
    const checkConnection = async () => {
      try {
        setState(prev => ({ ...prev, isLoading: true }));
        await pb.health.check();
        setState(prev => ({ 
          ...prev, 
          isConnected: true, 
          isLoading: false,
          error: null 
        }));
      } catch (err) {
        setState(prev => ({ 
          ...prev, 
          isConnected: false, 
          isLoading: false,
          error: 'No se pudo conectar con el servidor' 
        }));
      }
    };

    checkConnection();
  }, [pb]);

  // Sincronizar estado de autenticación
  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((token, model) => {
      if (model) {
        setUser(model as unknown as UserRecord);
      } else {
        clearUser();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [pb, setUser, clearUser]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      const authData = await pb.collection('users').authWithPassword(email, password);
      setUser(authData.record as unknown as UserRecord);
      toast({
        title: 'Inicio de sesión exitoso',
        description: `Bienvenido, ${authData.record.username || authData.record.email}`,
        variant: 'default',
      });
      return true;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al iniciar sesión';
      setState(prev => ({ ...prev, error: errorMessage }));
      toast({
        title: 'Error de inicio de sesión',
        description: errorMessage,
        variant: 'destructive',
      });
      return false;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb, setUser, toast]);

  const register = useCallback(async (
    email: string, 
    password: string, 
    passwordConfirm: string
  ): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const data = {
        email,
        password,
        passwordConfirm,
        emailVisibility: true,
      };

      const record = await pb.collection('users').create(data);
      await pb.collection('users').requestVerification(email);
      
      toast({
        title: 'Registro exitoso',
        description: 'Se ha enviado un correo de verificación',
        variant: 'default',
      });
      
      return true;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al registrarse';
      setState(prev => ({ ...prev, error: errorMessage }));
      toast({
        title: 'Error de registro',
        description: errorMessage,
        variant: 'destructive',
      });
      return false;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb, toast]);

  const logout = useCallback(() => {
    pb.authStore.clear();
    clearUser();
    router.push('/login');
    toast({
      title: 'Sesión cerrada',
      description: 'Has cerrado sesión correctamente',
      variant: 'default',
    });
  }, [pb, clearUser, router, toast]);

  const saveIcon = useCallback(async (icon: Partial<IconRecord>): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para guardar iconos');
      }

      const data = {
        title: icon.title || 'Icono sin título',
        description: icon.description || '',
        pngData: icon.pngData,
        svgData: icon.svgData || '',
        tags: icon.tags || [],
        width: icon.width || 64,
        height: icon.height || 64,
        user: pb.authStore.model?.id,
      };

      const record = await pb.collection('icons').create(data);
      
      setState(prev => ({ 
        ...prev, 
        lastSync: new Date(),
        isLoading: false 
      }));

      toast({
        title: 'Icono guardado',
        description: `"${data.title}" se ha guardado correctamente`,
        variant: 'default',
      });

      return true;
    } catch (err: any) {
      const errorMessage = err?.response?.message || err.message || 'Error al guardar el icono';
      setState(prev => ({ ...prev, error: errorMessage }));
      toast({
        title: 'Error al guardar',
        description: errorMessage,
        variant: 'destructive',
      });
      return false;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb, toast]);

  const loadIcon = useCallback(async (iconId?: string): Promise<IconRecord | null> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para cargar iconos');
      }

      let record;
      if (iconId) {
        record = await pb.collection('icons').getOne(iconId);
      } else {
        // Cargar el último icono guardado
        const records = await pb.collection('icons').getList(1, 1, {
          filter: `user="${pb.authStore.model?.id}"`,
          sort: '-created',
        });
        record = records.items[0];
      }

      if (record) {
        const iconRecord = record as unknown as IconRecord;
        setCurrentIcon({
          id: iconRecord.id,
          title: iconRecord.title,
          pngData: iconRecord.pngData,
          svgData: iconRecord.svgData,
          width: iconRecord.width,
          height: iconRecord.height,
        });
        
        toast({
          title: 'Icono cargado',
          description: `"${iconRecord.title}" se ha cargado correctamente`,
          variant: 'default',
        });
        
        return iconRecord;
      }
      
      return null;
    } catch (err: any) {
      const errorMessage = err?.response?.message || err.message || 'Error al cargar el icono';
      setState(prev => ({ ...prev, error: errorMessage }));
      toast({
        title: 'Error al cargar',
        description: errorMessage,
        variant: 'destructive',
      });
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb, setCurrentIcon, toast]);

  const getIcons = useCallback(async (page = 1, perPage = 50): Promise<IconRecord[]> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para obtener iconos');
      }

      const records = await pb.collection('icons').getList(page, perPage, {
        filter: `user="${pb.authStore.model?.id}"`,
        sort: '-created',
      });

      const icons = records.items as unknown as IconRecord[];
      setIconsState(icons);
            
      return icons;
    } catch (err: any) {
      const errorMessage = err?.response?.message || err.message || 'Error al obtener iconos';
      setState(prev => ({ ...prev, error: errorMessage }));
      return [];
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb]);

  const getIconById = useCallback(async (id: string): Promise<IconRecord | null> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      const record = await pb.collection('icons').getOne(id);
      return record as unknown as IconRecord;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al obtener el icono';
      setState(prev => ({ ...prev, error: errorMessage }));
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb]);

  const updateIcon = useCallback(async (id: string, data: Partial<IconRecord>): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para actualizar iconos');
      }

      await pb.collection('icons').update(id, data);
      
      setState(prev => ({ 
        ...prev, 
        lastSync: new Date(),
        isLoading: false 
      }));

      toast({
        title: 'Icono actualizado',
        description: 'Los cambios se han guardado correctamente',
        variant: 'default',
      });

      return true;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al actualizar el icono';
      setState(prev => ({ ...prev, error: errorMessage }));
      toast({
        title: 'Error al actualizar',
        description: errorMessage,
        variant: 'destructive',
      });
      return false;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb, toast]);

  const deleteIcon = useCallback(async (id: string): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para eliminar iconos');
      }

      await pb.collection('icons').delete(id);
      
      setState(prev => ({ 
        ...prev, 
        lastSync: new Date(),
        isLoading: false 
      }));

      toast({
        title: 'Icono eliminado',
        description: 'El icono se ha eliminado correctamente',
        variant: 'default',
      });

      return true;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al eliminar el icono';
      setState(prev => ({ ...prev, error: errorMessage }));
      toast({
        title: 'Error al eliminar',
        description: errorMessage,
        variant: 'destructive',
      });
      return false;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb, toast]);

  const searchIcons = useCallback(async (query: string): Promise<IconRecord[]> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para buscar iconos');
      }

      const records = await pb.collection('icons').getList(1, 50, {
        filter: `user="${pb.authStore.model?.id}" && (title ~ "${query}" || description ~ "${query}" || tags ~ "${query}")`,
        sort: '-created',
      });

      const icons = records.items as unknown as IconRecord[];
      setIconsState(icons);
            
      return icons;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al buscar iconos';
      setState(prev => ({ ...prev, error: errorMessage }));
      return [];
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb]);

  const getRecentIcons = useCallback(async (limit = 10): Promise<IconRecord[]> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para obtener iconos recientes');
      }

      const records = await pb.collection('icons').getList(1, limit, {
        filter: `user="${pb.authStore.model?.id}"`,
        sort: '-created',
      });

      const icons = records.items as unknown as IconRecord[];
      setIconsState(icons);
            
      return icons;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al obtener iconos recientes';
      setState(prev => ({ ...prev, error: errorMessage }));
      return [];
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb]);

  const syncWithServer = useCallback(async (): Promise<void> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para sincronizar');
      }

      const records = await pb.collection('icons').getList(1, 50, {
        filter: `user="${pb.authStore.model?.id}"`,
        sort: '-created',
      });

      const icons = records.items as unknown as IconRecord[];
      setIconsState(icons);
            
      setState(prev => ({ 
        ...prev, 
        lastSync: new Date(),
        isLoading: false 
      }));
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al sincronizar';
      setState(prev => ({ ...prev, error: errorMessage }));
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb]);

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      if (!pb.authStore.isValid) {
        throw new Error('Debes iniciar sesión para subir imágenes');
      }

      const formData = new FormData();
      formData.append('image', file);
      formData.append('user', pb.authStore.model?.id || '');

      const record = await pb.collection('images').create(formData);
      
      setState(prev => ({ 
        ...prev, 
        lastSync: new Date(),
        isLoading: false 
      }));

      return pb.files.getUrl(record, record.image) || null;
    } catch (err: any) {
      const errorMessage = err?.response?.message || 'Error al subir la imagen';
      setState(prev => ({ ...prev, error: errorMessage }));
      toast({
        title: 'Error al subir imagen',
        description: errorMessage,
        variant: 'destructive',
      });
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [pb, toast]);

  const getImageUrl = useCallback((record: any, filename: string): string | null => {
    try {
      if (!record || !filename) return null;
      return pb.files.getUrl(record, filename) || null;
    } catch {
      return null;
    }
  }, [pb]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const refresh = useCallback(async () => {
    await getIcons();
    setState(prev => ({ ...prev, lastSync: new Date() }));
  }, [getIcons]);

  return {
    isConnected: state.isConnected,
    isLoading: state.isLoading,
    error: state.error,
    lastSync: state.lastSync,
    login,
    register,
    logout,
    isAuthenticated: pb.authStore.isValid,
    currentUser: user,
    saveIcon,
    loadIcon,
    getIcons,
    getIconById,
    updateIcon,
    deleteIcon,
    searchIcons,
    getRecentIcons,
    syncWithServer,
    clearError,
    uploadImage,
    getImageUrl,
    refresh,
    icons,
    user,
  };
}
