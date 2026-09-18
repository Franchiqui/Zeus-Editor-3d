'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  showCloseButton?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
  overlayClassName?: string;
  containerClassName?: string;
  bodyClassName?: string;
  resizable?: boolean;
  hideScroll?: boolean;
}

const Modal = React.memo(function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
  closeOnOverlayClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  initialFocusRef,
  className,
  overlayClassName,
  containerClassName,
  bodyClassName,
  resizable,
  hideScroll = false,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && closeOnEsc) {
      onClose();
    }
  }, [onClose, closeOnEsc]);

  const handleOverlayClick = useCallback((event: React.MouseEvent) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose();
    }
  }, [closeOnOverlayClick, onClose]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Efecto para la gestión del foco y el scroll
  useEffect(() => {
    if (isOpen) {
      lastFocusedElement.current = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';

      // Refrescar foco para Electron (solución para frame:false en Windows)
      // Se ejecuta un poco antes del foco real para preparar la ventana
      const refreshTimeout = setTimeout(() => {
        if ((window as any).electronAPI?.refreshFocus) {
          (window as any).electronAPI.refreshFocus();
        }
      }, 50);

      const focusTimeout = setTimeout(() => {
        if (initialFocusRef?.current) {
          initialFocusRef.current.focus();
          // Segundo intento para asegurar en Electron
          setTimeout(() => initialFocusRef.current?.focus(), 50);
          return;
        }
        if (!modalRef.current) return;

        // Intentar encontrar el primer elemento con autoFocus
        const autoFocusEl = modalRef.current.querySelector('[autofocus]') as HTMLElement | null;
        if (autoFocusEl) {
          autoFocusEl.focus();
          setTimeout(() => autoFocusEl.focus(), 100);
          return;
        }

        // Si no hay autoFocus, enfocar el primer input/textarea/select
        const inputEls = modalRef.current.querySelectorAll('input:not([type="hidden"]), textarea, select');
        if (inputEls.length > 0) {
          const firstInput = inputEls[0] as HTMLElement;
          firstInput.focus();
          setTimeout(() => firstInput.focus(), 100);
          return;
        }

        // Fallback: primer elemento focusable cualquiera
        const focusableElements = modalRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
          (focusableElements[0] as HTMLElement).focus();
        }
      }, 350); // Aumentado a 350ms para dar tiempo a la animación y al refreshFocus de Electron

      return () => {
        clearTimeout(refreshTimeout);
        clearTimeout(focusTimeout);
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
      if (lastFocusedElement.current) {
        // Pequeño delay para devolver el foco después de que el modal se cierre
        setTimeout(() => {
          lastFocusedElement.current?.focus();
        }, 100);
      }
    }
  }, [isOpen, initialFocusRef]);

  // Efecto separado para el listener de teclado
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, handleKeyDown]);  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-5xl',
    full: 'max-w-full mx-4',
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'fixed inset-0 z-50 flex items-center justify-center p-4',
              overlayClassName
            )}
            onClick={handleOverlayClick}
            role="presentation"
          >
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              aria-hidden="true"
            />
            
            <motion.div
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn(
                'relative z-10 w-full rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800',
                'shadow-2xl border border-gray-700/50',
                sizeClasses[size],
                className
              )}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? 'modal-title' : undefined}
              aria-describedby={description ? 'modal-description' : undefined}
            >
              <div
                className={cn(
                  'flex flex-col max-h-[90vh]',
                  resizable && 'resize-y overflow-auto',
                  containerClassName
                )}
              >
                {(title || showCloseButton) && (
                  <div className="flex items-center justify-between p-6 border-b border-gray-700/50">
                    {title && (
                      <div className="flex-1">
                        <h2
                          id="modal-title"
                          className="text-xl font-semibold text-white"
                        >
                          {title}
                        </h2>
                        {description && (
                          <p
                            id="modal-description"
                            className="mt-1 text-sm text-gray-400"
                          >
                            {description}
                          </p>
                        )}
                      </div>
                    )}
                    
                    {showCloseButton && (
                      <button
                        type="button"
                        onClick={onClose}
                        className={cn(
                          'ml-4 rounded-full p-2',
                          'text-gray-400 hover:text-white hover:bg-gray-700/50',
                          'transition-colors duration-200',
                          'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900'
                        )}
                        aria-label="Close modal"
                      >
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                )}
                
                <div className={cn(
                  "flex-1 p-6",
                  !hideScroll && "overflow-y-auto",
                  hideScroll && "overflow-hidden",
                  bodyClassName
                )}>
                  {children}
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (!mounted) return null;

  return createPortal(modalContent, document.body);
});

Modal.displayName = 'Modal';

export { Modal };

export interface ModalHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export const ModalHeader = React.memo(function ModalHeader({
  title,
  description,
  children,
}: ModalHeaderProps) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-400">{description}</p>
      )}
      {children}
    </div>
  );
});

ModalHeader.displayName = 'ModalHeader';

export interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export const ModalFooter = React.memo(function ModalFooter({
  children,
  className,
}: ModalFooterProps) {
  return (
    <div className={cn(
      'mt-8 pt-6 border-t border-gray-700/50',
      'flex items-center justify-end space-x-3',
      className
    )}>
      {children}
    </div>
  );
});

ModalFooter.displayName = 'ModalFooter';

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

export const ModalBody = React.memo(function ModalBody({
  children,
  className,
}: ModalBodyProps) {
  return (
    <div className={cn('text-gray-300', className)}>
      {children}
    </div>
  );
});

ModalBody.displayName = 'ModalBody';