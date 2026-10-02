/**
 * Rutas de autenticación. Cambia estos valores para reutilizar en otra app.
 * También puedes usar variables de entorno: NEXT_PUBLIC_AUTH_LOGIN_PATH, etc.
 */
export const authPaths = {
  login: process.env.NEXT_PUBLIC_AUTH_LOGIN_PATH ?? '/auth/login',
  register: process.env.NEXT_PUBLIC_AUTH_REGISTER_PATH ?? '/auth/register',
  home: process.env.NEXT_PUBLIC_AUTH_HOME_PATH ?? '/',
  profile: process.env.NEXT_PUBLIC_AUTH_PROFILE_PATH ?? '/profile',
  settings: process.env.NEXT_PUBLIC_AUTH_SETTINGS_PATH ?? '/settings',
};
