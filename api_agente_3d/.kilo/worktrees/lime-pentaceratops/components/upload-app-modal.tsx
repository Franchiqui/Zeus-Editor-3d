'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import pb from '@/lib/pocketbase';
import { useI18n } from '@/lib/i18n';

interface UploadAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UploadAppModal({ isOpen, onClose }: UploadAppModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('web');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [dragOverZip, setDragOverZip] = useState(false);
  const [dragOverScreenshot, setDragOverScreenshot] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('web');
    setZipFile(null);
    setScreenshot(null);
    setScreenshotPreview(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (screenshotInputRef.current) screenshotInputRef.current.value = '';
  };

  const handleZipDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZip(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.zip')) {
      setZipFile(file);
    }
  };

  const handleScreenshotDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverScreenshot(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setScreenshot(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setScreenshotPreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !zipFile) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append('name', title);
      formData.append('description', description);
      formData.append('category', category);
      formData.append('zipFile', zipFile);
      if (screenshot) {
        formData.append('screenshot', screenshot);
      }

      await pb.collection('apps').create(formData);

      resetForm();
      onClose();
    } catch (err: any) {
      console.error('Error al crear app:', err);
      setSubmitError(err?.message || t('app.errPublish'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-lg mx-4 bg-gray-900 rounded-xl shadow-2xl border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">{t('app.uploadApp')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Captura */}
          <div>
            <Label className="text-sm font-medium text-gray-300 mb-2 block">Captura</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOverScreenshot ? 'border-red-500 bg-red-500/10' : 'border-gray-600 hover:border-gray-500'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOverScreenshot(true); }}
              onDragLeave={() => setDragOverScreenshot(false)}
              onDrop={handleScreenshotDrop}
              onClick={() => screenshotInputRef.current?.click()}
            >
              {screenshotPreview ? (
                <img src={screenshotPreview} alt="Preview" className="max-h-40 mx-auto rounded" />
              ) : (
                <div className="text-gray-400">
                  <svg className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">Arrastra una imagen o haz clic para seleccionar</p>
                </div>
              )}
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setScreenshot(file);
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setScreenshotPreview(event.target?.result as string);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </div>
          </div>

          {/* {t('app.titleLabel2')} */}
          <div>
            <Label htmlFor="title" className="text-sm font-medium text-gray-300 mb-2 block">{t('app.titleLabel2')}</Label>
            <Input
              id="title"
              className="w-full bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:border-red-500 focus:ring-red-500"
              placeholder="{t('app.appName')}"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* {t('app.descLabel')} */}
          <div>
            <Label htmlFor="description" className="text-sm font-medium text-gray-300 mb-2 block">{t('app.descLabel')}</Label>
            <textarea
              id="description"
              className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              rows={3}
              placeholder="{t('app.describeApp')}"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* {t('app.category')} */}
          <div>
            <Label htmlFor="category" className="text-sm font-medium text-gray-300 mb-2 block">{t('app.category')}</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="web">Web</option>
              <option value="mobile">{t('app.mobile')}</option>
              <option value="desktop">Escritorio</option>
              <option value="pagina-web">{t('app.webPage')}</option>
            </select>
          </div>

          {/* Archivo ZIP */}
          <div>
            <Label className="text-sm font-medium text-gray-300 mb-2 block">Archivo ZIP</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragOverZip ? 'border-red-500 bg-red-500/10' : 'border-gray-600 hover:border-gray-500'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOverZip(true); }}
              onDragLeave={() => setDragOverZip(false)}
              onDrop={handleZipDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {zipFile ? (
                <div className="text-gray-300">
                  <svg className="h-10 w-10 mx-auto mb-2 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-medium">{zipFile.name}</p>
                  <p className="text-xs text-gray-500">{(zipFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div className="text-gray-400">
                  <svg className="h-10 w-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm">Arrastra un archivo .zip o haz clic para seleccionar</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setZipFile(file);
                }}
              />
            </div>
          </div>

          {/* Error */}
          {submitError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {submitError}
            </div>
          )}

          {/* Botón de enviar */}
          <Button
            type="submit"
            className="w-full bg-red-600 hover:bg-red-700 text-white"
            disabled={!title || !description || !zipFile || !screenshot || isSubmitting}
          >
            {isSubmitting ? 'Publicando...' : t('app.publishApp')}
          </Button>
        </form>
      </div>
    </div>
  );
}