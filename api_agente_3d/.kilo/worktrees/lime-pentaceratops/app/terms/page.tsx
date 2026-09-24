'use client';

import Link from 'next/link';
import Image from 'next/image';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-yellow-900/20">
      <header className="h-14 flex items-center justify-between px-4 md:px-6 border-b border-white/5">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/installer-icon.ico" alt="" width={32} height={32} className="rounded-lg" />
          <span className="text-xl font-semibold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">
            Zeus Media Studio IA
          </span>
        </Link>
        <Link
          href="/auth"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Iniciar sesión
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 md:py-14">
        <h1 className="text-3xl font-bold text-white mb-2">Términos de servicio</h1>
        <p className="text-gray-500 text-sm mb-8">Última actualización: marzo 2025</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300">
          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">1. Aceptación de los términos</h2>
            <p>
              Al acceder o usar Zeus Media Studio IA («el Servicio»), aceptas quedar vinculado por estos Términos de servicio.
              Si no estás de acuerdo con alguna parte de los términos, no debes usar el Servicio.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">2. Descripción del servicio</h2>
            <p>
              Zeus Media Studio IA es una suite multimedia que ofrece herramientas de creación y gestión de contenido
              con asistencia de inteligencia artificial. El uso del Servicio está sujeto a la disponibilidad y a las
              condiciones que se indiquen en la aplicación.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">3. Uso aceptable</h2>
            <p>
              Te comprometes a utilizar el Servicio de forma lícita y de manera que no infrinja derechos de terceros
              ni las leyes aplicables. No está permitido usar el Servicio para fines ilegales, ofensivos o que
              puedan dañar la infraestructura o la experiencia de otros usuarios.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">4. Cuenta y responsabilidad</h2>
            <p>
              Eres responsable de mantener la confidencialidad de tu cuenta y contraseña. Cualquier actividad
              realizada bajo tu cuenta será bajo tu responsabilidad.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">5. Cambios en el servicio y los términos</h2>
            <p>
              Nos reservamos el derecho de modificar o interrumpir el Servicio, total o parcialmente, y de actualizar
              estos Términos. Los cambios relevantes se comunicarán cuando sea posible. El uso continuado del Servicio
              tras dichos cambios constituye la aceptación de los nuevos términos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">6. Contacto</h2>
            <p>
              Para cualquier pregunta sobre estos Términos de servicio, puedes contactarnos a través de los medios
              indicados en la aplicación o en nuestra Política de privacidad.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex flex-wrap gap-4">
          <Link href="/privacy" className="text-green-400 hover:text-green-300 transition-colors">
            Política de privacidad
          </Link>
          <Link href="/auth" className="text-gray-400 hover:text-white transition-colors">
            Volver al inicio de sesión
          </Link>
          <Link href="/" className="text-gray-400 hover:text-white transition-colors">
            Inicio
          </Link>
        </div>
      </main>
    </div>
  );
}
