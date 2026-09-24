import type { Metadata } from 'next';

/** Metadata de la aplicación. Único lugar donde se define; NO exportar metadata en app/page.tsx. */
export const metadata: Metadata = {
  title: 'Zeus Media Studio | Zeus IA',
  icons: {
    icon: '/installer-icon.ico',
  },
  description: 'Aplicación creada con Zeus IA - www.zeus-ia.com',
  openGraph: {
    title: 'Zeus Media Studio | Zeus IA',
    description: 'Aplicación creada con Zeus IA - www.zeus-ia.com',
  },
};
