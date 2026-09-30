'use client';

import { useEffect } from 'react';

/**
 * Carga /inspector-client.js SOLO cuando la página corre dentro del editor
 * visual (iframe) y con ruta relativa (mismo origen, sin puerto fijo).
 *
 * Antes el layout apuntaba siempre a http://localhost:3030/inspector-client.js,
 * así que fuera del editor la consola se ensuciaba con
 * «Failed to load resource: net::ERR_CONNECTION_REFUSED» en cada carga.
 */
export function InspectorClientLoader() {
  useEffect(() => {
    try {
      // Fuera de un iframe (modo standalone) el inspector no tiene sentido:
      // ni se usa ni hay servidor que lo sirva.
      if (window.self === window.top) return;
      if (document.querySelector('script[data-zeus-inspector]')) return;
      const script = document.createElement('script');
      script.src = '/inspector-client.js';
      script.dataset.zeusInspector = 'true';
      document.head.appendChild(script);
    } catch {
      // window.top inaccesible (iframe de otro origen): no cargar nada.
    }
  }, []);
  return null;
}