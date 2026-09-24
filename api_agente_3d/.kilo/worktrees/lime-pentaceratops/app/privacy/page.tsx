'use client';

import Link from 'next/link';
import Image from 'next/image';

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold text-white mb-2">Política de privacidad</h1>
        <p className="text-gray-500 text-sm mb-8">Última actualización: marzo 2025</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-gray-300">
          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">1. Responsable del tratamiento</h2>
            <p>
              Zeus Media Studio IA («nosotros», «el Servicio») trata los datos personales que nos facilitas al
              registrarte y usar la aplicación, con el fin de prestar el servicio y mejorar la experiencia de uso.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">2. Datos que recogemos</h2>
            <p>
              Podemos recoger, entre otros: datos de identificación (por ejemplo correo electrónico y nombre de usuario),
              datos de uso de la aplicación y, si inicias sesión con proveedores externos (Google, GitHub), los datos
              que esos servicios comparten con nosotros según su configuración.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">3. Finalidad y base legal</h2>
            <p>
              Utilizamos tus datos para gestionar tu cuenta, proporcionar las funcionalidades del Servicio, comunicarnos
              contigo cuando sea necesario y, en su caso, cumplir obligaciones legales. La base legal es la ejecución
              del contrato (uso del Servicio) y, cuando corresponda, tu consentimiento o el interés legítimo.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">4. Conservación y seguridad</h2>
            <p>
              Conservamos los datos mientras mantengas una cuenta activa y durante el tiempo necesario para cumplir
              obligaciones legales o reclamaciones. Aplicamos medidas técnicas y organizativas para proteger tus
              datos frente a accesos no autorizados y pérdida o alteración indebida.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">5. Tus derechos</h2>
            <p>
              Puedes ejercer los derechos de acceso, rectificación, supresión, limitación del tratamiento, portabilidad
              y oposición dirigiendo una solicitud a través de los medios de contacto que indiquemos en la aplicación.
              También tienes derecho a presentar una reclamación ante la autoridad de protección de datos competente.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mt-8 mb-2">6. Cambios en esta política</h2>
            <p>
              Podemos actualizar esta Política de privacidad. Los cambios relevantes se publicarán en esta página y,
              cuando sea significativo, te lo indicaremos en el Servicio. Te recomendamos revisarla periódicamente.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex flex-wrap gap-4">
          <Link href="/terms" className="text-green-400 hover:text-green-300 transition-colors">
            Términos de servicio
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
