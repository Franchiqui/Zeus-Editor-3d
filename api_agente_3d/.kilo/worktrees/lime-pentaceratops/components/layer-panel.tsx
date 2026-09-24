'use client';

import useAppStore, { type Layer } from '@/store/app-store';
import {
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  LockOpenIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

const GROUP_COLORS: Record<number, string> = {
  1: '#3B82F6',
  2: '#EF4444',
  3: '#22C55E',
};

export default function LayerPanel() {
  const { t } = useI18n();
  const store = useAppStore();
  const state = store.getActiveState();
  const layers = state.currentIcon?.layers ?? [];
  const selectedLayerId = state.selectedLayerId;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-400 uppercase">{t('editorIconos.layers.title')}</h3>
        <button
          onClick={() => store.addLayer()}
          className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-white"
          title={t('editorIconos.layers.addLayer')}
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1">
        {layers.map((layer) => (
          <div
            key={layer.id}
            onClick={() => store.selectLayer(layer.id)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm select-none ${
              selectedLayerId === layer.id
                ? 'bg-blue-600/20 text-white'
                : 'text-gray-300 hover:bg-gray-700/40'
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                store.toggleLayerVisibility(layer.id);
              }}
              className="text-gray-400 hover:text-white"
              title={layer.visible ? t('editorIconos.layers.hide') : t('editorIconos.layers.show')}
            >
              {layer.visible ? (
                <EyeIcon className="w-4 h-4" />
              ) : (
                <EyeSlashIcon className="w-4 h-4" />
              )}
            </button>

            <div className="flex-1 min-w-0">
              {editingId === layer.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => {
                    store.renameLayer(layer.id, editName.trim() || layer.name);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      store.renameLayer(layer.id, editName.trim() || layer.name);
                      setEditingId(null);
                    }
                    if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  className="w-full bg-transparent border-b border-blue-500 outline-none text-white text-sm"
                />
              ) : (
                <span className="truncate block">{layer.name === 'Layer 1' ? t('editorIconos.layers.layer1') : layer.name}</span>
              )}
            </div>

            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: GROUP_COLORS[layer.colorGroup] }}
              title={`${t('editorIconos.layers.group')} ${layer.colorGroup}`}
            />

            <button
              onClick={(e) => {
                e.stopPropagation();
                store.toggleLayerLock(layer.id);
              }}
              className="text-gray-400 hover:text-white"
              title={layer.locked ? t('editorIconos.layers.unlock') : t('editorIconos.layers.lock')}
            >
              {layer.locked ? (
                <LockClosedIcon className="w-4 h-4" />
              ) : (
                <LockOpenIcon className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(layer.id);
                setEditName(layer.name);
              }}
              className="text-gray-400 hover:text-white"
              title={t('editorIconos.layers.rename')}
            >
              <PencilIcon className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                store.removeLayer(layer.id);
              }}
              className="text-gray-500 hover:text-red-400"
              title={t('editorIconos.layers.delete')}
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {selectedLayerId && (
        <div className="flex items-center gap-1 pt-1">
          <span className="text-xs text-gray-500 mr-1">{t('editorIconos.layers.group')}:</span>
          {[1, 2, 3].map((g) => (
            <button
              key={g}
              onClick={() => store.setLayerColorGroup(selectedLayerId, g as 1 | 2 | 3)}
              className={`w-5 h-5 rounded-full border-2 ${
                layers.find((l) => l.id === selectedLayerId)?.colorGroup === g
                  ? 'border-white'
                  : 'border-transparent'
              }`}
              style={{ backgroundColor: GROUP_COLORS[g] }}
              title={`${t('editorIconos.layers.group')} ${g}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
