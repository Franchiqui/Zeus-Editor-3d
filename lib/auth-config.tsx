'use client';

// Configuración de autenticación para la aplicación
// Define rutas protegidas, públicas y de autenticación

export const authPaths = {
  login: '/auth/login',
  register: '/auth/register',
  home: '/',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  verifyEmail: '/auth/verify-email',
} as const;

export const publicPaths = [
  '/',
  '/about',
  '/contact',
  '/blog',
  '/pricing',
  '/terms',
  '/privacy',
  '/faq',
  '/features',
  '/docs',
  '/status',
] as const;

export const authRoutes = [
  authPaths.login,
  authPaths.register,
  authPaths.forgotPassword,
  authPaths.resetPassword,
  authPaths.verifyEmail,
] as const;

export const protectedRoutes = [
  '/dashboard',
  '/dashboard/*',
  '/profile',
  '/profile/*',
  '/settings',
  '/settings/*',
  '/admin',
  '/admin/*',
  '/chat',
  '/chat/*',
  '/calendar',
  '/calendar/*',
  '/notifications',
  '/notifications/*',
  '/analytics',
  '/analytics/*',
  '/media',
  '/media/*',
  '/e-commerce',
  '/e-commerce/*',
  '/orders',
  '/orders/*',
  '/invoices',
  '/invoices/*',
  '/api-keys',
  '/api-keys/*',
  '/team',
  '/team/*',
  '/billing',
  '/billing/*',
] as const;

export type AuthPath = (typeof authPaths)[keyof typeof authPaths];
export type PublicPath = (typeof publicPaths)[number];
export type AuthRoute = (typeof authRoutes)[number];
export type ProtectedRoute = (typeof protectedRoutes)[number];

export function isPublicPath(path: string): boolean {
  return publicPaths.some((publicPath) => {
    if (publicPath.endsWith('/*')) {
      return path.startsWith(publicPath.slice(0, -2));
    }
    return path === publicPath;
  });
}

export function isAuthRoute(path: string): boolean {
  return authRoutes.some((route) => {
    if (route.endsWith('/*')) {
      return path.startsWith(route.slice(0, -2));
    }
    return path === route;
  });
}

export function isProtectedRoute(path: string): boolean {
  return protectedRoutes.some((route) => {
    if (route.endsWith('/*')) {
      return path.startsWith(route.slice(0, -2));
    }
    return path === route;
  });
}

export function getDefaultRedirectPath(userRole?: string): string {
  switch (userRole) {
    case 'admin':
      return '/admin';
    case 'moderator':
      return '/dashboard';
    default:
      return authPaths.home;
  }
}

export function getLoginRedirectPath(currentPath?: string): string {
  if (currentPath && !isAuthRoute(currentPath) && !isPublicPath(currentPath)) {
    return `${authPaths.login}?redirect=${encodeURIComponent(currentPath)}`;
  }
  return authPaths.login;
}

export const authConfig = {
  sessionCookieName: 'pb_auth',
  sessionMaxAge: 7 * 24 * 60 * 60, // 7 días en segundos
  passwordMinLength: 8,
  passwordMaxLength: 128,
  emailVerificationRequired: false,
  allowRegistration: true,
  allowPasswordReset: true,
  loginAttempts: {
    maxAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutos en milisegundos
  },
  tokenRefreshInterval: 55 * 60 * 1000, // 55 minutos en milisegundos
  mfa: {
    enabled: false,
    methods: ['totp', 'sms', 'email'] as const,
  },
  socialLogin: {
    providers: ['google', 'github', 'facebook', 'twitter'] as const,
    enabled: false,
  },
} as const;

export type AuthConfig = typeof authConfig;

export function validatePassword(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < authConfig.passwordMinLength) {
    errors.push(
      `La contraseña debe tener al menos ${authConfig.passwordMinLength} caracteres`
    );
  }

  if (password.length > authConfig.passwordMaxLength) {
    errors.push(
      `La contraseña no puede tener más de ${authConfig.passwordMaxLength} caracteres`
    );
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra mayúscula');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra minúscula');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('La contraseña debe contener al menos un número');
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('La contraseña debe contener al menos un carácter especial');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('invalid login') || message.includes('invalid credentials')) {
      return 'Credenciales inválidas';
    }

    if (message.includes('email not verified')) {
      return 'Por favor verifica tu correo electrónico antes de iniciar sesión';
    }

    if (message.includes('account locked') || message.includes('too many requests')) {
      return 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos';
    }

    if (message.includes('user not found')) {
      return 'No se encontró una cuenta con este correo electrónico';
    }

    if (message.includes('password reset')) {
      return 'El enlace de restablecimiento de contraseña ha expirado. Solicita uno nuevo';
    }

    if (message.includes('email already exists')) {
      return 'Ya existe una cuenta con este correo electrónico';
    }

    if (message.includes('weak password')) {
      return 'La contraseña no cumple con los requisitos de seguridad mínimos';
    }

    if (message.includes('network') || message.includes('fetch')) {
      return 'Error de conexión. Verifica tu conexión a internet e intenta de nuevo';
    }

    return message.charAt(0).toUpperCase() + message.slice(1);
  }

  return 'Ha ocurrido un error inesperado. Intenta de nuevo más tarde';
}
