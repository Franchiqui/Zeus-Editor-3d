'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { AudioEditState, TimelineState, TimelineTrack, TimelineClip } from '@/types';
import AudioVisualizer from '@/components/ui/AudioVisualizer';
import ZeusEQ from '@/components/nexus-eq-standalone';
import Timeline from '@/components/editor/Timeline';
import TimelinePlayer from '@/components/editor/TimelinePlayer';
import {
  Play, Pause, Volume2, RotateCcw, FastForward, Save, X, Music, Trash2, FolderOpen, Loader2, Download, ChevronLeft, Folder, FileAudio, Mic, Plus, Sparkles
} from 'lucide-react';
import pb from '@/lib/pocketbase';
import { Modal } from '@/components/ui/modal';
import FileUploader from '@/components/ui/file-uploader';
import { useToast } from '@/hooks/use-toast';
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import TecladoMidi from '@/components/teclado-midi';
import {
  getLocalPaths, listDirectory, getMediaUrl, readProject, saveProject, writeFile,
  copyFile, ensureDir, getFilePath, readFileBuffer, deleteFile,
  checkDemucs, installDemucs, separateAudio, cancelSeparate, DemucsModel, DemucsStem,
  exportAudioToMp3
} from '@/lib/electron-fs';
import { audioBufferToWav } from '@/lib/audio-export';
import GenerateMusicModal from '@/components/GenerateMusicModal';
import { GenerateMusicResult, MusicGeneratorConfig, GenerateLoopResult, LoopCatalogItem } from '@/lib/procedural-music';
import { useI18n } from '@/lib/i18n';

type AudioEditorProps = {
  audioUrl: string;
  initialEditState?: AudioEditState;
  /** Cola inicial desde el explorador: añade todos estos archivos a la lista de reproducción al montar */
  initialQueue?: { url: string; fileName: string }[];
  onSave: (editState: AudioEditState) => void;
  onCancel: () => void;
  onOpenMusicLibrary?: () => void;
  pendingExternalTrack?: { url: string; fileName: string } | null;
  onExternalTrackAdded?: () => void;
};

type ExtendedAudioEditState = AudioEditState & {
  playbackRate: number;
  trimStart: number;
  trimEnd: number;
  timeline?: TimelineState;
};

function loadAudioMetadata(url: string): Promise<{ duration: number }> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.style.display = 'none';
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audio.src = url;
    document.body.appendChild(audio);

    let settled = false;
    const done = (duration: number) => {
      if (settled) return;
      settled = true;
      document.body.removeChild(audio);
      resolve({ duration });
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      document.body.removeChild(audio);
      resolve({ duration: 180 });
    };

    audio.onloadedmetadata = () => {
      const dur = audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        done(dur);
      } else {
        fail();
      }
    };

    audio.onerror = fail;

    setTimeout(() => {
      if (!settled && audio.readyState < 1) {
        fail();
      }
    }, 5000);
  });
}

const SaveAudioProjectForm = ({ onSave, onClose, isSaving, initialFiles = [] }: { onSave: (title: string, files: File[]) => void, onClose: () => void, isSaving: boolean, initialFiles?: File[] }) => {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [manualFiles, setManualFiles] = useState<File[]>(initialFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFilesToList = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setManualFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setManualFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6 p-6 text-white max-h-[80vh] overflow-y-auto custom-scrollbar">
      <div className="space-y-3">
        <Label className="text-xs font-bold uppercase text-gray-500 tracking-widest">{t('audioEditor.projectName')}</Label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('audioEditor.projectNamePlaceholder')}
          className="w-full bg-gray-900 border border-gray-800 p-4 rounded-2xl text-white text-lg outline-none focus:ring-2 focus:ring-green-500 shadow-inner"
          autoFocus
        />
      </div>

      <div className="space-y-4 p-4 bg-blue-500/5 border-2 border-dashed border-blue-500/20 rounded-2xl">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] flex items-center gap-2">
            <Music className="w-3 h-3" /> {t('audioEditor.filesToPack')}
          </label>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[9px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-black uppercase tracking-widest transition-all"
          >
            {t('audioEditor.addAudio')}
          </button>
          <input type="file" ref={fileInputRef} onChange={addFilesToList} multiple accept="audio/*" className="hidden" />
        </div>

        {manualFiles.length > 0 ? (
          <div className="space-y-2">
            {manualFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-950 p-2 rounded-xl border border-gray-800 group">
                <div className="flex items-center gap-3 truncate">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Music className="w-4 h-4 text-blue-400" />
                  </div>
                  <span className="text-xs font-bold text-gray-300 truncate">{f.name}</span>
                </div>
                <button onClick={() => removeFile(i)} className="p-2 text-gray-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center py-4 text-[10px] text-gray-600 uppercase font-bold italic">{t('audioEditor.noFilesSelected')}</p>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button variant="ghost" onClick={onClose} className="font-bold uppercase text-[10px] tracking-widest">{t('audioEditor.cancel')}</Button>
        <Button
          onClick={() => onSave(title, manualFiles)}
          disabled={isSaving || !title.trim()}
          className="bg-green-600 hover:bg-green-700 h-12 px-8 font-black uppercase tracking-[0.2em] shadow-lg shadow-green-900/20"
        >
          {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
          {t('audioEditor.createLocalProject')}
        </Button>
      </div>
    </div>
  );
};

export default function AudioEditor({ audioUrl, initialEditState, initialQueue, onSave, onCancel, onOpenMusicLibrary, pendingExternalTrack, onExternalTrackAdded }: AudioEditorProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  // 1. ESTADOS
  const [editState, setEditState] = useState<ExtendedAudioEditState>(() => {
    const defaultTimeline: TimelineState = {
      duration: 0, currentTime: 0, zoom: 100,
      tracks: [{ id: 'audio-1', type: 'audio', name: t('audioEditor.trackN', { n: 1 }), clips: [], isMuted: false, isLocked: false, volume: 1 }]
    };
    if (!initialEditState) return { volume: 1, fadeInDuration: 0, fadeOutDuration: 0, playbackRate: 1, trimStart: 0, trimEnd: 0, timeline: defaultTimeline };
    return { ...initialEditState, playbackRate: 1, trimStart: initialEditState.trimStart || 0, trimEnd: initialEditState.trimEnd || 0, timeline: initialEditState.timeline || defaultTimeline };
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [audioContext, setAudioContext] = useState<AudioContext | undefined>(undefined);
  const [audioSource, setAudioSource] = useState<AudioNode | undefined>(undefined);
  const [eqFilters, setEqFilters] = useState<BiquadFilterNode[]>([]);
  const [eqBands, setEqBands] = useState<any[]>([]);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [uploaderLocalFiles, setUploaderLocalFiles] = useState<any[]>([]);
  const [uploaderLocalLoading, setUploaderLocalLoading] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [savedProjects, setSavedProjects] = useState<any[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [clipboardClip, setClipboardClip] = useState<TimelineClip | null>(null);
  const [isEQBypassed, setIsEQBypassed] = useState(false);
  const [vizColor, setVizColor] = useState<string>('#22c55e');
  const [loadType, setLoadType] = useState<'proyectos' | 'archivos' | 'local'>('proyectos');
  const [loadArchivosStep, setLoadArchivosStep] = useState<'collection' | 'record' | 'file' | 'local'>('collection');
  const [audioCollections, setAudioCollections] = useState<{ id: string; name: string }[]>([]);
  const [selectedAudioCollection, setSelectedAudioCollection] = useState<string | null>(null);
  const [audioRecords, setAudioRecords] = useState<{ recordId: string; recordName: string; files: { url: string; fileName: string }[] }[]>([]);
  const [selectedRecordFiles, setSelectedRecordFiles] = useState<{ url: string; fileName: string }[] | null>(null);
  const [localFolderFiles, setLocalFolderFiles] = useState<any[]>([]);
  const [pbLoading, setPbLoading] = useState(false);
  const [isAddingAllToQueue, setIsAddingAllToQueue] = useState(false);
  const [addingRecordId, setAddingRecordId] = useState<string | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string>(t('audioEditor.noTrackLoaded'));
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportConfig, setExportConfig] = useState<{ title: string; format: 'wav' | 'mp3' | 'mp3-local' }>({ title: 'mi_mezcla_audio', format: 'wav' });
  const [micEnabled, setMicEnabled] = useState(false);
  const [showMidiKeyboard, setShowMidiKeyboard] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGenerateMusicModalOpen, setIsGenerateMusicModalOpen] = useState(false);
  const [isSeparateModalOpen, setIsSeparateModalOpen] = useState(false);
  const [demucsAvailable, setDemucsAvailable] = useState<boolean | null>(null);
  const [demucsMessage, setDemucsMessage] = useState<string>('');
  const [selectedDemucsModel, setSelectedDemucsModel] = useState<DemucsModel>('htdemucs');
  const [isSeparating, setIsSeparating] = useState(false);
  const [separateProgress, setSeparateProgress] = useState(0);
  const [separateStatus, setSeparateStatus] = useState('');
  const [separateJobId, setSeparateJobId] = useState('');
  const [isInstallingDemucs, setIsInstallingDemucs] = useState(false);

  const fileCache = useRef<Map<string, File>>(new Map());
  const micStreamRef = useRef<MediaStream | null>(null);
  const [headerMounted, setHeaderMounted] = useState(false);
  useEffect(() => setHeaderMounted(true), []);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    if (!pendingExternalTrack) return;
    let cancelled = false;
    const process = async () => {
      try {
        let finalUrl = pendingExternalTrack.url;
        let tempBlobUrl: string | null = null;

        // Convert Tunetank URLs to proxy URLs to avoid CORS
        if (finalUrl.includes('tunetank.com') || finalUrl.includes('d1s1y0ui543e5o.cloudfront.net')) {
          finalUrl = `/api/tunetank-audio?url=${encodeURIComponent(finalUrl)}`;
        }

        if (finalUrl.startsWith('http')) {
          try {
            const response = await fetch(finalUrl);
            const blob = await response.blob();
            const file = new File([blob], pendingExternalTrack.fileName, { type: blob.type || 'audio/mpeg' });
            tempBlobUrl = URL.createObjectURL(blob);
            fileCache.current.set(pendingExternalTrack.url, file);
            finalUrl = tempBlobUrl;
          } catch (fetchError) {
            console.warn('No se pudo pre-descargar el audio externo, se intentará con la URL directa:', fetchError);
            toast({
              title: t('audioEditor.toastWarnTitle'),
              description: t('audioEditor.toastWarnPreloadDesc'),
            });
            finalUrl = await cacheLocalMediaUrl(finalUrl);
          }
        } else {
          finalUrl = await cacheLocalMediaUrl(finalUrl);
        }

        const { duration } = await loadAudioMetadata(finalUrl);
        if (tempBlobUrl) URL.revokeObjectURL(tempBlobUrl);
        if (cancelled) return;
        const realDuration = duration;
        setIsPlaying(false);
        const clipId = `clip-${Date.now()}`;
        const newTrackId = `track-${Date.now()}`;
        setEditState(prev => {
          if (!prev.timeline) return prev;
          const newTrack: TimelineTrack = {
            id: newTrackId,
            type: 'audio',
            name: t('audioEditor.trackN', { n: prev.timeline.tracks.length + 1 }),
            clips: [{
              id: clipId,
              trackId: newTrackId,
              type: 'audio',
              mediaFileId: pendingExternalTrack!.url,
              startTime: 0,
              duration: realDuration,
              sourceStartTime: 0,
              sourceDuration: realDuration,
              volume: 1,
              playbackRate: 1,
              label: pendingExternalTrack!.fileName,
              overlayTint: undefined
            }],
            isMuted: false,
            isLocked: false,
            volume: 1
          };
          return {
            ...prev,
            timeline: {
              ...prev.timeline,
              currentTime: prev.timeline.currentTime,
              duration: Math.max(prev.timeline.duration, realDuration),
              tracks: [...prev.timeline.tracks, newTrack],
            },
          };
        });
        setLoadedFileName(pendingExternalTrack.fileName);
        setSelectedClipId(clipId);
        toast({
          title: t('audioEditor.toastSongAddedTitle'),
          description: t('audioEditor.toastSongAddedDesc', { fileName: pendingExternalTrack.fileName }),
        });
        onExternalTrackAdded?.();
      } catch (e) {
        console.error('Error adding external track:', e);
        toast({
          title: t('audioEditor.toastErrorTitle'),
          description: t('audioEditor.toastAddSongErrorDesc'),
          variant: 'destructive',
        });
      }
    };
    process();
    return () => { cancelled = true; };
  }, [pendingExternalTrack, onExternalTrackAdded, toast, t]);

  // 2. CALLBACKS
  const handleTimelineChange = useCallback((timeline: TimelineState) => {
    setEditState(prev => ({ ...prev, timeline }));
    setCurrentTime(timeline.currentTime);
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
    setEditState(prev => ({ ...prev, timeline: { ...prev.timeline!, currentTime: time } }));
  }, []);

  const handleAddTrack = useCallback(() => {
    setEditState(prev => {
      const newTrack: TimelineTrack = { id: `audio-${Date.now()}`, type: 'audio', name: t('audioEditor.trackN', { n: prev.timeline!.tracks.length + 1 }), clips: [], isMuted: false, isLocked: false, volume: 1 };
      return { ...prev, timeline: { ...prev.timeline!, tracks: [...prev.timeline!.tracks, newTrack] } };
    });
  }, []);

  const handleAdjustDuration = useCallback(() => {
    setEditState(prev => {
      if (!prev.timeline) return prev;
      let maxEnd = 0;
      for (const track of prev.timeline.tracks) {
        for (const clip of track.clips) {
          const end = clip.startTime + clip.duration;
          if (end > maxEnd) maxEnd = end;
        }
      }
      if (maxEnd <= 0) {
        return { ...prev, timeline: { ...prev.timeline, duration: 0 } };
      }
      const newDuration = Math.max(maxEnd, 1);
      return { ...prev, timeline: { ...prev.timeline, duration: newDuration } };
    });
  }, []);

  const handleAddClip = useCallback((trackId: string, clip: any) => {
    const newClip = { ...clip, id: `clip-${Date.now()}`, trackId };
    setEditState(prev => ({ ...prev, timeline: { ...prev.timeline!, tracks: prev.timeline!.tracks.map(t => t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t) } }));
    setSelectedClipId(newClip.id);
  }, []);

  const handleUpdateClip = useCallback((clipId: string, updates: Partial<TimelineClip>) => {
    // Clip bloqueado: sólo se permite cambiar el propio candado.
    const existing = editState.timeline?.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (existing?.locked && !Object.keys(updates).every(k => k === 'locked')) return;
    setEditState(prev => {
      if (!prev.timeline) return prev;
      let movedClip: TimelineClip | null = null;
      let sourceTrackId: string | null = null;
      const newTracks = prev.timeline.tracks.map(track => {
        const idx = track.clips.findIndex(c => c.id === clipId);
        if (idx === -1) return track;
        const clip = track.clips[idx];
        if (updates.trackId && updates.trackId !== track.id) {
          movedClip = { ...clip, ...updates };
          sourceTrackId = track.id;
          return { ...track, clips: track.clips.filter(c => c.id !== clipId) };
        }
        return { ...track, clips: track.clips.map(c => c.id === clipId ? { ...c, ...updates } : c) };
      });
      if (movedClip && sourceTrackId) {
        return {
          ...prev,
          timeline: {
            ...prev.timeline,
            tracks: newTracks.map(t => t.id === movedClip!.trackId ? { ...t, clips: [...t.clips, movedClip!] } : t)
          }
        };
      }
      return { ...prev, timeline: { ...prev.timeline, tracks: newTracks } };
    });
  }, [editState.timeline]);

  const handleCopyClip = useCallback((clipId: string) => {
    setEditState(prev => {
      if (!prev.timeline) return prev;
      const clip = prev.timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
      if (clip) setClipboardClip({ ...clip });
      return prev;
    });
  }, []);

  const handlePasteClip = useCallback(() => {
    if (!clipboardClip || !editState.timeline) return;
    setEditState(prev => {
      if (!prev.timeline) return prev;
      const sourceTrack = prev.timeline.tracks.find(t => t.clips.some(c => c.id === clipboardClip.id));
      const targetTrackId = sourceTrack?.id || prev.timeline.tracks[0]?.id;
      if (!targetTrackId) return prev;
      const newClip: TimelineClip = {
        ...clipboardClip,
        id: `clip-${Date.now()}`,
        trackId: targetTrackId,
        startTime: prev.timeline.currentTime,
      };
      return {
        ...prev,
        timeline: {
          ...prev.timeline,
          tracks: prev.timeline.tracks.map(t => t.id === targetTrackId ? { ...t, clips: [...t.clips, newClip] } : t),
        },
      };
    });
    setSelectedClipId(clipboardClip.id);
  }, [clipboardClip, editState.timeline]);

  const handleDeleteClip = useCallback((clipId: string) => {
    if (editState.timeline?.tracks.flatMap(t => t.clips).find(c => c.id === clipId)?.locked) return;
    setEditState(prev => ({ ...prev, timeline: { ...prev.timeline!, tracks: prev.timeline!.tracks.map(t => ({ ...t, clips: t.clips.filter(c => c.id !== clipId) })) } }));
    if (selectedClipId === clipId) setSelectedClipId(null);
  }, [selectedClipId, editState.timeline]);

  const handleSplitClip = useCallback((clipId: string, splitTime: number) => {
    if (editState.timeline?.tracks.flatMap(t => t.clips).find(c => c.id === clipId)?.locked) return;
    setEditState(prev => {
      const tracks = prev.timeline!.tracks.map(track => {
        const idx = track.clips.findIndex(c => c.id === clipId);
        if (idx === -1) return track;
        const clip = track.clips[idx];
        const rel = splitTime - clip.startTime;
        if (rel <= 0 || rel >= clip.duration) return track;
        const playbackRate = clip.playbackRate || 1;
        const sourceStart = clip.sourceStartTime || 0;
        const c1 = {
          ...clip,
          duration: rel,
          sourceStartTime: sourceStart,
          sourceDuration: rel * playbackRate,
        };
        const c2 = {
          ...clip,
          id: `clip-split-${Date.now()}`,
          startTime: splitTime,
          duration: clip.duration - rel,
          sourceStartTime: sourceStart + rel * playbackRate,
          sourceDuration: (clip.sourceDuration || clip.duration * playbackRate) - rel * playbackRate,
        };
        const nc = [...track.clips];
        nc.splice(idx, 1, c1, c2);
        return { ...track, clips: nc };
      });

      let minDuration = prev.timeline!.duration;
      for (const track of tracks) {
        for (const clip of track.clips) {
          const end = clip.startTime + clip.duration;
          if (end > minDuration) minDuration = end;
        }
      }

      return { ...prev, timeline: { ...prev.timeline!, tracks, duration: minDuration } };
    });
  }, [editState.timeline]);

  const handleMergeClips = useCallback((clipIdA: string, clipIdB: string) => {
    const clips = editState.timeline?.tracks.flatMap(t => t.clips);
    if (clips?.find(c => c.id === clipIdA)?.locked || clips?.find(c => c.id === clipIdB)?.locked) return;
    setEditState(prev => {
      const timeline = prev.timeline!;
      const clipA = timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipIdA);
      const clipB = timeline.tracks.flatMap(t => t.clips).find(c => c.id === clipIdB);
      if (!clipA || !clipB || clipA.trackId !== clipB.trackId || clipA.mediaFileId !== clipB.mediaFileId) return prev;
      const track = timeline.tracks.find(t => t.id === clipA.trackId);
      if (!track || !track.clips.includes(clipA) || !track.clips.includes(clipB)) return prev;
      const [first, second] = clipA.startTime <= clipB.startTime ? [clipA, clipB] : [clipB, clipA];
      const mergedClip = {
        ...first,
        id: `clip-merged-${Date.now()}`,
        startTime: first.startTime,
        duration: first.duration + second.duration,
        sourceStartTime: first.sourceStartTime ?? 0,
        sourceDuration: (first.sourceDuration ?? first.duration * (first.playbackRate ?? 1)) +
          (second.sourceDuration ?? second.duration * (second.playbackRate ?? 1)),
        playbackRate: first.playbackRate ?? 1
      };
      const newClips = track.clips.filter(c => c.id !== clipIdA && c.id !== clipIdB);
      newClips.push(mergedClip);
      newClips.sort((a, b) => a.startTime - b.startTime);
      return {
        ...prev,
        timeline: { ...timeline, tracks: timeline.tracks.map(t => t.id === track.id ? { ...t, clips: newClips } : t) }
      };
    });
    if (selectedClipId === clipIdA || selectedClipId === clipIdB) setSelectedClipId(null);
  }, [selectedClipId, editState.timeline]);

  const handleSnapToStart = useCallback((trackId: string) => {
    setEditState(prev => {
      if (!prev.timeline) return prev;
      const track = prev.timeline.tracks.find(t => t.id === trackId);
      if (!track || track.clips.length === 0) return prev;
      // "Traer clips al inicio": imán que cierra huecos. Los clips
      // bloqueados individualmente se quedan fijos; el resto se compacta
      // desde 0 rellenando huecos sin solaparse con los bloqueados.
      const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
      const lockedRanges = sorted
        .filter(c => c.locked)
        .map(c => ({ start: c.startTime, end: c.startTime + c.duration }));
      let cursor = 0;
      const startById = new Map<string, number>();
      for (const clip of sorted) {
        if (clip.locked) {
          startById.set(clip.id, clip.startTime);
          cursor = Math.max(cursor, clip.startTime + clip.duration);
          continue;
        }
        let s = Math.max(cursor, 0);
        let collided = true;
        while (collided) {
          collided = false;
          for (const r of lockedRanges) {
            if (s < r.end && s + clip.duration > r.start) {
              s = r.end;
              collided = true;
              break;
            }
          }
        }
        startById.set(clip.id, s);
        cursor = s + clip.duration;
      }
      const updatedClips = track.clips.map(clip => ({ ...clip, startTime: startById.get(clip.id) ?? clip.startTime }));
      return { ...prev, timeline: { ...prev.timeline, tracks: prev.timeline.tracks.map(t => t.id === trackId ? { ...t, clips: updatedClips } : t) } };
    });
  }, []);

  const handleDeleteTrack = useCallback((trackId: string) => {
    setEditState(prev => {
      if (!prev.timeline) return prev;
      const track = prev.timeline.tracks.find(t => t.id === trackId);
      if (!track) return prev;
      // Limpiar selección si el clip seleccionado pertenecía a esta pista
      const hadSelectedClip = track.clips.some(c => c.id === selectedClipId);
      if (hadSelectedClip) {
        // Deferimos el setState para no llamarlo dentro del updater
        setTimeout(() => setSelectedClipId(null), 0);
      }
      return {
        ...prev,
        timeline: {
          ...prev.timeline,
          tracks: prev.timeline.tracks.filter(t => t.id !== trackId),
        },
      };
    });
  }, [selectedClipId]);

  const handleMoveTrack = useCallback((trackId: string, direction: 'up' | 'down') => {
    setEditState(prev => {
      if (!prev.timeline) return prev;
      const tracks = [...prev.timeline.tracks];
      const idx = tracks.findIndex(t => t.id === trackId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= tracks.length) return prev;
      [tracks[idx], tracks[targetIdx]] = [tracks[targetIdx], tracks[idx]];
      return { ...prev, timeline: { ...prev.timeline, tracks } };
    });
  }, []);

  const handleBandChange = useCallback((id: string, value: number) => {
    setEqBands(prev => prev.map(b => b.id === id ? { ...b, value } : b));
    const initialBandsList = [{ id: 'sub', freq: 32 }, { id: 'bass', freq: 64 }, { id: 'low-mid', freq: 250 }, { id: 'mid', freq: 1000 }, { id: 'high-mid', freq: 4000 }, { id: 'presence', freq: 8000 }, { id: 'brilliance', freq: 16000 }];
    const bandIndex = initialBandsList.findIndex(b => b.id === id);
    if (bandIndex !== -1 && eqFilters[bandIndex] && audioContext) {
      eqFilters[bandIndex].gain.setTargetAtTime(value, audioContext.currentTime, 0.05);
    }
  }, [eqFilters, audioContext]);

  // 3. MEMOS
  const selectedClip = useMemo(() => {
    if (selectedClipId && editState.timeline) {
      for (const track of editState.timeline.tracks) {
        const clip = track.clips.find(c => c.id === selectedClipId);
        if (clip) return clip;
      }
    }
    return editState.timeline?.tracks?.[0]?.clips?.[0] || null;
  }, [selectedClipId, editState.timeline]);

  const clipAtCurrentTime = useMemo(() => {
    const track = editState.timeline?.tracks?.[0];
    if (!track) return null;
    return track.clips.find(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration) ?? null;
  }, [editState.timeline, currentTime]);

  const displayTitle = useMemo(() => {
    if (clipAtCurrentTime?.label) return clipAtCurrentTime.label;
    if (clipAtCurrentTime?.mediaFileId) {
      try {
        const p = new URL(clipAtCurrentTime.mediaFileId).pathname;
        const name = decodeURIComponent(p).split('/').filter(Boolean).pop();
        if (name) return name;
      } catch {}
    }
    return loadedFileName || t('audioEditor.noTrackLoaded');
  }, [clipAtCurrentTime, loadedFileName]);

  const sortedClips = useMemo(() => {
    const track = editState.timeline?.tracks?.[0];
    if (!track) return [];
    return [...(track.clips || [])].sort((a, b) => a.startTime - b.startTime);
  }, [editState.timeline]);

  const goToPrevClip = useCallback(() => {
    if (sortedClips.length === 0) return;
    const idx = sortedClips.findIndex(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
    const targetIdx = idx < 0 ? sortedClips.length - 1 : Math.max(0, idx - 1);
    handleTimeUpdate(sortedClips[targetIdx].startTime);
  }, [sortedClips, currentTime, handleTimeUpdate]);

  const goToNextClip = useCallback(() => {
    if (sortedClips.length === 0) return;
    const idx = sortedClips.findIndex(c => currentTime >= c.startTime && currentTime < c.startTime + c.duration);
    const targetIdx = idx < 0 ? 0 : Math.min(sortedClips.length - 1, idx + 1);
    handleTimeUpdate(sortedClips[targetIdx].startTime);
  }, [sortedClips, currentTime, handleTimeUpdate]);

  const memoizedTimelineComp = useMemo(() => (
    <Timeline 
      timeline={editState.timeline!}
      onTimelineChange={handleTimelineChange}
      onAddTrack={handleAddTrack}
      onAddClip={handleAddClip}
      onUpdateClip={handleUpdateClip}
      onDeleteClip={handleDeleteClip}
      onDeleteTrack={handleDeleteTrack}
      onMoveTrack={handleMoveTrack}
      onSnapToStart={handleSnapToStart}
      onSplitClip={handleSplitClip}
      onMergeClips={handleMergeClips}
      onCopyClip={handleCopyClip}
      onPasteClip={handlePasteClip}
      onPlayPause={setIsPlaying}
      allowedTrackTypes={['audio']}
      onAddFile={() => setIsUploaderOpen(true)}
      onAdjustDuration={handleAdjustDuration}
      selectedClipId={selectedClipId}
      onSelectClip={setSelectedClipId}
      isBypassed={isEQBypassed}
      showClipSkipButtons={true}
      autoScrollToPlayhead={true}
      microphoneToggle={{ enabled: micEnabled, onToggle: setMicEnabled }}
    />
  ), [editState.timeline, handleTimelineChange, handleAddTrack, handleAddClip, handleUpdateClip, handleDeleteClip, handleDeleteTrack, handleMoveTrack, handleSnapToStart, handleSplitClip, handleMergeClips, selectedClipId, isEQBypassed, micEnabled]);

  // 4. EFFECTS
  useEffect(() => {
    setMounted(true);

    // Auto-cargar proyecto si hay parámetros en la URL
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('projectId');
    const isLocalProject = params.get('isLocalProject');
    const localProjectName = params.get('projectName');
    const localProjectPath = params.get('projectPath');

    if (isLocalProject === 'true' && localProjectPath) {
      console.log('📂 Auto-cargando proyecto de audio local:', localProjectName);
      loadFullProjectLocal({ name: localProjectName, path: localProjectPath });
    } else if (projectId) {
      pb.collection('proyectos').getOne(projectId, { requestKey: null }).then((record) => {
        const data = typeof record.file === 'string' ? JSON.parse(record.file) : record.file;
        if (data.editState) {
          setEditState(data.editState);
        }
      }).catch(e => console.error('Error cargando proyecto de audio:', e));
    }
  }, []);

  async function loadFullProjectLocal(project: any) {
    setIsLoadingProjects(true);
    console.log("📥 [AudioEditor] Cargando proyecto local:", project.name);
    try {
      const projectPath = project.path;
      const data = await readProject(projectPath);
      if (!data) throw new Error(t('audioEditor.alertReadZeusError'));

      const assetsFolderPath = `${projectPath}${projectPath.includes('\\') ? '\\' : '/'}assets`;
      const assets = await listDirectory(assetsFolderPath);
      const availableAssets = assets || [];
      console.log("📦 [AudioEditor] Assets locales encontrados:", availableAssets.length);

      const findAssetByName = (originalUrlOrPath: string) => {
        if (!originalUrlOrPath || typeof originalUrlOrPath !== 'string') return null;
        const fileName = originalUrlOrPath.split(/[/\\]/).pop()?.split('?')[0];
        if (!fileName) return null;
        const found = availableAssets.find((a: any) => a.name === fileName);
        return found ? getMediaUrl(found.path) : null;
      };

      let projectData = data.editState || data;
      
      // Si projectData tiene un editState dentro, bajar un nivel más
      if (projectData.editState && !projectData.timeline) {
        projectData = projectData.editState;
      }

      console.log("🔍 [AudioEditor] Estructura de datos detectada:", projectData.timeline ? 'Timeline encontrado' : 'Timeline NO encontrado');

      if (projectData.timeline) {
        // 1. Descargar y cachear archivos para que el reproductor funcione
        const tracks = projectData.timeline.tracks || [];
        for (const track of tracks) {
          const clips = track.clips || [];
          for (const clip of clips) {
            const localUrl = findAssetByName(clip.mediaFileId);
            if (localUrl) {
              clip.mediaFileId = localUrl;
              console.log("🔗 [AudioEditor] Cargando asset en memoria:", clip.label);
              
              try {
                // Forzamos la descarga del archivo para tenerlo en el caché del navegador y del editor
                const res = await fetch(localUrl);
                const blob = await res.blob();
                // Creamos un objeto File real a partir del blob del servidor local
                const file = new File([blob], clip.label || 'audio-asset', { type: blob.type || 'audio/wav' });
                
                // ES CRUCIAL: El reproductor busca el archivo por su URL en el cache
                fileCache.current.set(localUrl, file);
                
                // También intentamos crear una URL de objeto local por si la URL del bridge da problemas de CORS/Headers
                const objectUrl = URL.createObjectURL(blob);
                fileCache.current.set(objectUrl, file);
                // Opcional: podrías usar objectUrl en clip.mediaFileId si el bridge falla, 
                // pero por ahora mantendremos la del bridge para consistencia.
              } catch (e) {
                console.warn("⚠️ [AudioEditor] No se pudo descargar asset para el caché:", clip.mediaFileId);
              }
            }
          }
        }

        // 2. Actualizar estado global y forzar refresco
        setEditState({ ...projectData });
        setCurrentTime(projectData.timeline.currentTime || 0);
        
        if (projectData.timeline.tracks?.[0]?.clips?.[0]) {
          setSelectedClipId(projectData.timeline.tracks[0].clips[0].id);
        }
        setLoadedFileName(project.name);
        console.log("✅ [AudioEditor] Proyecto cargado y timeline actualizado:", project.name);
      } else {
        console.error("❌ [AudioEditor] No se encontró el timeline en los datos del proyecto");
        alert(t('audioEditor.alertInvalidProject'));
      }
    } catch (e) {
      console.error('❌ Error loadFullProjectLocal:', e);
      alert(t('audioEditor.alertLoadProjectError'));
    } finally {
      setIsLoadingProjects(false);
    }
  }

  useEffect(() => {
    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    const masterGain = context.createGain();
    const frequencies = [32, 64, 250, 1000, 4000, 8000, 16000];
    const filters = frequencies.map((freq, i) => {
      const filter = context.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === frequencies.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });
    masterGain.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) { filters[i].connect(filters[i+1]); }
    filters[filters.length - 1].connect(context.destination);
    setAudioContext(context);
    setAudioSource(masterGain);
    setEqFilters(filters);
    const initialBands = [{ id: 'sub', label: 'SUB', frequency: '32Hz', value: 0, min: -24, max: 12, color: '#9d4edd' }, { id: 'bass', label: 'BASS', frequency: '64Hz', value: 0, min: -24, max: 12, color: '#7b2cbf' }, { id: 'low-mid', label: 'LOW MID', frequency: '250Hz', value: 0, min: -24, max: 12, color: '#5a189a' }, { id: 'mid', label: 'MID', frequency: '1kHz', value: 0, min: -24, max: 12, color: '#3c096c' }, { id: 'high-mid', label: 'HIGH MID', frequency: '4kHz', value: 0, min: -24, max: 12, color: '#240046' }, { id: 'presence', label: 'PRESENCE', frequency: '8kHz', value: 0, min: -24, max: 12, color: '#10002b' }, { id: 'brilliance', label: 'BRILLIANCE', frequency: '16kHz', min: -24, max: 12, color: '#00eeff' }];
    setEqBands(initialBands);
    return () => { if (context.state !== 'closed') context.close(); };
  }, []);

  useEffect(() => {
    if (audioSource instanceof GainNode && audioContext) audioSource.gain.setTargetAtTime(volume, audioContext.currentTime, 0.05);
  }, [volume, audioSource, audioContext]);

  // Si el motor está desactivado (Engine Active OFF), apagar también el micrófono
  useEffect(() => {
    if (isEQBypassed) setMicEnabled(false);
  }, [isEQBypassed]);

  // Conectar/desconectar micrófono al master (cuando el interruptor está activado)
  useEffect(() => {
    if (!micEnabled) {
      if (micSourceRef.current && audioSource) {
        try { micSourceRef.current.disconnect(); } catch (_) {}
        micSourceRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
      }
      return;
    }
    if (!audioContext || !audioSource) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      micStreamRef.current = stream;
      const source = audioContext.createMediaStreamSource(stream);
      micSourceRef.current = source;
      source.connect(audioSource);
    }).catch(() => {
      if (!cancelled) setMicEnabled(false);
    });
    return () => {
      cancelled = true;
      if (micSourceRef.current) { try { micSourceRef.current.disconnect(); } catch (_) {} micSourceRef.current = null; }
      if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    };
  }, [micEnabled, audioContext, audioSource]);

  useEffect(() => {
    if (selectedClip) {
      setEditState(prev => ({
        ...prev,
        trimStart: selectedClip.sourceStartTime || 0,
        trimEnd: (selectedClip.sourceStartTime || 0) + (selectedClip.duration * (selectedClip.playbackRate || 1)),
        playbackRate: selectedClip.playbackRate || 1,
        fadeInDuration: selectedClip.fadeInDuration || 0,
        fadeOutDuration: selectedClip.fadeOutDuration || 0,
      }));
    }
  }, [selectedClip]); 

  useEffect(() => {
    if (audioUrl && !initialQueue?.length && editState.timeline?.tracks[0].clips.length === 0) {
      const fileName = audioUrl.split('/').pop() || t('audioEditor.untitledAudio');
      (async () => {
        const url = await cacheLocalMediaUrl(audioUrl);
        loadAudioMetadata(url).then(({ duration }) => {
          const realDuration = duration;
          const clipId = `clip-main-${Date.now()}`;
          const initialClip: TimelineClip = { id: clipId, trackId: editState.timeline!.tracks[0].id, type: 'audio', mediaFileId: url, startTime: 0, duration: realDuration, sourceStartTime: 0, sourceDuration: realDuration, volume: 1, playbackRate: 1, label: fileName, overlayTint: undefined };
           setEditState(prev => ({ ...prev, trimEnd: realDuration, timeline: { ...prev.timeline!, duration: Math.max(prev.timeline!.duration, realDuration), tracks: prev.timeline!.tracks.map((t, i) => i === 0 ? { ...t, clips: [initialClip] } : t) } }));
          setLoadedFileName(fileName);
          setSelectedClipId(clipId);
        }).catch(() => {
          console.warn('No se pudo cargar metadatos del audio inicial');
        });
      })();
    }
  }, [audioUrl, initialQueue?.length, editState.timeline?.tracks]);

  // 5. HANDLERS ADICIONALES
  const handlePlaybackRateChange = (value: number[]) => {
    const newRate = value[0];
    setEditState(prev => ({ ...prev, playbackRate: newRate }));
    if (selectedClip) handleUpdateClip(selectedClip.id, { playbackRate: newRate });
  };

  const handleTrimStartChange = (value: number[]) => {
    const newStart = value[0];
    setEditState(prev => ({ ...prev, trimStart: newStart }));
    if (selectedClip) {
      const currentEndSourceTime = (selectedClip.sourceStartTime || 0) + (selectedClip.duration * (selectedClip.playbackRate || 1));
      const newDuration = (currentEndSourceTime - newStart) / (selectedClip.playbackRate || 1);
      handleUpdateClip(selectedClip.id, { sourceStartTime: newStart, duration: Math.max(0.1, newDuration) });
    }
  };

  const handleTrimEndChange = (value: number[]) => {
    const newEnd = value[0];
    setEditState(prev => ({ ...prev, trimEnd: newEnd }));
    if (selectedClip) {
      const newDuration = (newEnd - (selectedClip.sourceStartTime || 0)) / (selectedClip.playbackRate || 1);
      handleUpdateClip(selectedClip.id, { duration: Math.max(0.1, newDuration) });
    }
  };

  const handleFadeInChange = (value: number[]) => {
    const newVal = value[0];
    setEditState(prev => ({ ...prev, fadeInDuration: newVal }));
    if (selectedClip) handleUpdateClip(selectedClip.id, { fadeInDuration: newVal });
  };

  const handleFadeOutChange = (value: number[]) => {
    const newVal = value[0];
    setEditState(prev => ({ ...prev, fadeOutDuration: newVal }));
    if (selectedClip) handleUpdateClip(selectedClip.id, { fadeOutDuration: newVal });
  };

  const handleFilesSelected = (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);
    fileCache.current.set(url, file);
    loadAudioMetadata(url).then(({ duration }) => {
      const realDuration = duration;
      setIsPlaying(false);
      const clipId = `clip-${Date.now()}`;
      const newTrackId = `track-${Date.now()}`;
      setEditState(prev => {
        if (!prev.timeline) return prev;
        const newTrack: TimelineTrack = {
          id: newTrackId,
          type: 'audio',
          name: t('audioEditor.trackN', { n: prev.timeline.tracks.length + 1 }),
          clips: [{
            id: clipId,
            trackId: newTrackId,
            type: 'audio',
            mediaFileId: url,
            startTime: 0,
            duration: realDuration,
            sourceStartTime: 0,
            sourceDuration: realDuration,
            volume: 1,
            playbackRate: 1,
            label: file.name,
            overlayTint: undefined
          }],
          isMuted: false,
          isLocked: false,
          volume: 1
        };
        return {
          ...prev,
          timeline: {
            ...prev.timeline,
            currentTime: prev.timeline.currentTime,
            duration: Math.max(prev.timeline.duration, realDuration),
            tracks: [...prev.timeline.tracks, newTrack],
          },
        };
      });
      setLoadedFileName(file.name);
      setSelectedClipId(clipId);
      setIsUploaderOpen(false);
    }).catch(() => {
      alert(t('audioEditor.alertLoadAudioError'));
    });
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const saveProjectLocal = async (title: string, manualFiles: File[]) => {
    setIsSavingProject(true);
    try {
      const paths = await getLocalPaths();
      const rootPath = paths?.proyectos_audio;
      if (!rootPath) throw new Error(t('audioEditor.alertConfigAudioPath'));

      const projectFolder = rootPath.replace(/\\*$/, '') + '\\' + title;
      await ensureDir(projectFolder);
      const assetsFolder = projectFolder + '\\assets';
      await ensureDir(assetsFolder);

      const projectData = {
        version: '1.0',
        audioUrl,
        editState,
        timestamp: new Date().toISOString()
      };

      const zeusPath = projectFolder + '\\' + title + '.zeus';
      await saveProject(zeusPath, {
        titulo: title,
        tipo: 'edit_audio',
        editState: projectData
      });

      for (const file of manualFiles) {
        const sourcePath = getFilePath(file);
        const destPath = assetsFolder + '\\' + file.name;
        if (sourcePath) {
          await copyFile(sourcePath, destPath);
        } else {
          const buffer = new Uint8Array(await file.arrayBuffer());
          await writeFile(destPath, buffer);
        }
      }

      alert(t('audioEditor.alertProjectCreated', { folder: projectFolder, count: manualFiles.length }));
      setIsSaveModalOpen(false);
    } catch (e: any) {
      console.error('Error guardando proyecto local:', e);
      alert(e.message || t('audioEditor.alertSaveProjectError'));
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleExportAudio = async () => {
    if (!editState.timeline) return;
    setIsExporting(true);
    try {
      const tracks = editState.timeline.tracks;
      if (!tracks.length) throw new Error(t('audioEditor.alertNoTracks'));

      let maxEnd = 0;
      for (const track of tracks) {
        for (const clip of track.clips) {
          const end = clip.startTime + clip.duration;
          if (end > maxEnd) maxEnd = end;
        }
      }

      const duration = Math.max(maxEnd, 1);
      const offlineCtx = new OfflineAudioContext(2, 44100 * duration, 44100);
      for (const track of tracks) {
        if (track.isMuted || track.isLocked || track.volume === 0) continue;
        for (const clip of track.clips) {
          if (!clip.mediaFileId) continue;
          const res = await fetch(clip.mediaFileId); const ab = await res.arrayBuffer();
          const buffer = await offlineCtx.decodeAudioData(ab);
          const source = offlineCtx.createBufferSource(); source.buffer = buffer;
          const gain = offlineCtx.createGain(); gain.gain.value = (clip.volume || 1) * (track.volume ?? 1);
          source.connect(gain); gain.connect(offlineCtx.destination);
          source.start(clip.startTime, clip.sourceStartTime || 0, clip.duration);
        }
      }
      const rendered = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(rendered);

      if (exportConfig.format === 'mp3-local') {
        const paths = await getLocalPaths();
        const audioFolder = paths?.audio;
        if (!audioFolder) {
          alert(t('audioEditor.alertNoAudioFolder'));
          setIsExporting(false);
          return;
        }
        const safeName = exportConfig.title.replace(/[\\/:*?"<>|]/g, '_');
        const tempWavPath = `${audioFolder}\\${safeName}_tmp.wav`;
        const mp3Path = `${audioFolder}\\${safeName}.mp3`;
        await ensureDir(audioFolder);
        const wavBuffer = new Uint8Array(await wavBlob.arrayBuffer());
        await writeFile(tempWavPath, wavBuffer);
        const result = await exportAudioToMp3(tempWavPath, mp3Path);
        try { await deleteFile(tempWavPath); } catch {}
        if (!result.success) throw new Error(result.error || t('audioEditor.alertMp3ConvertError'));
        alert(t('audioEditor.alertMp3Saved', { path: mp3Path }));
        setIsExportModalOpen(false);
        return;
      }

      const formData = new FormData(); formData.append('titulo', exportConfig.title); formData.append('file', new File([wavBlob], `${exportConfig.title}.wav`, { type: 'audio/wav' }));
      await pb.collection('audio').create(formData); alert(t('audioEditor.alertExportedDb')); setIsExportModalOpen(false);
    } catch (e: any) {
      console.error(e);
      alert(e.message || t('audioEditor.alertExportError'));
    } finally { setIsExporting(false); }
  };

  const openLocalAudioFolder = async () => {
    setPbLoading(true);
    setLoadType('local');
    setLocalFolderFiles([]);
    setIsLoadModalOpen(true);
    
    try {
      const paths = await getLocalPaths();
      const audioFolder = paths?.audio;

      if (!audioFolder) {
        alert(t('audioEditor.alertNoAudioFolderFiles'));
        setPbLoading(false);
        setIsLoadModalOpen(false);
        return;
      }

      const files = await listDirectory(audioFolder, 'audio');
      setLocalFolderFiles(files || []);
    } catch (error: any) {
      console.error("Error al cargar carpeta local:", error);
      alert(error.message || t('audioEditor.alertAccessFilesError'));
      setIsLoadModalOpen(false);
    } finally {
      setPbLoading(false);
    }
  };

  useEffect(() => {
    if (isUploaderOpen) {
      setUploaderLocalFiles([]);
      setUploaderLocalLoading(true);
      (async () => {
        try {
          const paths = await getLocalPaths();
          const audioFolder = paths?.audio;
          if (audioFolder) {
            const files = await listDirectory(audioFolder, 'audio');
            setUploaderLocalFiles(files || []);
          }
        } catch (e) {
          console.error('Error al cargar archivos locales para el uploader:', e);
        } finally {
          setUploaderLocalLoading(false);
        }
      })();
    }
  }, [isUploaderOpen]);

  const openLocalProjectsFolder = async () => {
    setPbLoading(true);
    setLoadType('proyectos');
    setSavedProjects([]);
    setIsLoadModalOpen(true);
    
    try {
      const paths = await getLocalPaths();
      const projectsFolder = paths?.proyectos_audio;

      if (!projectsFolder) {
        alert(t('audioEditor.alertNoAudioProjectsFolder'));
        setPbLoading(false);
        setIsLoadModalOpen(false);
        return;
      }

      const files = await listDirectory(projectsFolder, 'proyectos');
      const projects = (files || []).map((f: any) => ({
        id: f.path,
        titulo: f.name || f.fileName,
        path: f.path,
        isDirectory: f.isDirectory,
        file: { editState: null }
      }));
      setSavedProjects(projects);
    } catch (error: any) {
      console.error("Error al cargar proyectos locales:", error);
      alert(error.message || t('audioEditor.alertAccessProjectsError'));
      setIsLoadModalOpen(false);
    } finally {
      setPbLoading(false);
    }
  };

  const handleOpenLocalProject = async (p: any) => {
    setIsLoadModalOpen(false);
    console.log("📥 [AudioEditor] Abriendo proyecto local desde modal:", p.titulo);

    try {
      let projectPath = p.path;

      if (p.isDirectory) {
        const files = await listDirectory(p.path, 'proyectos');
        const zeusFile = files.find((f: any) => f.name.endsWith('.zeus'));
        if (zeusFile) projectPath = zeusFile.path;
      }

      await loadFullProjectLocal({
        name: p.titulo || p.name,
        path: projectPath
      });
    } catch (e: any) {
      console.error("Error al abrir proyecto:", e);
      alert(e.message || t('audioEditor.alertOpenProjectError'));
    }
  };

  const fetchFromPocketBase = async (type: 'proyectos' | 'archivos') => {
    setIsLoadingProjects(true);
    setLoadType(type);
    try {
      if (type === 'proyectos') {
        const records = await pb.collection('proyectos').getFullList({ filter: 'tipo = "edit_audio"', sort: '-created' });
        setSavedProjects(records);
        setIsLoadModalOpen(true);
        return;
      }
      setLoadArchivosStep('collection');
      setSelectedAudioCollection(null);
      setAudioRecords([]);
      setSelectedRecordFiles(null);
      const fallback = [{ id: 'audio', name: 'audio' }, { id: 'video', name: 'video' }, { id: 'imagen', name: 'imagen' }];
      try {
        const res = await fetch('/api/collections');
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray(data?.items) ? data.items : [];
          if (items.length > 0) {
            setAudioCollections(items.map((c: any) => ({ id: c.id || c.name, name: c.name })));
            setIsLoadModalOpen(true);
            return;
          }
        }
      } catch {
        /* sigue al fallback */
      }
      try {
        if (pb.authStore.isValid) {
          const all = await pb.collections.getFullList();
          const filtered = all.filter(
            (c: { type?: string; name?: string }) =>
              c.type === 'base' && !['users', 'proyectos', 'notificaciones', 'logs'].includes(c.name || '')
          );
          if (filtered.length > 0) {
            setAudioCollections(filtered.map((c: { id: string; name: string }) => ({ id: c.id || c.name, name: c.name })));
            setIsLoadModalOpen(true);
            return;
          }
        }
      } catch {
        /* sigue al fallback */
      }
      setAudioCollections(fallback);
      setIsLoadModalOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const fetchRecordsForCollection = async (collectionName: string) => {
    setIsLoadingProjects(true);
    setSelectedAudioCollection(collectionName);
    try {
      const records = await pb.collection(collectionName).getFullList({ sort: '-created' });
      const audioExt = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'webm'];
      const out: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }[] = [];
      for (const record of records as any[]) {
        const fileFields = Object.keys(record).filter(key => {
          const val = record[key];
          if (!val) return false;
          if (typeof val === 'string' && val.includes('.')) return true;
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') return true;
          return false;
        }).filter(k => !['id', 'collectionId', 'collectionName', 'created', 'updated'].includes(k));
        const files: { url: string; fileName: string }[] = [];
        for (const fieldName of fileFields) {
          const fileValue = record[fieldName];
          const list = Array.isArray(fileValue) ? fileValue : [fileValue];
          for (const file of list) {
            if (typeof file !== 'string' || !file.includes('.')) continue;
            const ext = file.split('.').pop()?.toLowerCase() || '';
            if (!audioExt.includes(ext)) continue;
            files.push({ url: pb.files.getURL(record, file), fileName: file });
          }
        }
        if (files.length > 0) {
          out.push({
            recordId: record.id,
            recordName: record.titulo || record.name || record.id,
            files,
          });
        }
      }
      setAudioRecords(out);
      setLoadArchivosStep('record');
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const selectRecordForFiles = (record: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }) => {
    setSelectedRecordFiles(record.files);
    setLoadArchivosStep('file');
  };

  /** Cargar un solo archivo reemplazando el contenido actual (limpia timeline y pone el nuevo). */
  const handleRecordingComplete = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const fileName = `${t('audioEditor.recordingPrefix')}-${new Date().toLocaleTimeString()}.wav`;
    
    // Añadir la grabación como un nuevo clip al final de la primera pista
    const track = editState.timeline!.tracks[0];
    const lastEnd = track.clips.length === 0 ? 0 : Math.max(...track.clips.map(c => c.startTime + c.duration));
    const clipId = `clip-rec-${Date.now()}`;
    
    // Crear un objeto de audio temporal para obtener la duración real
    const tempAudio = document.createElement('audio');
    tempAudio.src = url;
    tempAudio.onloadedmetadata = () => {
      const realDuration = tempAudio.duration;
      const newClip: TimelineClip = {
        id: clipId,
        trackId: track.id,
        type: 'audio',
        mediaFileId: url,
        startTime: lastEnd,
        duration: realDuration,
        sourceStartTime: 0,
        sourceDuration: realDuration,
        volume: 1,
        playbackRate: 1,
        label: fileName,
        overlayTint: undefined
      };

      setEditState(prev => ({
        ...prev,
        timeline: {
          ...prev.timeline!,
            duration: Math.max(prev.timeline!.duration, lastEnd + realDuration),
          tracks: prev.timeline!.tracks.map((t, i) => i === 0 ? { ...t, clips: [...t.clips, newClip] } : t),
        },
      }));
      
      setSelectedClipId(clipId);
      toast({
        title: t('audioEditor.toastRecordedTitle'),
        description: t('audioEditor.toastRecordedDesc'),
      });
    };
  };

  const getPathFromMediaUrl = (url: string): string | null => {
    const match = url.match(/^media:\/\/\/?file\/?\?path=(.+)$/);
    if (match) return decodeURIComponent(match[1]);
    return null;
  };

  const cacheLocalMediaUrl = async (url: string): Promise<string> => {
    const cached = fileCache.current.get(url);
    if (cached) return url;
    const localPath = getPathFromMediaUrl(url);
    if (!localPath) return url;
    try {
      const buffer = await readFileBuffer(localPath);
      if (!buffer) return url;
      const ext = localPath.split('.').pop()?.toLowerCase() || 'bin';
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
        mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
      };
      const blob = new Blob([new Uint8Array(buffer)], { type: mimeMap[ext] || 'application/octet-stream' });
      const objectUrl = URL.createObjectURL(blob);
      const file = new File([blob], localPath.split(/[\\/]/).pop() || 'file', { type: blob.type });
      fileCache.current.set(url, file);
      fileCache.current.set(objectUrl, file);
      console.log('[AudioEditor] Cacheado local:', localPath, '→', objectUrl);
      return objectUrl;
    } catch (e) {
      console.warn('[AudioEditor] No se pudo cachear archivo local:', localPath, e);
      return url;
    }
  };

  const loadSingleFile = async (item: { url: string; fileName: string }) => {
    const url = await cacheLocalMediaUrl(item.url);
    loadAudioMetadata(url).then(({ duration }) => {
      const realDuration = duration;
      setIsPlaying(false);
      // Don't reset currentTime - keep user position
      const clipId = `clip-${Date.now()}`;
      const newTrackId = `track-${Date.now()}`;
      setEditState(prev => {
        if (!prev.timeline) return prev;
        const newTrack: TimelineTrack = {
          id: newTrackId,
          type: 'audio',
          name: t('audioEditor.trackN', { n: prev.timeline.tracks.length + 1 }),
          clips: [{
            id: clipId,
            trackId: newTrackId,
            type: 'audio',
            mediaFileId: url,
            startTime: 0,
            duration: realDuration,
            sourceStartTime: 0,
            sourceDuration: realDuration,
            volume: 1,
            playbackRate: 1,
            label: item.fileName,
            overlayTint: undefined
          }],
          isMuted: false,
          isLocked: false,
          volume: 1
        };
        return {
          ...prev,
          timeline: {
            ...prev.timeline,
            currentTime: prev.timeline.currentTime,
            duration: Math.max(prev.timeline.duration, realDuration),
            tracks: [...prev.timeline.tracks, newTrack],
          },
        };
      });
      setLoadedFileName(item.fileName);
      setSelectedClipId(clipId);
      setIsLoadModalOpen(false);
      setLoadArchivosStep('collection');
      setSelectedRecordFiles(null);
      setSelectedAudioCollection(null);
    }).catch(() => {
      console.warn('Error cargando audio:', item.fileName);
    });
  };

  const addFileToQueue = async (item: { url: string; fileName: string }) => {
    const url = await cacheLocalMediaUrl(item.url);
    loadAudioMetadata(url).then(({ duration }) => {
      const realDuration = duration;
      const track = editState.timeline!.tracks[0];
      const lastEnd = track.clips.length === 0 ? 0 : Math.max(...track.clips.map(c => c.startTime + c.duration));
      const clipId = `clip-${Date.now()}`;
      const newClip: TimelineClip = { id: clipId, trackId: track.id, type: 'audio', mediaFileId: url, startTime: lastEnd, duration: realDuration, sourceStartTime: 0, sourceDuration: realDuration, volume: 1, playbackRate: 1, label: item.fileName, overlayTint: undefined };
      setEditState(prev => ({
        ...prev,
        timeline: {
          ...prev.timeline!,
            duration: Math.max(prev.timeline!.duration, lastEnd + realDuration),
          tracks: prev.timeline!.tracks.map((t, i) => i === 0 ? { ...t, clips: [...t.clips, newClip] } : t),
        },
      }));
      setLoadedFileName(item.fileName);
      setSelectedClipId(clipId);
      setIsLoadModalOpen(false);
      setLoadArchivosStep('collection');
      setSelectedRecordFiles(null);
      setSelectedAudioCollection(null);
    }).catch(() => {
      console.warn('Error cargando audio en cola:', item.fileName);
    });
  };

  const addAllFilesToQueue = async (files: { url: string; fileName: string }[], recordId: string) => {
    if (files.length === 0) return;
    setIsAddingAllToQueue(true);
    setAddingRecordId(recordId);
    try {
      const withDuration = await Promise.all(
        files.map(async (f) => {
          try {
            const meta = await loadAudioMetadata(f.url);
            return { ...f, duration: meta.duration };
          } catch {
            return { ...f, duration: 5 };
          }
        })
      );
      const baseId = Date.now();
      setEditState((prev) => {
        const track = prev.timeline!.tracks[0];
        const lastEnd = track.clips.length === 0 ? 0 : Math.max(...track.clips.map((c) => c.startTime + c.duration));
        let currentStart = lastEnd;
        const newClips: TimelineClip[] = withDuration.map((f, i) => {
          const clipId = `clip-${baseId}-${i}`;
          const clip: TimelineClip = {
            id: clipId,
            trackId: track.id,
            type: 'audio',
            mediaFileId: f.url,
            startTime: currentStart,
            duration: f.duration,
            sourceStartTime: 0,
            sourceDuration: f.duration,
            volume: 1,
            playbackRate: 1,
            label: f.fileName,
            overlayTint: undefined,
          };
          currentStart += f.duration;
          return clip;
        });
        const totalDuration = currentStart + 10;
        return {
          ...prev,
          timeline: {
            ...prev.timeline!,
            duration: Math.max(prev.timeline!.duration, totalDuration),
            tracks: prev.timeline!.tracks.map((t, i) =>
              i === 0 ? { ...t, clips: [...t.clips, ...newClips] } : t
            ),
          },
        };
      });
      setLoadedFileName(withDuration.length > 1 ? t('audioEditor.tracksInQueue', { count: withDuration.length }) : withDuration[0]?.fileName ?? '');
      if (withDuration.length > 0) setSelectedClipId(`clip-${baseId}-0`);
      setIsLoadModalOpen(false);
      setLoadArchivosStep('collection');
      setSelectedRecordFiles(null);
      setSelectedAudioCollection(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAddingAllToQueue(false);
      setAddingRecordId(null);
    }
  };

  const handleGeneratedMusic = useCallback((result: GenerateMusicResult, config: MusicGeneratorConfig) => {
    const fileName = `musica-generada-${config.style}-${config.duration}s.wav`;
    const file = new File([result.blob], fileName, { type: 'audio/wav' });
    fileCache.current.set(result.url, file);

    const clipId = `clip-music-${Date.now()}`;
    setEditState((prev) => {
      if (!prev.timeline) return prev;
      const track = prev.timeline.tracks[0];
      const lastEnd = track.clips.length === 0 ? 0 : Math.max(...track.clips.map((c) => c.startTime + c.duration));
      const newClip: TimelineClip = {
        id: clipId,
        trackId: track.id,
        type: 'audio',
        mediaFileId: result.url,
        startTime: lastEnd,
        duration: result.duration,
        sourceStartTime: 0,
        sourceDuration: result.duration,
        volume: 0.7,
        playbackRate: 1,
        label: fileName,
        overlayTint: undefined,
      };
      return {
        ...prev,
        timeline: {
          ...prev.timeline,
            duration: Math.max(prev.timeline.duration, lastEnd + result.duration),
          tracks: prev.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips: [...t.clips, newClip] } : t)),
        },
      };
    });
    setLoadedFileName(fileName);
    setSelectedClipId(clipId);
    toast({
      title: t('audioEditor.toastMusicGeneratedTitle'),
      description: t('audioEditor.toastMusicGeneratedDesc', { fileName, duration: config.duration, style: config.style }),
    });
  }, [toast, t]);

  const handleLoopSelected = useCallback((result: GenerateLoopResult, item: LoopCatalogItem) => {
    const fileName = `loop-${item.category}-${item.name.toLowerCase().replace(/\s+/g, '_')}-${item.bpm}bpm.wav`;
    const file = new File([result.blob], fileName, { type: 'audio/wav' });
    fileCache.current.set(result.url, file);

    const clipId = `clip-loop-${Date.now()}`;
    setEditState((prev) => {
      if (!prev.timeline) return prev;
      const track = prev.timeline.tracks[0];
      const lastEnd = track.clips.length === 0 ? 0 : Math.max(...track.clips.map((c) => c.startTime + c.duration));
      const newClip: TimelineClip = {
        id: clipId,
        trackId: track.id,
        type: 'audio',
        mediaFileId: result.url,
        startTime: lastEnd,
        duration: result.duration,
        sourceStartTime: 0,
        sourceDuration: result.duration,
        volume: 0.8,
        playbackRate: 1,
        label: fileName,
        overlayTint: undefined,
      };
      return {
        ...prev,
        timeline: {
          ...prev.timeline,
            duration: Math.max(prev.timeline.duration, lastEnd + result.duration),
          tracks: prev.timeline.tracks.map((t, i) => (i === 0 ? { ...t, clips: [...t.clips, newClip] } : t)),
        },
      };
    });
    setLoadedFileName(fileName);
    setSelectedClipId(clipId);
    toast({
      title: t('audioEditor.toastLoopAddedTitle'),
      description: t('audioEditor.toastLoopAddedDesc', { name: item.name, bpm: item.bpm }),
    });
  }, [toast, t]);

  // --- Demucs / separación de stems ---

  const ensureLocalInputPath = async (mediaFileId: string): Promise<string | null> => {
    const localPath = getPathFromMediaUrl(mediaFileId);
    if (localPath) return localPath;

    // Para blobs/http, descargar a un archivo temporal
    try {
      const res = await fetch(mediaFileId);
      const blob = await res.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const ext = blob.type?.includes('mp3') ? 'mp3' : blob.type?.includes('wav') ? 'wav' : blob.type?.includes('ogg') ? 'ogg' : blob.type?.includes('flac') ? 'flac' : 'mp3';
      const tmpPath = `C:\\Windows\\Temp\\zms-stem-input-${Date.now()}.${ext}`;
      const ok = await writeFile(tmpPath, new Uint8Array(arrayBuffer));
      if (!ok) return null;
      return tmpPath;
    } catch (e) {
      console.error('Error preparando archivo local para Demucs:', e);
      return null;
    }
  };

  const openSeparateModal = useCallback(async () => {
    setIsSeparateModalOpen(true);
    setDemucsAvailable(null);
    setDemucsMessage('');
    setIsSeparating(false);
    setSeparateProgress(0);
    setSeparateStatus('');
    try {
      const status = await checkDemucs();
      setDemucsAvailable(status.available);
      setDemucsMessage(status.message || '');
    } catch (e) {
      setDemucsAvailable(false);
      setDemucsMessage(t('audioEditor.demucsCheckError'));
    }
  }, [t]);

  const handleInstallDemucs = useCallback(async () => {
    setIsInstallingDemucs(true);
    try {
      const res = await installDemucs();
      if (res.success) {
        const status = await checkDemucs();
        setDemucsAvailable(status.available);
        setDemucsMessage(status.message || t('audioEditor.demucsInstalledOk'));
        toast({ title: t('audioEditor.toastDemucsInstalledTitle'), description: t('audioEditor.toastDemucsInstalledDesc') });
      } else {
        setDemucsMessage(res.error || t('audioEditor.demucsInstallError'));
        toast({ title: t('audioEditor.toastErrorTitle'), description: res.error || t('audioEditor.toastDemucsInstallErrorDesc'), variant: 'destructive' });
      }
    } catch (e) {
      setDemucsMessage(t('audioEditor.demucsInstallException'));
    } finally {
      setIsInstallingDemucs(false);
    }
  }, [t, toast]);

  const handleSeparateStems = useCallback(async () => {
    const clip = selectedClip;
    if (!clip?.mediaFileId) {
      toast({ title: t('audioEditor.toastNoAudioTitle'), description: t('audioEditor.toastNoAudioDesc') });
      return;
    }

    const inputPath = await ensureLocalInputPath(clip.mediaFileId);
    if (!inputPath) {
      toast({ title: t('audioEditor.toastErrorTitle'), description: t('audioEditor.toastPrepErrorDesc') });
      return;
    }

    const jobId = `demucs-${Date.now()}`;
    setSeparateJobId(jobId);
    setIsSeparating(true);
    setSeparateProgress(0);
    setSeparateStatus(t('audioEditor.demucsPreparing'));

    try {
      const result = await separateAudio(
        { inputPath, model: selectedDemucsModel, jobId },
        (percent, status) => {
          setSeparateProgress(percent);
          if (status) setSeparateStatus(status);
        }
      );

      if (!result.success || !result.stems) {
        let detail = result.error || 'Error desconocido.';
        if (result.stderr) {
          const lastErr = result.stderr.split('\n').filter(Boolean).slice(-3).join('\n');
          if (lastErr) detail += `\n${lastErr}`;
        }
        toast({ title: t('audioEditor.toastSeparateErrorTitle'), description: detail });
        return;
      }

      // Añadir una pista por stem, todas alineadas en t=0
      const stems = result.stems as DemucsStem[];
      const baseDuration = clip.duration;

      // Precargar los stems en memoria para que el reproductor use blob URLs
      // en lugar de media://; evita problemas de CORS/taint en Web Audio.
      setSeparateStatus(t('audioEditor.demucsLoadingStems'));
      await Promise.all(stems.map(async (stem) => {
        const url = getMediaUrl(stem.path);
        try { await cacheLocalMediaUrl(url); } catch (e) { console.warn('No se pudo cachear stem:', stem.path, e); }
      }));

      setEditState((prev) => {
        if (!prev.timeline) return prev;
        const timestamp = Date.now();
        const newTracks = stems.map((stem, index) => {
          const trackId = `track-stem-${stem.name}-${timestamp}-${index}`;
          const clipId = `clip-stem-${stem.name}-${timestamp}-${index}`;
          const url = getMediaUrl(stem.path);
          return {
            id: trackId,
            type: 'audio' as const,
            name: stem.name.charAt(0).toUpperCase() + stem.name.slice(1),
            clips: [{
              id: clipId,
              trackId,
              type: 'audio' as const,
              mediaFileId: url,
              startTime: 0,
              duration: baseDuration,
              sourceStartTime: 0,
              sourceDuration: baseDuration,
              volume: 0.85,
              playbackRate: 1,
              label: `${stem.name}.wav`,
              overlayTint: undefined,
            }],
            isMuted: false,
            isLocked: false,
            volume: 1,
          } satisfies TimelineTrack;
        });
        return {
          ...prev,
          timeline: {
            ...prev.timeline,
            duration: Math.max(prev.timeline.duration, baseDuration),
            tracks: [...prev.timeline.tracks, ...newTracks],
          },
        };
      });

      toast({
        title: t('audioEditor.toastStemsSeparatedTitle'),
        description: t('audioEditor.toastStemsSeparatedDesc', { count: stems.length, names: stems.map((s) => s.name).join(', ') }),
      });
      setIsSeparateModalOpen(false);
    } catch (e) {
      console.error(e);
      toast({ title: t('audioEditor.toastErrorTitle'), description: t('audioEditor.toastSeparateFailDesc') });
    } finally {
      setIsSeparating(false);
      setSeparateProgress(0);
      setSeparateStatus('');
    }
  }, [selectedClip, selectedDemucsModel, editState.timeline, toast, t]);

  const handleCancelSeparate = useCallback(async () => {
    await cancelSeparate();
    setIsSeparating(false);
    setSeparateProgress(0);
    setSeparateStatus(t('audioEditor.demucsCancelStatus'));
  }, [t]);

  // Cola inicial desde el explorador multimedia: añadir todos al reproductor al montar
  const initialQueueProcessed = useRef(false);
  useEffect(() => {
    if (initialQueueProcessed.current || !initialQueue?.length) return;
    initialQueueProcessed.current = true;
    addAllFilesToQueue(initialQueue, 'explorer');
  }, [initialQueue]);

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden rounded-xl border border-gray-800 shadow-2xl">
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-500/20 rounded-lg"><Music className="w-5 h-5 text-green-400" /></div>
          <h2 className="font-bold text-sm uppercase"> {t('audioEditor.brand')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 shrink-0 text-gray-400" aria-hidden />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400">{t('audioEditor.mic')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={micEnabled}
              onClick={() => setMicEnabled(!micEnabled)}
              className="flex items-center gap-0.5 p-0.5 rounded-full bg-gray-900 border-2 border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-blue-500/50 cursor-pointer transition-all"
            >
              <span className={`h-5 w-5 rounded-full border-2 transition-all ${!micEnabled ? 'border-blue-500 bg-blue-500/30 shadow-inner' : 'border-blue-500 bg-gray-700'}`} />
              <span className={`h-5 w-5 rounded-full border-2 transition-all ${micEnabled ? 'bg-red-500 border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'border-blue-500 bg-gray-800'}`} />
            </button>
            <span className={`h-2 w-2 rounded-full transition-colors ${micEnabled ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]' : 'bg-gray-600'}`} title={micEnabled ? t('audioEditor.micConnected') : t('audioEditor.micDisconnected')} aria-hidden />
          </div>
          <div className="w-px h-6 bg-gray-800 mx-1" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-400">{t('audioEditor.midiKeyboard')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={showMidiKeyboard}
            onClick={() => setShowMidiKeyboard(!showMidiKeyboard)}
            className="flex items-center gap-0.5 p-0.5 rounded-full bg-gray-900 border-2 border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-blue-500/50 cursor-pointer transition-all"
          >
            <span className={`h-5 w-5 rounded-full border-2 transition-all ${!showMidiKeyboard ? 'border-blue-500 bg-blue-500/30 shadow-inner' : 'border-blue-500 bg-gray-700'}`} />
            <span className={`h-5 w-5 rounded-full border-2 transition-all ${showMidiKeyboard ? 'border-blue-500 bg-blue-500/80 shadow-[0_0_6px_rgba(59,130,246,0.5)]' : 'border-blue-500 bg-gray-800'}`} />
          </button>
          <span
            className={`h-2 w-2 rounded-full transition-colors ${showMidiKeyboard ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]' : 'bg-gray-600'}`}
            title={showMidiKeyboard ? t('audioEditor.midiActive') : t('audioEditor.midiInactive')}
            aria-hidden
          />
          <Button variant="ghost" size="sm" onClick={() => setIsExportModalOpen(true)} className="text-xs text-gray-400 hover:text-green-400"><Download className="w-4 h-4 mr-2" /> {t('audioEditor.export')}</Button>
          <Button variant="ghost" size="sm" onClick={() => setIsGenerateMusicModalOpen(true)} className="text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"><Sparkles className="w-4 h-4 mr-2" /> {t('audioEditor.generateMusic')}</Button>
          <Button variant="ghost" size="sm" onClick={onOpenMusicLibrary} className="text-xs text-green-400 hover:text-green-300 hover:bg-green-500/10"><Music className="w-4 h-4 mr-2" /> {t('audioEditor.musicLibrary')}</Button>
          <Button variant="ghost" size="sm" onClick={openSeparateModal} className="text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"><Music className="w-4 h-4 mr-2" /> {t('audioEditor.separateStems')}</Button>
          {headerMounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-green-400"><FolderOpen className="w-4 h-4 mr-2" /> {t('audioEditor.load')}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-gray-900 border-gray-800 text-white min-w-[150px]">
                <DropdownMenuItem onClick={() => openLocalProjectsFolder()} className="hover:bg-gray-800 cursor-pointer p-3">
                  <Folder className="w-4 h-4 mr-2 text-green-400" />
                  {t('audioEditor.localProjects')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openLocalAudioFolder()} className="hover:bg-gray-800 cursor-pointer p-3">
                  <FileAudio className="w-4 h-4 mr-2 text-amber-400" />
                  {t('audioEditor.localAudios')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-green-400"><FolderOpen className="w-4 h-4 mr-2" /> {t('audioEditor.load')}</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setIsSaveModalOpen(true)} className="text-xs text-gray-400"><Save className="w-4 h-4 mr-2" /> {t('audioEditor.save')}</Button>
          <div className="w-px h-6 bg-gray-800 mx-1" />
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-gray-400 hover:text-red-400"><X className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-gradient-to-b from-gray-900 to-gray-950 shrink-0 border-b border-gray-800/50">
          <AudioVisualizer
            audioContext={audioContext}
            audioSource={audioSource}
            isPlaying={isPlaying && !isEQBypassed}
            currentTime={currentTime}
            duration={editState.timeline?.duration || 0}
            height={400}
            showInfo={true}
            isBypassed={isEQBypassed}
            showLiveInput={true}
            color={vizColor}
            trackTitle={displayTitle}
            showTransport={true}
            onPlayPause={setIsPlaying}
            onPrevTrack={sortedClips.length > 1 ? goToPrevClip : undefined}
            onNextTrack={sortedClips.length > 1 ? goToNextClip : undefined}
            deckAActive={showMidiKeyboard}
            deckBActive={!showMidiKeyboard}
            onRecordingComplete={handleRecordingComplete}
            />

        </div>
        <div className="shrink-0 border-b border-gray-800/50 bg-gray-950">
          <ZeusEQ masterGain={Math.round(20 * Math.log10(volume || 0.0001))} onMasterGainChange={(db) => setVolume(Math.pow(10, db / 20))} isBypassed={isEQBypassed} onBypassChange={(bypassed) => { setIsEQBypassed(bypassed); if (bypassed) setIsPlaying(false); }} isPlaying={isPlaying} showLiveInput={true} bands={eqBands} onBandChange={handleBandChange} audioContext={audioContext} audioSource={audioSource} vizColor={vizColor} onColorChange={setVizColor} />
        </div>
        <div className="flex-1 min-h-[200px] overflow-hidden flex flex-col">
          {showMidiKeyboard ? (
            <div className="flex-1 min-h-0 flex flex-col w-full overflow-y-auto overflow-x-hidden">
              <TecladoMidi embedded audioContext={audioContext} masterOutput={audioSource as AudioNode} roomColor={vizColor} engineActive={!isEQBypassed} />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden bg-gray-950/50">
            {memoizedTimelineComp}
            </div>
          )}
        </div>
        {!showMidiKeyboard && (
        <div className="bg-gray-900 border-t border-gray-800 p-4 shrink-0 shadow-[0_-10px_20px_rgba(0,0,0,0.3)]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 max-w-6xl mx-auto">
            <div className="space-y-2">
              <Label className={`font-bold text-[9px] uppercase tracking-[0.2em] flex items-center gap-2 transition-colors duration-500 ${isEQBypassed ? 'text-gray-600' : 'text-green-400'}`}><RotateCcw className="w-3 h-3" /> {t('audioEditor.startPoint')}</Label>
              <div className="flex items-center gap-3">
                <Slider 
                  min={0} 
                  max={selectedClip ? (selectedClip.sourceDuration || 100) : 100} 
                  step={0.1} 
                  value={[editState.trimStart]} 
                  onValueChange={handleTrimStartChange} 
                  className={`flex-1 transition-all duration-500 ${isEQBypassed ? 'opacity-30 grayscale' : ''}`} 
                  disabled={isEQBypassed} 
                  thumbClassName={isEQBypassed ? "slider-thumb-rect-striped" : "slider-thumb-rect-striped-green"} 
                  rangeClassName="!bg-gray-700" 
                />
                <span className={`text-[10px] font-mono min-w-[40px] text-right transition-colors duration-500 ${isEQBypassed ? 'text-gray-700' : 'text-gray-400'}`}>{formatTime(editState.trimStart)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className={`font-bold text-[9px] uppercase tracking-[0.2em] flex items-center gap-2 transition-colors duration-500 ${isEQBypassed ? 'text-gray-600' : 'text-blue-400'}`}><FastForward className="w-3 h-3" /> {t('audioEditor.speed')}</Label>
              <div className="flex items-center gap-3">
                <Slider 
                  min={0.25} 
                  max={2} 
                  step={0.05} 
                  value={[editState.playbackRate || 1]} 
                  onValueChange={handlePlaybackRateChange} 
                  className={`flex-1 transition-all duration-500 ${isEQBypassed ? 'opacity-30 grayscale' : ''}`} 
                  disabled={isEQBypassed} 
                  thumbClassName={isEQBypassed ? "slider-thumb-rect-striped" : "slider-thumb-rect-striped-green"} 
                  rangeClassName="!bg-gray-700" 
                />
                <span className={`text-[10px] font-mono min-w-[40px] text-right transition-colors duration-500 ${isEQBypassed ? 'text-gray-700' : 'text-gray-400'}`}>{(editState.playbackRate || 1).toFixed(2)}x</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className={`font-bold text-[9px] uppercase tracking-[0.2em] flex items-center gap-2 transition-colors duration-500 ${isEQBypassed ? 'text-gray-600' : 'text-green-400'}`}><FastForward className="w-3 h-3" /> {t('audioEditor.endPoint')}</Label>
              <div className="flex items-center gap-3">
                <Slider 
                  min={0.1} 
                  max={selectedClip?.sourceDuration || 100} 
                  step={0.1} 
                  value={[editState.trimEnd || (selectedClip?.sourceDuration || 100)]} 
                  onValueChange={handleTrimEndChange} 
                  className={`flex-1 transition-all duration-500 ${isEQBypassed ? 'opacity-30 grayscale' : ''}`} 
                  disabled={isEQBypassed} 
                  thumbClassName={isEQBypassed ? "slider-thumb-rect-striped" : "slider-thumb-rect-striped-green"} 
                  rangeClassName="!bg-gray-700" 
                />
                <span className={`text-[10px] font-mono min-w-[40px] text-right transition-colors duration-500 ${isEQBypassed ? 'text-gray-700' : 'text-gray-400'}`}>{formatTime(editState.trimEnd)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 items-start">
              <div className="space-y-2">
                <Label className={`font-bold text-[9px] uppercase tracking-[0.2em] flex items-center gap-2 transition-colors duration-500 ${isEQBypassed ? 'text-gray-600' : 'text-green-400'}`}><Volume2 className="w-3 h-3" /> {t('audioEditor.fadeIn')}</Label>
                <div className="flex items-center gap-3"><Slider min={0} max={10} step={0.1} value={[editState.fadeInDuration]} onValueChange={handleFadeInChange} className={`flex-1 transition-all duration-500 ${isEQBypassed ? 'opacity-30 grayscale' : ''}`} disabled={isEQBypassed} thumbClassName={isEQBypassed ? "slider-thumb-rect-striped" : "slider-thumb-rect-striped-green"} rangeClassName="!bg-gray-700" /><span className={`text-[10px] font-mono min-w-[20px] transition-colors duration-500 ${isEQBypassed ? 'text-gray-700' : 'text-gray-400'}`}>{editState.fadeInDuration}s</span></div>
              </div>
              <div className="space-y-2">
                <Label className={`font-bold text-[9px] uppercase tracking-[0.2em] flex items-center gap-2 transition-colors duration-500 ${isEQBypassed ? 'text-gray-600' : 'text-red-400'}`}><Volume2 className="w-3 h-3" /> {t('audioEditor.fadeOut')}</Label>
                <div className="flex items-center gap-3"><Slider min={0} max={10} step={0.1} value={[editState.fadeOutDuration]} onValueChange={handleFadeOutChange} className={`flex-1 transition-all duration-500 ${isEQBypassed ? 'opacity-30 grayscale' : ''}`} disabled={isEQBypassed} thumbClassName={isEQBypassed ? "slider-thumb-rect-striped" : "slider-thumb-rect-striped-red"} rangeClassName="!bg-gray-700" /><span className={`text-[10px] font-mono min-w-[20px] transition-colors duration-500 ${isEQBypassed ? 'text-gray-700' : 'text-gray-400'}`}>{editState.fadeOutDuration}s</span></div>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>

      <TimelinePlayer timeline={editState.timeline} currentTime={currentTime} isPlaying={isPlaying} onTimeUpdate={handleTimeUpdate} audioContext={audioContext} masterOutput={audioSource} resetToStartOnEnd onReachedEnd={() => setIsPlaying(false)} fileCache={fileCache} />
      <Modal isOpen={isSaveModalOpen} onClose={() => setIsSaveModalOpen(false)} title={t('audioEditor.saveModalTitle')} size="md">
        <SaveAudioProjectForm 
          onSave={saveProjectLocal} 
          onClose={() => setIsSaveModalOpen(false)} 
          isSaving={isSavingProject} 
          initialFiles={Array.from(fileCache.current.values())}
        />
      </Modal>
      <Modal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} title={t('audioEditor.exportModalTitle')} size="md">
        <div className="p-6 space-y-4 text-white">
          <div className="space-y-2"><Label>{t('audioEditor.exportFileName')}</Label><input value={exportConfig.title} onChange={e => setExportConfig({...exportConfig, title: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2" /></div>
          <div className="space-y-2"><Label>{t('audioEditor.exportFormat')}</Label><select value={exportConfig.format} onChange={e => setExportConfig({...exportConfig, format: e.target.value as any})} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2">
              <option value="wav">{t('audioEditor.exportFormatWav')}</option>
              <option value="mp3-local">{t('audioEditor.exportFormatMp3')}</option>
            </select><p className="text-[10px] text-gray-500 italic">{exportConfig.format === 'mp3-local' ? t('audioEditor.exportMp3Hint') : t('audioEditor.exportWavHint')}</p></div>
          <Button onClick={handleExportAudio} disabled={isExporting} className="w-full bg-green-600 hover:bg-green-700 mt-4">{isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}{isExporting ? t('audioEditor.exportProcessing') : exportConfig.format === 'mp3-local' ? t('audioEditor.exportMp3Local') : t('audioEditor.exportMixAndExport')}</Button>
        </div>
      </Modal>
      <Modal isOpen={isLoadModalOpen} onClose={() => setIsLoadModalOpen(false)} title={loadType === 'proyectos' ? t('audioEditor.loadProjectModalTitle') : t('audioEditor.loadAudioModalTitle')} size="lg">
        <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {loadType === 'proyectos' && (
            <div className="space-y-4">
              {pbLoading && <p className="text-center py-10 text-gray-500 italic flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('audioEditor.scanningProjects')}
              </p>}
              {!pbLoading && savedProjects.length === 0 && <p className="text-center py-10 text-gray-500 italic">{t('audioEditor.noProjectsFound')}</p>}
              
              {!pbLoading && savedProjects.length > 0 && (
                <div className="grid grid-cols-1 gap-2">
                  {savedProjects.map((p, i) => (
                    <div 
                      key={i} 
                      className="flex items-center justify-between p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer group"
                      onClick={() => handleOpenLocalProject(p)}
                    >
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="p-2 bg-green-500/20 rounded-lg group-hover:bg-green-500/40 transition-colors">
                          <Music className="w-5 h-5 text-green-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-white text-sm truncate">{p.titulo}</h4>
                          <p className="text-[10px] text-gray-500 truncate">{p.path}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                          {t('audioEditor.open')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {loadType === 'local' && (
            <div className="space-y-4">
              {pbLoading && <p className="text-center py-10 text-gray-500 italic flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('audioEditor.scanningFolder')}
              </p>}
              {!pbLoading && localFolderFiles.length === 0 && <p className="text-center py-10 text-gray-500 italic">{t('audioEditor.noAudioFilesFound')}</p>}
              
              {!pbLoading && localFolderFiles.length > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full mb-3 border-2 border-amber-500 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white gap-1.5 font-bold uppercase tracking-widest text-[10px]"
                    disabled={isAddingAllToQueue}
                    onClick={() => {
                      const queueItems = localFolderFiles.map(f => ({
                        url: `${getMediaUrl(f.path)}`,
                        fileName: f.name || f.fileName || t('audioEditor.localFile')
                      }));
                      addAllFilesToQueue(queueItems, 'local-folder');
                    }}
                  >
                    {isAddingAllToQueue ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    {t('audioEditor.addFolderToQueue')}
                  </Button>

                  <div className="grid grid-cols-1 gap-2">
                    {localFolderFiles.map((f, i) => (
                      <div 
                        key={i} 
                        className="flex items-center justify-between p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer group"
                        onClick={() => loadSingleFile({
                          url: `${getMediaUrl(f.path)}`,
                          fileName: f.name || f.fileName || t('audioEditor.localFile')
                        })}
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="p-2 bg-amber-500/20 rounded-lg group-hover:bg-amber-500/40 transition-colors">
                            <Music className="w-5 h-5 text-amber-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-white text-sm truncate">{f.name || f.fileName}</h4>
                            <p className="text-[10px] text-gray-500 truncate">{f.path}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addFileToQueue({
                                url: `${getMediaUrl(f.path)}`,
                                fileName: f.name || f.fileName || t('audioEditor.localFile')
                              });
                            }}
                            className="p-2 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white rounded-lg transition-colors"
                            title={t('audioEditor.addToQueueTitle')}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Modal>
      <Modal isOpen={isUploaderOpen} onClose={() => { setIsUploaderOpen(false); setUploaderLocalFiles([]); }} title={t('audioEditor.uploaderModalTitle')} size="md">
        <div className="p-6 space-y-6">
          <FileUploader onFilesSelected={handleFilesSelected} accept="audio/*" multiple={false} />

          <div className="border-t border-gray-700 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Folder className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-gray-300">{t('audioEditor.localFiles')}</span>
            </div>
            {uploaderLocalLoading && (
              <p className="text-center py-4 text-gray-500 italic flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('audioEditor.loadingLocalFiles')}
              </p>
            )}
            {!uploaderLocalLoading && uploaderLocalFiles.length === 0 && (
              <p className="text-center py-4 text-gray-500 italic text-xs">{t('audioEditor.noLocalAudioFiles')}</p>
            )}
            {!uploaderLocalLoading && uploaderLocalFiles.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {uploaderLocalFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer group"
                    onClick={() => {
                      loadSingleFile({
                        url: `${getMediaUrl(f.path)}`,
                        fileName: f.name || f.fileName || t('audioEditor.localFile')
                      });
                      setIsUploaderOpen(false);
                      setUploaderLocalFiles([]);
                    }}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="text-amber-400">
                        <Music className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{f.name || f.fileName}</p>
                        <p className="text-[10px] text-gray-500 truncate">{f.path}</p>
                      </div>
                    </div>
                    <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg text-[10px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                      {t('audioEditor.open')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
      <GenerateMusicModal
        isOpen={isGenerateMusicModalOpen}
        onClose={() => setIsGenerateMusicModalOpen(false)}
        onGenerated={handleGeneratedMusic}
        onLoopSelected={handleLoopSelected}
      />

      <Modal
        isOpen={isSeparateModalOpen}
        onClose={() => { if (!isSeparating) setIsSeparateModalOpen(false); }}
        title={
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/20 rounded-lg">
              <Music className="w-5 h-5 text-cyan-400" />
            </div>
            <span>{t('audioEditor.demucsModalTitle')}</span>
          </div>
        }
        size="md"
        closeOnOverlayClick={!isSeparating}
        closeOnEsc={!isSeparating}
      >
        <div className="p-6 space-y-6 text-white">
          <p className="text-sm text-gray-400">
            {t('audioEditor.demucsDesc')}
          </p>

          {demucsAvailable === null && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('audioEditor.demucsChecking')}
            </div>
          )}

          {demucsAvailable === false && (
            <div className="space-y-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-red-500/20 rounded-lg shrink-0">
                  <Music className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-red-400">{t('audioEditor.demucsUnavailable')}</p>
                  <p className="text-sm text-gray-300 mt-1">{demucsMessage}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {t('audioEditor.demucsNeedPython')}
                  </p>
                </div>
              </div>
              <Button
                onClick={handleInstallDemucs}
                disabled={isInstallingDemucs}
                className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold"
              >
                {isInstallingDemucs ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('audioEditor.demucsInstalling')}</>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> {t('audioEditor.demucsInstallBtn')}</>
                )}
              </Button>
            </div>
          )}

          {demucsAvailable === true && (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400">{t('audioEditor.demucsModelLabel')}</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'htdemucs', label: t('audioEditor.demucsModel4Stems'), desc: t('audioEditor.demucsModel4StemsDesc') },
                    { id: 'htdemucs_6s', label: t('audioEditor.demucsModel6Stems'), desc: t('audioEditor.demucsModel6StemsDesc') },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedDemucsModel(m.id as DemucsModel)}
                      disabled={isSeparating}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        selectedDemucsModel === m.id
                          ? 'bg-cyan-600 border-cyan-500 text-white shadow-lg'
                          : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <p className="font-bold">{m.label}</p>
                      <p className="text-xs opacity-80">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {selectedClip?.mediaFileId ? (
                <div className="p-3 bg-gray-900 border border-gray-800 rounded-xl">
                  <p className="text-xs font-black uppercase tracking-widest text-gray-500">{t('audioEditor.demucsSelectedAudio')}</p>
                  <p className="text-sm text-white truncate">{selectedClip.label || t('audioEditor.demucsUnnamedClip')}</p>
                </div>
              ) : (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
                  {t('audioEditor.demucsNoClip')}
                </div>
              )}

              {isSeparating && (
                <div className="space-y-2 p-4 bg-gray-900/50 border border-gray-800 rounded-2xl">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                    {separateStatus || t('audioEditor.demucsSeparating')}
                  </div>
                  <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, separateProgress))}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">{t('audioEditor.demucsTakesMinutes')}</p>
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-800">
            <Button
              variant="ghost"
              onClick={() => setIsSeparateModalOpen(false)}
              disabled={isSeparating}
              className="text-gray-400 hover:text-white"
            >
              {t('audioEditor.demucsClose')}
            </Button>
            {demucsAvailable === true && (
              <Button
                onClick={handleSeparateStems}
                disabled={isSeparating || !selectedClip?.mediaFileId}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold"
              >
                {isSeparating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('audioEditor.demucsSeparating')}</>
                ) : (
                  <><Music className="w-4 h-4 mr-2" /> {t('audioEditor.demucsSeparateBtn')}</>
                )}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
