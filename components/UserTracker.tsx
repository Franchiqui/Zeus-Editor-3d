'use client';

import { useState, useEffect } from 'react';
import { checkUser, registerUser, type UserTrackingResult } from '@/lib/userTracking';
import { Modal, ModalHeader, ModalFooter } from '@/components/ui/modal';

export default function UserTracker() {
  const [showNameModal, setShowNameModal] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [returningUserName, setReturningUserName] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (hasChecked) return;
    setHasChecked(true);

    const init = async () => {
      try {
        const result: UserTrackingResult = await checkUser();
        if (result.exists && result.user) {
          setReturningUserName(result.user.name || ' Usuario');
          setShowWelcomeModal(true);
        } else {
          setShowNameModal(true);
        }
      } catch {
        // Silently fail — editor still usable
      }
    };

    init();
  }, [hasChecked]);

  const handleSave = async () => {
    if (!username.trim()) return;
    setIsSaving(true);
    try {
      await registerUser(username.trim());
    } finally {
      setIsSaving(false);
      setShowNameModal(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={showNameModal}
        onClose={() => setShowNameModal(false)}
        showCloseButton={false}
        closeOnOverlayClick={false}
        closeOnEsc={false}
      >
        <ModalHeader
          title="Bienvenido al Editor 3D"
          description="Introduce tu nombre de usuario para registrarte."
        />
        <div className="mb-4">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Nombre de usuario"
            className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && username.trim()) {
                handleSave();
              }
            }}
          />
        </div>
        <ModalFooter>
          <button
            onClick={() => setShowNameModal(false)}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors font-medium"
          >
            Saltar
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !username.trim()}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white font-bold transition-colors"
          >
            {isSaving ? 'Guardando...' : 'Guardar'}
          </button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
        showCloseButton={false}
        closeOnOverlayClick={false}
        closeOnEsc={false}
      >
        <ModalHeader
          title={`¡Bienvenido de nuevo, ${returningUserName}!`}
          description="Tu conexión ha sido registrada. Que disfrutes del editor."
        />
        <ModalFooter>
          <button
            onClick={() => setShowWelcomeModal(false)}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-white font-bold transition-colors"
          >
            Entrar
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
}
