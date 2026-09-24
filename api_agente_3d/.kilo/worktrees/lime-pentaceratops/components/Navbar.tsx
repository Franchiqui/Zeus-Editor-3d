'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Definir rutas de autenticación por defecto ya que el módulo '@/lib/auth-config' no existe
export const defaultAuthPaths = {
  home: '/',
  login: '/auth/login',
  register: '/auth/register',
  profile: '/profile',
  settings: '/settings'
};

export interface NavbarProps {
  /** Nombre de la app (reutilizable en otra aplicación) */
  appName?: string;
  /** Ruta de inicio (por defecto '/') */
  homePath?: string;
  /** Rutas de auth para AuthStatus (login, register, home, profile, settings) */
  paths?: {
    login: string;
    register: string;
    home: string;
    profile: string;
    settings: string;
  };
  className?: string;
}

export default function Navbar({
  appName = 'Mi Aplicación',
  homePath = '/',
  paths = defaultAuthPaths,
  className = '',
}: NavbarProps) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith('/auth');
  const bgClass = isAuthRoute
    ? 'bg-gray-900 border-gray-800 text-white'
    : 'bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100';

  return (
    <nav
      className={`flex items-center justify-between px-4 py-3 border-b ${bgClass} ${className}`}
      role="navigation"
    >
      <div className="flex items-center gap-6">
        <Link
          href={homePath}
          className="text-xl font-bold hover:opacity-90 transition-opacity"
        >
          {appName}
        </Link>
      </div>
      <div className="flex items-center gap-4">
        {/* AuthStatus component removed due to missing module */}
        <Link href={paths.login} className="text-sm hover:underline">
          Login
        </Link>
        <Link href={paths.register} className="text-sm hover:underline">
          Register
        </Link>
      </div>
    </nav>
  );
}
