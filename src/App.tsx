/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  Loader2,
  Music,
  RefreshCw,
  Scissors,
  Settings2,
  Tag,
  Trash2,
  Upload,
  Video,
  Volume2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ConversionOptions {
  format: string;
  bitrate: string;
  volume: string;
  startTime: string;
  duration: string;
  title: string;
  artist: string;
  album: string;
  fadeIn: string;
  fadeOut: string;
}

interface FileItem {
  id: string;
  file: File;
  status: 'idle' | 'converting' | 'completed' | 'error';
  progress: number;
  options: ConversionOptions;
  resultUrl?: string;
  resultFormat?: string;
  error?: string;
  expiresAt: number;
}

type AppPage = 'home' | 'convert' | 'features' | 'docs' | 'privacy' | 'terms';

const FORMATS = [
  { id: 'mp3', name: 'MP3' },
  { id: 'wav', name: 'WAV' },
  { id: 'flac', name: 'FLAC' },
  { id: 'aac', name: 'AAC' },
  { id: 'ogg', name: 'OGG' },
  { id: 'm4a', name: 'M4A' },
];

const BITRATES = ['128k', '192k', '320k', 'lossless'];
const AUTO_DELETE_MS = 15 * 60 * 1000;
const AD_UNLOCK_WATCH_SECONDS = 30;
const AD_UNLOCK_MS = 15 * 60 * 1000;

// Fill these with your real ad script URLs and zone/embed snippets.
const ADSTERRA_SCRIPT_SRC = 'https://pl28924863.effectivegatecpm.com/d1/ee/1e/d1ee1e9958ae4b01aa34bc99c493d945.js';
const ADSTERRA_BANNER_728_KEY = 'bf7f39805200f7da2379190571359d26';
const ADSTERRA_BANNER_728_SRC = 'https://www.highperformanceformat.com/bf7f39805200f7da2379190571359d26/invoke.js';

const ffmpegRef = new FFmpeg();

const getPageFromPath = (): AppPage => {
  const path = window.location.pathname;
  if (path === '/convert') return 'convert';
  if (path === '/features') return 'features';
  if (path === '/documentation') return 'docs';
  if (path === '/privacy') return 'privacy';
  if (path === '/terms') return 'terms';
  return 'home';
};

const getMediaDuration = (file: File): Promise<number | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });

const downloadFile = (url: string, originalName: string, format: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = `${originalName.split('.')[0]}.${format}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>(getPageFromPath);
  const [adUnlockedUntil, setAdUnlockedUntil] = useState(0);
  const [watchSecondsLeft, setWatchSecondsLeft] = useState(AD_UNLOCK_WATCH_SECONDS);
  const [isAdModalOpen, setIsAdModalOpen] = useState(false);
  const [isWatchingUnlockAd, setIsWatchingUnlockAd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const adWatchTimerRef = useRef<number | null>(null);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setActivePage(getPageFromPath());
  };

  useEffect(() => {
    const onPop = () => setActivePage(getPageFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem('ad_unlock_until');
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && parsed > Date.now()) {
      setAdUnlockedUntil(parsed);
    }
  }, []);

  useEffect(() => {
    if (ADSTERRA_SCRIPT_SRC) {
      const s = document.createElement('script');
      s.src = ADSTERRA_SCRIPT_SRC;
      s.async = true;
      s.setAttribute('data-ad-network', 'adsterra');
      document.body.appendChild(s);
      return () => {
        if (s.parentNode) s.parentNode.removeChild(s);
      };
    }
    return;
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activePage]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (adUnlockedUntil > 0 && now >= adUnlockedUntil) {
        setAdUnlockedUntil(0);
        window.localStorage.removeItem('ad_unlock_until');
      }
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [adUnlockedUntil]);

  useEffect(() => {
    return () => {
      if (adWatchTimerRef.current) {
        window.clearInterval(adWatchTimerRef.current);
        adWatchTimerRef.current = null;
      }
    };
  }, []);

  // Auto-clean local in-memory files to keep the app responsive over time.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setFiles((prev) => {
        let changed = false;
        const next = prev.filter((f) => {
          if (now >= f.expiresAt) {
            if (f.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(f.resultUrl);
            changed = true;
            return false;
          }
          return true;
        });
        return changed ? next : prev;
      });
    }, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  const handleFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;

    const validFiles: FileItem[] = Array.from(newFiles)
      .filter((file) => {
        const isAudio = file.type.startsWith('audio/');
        const isVideo = file.type.startsWith('video/');
        const hasExt = /\.(mp3|wav|flac|aac|ogg|m4a|mp4|mkv|avi|mov|wmv)$/i.test(file.name);
        return isAudio || isVideo || hasExt;
      })
      .map((file) => ({
        id: Math.random().toString(36).slice(2, 10),
        file,
        status: 'idle' as const,
        progress: 0,
        options: {
          format: 'mp3',
          bitrate: '192k',
          volume: '1.0',
          startTime: '',
          duration: '',
          title: file.name.split('.')[0],
          artist: '',
          album: '',
          fadeIn: '',
          fadeOut: '',
        },
        expiresAt: Date.now() + AUTO_DELETE_MS,
      }));

    setFiles((prev) => [...prev, ...validFiles]);
    if (activePage !== 'convert') navigate('/convert');
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const fileToRemove = prev.find((f) => f.id === id);
      if (fileToRemove?.resultUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(fileToRemove.resultUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  const clearAll = () => {
    files.forEach((f) => {
      if (f.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(f.resultUrl);
    });
    setFiles([]);
  };

  const updateOptions = (id: string, updates: Partial<ConversionOptions>) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;

        // If a completed file is edited, invalidate stale output so user must reconvert.
        if (f.status === 'completed') {
          if (f.resultUrl?.startsWith('blob:')) URL.revokeObjectURL(f.resultUrl);
          return {
            ...f,
            status: 'idle',
            progress: 0,
            resultUrl: undefined,
            resultFormat: undefined,
            error: undefined,
            options: { ...f.options, ...updates },
          };
        }

        return {
          ...f,
          status: f.status === 'error' ? 'idle' : f.status,
          error: undefined,
          options: { ...f.options, ...updates },
        };
      })
    );
  };

  const convertFile = async (item: FileItem) => {
    setFiles((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: 'converting', progress: 0 } : f)));

    try {
      if (!ffmpegRef.loaded) {
        setFfmpegLoading(true);
        await ffmpegRef.load({
          coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
          wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
        });
        setFfmpegLoading(false);
      }

      const { format, bitrate, volume, startTime, duration, title, artist, album, fadeIn, fadeOut } = item.options;
      const extension = item.file.name.split('.').pop() ?? 'bin';
      const inputName = `in_${item.id}.${extension}`;
      const outputName = `out_${item.id}.${format}`;

      const onProgress = ({ progress }: { progress: number }) => {
        setFiles((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, progress: Math.min(99, Math.round(progress * 100)) } : f))
        );
      };

      ffmpegRef.on('progress', onProgress);
      await ffmpegRef.writeFile(inputName, await fetchFile(item.file));

      const args: string[] = ['-i', inputName];
      if (startTime) args.push('-ss', startTime);
      if (duration) args.push('-t', duration);

      const filters: string[] = [];
      if (volume !== '1.0') filters.push(`volume=${volume}`);
      if (fadeIn && parseFloat(fadeIn) > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
      if (fadeOut && parseFloat(fadeOut) > 0) {
        const totalDuration = await getMediaDuration(item.file);
        const effectiveDuration = duration ? parseFloat(duration) : totalDuration;
        if (effectiveDuration && !isNaN(effectiveDuration)) {
          const start = Math.max(0, effectiveDuration - parseFloat(fadeOut));
          filters.push(`afade=t=out:st=${start}:d=${fadeOut}`);
        }
      }
      if (filters.length) args.push('-af', filters.join(','));

      if (title) args.push('-metadata', `title=${title}`);
      if (artist) args.push('-metadata', `artist=${artist}`);
      if (album) args.push('-metadata', `album=${album}`);

      if (bitrate !== 'lossless' && format !== 'flac' && format !== 'wav') {
        args.push('-b:a', bitrate);
      }

      args.push('-vn', outputName);

      const exitCode = await ffmpegRef.exec(args);
      ffmpegRef.off('progress', onProgress);
      if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);

      const data = (await ffmpegRef.readFile(outputName)) as Uint8Array;
      const mimeMap: Record<string, string> = {
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        flac: 'audio/flac',
        aac: 'audio/aac',
        ogg: 'audio/ogg',
        m4a: 'audio/mp4',
      };
      const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeMap[format] ?? 'audio/mpeg' });
      const resultUrl = URL.createObjectURL(blob);

      try {
        await ffmpegRef.deleteFile(inputName);
      } catch {
        // ignore cleanup failures
      }
      try {
        await ffmpegRef.deleteFile(outputName);
      } catch {
        // ignore cleanup failures
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id
            ? { ...f, status: 'completed', progress: 100, resultUrl, resultFormat: format, expiresAt: Date.now() + AUTO_DELETE_MS }
            : f
        )
      );
    } catch (error) {
      console.error('Conversion error:', error);
      setFfmpegLoading(false);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === item.id ? { ...f, status: 'error', error: 'Conversion failed. The file may be unsupported.' } : f
        )
      );
    }
  };

  const convertAll = () => {
    files.filter((f) => f.status === 'idle').forEach(convertFile);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const isAdUnlocked = adUnlockedUntil > Date.now();
  const unlockSecondsLeft = Math.max(0, Math.floor((adUnlockedUntil - Date.now()) / 1000));

  const startUnlockAdWatch = () => {
    if (isWatchingUnlockAd) return;
    setIsAdModalOpen(true);
    setIsWatchingUnlockAd(true);
    setWatchSecondsLeft(AD_UNLOCK_WATCH_SECONDS);

    if (adWatchTimerRef.current) {
      window.clearInterval(adWatchTimerRef.current);
      adWatchTimerRef.current = null;
    }

    adWatchTimerRef.current = window.setInterval(() => {
      setWatchSecondsLeft((prev) => {
        if (prev <= 1) {
          if (adWatchTimerRef.current) {
            window.clearInterval(adWatchTimerRef.current);
            adWatchTimerRef.current = null;
          }
          const unlockUntil = Date.now() + AD_UNLOCK_MS;
          setAdUnlockedUntil(unlockUntil);
          window.localStorage.setItem('ad_unlock_until', String(unlockUntil));
          setIsWatchingUnlockAd(false);
          setIsAdModalOpen(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);
  };

  const closeAdModal = () => {
    if (isWatchingUnlockAd) return;
    setIsAdModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-emerald-500/30">
      <nav className="fixed top-0 w-full z-50 bg-black/50 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Music className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">AudioConvert</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <button
              onClick={() => navigate('/convert')}
              className={cn('text-sm font-medium transition-colors', activePage === 'convert' ? 'text-emerald-400' : 'text-white/60 hover:text-white')}
            >
              Convert
            </button>
            <button
              onClick={() => navigate('/features')}
              className={cn('text-sm font-medium transition-colors', activePage === 'features' ? 'text-emerald-400' : 'text-white/60 hover:text-white')}
            >
              Features
            </button>
            <button
              onClick={() => navigate('/documentation')}
              className={cn('bg-white/5 hover:bg-white/10 px-5 py-2.5 rounded-full text-sm font-medium transition-all border border-white/10', activePage === 'docs' ? 'border-emerald-500 text-emerald-400' : 'text-white')}
            >
              Documentation
            </button>
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {ffmpegLoading && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-20 inset-x-0 z-40 flex justify-center pointer-events-none"
          >
            <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-black/80 border border-emerald-500/30 text-emerald-400 text-sm backdrop-blur-xl shadow-xl">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading audio engine - first conversion may take a moment
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pt-32 pb-32 px-6">
        <div className="max-w-6xl mx-auto mb-8">
          <div className={cn(
            'rounded-2xl border px-5 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4',
            isAdUnlocked ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'
          )}>
            <div>
              <p className="font-semibold text-sm md:text-base">
                {isAdUnlocked ? 'Conversion unlocked' : 'Ad unlock required for conversion'}
              </p>
              <p className="text-xs text-white/60 mt-1">
                {isAdUnlocked
                  ? `Access time left: ${Math.floor(unlockSecondsLeft / 60)}m ${unlockSecondsLeft % 60}s`
                  : 'Watch a 30-second ad to unlock converter tools for 15 minutes.'}
              </p>
            </div>
            <button
              onClick={startUnlockAdWatch}
              disabled={isAdUnlocked || isWatchingUnlockAd}
              className="bg-white text-black px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
            >
              {isAdUnlocked ? 'Unlocked' : isWatchingUnlockAd ? 'Watching...' : 'Watch Ad (30s)'}
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {activePage === 'home' ? (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-6xl mx-auto"
            >
              <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-emerald-500/15 via-cyan-500/5 to-transparent p-10 md:p-16">
                <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-emerald-500/20 blur-3xl" />
                <div className="absolute -bottom-20 -left-12 w-64 h-64 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="relative z-10 text-center">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="inline-block px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-8"
                  >
                    Fast • Private • Local-First
                  </motion.div>
                  <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-[1.05]">
                    Convert Audio and Video <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-emerald-400">Directly On Your Device</span>
                  </h1>
                  <p className="text-lg md:text-xl text-white/50 max-w-3xl mx-auto mb-10">
                    AudioConvert processes media locally in your browser. No account, no cloud storage, and no database dependency.
                  </p>
                  <div className="flex items-center justify-center gap-4 flex-wrap">
                    <button
                      onClick={() => navigate('/convert')}
                      className="bg-emerald-500 hover:bg-emerald-400 text-black px-12 py-5 rounded-2xl text-xl font-extrabold transition-all shadow-2xl shadow-emerald-500/25"
                    >
                      Convert
                    </button>
                    <button
                      onClick={() => navigate('/features')}
                      className="bg-white/5 hover:bg-white/10 border border-white/15 text-white px-8 py-5 rounded-2xl text-lg font-semibold transition-all"
                    >
                      Explore Features
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-10 space-y-6">
                <AdBanner title="Top Banner Ad" provider="Adsterra" unit="banner-728" />
              </div>
            </motion.div>
          ) : activePage === 'convert' ? (
            <motion.div
              key="convert"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="max-w-5xl mx-auto"
            >
              {!isAdUnlocked && (
                <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
                  <h3 className="text-2xl font-bold mb-3">Unlock Converter</h3>
                  <p className="text-white/60 mb-6">Watch a 30-second ad to enable conversion for 15 minutes.</p>
                  <button
                    onClick={startUnlockAdWatch}
                    disabled={isWatchingUnlockAd}
                    className="bg-emerald-500 hover:bg-emerald-400 text-black px-7 py-3 rounded-xl font-bold disabled:opacity-50"
                  >
                    {isWatchingUnlockAd ? `Watching... ${watchSecondsLeft}s` : 'Watch Ad To Unlock'}
                  </button>
                </div>
              )}

              <div
                onDragOver={(e) => {
                  if (!isAdUnlocked) return;
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  if (!isAdUnlocked) return;
                  e.preventDefault();
                  setIsDragging(false);
                  handleFiles(e.dataTransfer.files);
                }}
                className={cn(
                  'relative group transition-all duration-500',
                  isDragging ? 'scale-[0.98]' : 'scale-100',
                  !isAdUnlocked && 'opacity-60 pointer-events-none'
                )}
              >
                <div
                  className={cn(
                    'rounded-[40px] p-12 border-2 border-dashed transition-all duration-500 flex flex-col items-center justify-center text-center bg-white/5 backdrop-blur-sm',
                    isDragging ? 'border-emerald-500 bg-emerald-500/5' : 'border-white/10 hover:border-white/20'
                  )}
                >
                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    onChange={(e) => handleFiles(e.target.files)}
                    className="hidden"
                  />
                  <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                    <Upload className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2">Drop your files here</h3>
                  <p className="text-white/40 mb-8">Supports MP3, WAV, FLAC, MP4, MKV and more</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-emerald-500 hover:bg-emerald-400 text-black px-8 py-4 rounded-2xl font-bold transition-all shadow-xl shadow-emerald-500/20"
                  >
                    Select Files
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {files.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="mt-12 space-y-4">
                    <div className="flex items-center justify-between mb-8">
                      <h2 className="text-2xl font-bold">Queue ({files.length})</h2>
                      <div className="flex gap-4">
                        <button onClick={clearAll} className="text-sm text-white/40 hover:text-white transition-colors">
                          Clear All
                        </button>
                        <button
                          onClick={convertAll}
                          disabled={!isAdUnlocked}
                          className="bg-white text-black px-6 py-2.5 rounded-full text-sm font-bold hover:bg-emerald-400 transition-all"
                        >
                          Convert All
                        </button>
                      </div>
                    </div>

                    {files.map((item) => (
                      <FileCard
                        key={item.id}
                        item={item}
                        onRemove={() => removeFile(item.id)}
                        onUpdate={(updates: Partial<ConversionOptions>) => updateOptions(item.id, updates)}
                        onConvert={() => convertFile(item)}
                        canConvert={isAdUnlocked}
                        onRequestUnlock={startUnlockAdWatch}
                        formatFileSize={formatFileSize}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-10 space-y-6">
                <AdBanner title="Bottom Banner Ad" provider="Adsterra" unit="banner-728" />
              </div>
            </motion.div>
          ) : activePage === 'features' ? (
            <motion.div
              key="features"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-7xl mx-auto"
            >
              <div className="text-center mb-20">
                <h2 className="text-5xl font-bold mb-6">Professional Audio Suite</h2>
                <p className="text-xl text-white/40 max-w-2xl mx-auto">
                  Everything you need to perfect your audio files in one place.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <FeatureCard icon={<Scissors className="w-6 h-6" />} title="Precision Trimmer" desc="Cut and trim your audio with millisecond precision." />
                <FeatureCard icon={<Volume2 className="w-6 h-6" />} title="Volume Booster" desc="Increase volume up to 200% with clean gain control." />
                <FeatureCard icon={<Tag className="w-6 h-6" />} title="Metadata Editor" desc="Edit title, artist, and album tags quickly." />
                <FeatureCard icon={<RefreshCw className="w-6 h-6" />} title="Fade Effects" desc="Add smooth fade-in and fade-out transitions." />
                <FeatureCard icon={<Video className="w-6 h-6" />} title="Video Extraction" desc="Extract high-quality audio from common video formats." />
                <FeatureCard icon={<RefreshCw className="w-6 h-6" />} title="Batch Processing" desc="Convert multiple files with a single click." />
              </div>
            </motion.div>
          ) : activePage === 'docs' ? (
            <motion.div
              key="docs"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <h1 className="text-5xl font-bold mb-12">Documentation</h1>
              <div className="space-y-16 text-white/70">
                <section>
                  <h2 className="text-2xl font-bold mb-4 text-white">1. Add Files</h2>
                  <p>Go to Convert and drag-drop files or select them manually.</p>
                </section>
                <section>
                  <h2 className="text-2xl font-bold mb-4 text-white">2. Configure Output</h2>
                  <p>Adjust format, bitrate, volume, trimming, metadata, and fade effects per file.</p>
                </section>
                <section>
                  <h2 className="text-2xl font-bold mb-4 text-white">3. Convert Locally</h2>
                  <p>All conversion happens on your device using browser-based FFmpeg.</p>
                </section>
                <section>
                  <h2 className="text-2xl font-bold mb-4 text-white">4. Download</h2>
                  <p>Download processed files directly. Nothing is uploaded or stored on our server.</p>
                </section>
              </div>
            </motion.div>
          ) : activePage === 'privacy' ? (
            <motion.div
              key="privacy"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <h1 className="text-5xl font-bold mb-12">Privacy Policy</h1>
              <div className="prose prose-invert max-w-none space-y-8 text-white/60">
                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">Data Collection</h2>
                  <p>AudioConvert is privacy-first. We do not collect, store, or share personal data.</p>
                </section>
                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">Local Processing</h2>
                  <p>Your files are processed in your own browser on your own device, not in our cloud.</p>
                </section>
                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">No Server Storage</h2>
                  <p>Uploaded and converted files are not stored on our server and are not saved in a backend database.</p>
                </section>
              </div>
            </motion.div>
          ) : activePage === 'terms' ? (
            <motion.div
              key="terms"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <h1 className="text-5xl font-bold mb-12">Terms of Service</h1>
              <div className="prose prose-invert max-w-none space-y-8 text-white/60">
                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">Acceptance of Terms</h2>
                  <p>By using AudioConvert, you agree to these terms.</p>
                </section>
                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">Permitted Use</h2>
                  <p>You are responsible for ensuring you have the legal right to convert uploaded media.</p>
                </section>
                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">Disclaimer</h2>
                  <p>AudioConvert is provided as-is without warranties.</p>
                </section>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {isAdModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={closeAdModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-2xl rounded-3xl border border-white/10 bg-neutral-950 p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-2xl font-bold mb-2">Watch Ad To Unlock</h3>
              <p className="text-white/60 mb-6">
                Keep this window open for {AD_UNLOCK_WATCH_SECONDS} seconds. Unlock duration: 15 minutes.
              </p>
              <div className="mb-6 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${((AD_UNLOCK_WATCH_SECONDS - watchSecondsLeft) / AD_UNLOCK_WATCH_SECONDS) * 100}%` }}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <AdBanner title="Unlock Reward Ad" provider="Adsterra" unit="banner-728" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">Time left: {watchSecondsLeft}s</span>
                <button
                  onClick={closeAdModal}
                  disabled={isWatchingUnlockAd}
                  className="px-4 py-2 rounded-lg bg-white/10 text-white/80 disabled:opacity-40"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Music className="w-5 h-5 text-black" />
            </div>
            <span className="font-bold">AudioConvert</span>
          </div>
          <p className="text-white/20 text-sm">©2026 AudioConvert. developer by MahinLtd (Tanvir)</p>
          <div className="flex gap-8 text-sm text-white/40">
            <button onClick={() => navigate('/privacy')} className="hover:text-white transition-colors">Privacy</button>
            <button onClick={() => navigate('/terms')} className="hover:text-white transition-colors">Terms</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FileCard({
  item,
  onRemove,
  onUpdate,
  onConvert,
  canConvert,
  onRequestUnlock,
  formatFileSize,
}: {
  item: FileItem;
  onRemove: () => void;
  onUpdate: (updates: Partial<ConversionOptions>) => void;
  onConvert: () => void;
  canConvert: boolean;
  onRequestUnlock: () => void;
  formatFileSize: (bytes: number) => string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white/5 rounded-3xl border border-white/5 overflow-hidden"
    >
      <div className="p-6 flex flex-col md:flex-row md:items-center gap-6">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center flex-shrink-0">
            {item.file.type.includes('video') ? (
              <Video className="w-6 h-6 text-emerald-400" />
            ) : (
              <FileAudio className="w-6 h-6 text-emerald-400" />
            )}
          </div>
          <div className="min-w-0">
            <h4 className="font-bold truncate">{item.file.name}</h4>
            <div className="flex items-center gap-2">
              <p className="text-xs text-white/40">
                {formatFileSize(item.file.size)} - {item.file.type.split('/')[1]?.toUpperCase() || 'FILE'}
              </p>
              {item.status === 'error' && (
                <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {item.error}
                </span>
              )}
              {item.status === 'completed' && (
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Done
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={item.options.format}
            onChange={(e) => onUpdate({ format: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm font-medium outline-none focus:border-emerald-500 transition-all"
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id} className="bg-neutral-900">
                {f.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn('p-2.5 rounded-xl transition-all', isExpanded ? 'bg-emerald-500 text-black' : 'bg-white/5 hover:bg-white/10')}
          >
            <Settings2 className="w-5 h-5" />
          </button>

          {item.status === 'completed' ? (
            <button
              onClick={() => downloadFile(item.resultUrl!, item.file.name, item.resultFormat ?? item.options.format)}
              className="bg-emerald-500 hover:bg-emerald-400 text-black px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" /> Download
            </button>
          ) : (
            <button
              onClick={canConvert ? onConvert : onRequestUnlock}
              disabled={item.status === 'converting'}
              className={cn(
                'px-6 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50',
                canConvert ? 'bg-white text-black hover:bg-emerald-400' : 'bg-amber-500 text-black hover:bg-amber-400'
              )}
            >
              {item.status === 'converting' ? <Loader2 className="w-4 h-4 animate-spin" /> : canConvert ? 'Convert' : 'Unlock'}
            </button>
          )}

          <button onClick={onRemove} className="p-2.5 rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-all">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {item.status === 'converting' && (
        <div className="h-1 w-full bg-white/5">
          <motion.div initial={{ width: 0 }} animate={{ width: `${item.progress}%` }} className="h-full bg-emerald-500" />
        </div>
      )}

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 bg-black/20"
          >
            <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                    <Settings2 className="w-3 h-3" /> Bitrate / Quality
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {BITRATES.map((b) => (
                      <button
                        key={b}
                        onClick={() => onUpdate({ bitrate: b })}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                          item.options.bitrate === b ? 'bg-emerald-500 border-emerald-500 text-black' : 'border-white/10 hover:border-white/20'
                        )}
                      >
                        {b.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                    <Volume2 className="w-3 h-3" /> Volume Boost
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={item.options.volume}
                    onChange={(e) => onUpdate({ volume: e.target.value })}
                    className="w-full accent-emerald-500"
                  />
                  <div className="flex justify-between text-[10px] text-white/20">
                    <span>50%</span>
                    <span>100%</span>
                    <span>200%</span>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                    <Scissors className="w-3 h-3" /> Trim Audio
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-white/20">Start (sec)</span>
                      <input
                        type="text"
                        placeholder="0"
                        value={item.options.startTime}
                        onChange={(e) => onUpdate({ startTime: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-white/20">Duration (sec)</span>
                      <input
                        type="text"
                        placeholder="End"
                        value={item.options.duration}
                        onChange={(e) => onUpdate({ duration: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                    <RefreshCw className="w-3 h-3" /> Fade Effects
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-white/20">Fade In (sec)</span>
                      <input
                        type="text"
                        placeholder="0"
                        value={item.options.fadeIn}
                        onChange={(e) => onUpdate({ fadeIn: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-white/20">Fade Out (sec)</span>
                      <input
                        type="text"
                        placeholder="0"
                        value={item.options.fadeOut}
                        onChange={(e) => onUpdate({ fadeOut: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                  <Tag className="w-3 h-3" /> Metadata Editor
                </label>
                <input
                  type="text"
                  placeholder="Title"
                  value={item.options.title}
                  onChange={(e) => onUpdate({ title: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Artist"
                  value={item.options.artist}
                  onChange={(e) => onUpdate({ artist: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Album"
                  value={item.options.album}
                  onChange={(e) => onUpdate({ album: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="p-8 rounded-[32px] bg-white/5 border border-white/5 hover:border-white/10 transition-all group">
      <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h4 className="text-xl font-bold mb-3">{title}</h4>
      <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function AdBanner({ title, provider, unit }: { title: string; provider: 'Adsterra'; unit?: 'banner-728' }) {
  if (provider === 'Adsterra' && unit === 'banner-728') {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-xs uppercase tracking-widest text-white/40 mb-2">{provider} Banner 728x90</p>
        <AdsterraIframeUnit adKey={ADSTERRA_BANNER_728_KEY} scriptSrc={ADSTERRA_BANNER_728_SRC} width={728} height={90} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-widest text-white/40 mb-2">{provider} Banner</p>
      <div className="h-20 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center text-white/50 text-sm">
        {title} - paste {provider} banner embed here
      </div>
    </div>
  );
}

function AdsterraIframeUnit({
  adKey,
  scriptSrc,
  width,
  height,
}: {
  adKey: string;
  scriptSrc: string;
  width: number;
  height: number;
}) {
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    slot.innerHTML = '';

    const configScript = document.createElement('script');
    configScript.type = 'text/javascript';
    configScript.text = `atOptions = { key: '${adKey}', format: 'iframe', height: ${height}, width: ${width}, params: {} };`;

    const invokeScript = document.createElement('script');
    invokeScript.type = 'text/javascript';
    invokeScript.src = scriptSrc;
    invokeScript.async = true;

    slot.appendChild(configScript);
    slot.appendChild(invokeScript);

    return () => {
      slot.innerHTML = '';
    };
  }, [adKey, scriptSrc, width, height]);

  return (
    <div className="w-full overflow-x-auto">
      <div ref={slotRef} className="min-w-[728px] min-h-[90px] rounded-xl bg-black/20 border border-white/10" />
    </div>
  );
}
