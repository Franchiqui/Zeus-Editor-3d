'use client';

import { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, CameraOff, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { imageDataToThumbnail } from '@/lib/gif-utils';
import { useI18n } from '@/lib/i18n';

interface WebcamCaptureProps {
  onFrameCaptured: (frame: { id: string; imageData: ImageData; thumbnail: string }) => void;
}

export function WebcamCapture({ onFrameCaptured }: WebcamCaptureProps) {
  const { t } = useI18n();
  const webcamRef = useRef<Webcam>(null);
  const [isActive, setIsActive] = useState(false);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const thumbnail = imageDataToThumbnail(imageData);

      onFrameCaptured({
        id: `${Date.now()}-${Math.random()}`,
        imageData,
        thumbnail,
      });
    };

    img.src = imageSrc;
  }, [onFrameCaptured]);

  return (
    <div className="space-y-6">
      <div className="flex justify-center gap-4">
        <Button
          onClick={() => setIsActive(!isActive)}
          variant={isActive ? 'destructive' : 'default'}
          className={!isActive ? "bg-green-600 hover:bg-green-500 text-black font-bold rounded-xl px-6" : "rounded-xl px-6"}
        >
          {isActive ? (
            <>
              <CameraOff className="w-4 h-4 mr-2" />
              {t('gifEditor.webcamStop')}
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 mr-2" />
              {t('gifEditor.webcamStart')}
            </>
          )}
        </Button>
        {isActive && (
          <Button onClick={capture} variant="secondary" className="bg-white hover:bg-gray-200 text-black font-bold rounded-xl px-6 shadow-lg shadow-white/10">
            <Circle className="w-4 h-4 mr-2 fill-red-500 stroke-red-500" />
            {t('gifEditor.webcamCapture')}
          </Button>
        )}
      </div>

      {isActive ? (
        <div className="relative rounded-2xl overflow-hidden bg-black border-4 border-gray-800 shadow-2xl aspect-video max-w-2xl mx-auto">
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            className="w-full h-full object-cover"
            videoConstraints={{
              width: 1280,
              height: 720,
              facingMode: 'user',
            }}
          />
          <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white">{t('gifEditor.webcamLive')}</span>
          </div>
        </div>
      ) : (
        <div className="aspect-video max-w-2xl mx-auto bg-gray-900/50 rounded-2xl border-2 border-dashed border-gray-800 flex flex-col items-center justify-center gap-4 text-gray-600">
           <Camera className="w-12 h-12 opacity-20" />
           <p className="text-sm font-bold uppercase tracking-widest opacity-30">{t('gifEditor.webcamOff')}</p>
        </div>
      )}
    </div>
  );
}
