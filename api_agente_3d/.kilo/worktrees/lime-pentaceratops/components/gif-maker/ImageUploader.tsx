'use client';

import { useCallback } from 'react';
import { Upload, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadImageFromFile, imageDataToThumbnail } from '@/lib/gif-utils';
import { useI18n } from '@/lib/i18n';

interface ImageUploaderProps {
  onImagesAdded: (images: { id: string; imageData: ImageData; thumbnail: string }[]) => void;
}

export function ImageUploader({ onImagesAdded }: ImageUploaderProps) {
  const { t } = useI18n();
  const handleFiles = useCallback(
    async (files: FileList) => {
      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith('image/')
      );

      const loadedImages = await Promise.all(
        imageFiles.map(async (file) => {
          const imageData = await loadImageFromFile(file);
          const thumbnail = imageDataToThumbnail(imageData);
          return {
            id: `${Date.now()}-${Math.random()}`,
            imageData,
            thumbnail,
          };
        })
      );

      onImagesAdded(loadedImages);
    },
    [onImagesAdded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles]
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className="border-2 border-dashed border-gray-800 rounded-2xl p-12 text-center hover:border-green-500/50 transition-all bg-gray-900/50 group"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="p-4 bg-gray-800 rounded-full group-hover:scale-110 transition-transform">
          <ImageIcon className="w-8 h-8 text-green-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold mb-2 text-white">{t('gifEditor.uploadTitle')}</h3>
          <p className="text-sm text-gray-500 mb-6 font-medium">
            {t('gifEditor.uploadDropHint')}
          </p>
        </div>
        <label htmlFor="file-upload">
          <Button type="button" asChild variant="default" className="rounded-xl px-8 h-12 transition-all font-bold uppercase text-xs tracking-widest">
            <span className="cursor-pointer flex items-center">
              <Upload className="w-4 h-4 mr-2" />
              {t('gifEditor.uploadSelectBtn')}
            </span>
          </Button>
        </label>
        <input
          id="file-upload"
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>
    </div>
  );
}
