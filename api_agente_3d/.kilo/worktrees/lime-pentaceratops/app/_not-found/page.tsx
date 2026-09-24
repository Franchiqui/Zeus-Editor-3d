'use client';

import Link from 'next/link';
import { Home, RotateCcw } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col items-center justify-center text-center px-8">
      <div className="text-9xl font-bold text-gray-800 mb-4">404</div>
      <h1 className="text-3xl font-semibold text-white mb-4">Página no encontrada</h1>
      <p className="text-gray-400 mb-8 max-w-md">
        Lo sentimos, la página que buscas no existe o ha sido movida.
      </p>
      <div className="flex gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
        >
          <Home className="w-5 h-5" />
          Ir al inicio
        </Link>
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors border border-gray-700"
        >
          <RotateCcw className="w-5 h-5" />
          Volver atrás
        </button>
      </div>
    </div>
  );
}