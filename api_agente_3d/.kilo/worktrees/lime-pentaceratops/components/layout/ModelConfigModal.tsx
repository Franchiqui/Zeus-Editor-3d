'use client';

import { useState, useEffect } from 'react';
import { Languages } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import pb from '@/lib/pocketbase';
import { useI18n, LANGUAGES } from '@/lib/i18n';
import {
  MODELOS_FIELDS,
  MODELOS_COLLECTION_NAME,
  PROVIDER_PRESETS,
  getProviderPreset,
  normalizeProvider,
} from '@/lib/collections';
import type { ModeloRecord } from '@/lib/collections';

/** Formulario interno (nombres de UI) */
export type ModelConfigForm = {
  id?: string;
  proveedor: string;
  name: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  isVision: boolean;
};

const DEFAULT_FORM: Omit<ModelConfigForm, 'id'> = {
  proveedor: 'OpenAI',
  name: '',
  modelId: '',
  baseUrl: '',
  apiKey: '',
  maxTokens: 4096,
  temperature: 0.7,
  isVision: false,
};

function recordToForm(r: ModeloRecord): ModelConfigForm {
  return {
    id: r.id,
    proveedor: normalizeProvider((r.proveedor as string) ?? ''),
    name: (r.nombre_modelo as string) ?? '',
    modelId: (r.id_modelo as string) ?? '',
    baseUrl: (r.url as string) ?? '',
    apiKey: (r.clave_api as string) ?? '',
    maxTokens: typeof r.max_token === 'number' ? r.max_token : 4096,
    temperature: typeof r.temperatura === 'number' ? r.temperatura : 0.7,
    isVision: Boolean(r.is_vision),
  };
}

function formToPayload(f: ModelConfigForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    [MODELOS_FIELDS.PROVEEDOR]: f.proveedor || undefined,
    [MODELOS_FIELDS.NOMBRE_MODELO]: f.name.trim() || undefined,
    [MODELOS_FIELDS.ID_MODELO]: f.modelId.trim() || undefined,
    [MODELOS_FIELDS.URL]: f.baseUrl.trim() || undefined,
    [MODELOS_FIELDS.CLAVE_API]: f.apiKey || undefined,
    [MODELOS_FIELDS.MAX_TOKEN]: f.maxTokens,
    [MODELOS_FIELDS.TEMPERATURA]: f.temperature,
    [MODELOS_FIELDS.IS_VISION]: f.isVision,
  };
  return payload;
}

interface ModelConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function ModelConfigModal({ isOpen, onClose, onSaved }: ModelConfigModalProps) {
  const [configs, setConfigs] = useState<ModelConfigForm[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [form, setForm] = useState<ModelConfigForm>({ ...DEFAULT_FORM });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { locale, setLocale, t } = useI18n();

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    const userId = pb.authStore.model?.id;
    try {
      const url = userId ? `/api/modelos?user=${userId}` : '/api/modelos';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const records: ModeloRecord[] = Array.isArray(data?.records) ? data.records : [];
        setConfigs(records.map(recordToForm));
      } else if (pb.authStore.isValid && userId) {
        const filter = `user = "${userId}"`;
        const records = await pb.collection(MODELOS_COLLECTION_NAME).getFullList({ 
          sort: '-created',
          filter
        });
        setConfigs((records as ModeloRecord[]).map(recordToForm));
      } else {
        setConfigs([]);
      }
    } catch {
      if (pb.authStore.isValid && userId) {
        try {
          const filter = `user = "${userId}"`;
          const records = await pb.collection(MODELOS_COLLECTION_NAME).getFullList({ 
            sort: '-created',
            filter
          });
          setConfigs((records as ModeloRecord[]).map(recordToForm));
        } catch (e) {
          setError(e instanceof Error ? e.message : t('modelConfig.errLoad'));
          setConfigs([]);
        }
      } else {
        setError(t('modelConfig.errLoad'));
        setConfigs([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadModels();
      setEditingIndex(null);
      setForm({ ...DEFAULT_FORM });
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.modelId.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const userId = pb.authStore.model?.id;
      const payload = formToPayload(form);
      if (userId) {
        payload[MODELOS_FIELDS.USER] = userId;
      }

      if (editingIndex !== null && form.id) {
        const res = await fetch('/api/modelos', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: form.id, ...payload }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || t('modelConfig.errUpdate'));
        }
        const { record } = await res.json();
        const next = [...configs];
        next[editingIndex] = recordToForm(record as ModeloRecord);
        setConfigs(next);
        setEditingIndex(null);
      } else {
        const res = await fetch('/api/modelos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || t('modelConfig.errSave'));
        }
        const { record } = await res.json();
        setConfigs((prev) => [...prev, recordToForm(record as ModeloRecord)]);
      }
      setForm({ ...DEFAULT_FORM });
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('modelConfig.errSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setForm({ ...configs[index] });
  };

  const handleDelete = async (index: number) => {
    const item = configs[index];
    if (!item.id) return;
    if (!confirm(t('modelConfig.confirmDelete', { name: item.name }))) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/modelos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || t('modelConfig.errDelete'));
      }
      const next = configs.filter((_, i) => i !== index);
      setConfigs(next);
      if (editingIndex === index) {
        setEditingIndex(null);
        setForm({ ...DEFAULT_FORM });
      } else if (editingIndex !== null && editingIndex > index) {
        setEditingIndex(editingIndex - 1);
      }
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('modelConfig.errDelete'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('modelConfig.title')}
      description={t('modelConfig.description')}
      size="lg"
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t('modelConfig.languageTooltip')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-600 bg-gray-800/60 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
              >
                <Languages className="h-3.5 w-3.5" />
                {t(`language.${locale}`)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[10rem]">
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(v) => setLocale(v as typeof locale)}
              >
                {LANGUAGES.map((l) => (
                  <DropdownMenuRadioItem key={l.code} value={l.code}>
                    {t(`language.${l.code}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={() => {
              try {
                (window as any).electronAPI?.toggleDevTools?.();
              } catch (e) {
                console.error('No se pudo abrir DevTools:', e);
              }
            }}
            title={t('modelConfig.devToolsTooltip')}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-600 bg-gray-800/60 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            {t('modelConfig.devTools')}
          </button>
        </div>

        <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-white">
            {editingIndex !== null ? t('modelConfig.editModel') : t('modelConfig.newModel')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('modelConfig.provider')}</label>
              <select
                value={form.proveedor}
                onChange={(e) => {
                  const presetId = e.target.value;
                  const preset = getProviderPreset(presetId);
                  setForm((f) => ({
                    ...f,
                    proveedor: presetId,
                    // Autorellena URL/modelo solo si están vacíos (no sobreescribe lo editado).
                    baseUrl: f.baseUrl.trim() ? f.baseUrl : preset?.defaultBaseUrl ?? '',
                    modelId: f.modelId.trim() ? f.modelId : preset?.defaultModel ?? '',
                  }));
                }}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {getProviderPreset(form.proveedor)?.hint && (
                <p className="mt-1 text-xs text-gray-500">{getProviderPreset(form.proveedor)!.hint}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('modelConfig.modelName')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('modelConfig.modelNamePlaceholder')}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('modelConfig.modelId')}</label>
              <input
                type="text"
                value={form.modelId}
                onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
                placeholder={t('modelConfig.modelIdPlaceholder')}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">{t('modelConfig.baseUrl')}</label>
            <input
              type="url"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              {t('modelConfig.apiKey')}{getProviderPreset(form.proveedor)?.requiresApiKey === false ? t('modelConfig.apiKeyOptional') : ''}
            </label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={getProviderPreset(form.proveedor)?.requiresApiKey === false ? t('modelConfig.apiKeyNotRequired') : t('modelConfig.apiKeyPlaceholder')}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('modelConfig.maxTokens')}</label>
              <input
                type="number"
                min={1}
                max={128000}
                value={form.maxTokens}
                onChange={(e) => setForm((f) => ({ ...f, maxTokens: Number(e.target.value) || 4096 }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">{t('modelConfig.temperature')}</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(e) => setForm((f) => ({ ...f, temperature: Number(e.target.value) || 0.7 }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isVision"
              checked={form.isVision}
              onChange={(e) => setForm((f) => ({ ...f, isVision: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-green-600 focus:ring-green-500"
            />
            <label htmlFor="isVision" className="text-sm text-gray-300">
              {t('modelConfig.isVision')}
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!form.name.trim() || !form.modelId.trim() || saving}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition-colors"
            >
              {saving ? t('modelConfig.saving') : editingIndex !== null ? t('modelConfig.saveChanges') : t('modelConfig.addModel')}
            </button>
            {editingIndex !== null && (
              <button
                type="button"
                onClick={() => {
                  setEditingIndex(null);
                  setForm({ ...DEFAULT_FORM });
                }}
                disabled={saving}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 text-sm font-medium transition-colors"
              >
                {t('modelConfig.cancel')}
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-700 bg-gray-800/30 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">{t('modelConfig.dbTitle')}</h3>
          {loading ? (
            <p className="text-gray-500 text-sm">{t('modelConfig.loading')}</p>
          ) : configs.length === 0 ? (
            <p className="text-gray-500 text-sm">{t('modelConfig.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {configs.map((c, i) => (
                <li
                  key={c.id ?? i}
                  className="flex items-center justify-between gap-2 p-3 rounded-lg bg-gray-900 border border-gray-700"
                >
                  <div className="min-w-0">
                    <p className="text-white font-medium truncate">
                      {c.proveedor ? `${c.proveedor} · ` : ''}{c.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.modelId} · {c.baseUrl || '—'}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEdit(i)}
                      disabled={saving}
                      className="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                      title={t('modelConfig.edit')}
                    >
                      {t('modelConfig.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(i)}
                      disabled={saving}
                      className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                      title={t('modelConfig.delete')}
                    >
                      {t('modelConfig.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
