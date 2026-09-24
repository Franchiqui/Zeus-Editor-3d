'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion } from 'framer-motion';
import pb, { resolveClientBaseUrl, loginWithFallback } from '@/lib/pocketbase';
import { useStore } from '@/lib/store';
import { getPocketBaseErrorMessage } from '@/lib/utils';

export default function AuthPage() {
  const router = useRouter();
  const { init: initStore, setUser: setStoreUser } = useStore();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [oauthLoading, setOAuthLoading] = useState<'google' | 'github' | null>(null);
  const [ready, setReady] = useState(false);

  // Si ya hay sesión válida, ir al inicio
  useEffect(() => {
    if (typeof window === 'undefined') return;
    pb.autoCancellation(false);
    (async () => {
      // Asegura que pb.baseUrl apunte a la base activa (remota o local) antes de leer la cookie.
      await resolveClientBaseUrl();
      pb.authStore.loadFromCookie(document.cookie);
      if (pb.authStore.isValid) {
        initStore();
        setStoreUser(pb.authStore.model ?? null);
        router.replace('/');
        return;
      }
      const savedEmail = localStorage.getItem('Zeus_remember_email');
      const savedPass = localStorage.getItem('Zeus_remember_pass');
      if (savedEmail && savedPass) {
        setAuthEmail(savedEmail);
        setAuthPassword(savedPass);
        setRememberMe(true);
      }
      setReady(true);
    })();
  }, [router, initStore, setStoreUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    try {
      await loginWithFallback(authEmail, authPassword);
      setStoreUser(pb.authStore.model ?? null);
      if (rememberMe) {
        localStorage.setItem('Zeus_remember_email', authEmail);
        localStorage.setItem('Zeus_remember_pass', authPassword);
      } else {
        localStorage.removeItem('Zeus_remember_email');
        localStorage.removeItem('Zeus_remember_pass');
      }
      document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
      initStore();
      router.replace('/');
    } catch (error: unknown) {
      console.error('Login error:', error);
      const msg = getPocketBaseErrorMessage(error);
      const hint = (String(error).includes('create record') || String(error).includes('Failed to fetch') || String(error).includes('fetch'))
        ? ' Comprueba que NEXT_PUBLIC_POCKETBASE_URL sea la URL de tu PocketBase.'
        : '';
      alert('Error al iniciar sesión: ' + msg + hint);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedTerms) {
      alert('Debes aceptar los Términos de servicio y la Política de privacidad para registrarte.');
      return;
    }
    if (authPassword !== authConfirmPassword) {
      alert('Las contraseñas no coinciden');
      return;
    }
    if (authPassword.length < 9) {
      alert('La contraseña debe tener al menos 9 caracteres');
      return;
    }
    setAuthLoading(true);
    try {
      await pb.collection('users').create({
        email: authEmail.trim(),
        password: authPassword,
        passwordConfirm: authConfirmPassword,
        name: authEmail.split('@')[0],
      });
      await loginWithFallback(authEmail, authPassword);
      setStoreUser(pb.authStore.model ?? null);
      if (rememberMe) {
        localStorage.setItem('Zeus_remember_email', authEmail);
        localStorage.setItem('Zeus_remember_pass', authPassword);
      }
      document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
      initStore();
      router.replace('/');
    } catch (error: unknown) {
      console.error('Register error:', error);
      const msg = getPocketBaseErrorMessage(error);
      const hint = (String(error).includes('create record') || String(error).includes('Failed to fetch') || String(error).includes('fetch'))
        ? ' Comprueba NEXT_PUBLIC_POCKETBASE_URL en tu plataforma.'
        : '';
      alert('Error al registrarse: ' + msg + hint);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setOAuthLoading(provider);
    const baseUrl = pb.baseUrl || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'https://zeus-media-studio-ia.fly.dev';
    
    try {
      // 1. Obtener la lista de métodos de forma manual (Bypass SDK bug)
      const methodsRes = await fetch(`${baseUrl}/api/collections/users/auth-methods`);
      if (!methodsRes.ok) throw new Error("No se pudieron obtener los métodos de acceso del servidor.");
      
      const methods = await methodsRes.json();
      const availableProviders = methods.authProviders || methods.providers || [];
      const found = availableProviders.find((p: any) => p.name === provider);

      if (!found) {
        throw new Error(`El proveedor '${provider}' no está activo en el panel de PocketBase.`);
      }

      // 2. Usar el flujo manual del SDK que es más estable
      // En lugar de pasar solo el nombre, pasamos el objeto completo si es necesario
      // pero authWithOAuth2 con el nombre debería funcionar si el redirect está bien
      const authData = await pb.collection('users').authWithOAuth2({
        provider: found.name,
        // Forzamos la URL de redirección oficial de tu instancia
        url: `${baseUrl}/api/oauth2-redirect` 
      });
      
      if (authData && pb.authStore.isValid) {
        setStoreUser(pb.authStore.model ?? null);
        document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
        initStore();
        router.replace('/');
      }
    } catch (err: unknown) {
      console.error('❌ ERROR OAUTH:', err);
      const msg = err instanceof Error ? err.message : String(err);
      
      // Si el error sigue siendo el de 'providers', usamos el plan C: Redirección manual completa
      if (msg.includes('providers')) {
        alert("Detectado conflicto persistente en el SDK. Redirigiendo al flujo de emergencia...");
        // Intentar obtener la authUrl del objeto que ya encontramos
        const methodsRes = await fetch(`${baseUrl}/api/collections/users/auth-methods`);
        const methods = await methodsRes.json();
        const availableProviders = methods.authProviders || methods.providers || [];
        const found = availableProviders.find((p: any) => p.name === provider);
        
        if (found && found.authUrl) {
          // Guardar el verifier en localStorage para recuperarlo al volver
          localStorage.setItem('zeus_oauth_verifier', found.codeVerifier);
          localStorage.setItem('zeus_oauth_provider', provider);
          // Redirigir a Google/GitHub
          window.location.href = found.authUrl + `${baseUrl}/api/oauth2-redirect`;
          return;
        }
      }

      alert(`Error al conectar con ${provider}:\n\n${msg}`);
    } finally {
      setOAuthLoading(null);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-yellow-900/20 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-yellow-900/20 flex flex-col">
      {/* Barra superior igual que la página principal: logo installer-icon + dos textos (un poco más grandes) */}
      <header className="w-full flex-shrink-0 h-14 px-6 flex items-center border-b border-gray-700/50">
        <div className="flex items-center gap-4 shrink-0">
          <img src="/installer-icon.ico" alt="Zeus" className="w-10 h-10 object-contain" />
          <div className="flex flex-col">
            <h1 className="text-2xl font-black bg-gradient-to-r from-green-400 to-yellow-500 bg-clip-text text-transparent leading-none tracking-tight">
              Zeus Media Studio IA
            </h1>
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Media Studior Suite</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-lg">
          <div className="absolute left-1/2 -translate-x-1/2 -top-[260px] z-20 w-[520px] sm:w-[640px] h-auto drop-shadow-2xl pointer-events-none">
            <Image
              src="/Letras Zeus.png"
              alt="Zeus Media Studio IA"
              width={640}
              height={128}
              className="w-full h-auto object-contain"
              priority
            />
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 -top-32 sm:-top-36 z-10 w-56 sm:w-72 h-auto drop-shadow-2xl pointer-events-none">
            <Image
              src="/Zeus-Media.png"
              alt="Zeus Media Studio IA"
              width={384}
              height={120}
              priority
              className="w-full h-auto object-contain"
              sizes="(max-width: 640px) 288px, 384px"
            />
          </div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative w-full bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8 pt-36 shadow-2xl"
          >
            <div className="text-center mb-6">
              <p className="text-gray-400">
                {authMode === 'login' ? 'Bienvenido de nuevo' : 'Crea tu cuenta profesional'}
              </p>
            </div>

            <form onSubmit={authMode === 'login' ? handleLogin : handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                  placeholder="tu@email.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Contraseña</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                  placeholder={authMode === 'register' ? 'Mínimo 9 caracteres' : '••••••••'}
                  required
                  minLength={authMode === 'register' ? 9 : undefined}
                />
              </div>
              {authMode === 'register' && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Confirmar contraseña</label>
                  <input
                    type="password"
                    value={authConfirmPassword}
                    onChange={(e) => setAuthConfirmPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-all"
                    placeholder="Repite la contraseña"
                    required
                    minLength={9}
                  />
                </div>
              )}

              {authMode === 'register' && (
                <div className="flex items-start space-x-2 py-1">
                  <input
                    type="checkbox"
                    id="acceptedTerms"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded border-white/10 bg-white/5 text-green-600 accent-green-500 focus:ring-green-500/50 transition-all cursor-pointer flex-shrink-0"
                  />
                  <label htmlFor="acceptedTerms" className="text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                    Acepto los{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300 underline underline-offset-1" onClick={(e) => e.stopPropagation()}>
                      Términos de servicio
                    </a>
                    {' '}y la{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300 underline underline-offset-1" onClick={(e) => e.stopPropagation()}>
                      Política de privacidad
                    </a>
                  </label>
                </div>
              )}

              <div className="flex items-center space-x-2 py-1">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-green-600 accent-green-500 focus:ring-green-500/50 transition-all cursor-pointer"
                />
                <label htmlFor="rememberMe" className="text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
                  Recordarme en este equipo
                </label>
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-gradient-to-r from-green-600 to-yellow-500 hover:from-green-500 hover:to-yellow-400 text-white font-semibold py-3 rounded-xl transition-all transform active:scale-[0.98] shadow-lg shadow-green-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {authLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  authMode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'
                )}
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-transparent text-gray-500">o continúa con</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleOAuth('google')}
                  disabled={oauthLoading !== null}
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-medium transition-all disabled:opacity-50"
                >
                  {oauthLoading === 'google' ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden>
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      <span>Google</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleOAuth('github')}
                  disabled={oauthLoading !== null}
                  className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-medium transition-all disabled:opacity-50"
                >
                  {oauthLoading === 'github' ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                      </svg>
                      <span>GitHub</span>
                    </>
                  )}
                </button>
              </div>
            </form>
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                {authMode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
      {authMode === 'login' && (
        <p className="text-center text-sm text-gray-500 mt-8 pb-6">
          Al continuar, aceptas nuestros{' '}
          <a href="/terms" className="text-green-400 hover:text-green-300 underline underline-offset-2 transition-colors">
            Términos de servicio
          </a>
          {' '}y{' '}
          <a href="/privacy" className="text-green-400 hover:text-green-300 underline underline-offset-2 transition-colors">
            Política de privacidad
          </a>
          .
        </p>
      )}
    </div>
  );
}
