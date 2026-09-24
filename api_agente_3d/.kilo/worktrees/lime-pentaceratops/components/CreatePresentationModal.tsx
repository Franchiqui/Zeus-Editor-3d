'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import {
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  FileSpreadsheet,
  Sparkles,
  X,
  Upload,
  CheckCircle2,
  Film,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { useI18n } from '@/lib/i18n';

const ACCEPT_DOCS = '.ppt,.pptx,.pdf,.doc,.docx,.txt,.md';
const ACCEPT_IMAGES = 'image/*';
const ACCEPT_VIDEO = 'video/*';
const ACCEPT_AUDIO = 'audio/*';

export interface CreatePresentationForm {
  title: string;
  prompt: string;
  notes: string;
  style: string;
  numSlides: number | '';
  files: File[];
  mode: 'animation' | 'presentation';
  /** Archivo de audio para fondo de la presentación (solo modo presentation) */
  audioFile?: File | null;
  /** Archivo de vídeo/imagen para fondo de la presentación (solo modo presentation) */
  backgroundFile?: File | null;
}

const defaultForm: CreatePresentationForm = {
  title: '',
  prompt: '',
  notes: '',
  style: 'profesional',
  numSlides: '',
  files: [],
  mode: 'animation',
  audioFile: null,
  backgroundFile: null,
};

const STYLE_OPTIONS = [
  { value: 'profesional', labelKey: 'presentation.styleProfessional' },
  { value: 'creativo', labelKey: 'presentation.styleCreative' },
  { value: 'educativo', labelKey: 'presentation.styleEducational' },
  { value: 'cinematografico', labelKey: 'presentation.styleCinematic' },
  { value: 'motion_graphics', label: 'Motion graphics' },
  { value: 'documental', label: 'Tipo documental' },
  { value: 'minimalista', label: 'Minimalista' },
  { value: 'corporativo', label: 'Corporativo' },
];

export type CreatePresentationResult =
  | void
  | string
  | { showSuccessCard: true; title: string };

export interface CreatePresentationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Si devuelve { showSuccessCard: true, title }, se muestra la tarjeta de éxito. Si devuelve string, se muestra como texto. */
  onSubmit?: (form: CreatePresentationForm) => void | Promise<void> | string | Promise<string> | CreatePresentationResult | Promise<CreatePresentationResult>;
}

export function CreatePresentationModal({
  isOpen,
  onClose,
  onSubmit,
}: CreatePresentationModalProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { selectedModel } = useStore();
  const [form, setForm] = useState<CreatePresentationForm>(defaultForm);
  const [fileList, setFileList] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [successCard, setSuccessCard] = useState<{ title: string } | null>(null);
  const [filesAdding, setFilesAdding] = useState(false);
  const filesListRef = React.useRef<HTMLUListElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setForm({ ...defaultForm, files: [] });
    setFileList([]);
    setResultText(null);
    setSuccessCard(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const update = (patch: Partial<CreatePresentationForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files;
    if (!chosen?.length) return;
    const newFiles = Array.from(chosen);
    setFilesAdding(true);
    setFileList((prev) => [...prev, ...newFiles]);
    setForm((prev) => ({ ...prev, files: [...prev.files, ...newFiles] }));
    e.target.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTimeout(() => {
      setFilesAdding(false);
      filesListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  const removeFile = (index: number) => {
    setFileList((prev) => prev.filter((_, i) => i !== index));
    setForm((prev) => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index),
    }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files;
    if (!dropped?.length) return;
    const newFiles = Array.from(dropped);
    setFilesAdding(true);
    setFileList((prev) => [...prev, ...newFiles]);
    setForm((prev) => ({ ...prev, files: [...prev.files, ...newFiles] }));
    setTimeout(() => {
      setFilesAdding(false);
      filesListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 300);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = () => setDragActive(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.prompt.trim()) return;
    if (!selectedModel && onSubmit) {
      // Si usa API interna, selectedModel es necesario
      return;
    }
    setIsSubmitting(true);
    setResultText(null);
    try {
      const payload = { ...form, files: fileList };
      const result = await onSubmit?.(payload);
      if (typeof result === 'string') {
        setResultText(result);
      } else if (result && typeof result === 'object' && 'showSuccessCard' in result && result.showSuccessCard && result.title) {
        setSuccessCard({ title: result.title });
      } else {
        handleClose();
      }
    } catch (err) {
      console.error(err);
      setResultText((err instanceof Error ? err.message : t('presentation.errorGenerating')) + '');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fileTypeIcon = (file: File) => {
    const t = file.type;
    if (t.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-green-400" />;
    if (t.startsWith('video/')) return <Video className="w-4 h-4 text-blue-400" />;
    if (t.startsWith('audio/')) return <Music className="w-4 h-4 text-amber-400" />;
    if (
      /\.(ppt|pptx|pdf|doc|docx)$/i.test(file.name) ||
      t.includes('presentation') ||
      t.includes('pdf') ||
      t.includes('document')
    )
      return <FileSpreadsheet className="w-4 h-4 text-orange-400" />;
    return <FileText className="w-4 h-4 text-gray-400" />;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={form.mode === 'presentation' ? t('presentation.createSlides') : t('presentation.createAnimation')}
      description={form.mode === 'presentation'
        ? t('presentation.slidesDesc')
        : t('presentation.animationDesc')}
      size="full"
      className="max-w-4xl"
      bodyClassName="max-h-[70vh] overflow-y-auto"
    >
      {successCard ? (
        <div className="flex flex-col">
          <ModalBody>
            <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/60 to-gray-900 p-6 text-center">
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-emerald-500/20 p-4">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400" />
                </div>
              </div>
              <h3 className="text-xl font-semibold text-white mb-1">
                {form.mode === 'presentation' ? t('presentation.readyTitle') : t('presentation.proposalDone')}
              </h3>
              <p className="text-gray-300 mb-6">
                {form.mode === 'presentation'
                  ? t('presentation.readySlidesDesc')
                  : t('presentation.readyAnimationDesc')}
                {successCard.title && (
                  <span className="block mt-2 text-emerald-400/90 font-medium">Propuesta para &quot;{successCard.title}&quot;</span>
                )}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    router.push('/edit-video');
                    handleClose();
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-green-600 to-yellow-500 hover:from-green-500 hover:to-yellow-400 text-white font-medium shadow-lg transition-all"
                >
                  <Film className="w-5 h-5" />
                  Abrir en editor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') sessionStorage.removeItem('zeus_ai_script');
                    handleClose();
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-600 text-gray-300 hover:bg-gray-700/50 transition-colors"
                >
                  {t('presentation.cancel')}
                </button>
              </div>
            </div>
          </ModalBody>
        </div>
      ) : resultText ? (
        <div className="flex flex-col h-full">
          <ModalBody>
            <div className="rounded-[2rem] bg-gray-900 border border-gray-800 p-8 shadow-2xl">
              <div className="flex items-center gap-3 mb-6 border-b border-gray-800 pb-4">
                <div className="p-2 bg-blue-500/10 rounded-xl">
                  <Sparkles className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white leading-none">{t('presentation.iaProposal')}</h3>
                  <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-black">{t('presentation.detailedPlan')}</p>
                </div>
              </div>
              <div className="text-gray-200 whitespace-pre-wrap max-h-[60vh] overflow-y-auto pr-4 custom-proposal-scroll leading-relaxed text-lg">
                {resultText.split('\n').map((line, i) => {
                  let className = "mb-1 block";
                  let content: React.ReactNode = line;

                  // Formateo manual simple
                  if (line.startsWith('#')) {
                    className = "text-2xl font-black text-blue-400 mt-6 mb-3 border-l-4 border-blue-600 pl-4 uppercase tracking-tight";
                    content = line.replace(/#/g, '').trim();
                  } else if (line.startsWith('**') || line.includes('**')) {
                    // Resaltar negritas y marcas de tiempo
                    const parts = line.split(/(\*\*.*?\*\*|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/g);
                    content = parts.map((part, idx) => {
                      if (part.startsWith('**') && part.endsWith('**')) {
                        return <strong key={idx} className="text-green-400 font-bold">{part.replace(/\*\*/g, '')}</strong>;
                      }
                      if (/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(part)) {
                        return <span key={idx} className="px-2 py-0.5 bg-yellow-500/10 text-yellow-500 rounded font-black text-sm border border-yellow-500/20 mx-1">{part}</span>;
                      }
                      return part;
                    });
                  } else if (line.trim().startsWith('-') || line.trim().startsWith('•')) {
                    className = "ml-4 mb-2 flex gap-2 items-start text-gray-300";
                    content = <><span className="text-blue-500 font-bold mt-1.5">•</span> <span>{line.trim().substring(1).trim()}</span></>;
                  }

                  return <span key={i} className={className}>{content}</span>;
                })}
              </div>
            </div>
            <style jsx global>{`
              .custom-proposal-scroll::-webkit-scrollbar {
                width: 4px;
              }
              .custom-proposal-scroll::-webkit-scrollbar-track {
                background: transparent;
              }
              .custom-proposal-scroll::-webkit-scrollbar-thumb {
                background: #3b82f6;
                border-radius: 10px;
              }
              .custom-proposal-scroll::-webkit-scrollbar-thumb:hover {
                background: #60a5fa;
              }
            `}</style>
          </ModalBody>
          <ModalFooter>
            <div className="flex justify-between w-full items-center">
              <p className="text-xs text-gray-500 italic">{t('presentation.copyScriptHelp')}</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setResultText(null)} className="px-6 py-2.5 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 transition-all font-bold">
                  Volver a Editar
                </button>
                <button type="button" onClick={handleClose} className="px-8 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-900/30 transition-all">
                  Entendido
                </button>
              </div>
            </div>
          </ModalFooter>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="relative flex flex-col h-full">
        {isSubmitting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-gray-900/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 text-white">
              <Loader2 className="w-12 h-12 animate-spin text-green-400" />
              <p className="font-medium">{t('presentation.generatingProposal')}</p>
              <p className="text-sm text-gray-400">{t('presentation.waitMoment')}</p>
            </div>
          </div>
        )}
        <ModalBody className="space-y-6">
          {/* Selector de modo */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => update({ mode: 'animation' })}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 ${
                form.mode === 'animation'
                  ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-300'
              }`}
            >
              <Film className="w-4 h-4" />{t('presentation.animationType')}</button>
            <button
              type="button"
              onClick={() => update({ mode: 'presentation' })}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-all flex items-center justify-center gap-2 ${
                form.mode === 'presentation'
                  ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-300'
              }`}
            >
              <ImageIcon className="w-4 h-4" />{t('presentation.slidesType')}</button>
          </div>

          {/* Título de la presentación */}
          <div>
            <label htmlFor="pres-title" className="block text-sm font-medium text-gray-300 mb-1">{t('presentation.pieceTitle')}</label>
            <input
              id="pres-title"
              type="text"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Ej: Estrategia Q4 2025"
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Prompt principal */}
          <div>
            <label htmlFor="pres-prompt" className="block text-sm font-medium text-gray-300 mb-1">
              {form.mode === 'presentation' ? t('presentation.scriptLabel') : t('presentation.goalLabel')} <span className="text-green-400">*</span>
            </label>
            <textarea
              id="pres-prompt"
              required
              value={form.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder={form.mode === 'presentation'
                ? t('presentation.scriptPlaceholder')
                : t('presentation.scriptHint')}
              rows={4}
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent resize-y min-h-[100px]"
            />
          </div>

          {/* Notas o texto adicional */}
          <div>
            <label htmlFor="pres-notes" className="block text-sm font-medium text-gray-300 mb-1">
              {t('presentation.scriptOptional')}
            </label>
            <textarea
              id="pres-notes"
              value={form.notes}
              onChange={(e) => update({ notes: e.target.value })}
              placeholder={t('presentation.animationScriptHint')}
              rows={3}
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent resize-y"
            />
          </div>

          {/* Estilo y número de diapositivas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pres-style" className="block text-sm font-medium text-gray-300 mb-1">
                {t('presentation.styleLabel')}
              </label>
              <select
                id="pres-style"
                value={form.style}
                onChange={(e) => update({ style: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                {STYLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.labelKey ? t(o.labelKey) : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pres-num" className="block text-sm font-medium text-gray-300 mb-1">{t('presentation.durationLabel')}</label>
              <input
                id="pres-num"
                type="number"
                min={5}
                max={600}
                value={form.numSlides}
                onChange={(e) =>
                  update({
                    numSlides: e.target.value === '' ? '' : Math.max(5, Math.min(600, parseInt(e.target.value, 10) || 5)),
                  })
                }
                placeholder="Ej: 60"
                className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Subida de archivos */}
          <div>
            <span className="block text-sm font-medium text-gray-300 mb-2">
              {form.mode === 'presentation'
                ? t('presentation.filesHint')
                : t('presentation.filesLabel')}
            </span>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center transition-colors relative',
                dragActive ? 'border-green-500 bg-green-500/10' : 'border-gray-600 bg-gray-800/50 hover:border-gray-500'
              )}
            >
              {filesAdding && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gray-900/80 z-[1]">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <Loader2 className="w-8 h-8 animate-spin text-green-400" />
                    <span className="text-sm">{t('presentation.addingFiles')}</span>
                  </div>
                </div>
              )}
              <input
                type="file"
                multiple
                accept={`${ACCEPT_DOCS},${ACCEPT_IMAGES},${ACCEPT_VIDEO},${ACCEPT_AUDIO}`}
                onChange={handleFileChange}
                ref={fileInputRef}
                className="hidden"
                id="pres-files"
              />
              <label
                htmlFor="pres-files"
                className={cn(
                  'cursor-pointer flex flex-col items-center gap-2 transition-colors',
                  filesAdding ? 'pointer-events-none opacity-50' : 'text-gray-400 hover:text-green-400'
                )}
              >
                <Upload className="w-10 h-10" />
                <span>{t('presentation.dropHint')}</span>
                <span className="text-xs">{t('presentation.acceptedTypes')}</span>
              </label>
            </div>

            {/* Lista siempre visible: {t('presentation.filesLoaded')} */}
            <div className="mt-4 rounded-xl border-2 border-gray-700 bg-gray-900/80 p-4">
              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <CheckCircle2 className={cn('w-4 h-4', fileList.length > 0 ? 'text-green-400' : 'text-gray-500')} />
                {t('presentation.filesLoaded')}
                <span className="text-gray-400 font-normal">({fileList.length})</span>
              </h4>
              {fileList.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">{t('presentation.noFiles')}</p>
              ) : (
                <ul ref={filesListRef} className="space-y-2">
                  {fileList.map((file, i) => (
                    <li
                      key={`${file.name}-${file.size}-${i}`}
                      className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-gray-800 border border-gray-700 text-white"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {fileTypeIcon(file)}
                        <span className="text-sm font-medium truncate">{file.name}</span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {file.size >= 1024 * 1024
                            ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                            : `${(file.size / 1024).toFixed(1)} KB`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/20 shrink-0"
                        aria-label="Quitar archivo"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Campos exclusivos para modo presentación */}
          {form.mode === 'presentation' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Audio de fondo */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  <Music className="w-3.5 h-3.5 inline mr-1" />
                  Audio de fondo (opcional)
                </label>
                <div className="border-2 border-dashed border-gray-600 rounded-xl p-4 text-center bg-gray-800/50 hover:border-gray-500 transition-colors">
                  <input
                    type="file"
                    accept={ACCEPT_AUDIO}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      update({ audioFile: file });
                    }}
                    className="hidden"
                    id="pres-audio"
                  />
                  <label htmlFor="pres-audio" className="cursor-pointer flex flex-col items-center gap-2 text-gray-400 hover:text-green-400 transition-colors">
                    <Upload className="w-6 h-6" />
                    <span className="text-xs">{form.audioFile ? form.audioFile.name : t('presentation.backgroundAudioHint')}</span>
                  </label>
                </div>
                {form.audioFile && (
                  <div className="mt-2 flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-800 border border-gray-700">
                    <div className="flex items-center gap-2 min-w-0">
                      <Music className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-sm font-medium truncate">{form.audioFile.name}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {form.audioFile.size >= 1024 * 1024
                          ? `${(form.audioFile.size / 1024 / 1024).toFixed(2)} MB`
                          : `${(form.audioFile.size / 1024).toFixed(1)} KB`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => update({ audioFile: null })}
                      className="p-1 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/20 shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Fondo de presentación */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  <Video className="w-3.5 h-3.5 inline mr-1" />{t('presentation.bgLabel')}</label>
                <div className="border-2 border-dashed border-gray-600 rounded-xl p-4 text-center bg-gray-800/50 hover:border-gray-500 transition-colors">
                  <input
                    type="file"
                    accept={`${ACCEPT_VIDEO},${ACCEPT_IMAGES}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      update({ backgroundFile: file });
                    }}
                    className="hidden"
                    id="pres-bg"
                  />
                  <label htmlFor="pres-bg" className="cursor-pointer flex flex-col items-center gap-2 text-gray-400 hover:text-green-400 transition-colors">
                    <Upload className="w-6 h-6" />
                    <span className="text-xs">{form.backgroundFile ? form.backgroundFile.name : t('presentation.bgHint')}</span>
                  </label>
                </div>
                {form.backgroundFile && (
                  <div className="mt-2 flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-800 border border-gray-700">
                    <div className="flex items-center gap-2 min-w-0">
                      {form.backgroundFile.type.startsWith('video/') ? (
                        <Video className="w-4 h-4 text-blue-400 shrink-0" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-green-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate">{form.backgroundFile.name}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {form.backgroundFile.size >= 1024 * 1024
                          ? `${(form.backgroundFile.size / 1024 / 1024).toFixed(2)} MB`
                          : `${(form.backgroundFile.size / 1024).toFixed(1)} KB`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => update({ backgroundFile: null })}
                      className="p-1 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/20 shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700/50 transition-colors"
          >
            {t('presentation.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.prompt.trim() || isSubmitting}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-green-600 to-yellow-500 hover:from-green-500 hover:to-yellow-400 text-white font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSubmitting ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {form.mode === 'presentation' ? t('presentation.generateSlides') : t('presentation.generateAnimation')}
          </button>
        </ModalFooter>
      </form>
      )}
    </Modal>
  );
}
