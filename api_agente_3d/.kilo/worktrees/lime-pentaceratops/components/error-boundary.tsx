'use client';

import React from 'react';
import { useI18nStore, translations, resolve as resolveKey } from '@/lib/i18n';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
  onReset?: () => void;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Actualizar el estado con el error para asegurar que esté disponible
    this.setState({ error });
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined });
    // Llamar al callback personalizado si está definido
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    const t = (k: string) => resolveKey(translations[useI18nStore.getState().locale] ?? translations.es, k) ?? k;
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error} resetError={this.resetError} />;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              {t('app.errorTitle')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {t('app.errorDesc')}
            </p>
            <button
              onClick={this.resetError}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Intentar de nuevo
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;