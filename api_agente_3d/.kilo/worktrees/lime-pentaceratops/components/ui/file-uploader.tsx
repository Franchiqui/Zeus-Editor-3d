'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, File, Image, Video, Music, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxSize?: number; // in MB
  className?: string;
}

export default function FileUploader({ 
  onFilesSelected, 
  accept = "image/*,video/*,audio/*", 
  multiple = true,
  maxSize = 100, // 100MB default
  className = ""
}: FileUploaderProps) {
  const { t } = useI18n();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > maxSize * 1024 * 1024) {
      return `El archivo ${file.name} excede el tamaño máximo de ${maxSize}MB`;
    }

    // Check file type
    const validTypes = accept.split(',').map(type => type.trim().toLowerCase());
    const isValidType = validTypes.some(type => {
      // Soporte para extensiones (ej: .txt, .pdf)
      if (type.startsWith('.')) {
        return file.name.toLowerCase().endsWith(type);
      }
      // Soporte para mime-types con comodín (ej: image/*)
      if (type.endsWith('/*')) {
        return file.type.startsWith(type.replace('/*', ''));
      }
      // Soporte para mime-types exactos (ej: application/pdf)
      return file.type === type;
    });

    if (!isValidType) {
      return `El archivo ${file.name} no es un tipo de archivo válido`;
    }

    return null;
  };

  const handleFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newErrors: string[] = [];
    const validFiles: File[] = [];

    fileArray.forEach(file => {
      const error = validateFile(file);
      if (error) {
        newErrors.push(error);
      } else {
        validFiles.push(file);
      }
    });

    setErrors(newErrors);
    
    if (validFiles.length > 0) {
      setSelectedFiles(prev => multiple ? [...prev, ...validFiles] : validFiles);
      onFilesSelected(validFiles);
    }

    // Clear errors after 5 seconds
    if (newErrors.length > 0) {
      setTimeout(() => setErrors([]), 5000);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <Image className="w-4 h-4" />;
    if (file.type.startsWith('video/')) return <Video className="w-4 h-4" />;
    if (file.type.startsWith('audio/')) return <Music className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive 
            ? 'border-green-500 bg-green-500/10' 
            : 'border-gray-600 hover:border-gray-500'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
        
        <div className="space-y-4">
          <Upload className="w-12 h-12 mx-auto text-green-400" />
          <div>
            <p className="text-lg font-medium text-white mb-2">
              {t('app.dropFilesHere')}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              o busca en tu dispositivo
            </p>
          </div>
          
          <Button onClick={openFileDialog} className="bg-green-600 hover:bg-green-700">
            <Upload className="w-4 h-4 mr-2" />
            Seleccionar Archivos
          </Button>
          
          <p className="text-xs text-gray-500">
            Formatos aceptados: {accept.replace(/\*/g, '•')} • Máximo {maxSize}MB
          </p>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500 rounded-lg p-3">
          <p className="text-red-400 text-sm font-medium mb-1">Errores:</p>
          <ul className="text-red-300 text-xs space-y-1">
            {errors.map((error, index) => (
              <li key={index}>• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Selected Files Preview */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-300">
            Archivos seleccionados ({selectedFiles.length})
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-gray-800 rounded-lg p-3"
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div className="text-green-400">
                    {getFileIcon(file)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{file.name}</p>
                    <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(index)}
                  className="text-gray-400 hover:text-red-400 h-8 w-8 p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
