'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Play, Pause, Download, Tag, ChevronDown, X, Music } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type LicenseType = 'royalty-free' | 'public-domain' | 'creative-commons';

interface JamendoTrack {
  id: number;
  name: string;
  artist_name: string;
  audio: string;
  audiodownload: string;
  audiodownload_allowed: boolean;
  image: string;
  album_name: string;
  license_cc: string;
  musicinfo: {
    tags: {
      genres: string[];
    };
  };
}

interface Track {
  id: number;
  title: string;
  artist: string;
  category: string;
  license: LicenseType;
  allowedUses: string[];
  prohibitedUses: string[];
  image: string;
  audioUrl: string;
  downloadUrl: string;
}

interface MusicPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientId: string;
  onAddToTimeline?: (url: string, fileName: string) => void;
}

interface TunetankTrack {
  name: string;
  artist: string;
  duration: number;
  bpm: number;
  preview_url: string;
  track_page_url: string;
  genres: string[];
  moods: string[];
  themes: string[];
}

const CATEGORIES = ['Todas', 'Electronic', 'House', 'Rock', 'Pop', 'Jazz', 'Classical', 'HipHop', 'Relaxation', 'World', 'Metal'] as const;
const PAGE_SIZE = 6;
const API_PROVIDERS = ['Jamendo', 'Tunetank'] as const;
type ApiProvider = typeof API_PROVIDERS[number];

const licenseInfo: Record<LicenseType, { label: string; color: string }> = {
  'royalty-free': { label: 'Royalty Free', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'public-domain': { label: 'app.publicDomain', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'creative-commons': { label: 'Creative Commons', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
};

const mapJamendoTrackToTrack = (jamendoTrack: JamendoTrack): Track => {
  const genre = jamendoTrack.musicinfo?.tags?.genres?.[0] || 'Pop';
  const licenseType: LicenseType = jamendoTrack.license_cc ? 'creative-commons' : 'royalty-free';
  
  return {
    id: jamendoTrack.id,
    title: jamendoTrack.name,
    artist: jamendoTrack.artist_name,
    category: genre,
    license: licenseType,
    allowedUses: ['Videos de YouTube', 'Streaming', 'Podcasts'],
    prohibitedUses: jamendoTrack.audiodownload_allowed ? ['Venta directa de la pista'] : ['Descarga no permitida'],
    image: jamendoTrack.image || 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=450&h=300&fit=crop',
    audioUrl: jamendoTrack.audio,
    downloadUrl: jamendoTrack.audiodownload_allowed ? jamendoTrack.audiodownload : '',
  };
};

const mapTunetankTrackToTrack = (tunetankTrack: any, index: number): Track => {
  console.log('Mapping Tunetank track:', tunetankTrack);
  
  const genre = tunetankTrack.genres?.[0] || tunetankTrack.moods?.[0] || 'Various';
  const audioUrl = tunetankTrack.preview || tunetankTrack.preview_url || tunetankTrack.audio_url || tunetankTrack.url;
  
  if (!audioUrl) {
    console.error('No audio URL found in Tunetank track:', tunetankTrack);
  }
  
  // Use proxy URL for Tunetank audio to avoid CORS
  const proxyAudioUrl = audioUrl ? `/api/tunetank-audio?url=${encodeURIComponent(audioUrl)}` : '';
  
  // Generate unique image based on track ID for visual variety using picsum.photos
  const trackId = tunetankTrack.id || index;
  const uniqueImage = `https://picsum.photos/450/300?random=${trackId}`;
  
  return {
    id: Date.now() + index,
    title: tunetankTrack.name || 'Unknown Track',
    artist: tunetankTrack.artist || 'Unknown Artist',
    category: genre,
    license: 'royalty-free',
    allowedUses: ['Videos de YouTube', 'Streaming', 'Podcasts', 'Instagram', 'TikTok', 'Twitch'],
    prohibitedUses: [],
    image: uniqueImage,
    audioUrl: proxyAudioUrl,
    downloadUrl: proxyAudioUrl, // Use proxy URL for both playback and download
  };
};

const searchTunetankMusic = async (query: string, page: number = 1, limit: number = 6): Promise<{ tracks: Track[]; totalCount: number }> => {
  try {
    const offset = (page - 1) * limit;
    const response = await fetch('/api/tunetank-music', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query === 'Todas' ? '' : query,
        limit: limit,
        offset: offset,
      }),
    });

    if (!response.ok) {
      console.error('Tunetank API error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return { tracks: [], totalCount: 0 };
    }

    const data = await response.json();
    console.log('Tunetank Response:', data);
    
    if (data.result && Array.isArray(data.result)) {
      // Tunetank doesn't provide total count, so we estimate based on returned tracks
      const tracks = data.result.map((track: TunetankTrack, index: number) => mapTunetankTrackToTrack(track, index));
      const totalCount = tracks.length >= limit ? (page + 1) * limit : page * limit; // Estimate for pagination
      return { tracks, totalCount };
    }
    
    return { tracks: [], totalCount: 0 };
  } catch (error) {
    console.error('Error fetching from Tunetank:', error);
    return { tracks: [], totalCount: 0 };
  }
};

const fetchTracksFromJamendo = async (category: string, page: number, clientId: string): Promise<{ tracks: Track[]; totalCount: number }> => {
  try {
    const offset = (page - 1) * PAGE_SIZE;
    let url = `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=${PAGE_SIZE}&offset=${offset}&include=musicinfo&include=licenses&imagesize=500&fullcount=true`;
    
    // Map category names to Jamendo tags
    const tagMap: Record<string, string> = {
      'Todas': '',
      'Electronic': 'electronic',
      'House': 'house',
      'Rock': 'rock',
      'Pop': 'pop',
      'Jazz': 'jazz',
      'Classical': 'classical',
      'HipHop': 'hiphop',
      'Relaxation': 'relaxation',
      'World': 'world',
      'Metal': 'metal',
    };
    
    const tag = tagMap[category];
    if (tag) {
      url += `&tags=${tag}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('API Response:', JSON.stringify(data, null, 2));
    
    if (data.results && Array.isArray(data.results)) {
      // Try multiple possible locations for the count
      const totalCount = data.headers?.count || 
                         data.headers?.results_fullcount || 
                         data.results?.length || 
                         0;
      
      console.log('Category:', category, 'Page:', page, 'TotalCount:', totalCount, 'Results:', data.results.length);
      
      // If count is unreasonably high (over 500,000), cap it at 500,000
      // This prevents pagination issues while still allowing large libraries
      const safeTotalCount = totalCount > 500000 ? 500000 : totalCount;
      
      return {
        tracks: data.results.map(mapJamendoTrackToTrack),
        totalCount: safeTotalCount,
      };
    }
    console.log('No results found for category:', category);
    return { tracks: [], totalCount: 0 };
  } catch (error) {
    console.error('Error fetching tracks from Jamendo:', error);
    return { tracks: [], totalCount: 0 };
  }
};

export default function MusicPlayerModal({ isOpen, onClose, clientId, onAddToTimeline }: MusicPlayerModalProps) {
  const { t } = useI18n();
  const [selectedCategory, setSelectedCategory] = useState<string>('Todas');
  const [selectedProvider, setSelectedProvider] = useState<ApiProvider>('Jamendo');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setIsClient(true);
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const loadTracks = async () => {
      setIsLoading(true);
      if (selectedProvider === 'Jamendo') {
        const { tracks: fetchedTracks, totalCount } = await fetchTracksFromJamendo(selectedCategory, currentPage, clientId);
        setTracks(fetchedTracks);
        const calculatedTotalPages = Math.ceil(totalCount / PAGE_SIZE);
        console.log('Pagination calc:', { totalCount, PAGE_SIZE, calculatedTotalPages, category: selectedCategory, currentPage });
        setTotalPages(calculatedTotalPages > 0 ? calculatedTotalPages : 1);
      } else {
        const { tracks: fetchedTracks, totalCount } = await searchTunetankMusic(selectedCategory, currentPage, PAGE_SIZE);
        setTracks(fetchedTracks);
        const calculatedTotalPages = Math.ceil(totalCount / PAGE_SIZE);
        setTotalPages(calculatedTotalPages > 0 ? calculatedTotalPages : 1);
      }
      setIsLoading(false);
    };
    loadTracks();
  }, [selectedCategory, currentPage, isOpen, clientId, selectedProvider]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      setPlayingId(null);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [playingId]);

  const handleCategoryChange = useCallback((category: string) => {
    setSelectedCategory(category);
    setCurrentPage(1);
    setIsDropdownOpen(false);
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  }, []);

  const handleProviderChange = useCallback((provider: ApiProvider) => {
    setSelectedProvider(provider);
    setIsProviderDropdownOpen(false);
    setTracks([]);
    setSelectedTrack(null);
    setCurrentPage(1);
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  }, []);

  const handleTrackSelect = useCallback((track: Track) => {
    setSelectedTrack(track);
  }, []);

  const togglePlay = useCallback((track: Track) => {
    if (!audioRef.current) {
      const audio = new Audio(track.audioUrl);
      audio.preload = 'none';
      audioRef.current = audio;
    }

    const audio = audioRef.current;

    if (playingId === track.id) {
      audio.pause();
      setPlayingId(null);
    } else {
      if (audio.src !== track.audioUrl) {
        audio.src = track.audioUrl;
        audio.load();
        setCurrentTime(0);
      }
      audio.play().catch(() => {
        setPlayingId(null);
      });
      setPlayingId(track.id);
    }
  }, [playingId]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownload = useCallback((track: Track) => {
    if (!track.downloadUrl) {
      alert('Este track no permite descarga');
      return;
    }
    const link = document.createElement('a');
    link.href = track.downloadUrl;
    link.download = `${track.title}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">{t('app.musicLibraryTitle')}</h2>
          <span className="text-sm font-bold text-yellow-400 tracking-wide">{t('app.royaltyFreeBadge')}</span>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* API Provider Dropdown */}
        <div className="p-4 border-b border-gray-800 relative z-30">
          <div className="relative">
            <button
              onClick={() => setIsProviderDropdownOpen(!isProviderDropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            >
              <span>{t('app.providerLabel', { provider: selectedProvider })}</span>
              <ChevronDown className={clsx('w-4 h-4 transition-transform', isProviderDropdownOpen && 'rotate-180')} />
            </button>
            {isProviderDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-lg shadow-xl z-50">
                {API_PROVIDERS.map((provider) => (
                  <button
                    key={provider}
                    onClick={() => handleProviderChange(provider as ApiProvider)}
                    className={clsx(
                      'w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors',
                      selectedProvider === provider ? 'bg-gray-700 text-red-400' : 'text-gray-300'
                    )}
                  >
                    {provider}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Category Dropdown */}
        <div className="p-4 border-b border-gray-800 relative z-20">
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            >
              <span>{selectedCategory}</span>
              <ChevronDown className={clsx('w-4 h-4 transition-transform', isDropdownOpen && 'rotate-180')} />
            </button>
            {isDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
                {CATEGORIES.map((category) => (
                  <button
                    key={category}
                    onClick={() => handleCategoryChange(category)}
                    className={clsx(
                      'w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors',
                      selectedCategory === category ? 'bg-gray-700 text-red-400' : 'text-gray-300'
                    )}
                  >
                    {category === 'Todas' ? t('app.all') : category}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tracks List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-gray-800 rounded-lg h-32 animate-pulse" />
              ))}
            </div>
          ) : tracks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400 text-sm">{t('app.noSongsCategory')}</p>
              <p className="text-gray-500 text-xs mt-2">{t('app.tryAnotherCategory')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {tracks.map((track) => {
                const license = licenseInfo[track.license];
                const isSelected = selectedTrack?.id === track.id;
                
                return (
                  <div
                    key={track.id}
                    onClick={() => handleTrackSelect(track)}
                    className={clsx(
                      'bg-gray-800 rounded-lg overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-red-500',
                      isSelected && 'ring-2 ring-red-500'
                    )}
                  >
                    <div className="relative h-20">
                      <img
                        src={track.image}
                        alt={track.title}
                        className="w-full h-full object-cover"
                      />
                      <span className={clsx(
                        'absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-semibold rounded border',
                        license.color
                      )}>
                        {license.label.startsWith('app.') ? t(license.label) : license.label}
                      </span>
                    </div>
                    <div className="p-2">
                      <h3 className="text-xs font-semibold text-white truncate">{track.title}</h3>
                      <p className="text-[10px] text-gray-400 truncate">{track.artist}</p>
                      <div className="mt-1 text-[9px] text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Tag className="w-2 h-2" />
                          {track.category}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-4">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                ←
              </button>
              <span className="text-xs text-gray-400">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                →
              </button>
            </div>
          )}
          {/* Debug info */}
          <div className="text-[9px] text-gray-600 mt-2 text-center">
            Debug: totalPages={totalPages}, currentPage={currentPage}
          </div>
        </div>

        {/* Active Player */}
        {selectedTrack && (
          <div className="border-t border-gray-800 p-4 bg-gray-950">
            <div className="flex items-center gap-4">
              <img
                src={selectedTrack.image}
                alt={selectedTrack.title}
                className="w-16 h-16 rounded-lg object-cover"
              />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white truncate">{selectedTrack.title}</h3>
                <p className="text-xs text-gray-400 truncate">{selectedTrack.artist}</p>
                
                {playingId === selectedTrack.id && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-8">{formatTime(currentTime)}</span>
                      <input
                        type="range"
                        min="0"
                        max={duration || 0}
                        value={currentTime}
                        onChange={handleSeek}
                        className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500"
                      />
                      <span className="text-[10px] text-gray-400 w-8">{formatTime(duration)}</span>
                    </div>
                  </div>
                )}
              </div>
              
               <div className="flex gap-2">
                 <button
                   onClick={() => togglePlay(selectedTrack)}
                   className={clsx(
                     'p-2 rounded-lg transition-colors',
                     playingId === selectedTrack.id
                       ? 'bg-red-600 hover:bg-red-700 text-white'
                       : 'bg-gray-800 hover:bg-gray-700 text-white'
                   )}
                 >
                   {playingId === selectedTrack.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                 </button>
                  {onAddToTimeline && (
                    <button
                      onClick={() => {
                        const url = selectedTrack.downloadUrl || selectedTrack.audioUrl;
                        onAddToTimeline(url, selectedTrack.title);
                        onClose();
                      }}
                      className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white transition-colors"
                    >
                      <Music className="w-4 h-4" />
                    </button>
                  )}
                 <button
                   onClick={() => handleDownload(selectedTrack)}
                   disabled={!selectedTrack.downloadUrl}
                   className={clsx(
                     'p-2 rounded-lg transition-colors',
                     selectedTrack.downloadUrl
                       ? 'bg-gray-800 hover:bg-gray-700 text-white'
                       : 'bg-gray-800/50 text-gray-500 cursor-not-allowed'
                   )}
                 >
                   <Download className="w-4 h-4" />
                 </button>
               </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
