import type { FacialEmotion } from '../types/nova';
import { getDesktopBridgeToken } from './desktopBridge';

// Client-side neural audio playback (Web Audio API with real-time FFT lip-sync),
// speed/volume controls, and SpeechRecognition helpers.

let sharedAudioCtx: AudioContext | null = null;
let activeSourceNode: AudioBufferSourceNode | null = null;
let activeAbortController: AbortController | null = null;
let lipSyncRafId = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

export function stopAllSpeech(): void {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  if (activeSourceNode) {
    try {
      activeSourceNode.stop();
      activeSourceNode.disconnect();
    } catch {
      // already stopped
    }
    activeSourceNode = null;
  }
  if (lipSyncRafId) {
    cancelAnimationFrame(lipSyncRafId);
    lipSyncRafId = 0;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export interface SpeakResult {
  engine: string;
}

export async function speakText(params: {
  text: string;
  voiceName: string;
  language: 'en' | 'ur';
  emotion?: FacialEmotion;
  voiceSpeed?: number;
  voiceVolume?: number;
  onStart?: () => void;
  onLipSync?: (openness: number, width: number) => void;
  onEnd?: () => void;
}): Promise<SpeakResult> {
  stopAllSpeech();
  const cleanText = params.text.trim();
  if (!cleanText) {
    params.onLipSync?.(0, 0);
    params.onEnd?.();
    return { engine: 'none' };
  }

  const controller = new AbortController();
  activeAbortController = controller;
  params.onStart?.();

  let engineUsed = 'urdu-neural-https';

  try {
    // When paired, prefer Microsoft Edge neural voices locally (Pakistani Urdu Uzma).
    const desktopToken = getDesktopBridgeToken();
    if (desktopToken) {
      try {
        const localResponse = await fetch('http://127.0.0.1:3210/v1/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${desktopToken}` },
          body: JSON.stringify({
            text: cleanText.slice(0, 2500),
            voice: params.language === 'ur' ? 'ur-PK-UzmaNeural' : 'en-US-JennyNeural',
            emotion: params.emotion || 'calm',
          }),
          signal: controller.signal,
        });
        if (localResponse.ok) {
          const localData = await localResponse.json() as {
            audioChunks?: Array<{ audioBase64: string; mimeType: string }>;
            engine?: string;
          };
          if (localData.audioChunks?.length) {
            engineUsed = localData.engine || 'microsoft-edge-neural';
            const speed = Math.min(1.6, Math.max(0.65, params.voiceSpeed ?? 1));
            const volume = Math.min(1.5, Math.max(0, params.voiceVolume ?? 1));
            for (const chunk of localData.audioChunks) {
              if (controller.signal.aborted) break;
              await playBufferWithLipSync({
                base64: chunk.audioBase64,
                speed,
                volume,
                signal: controller.signal,
                onLipSync: params.onLipSync,
              });
            }
            params.onLipSync?.(0, 0);
            params.onEnd?.();
            return { engine: engineUsed };
          }
        }
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // Continue with hosted TTS if the desktop companion is offline.
      }
    }

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        voiceName: params.voiceName,
        emotion: params.emotion || 'calm',
        language: params.language,
      }),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = (await res.json()) as {
        audioChunks?: Array<{ audioBase64: string; mimeType: string }>;
        engine?: string;
      };
      if (data.engine) engineUsed = data.engine;

      const chunks = data.audioChunks ?? [];
      if (chunks.length > 0 && !controller.signal.aborted) {
        const speed = Math.min(1.6, Math.max(0.65, params.voiceSpeed ?? 1.0));
        const volume = Math.min(1.5, Math.max(0.0, params.voiceVolume ?? 1.0));

        for (let i = 0; i < chunks.length; i++) {
          if (controller.signal.aborted) break;
          await playBufferWithLipSync({
            base64: chunks[i].audioBase64,
            speed,
            volume,
            signal: controller.signal,
            onLipSync: params.onLipSync,
          });
          // Natural brief breathing pause between phrases
          if (i < chunks.length - 1 && !controller.signal.aborted) {
            params.onLipSync?.(0, 0);
            await waitMs(55, controller.signal);
          }
        }
        params.onLipSync?.(0, 0);
        params.onEnd?.();
        return { engine: engineUsed };
      }
    }
  } catch (err) {
    if (controller.signal.aborted) {
      params.onLipSync?.(0, 0);
      params.onEnd?.();
      return { engine: 'aborted' };
    }
    void err;
  }

  // Browser female SpeechSynthesis safety fallback if server returned 0 chunks
  if (!controller.signal.aborted) {
    const playedBrowser = await playBrowserSpeechFallback({
      text: cleanText,
      language: params.language,
      speed: params.voiceSpeed ?? 1.0,
      volume: params.voiceVolume ?? 1.0,
      signal: controller.signal,
      onLipSync: params.onLipSync,
    });
    if (playedBrowser) {
      params.onLipSync?.(0, 0);
      params.onEnd?.();
      return { engine: 'browser-speech-synthesis' };
    }
  }

  params.onLipSync?.(0, 0);
  params.onEnd?.();
  return { engine: engineUsed };
}

function playBrowserSpeechFallback(params: {
  text: string;
  language: 'en' | 'ur';
  speed: number;
  volume: number;
  signal: AbortSignal;
  onLipSync?: (openness: number, width: number) => void;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      const utter = new SpeechSynthesisUtterance(params.text);
      const voices = window.speechSynthesis.getVoices();
      const preferredFemale =
        voices.find((v) =>
          params.language === 'ur'
            ? /ur|hi|pak|india/i.test(v.lang) && /female|uzma|swara|heera|lekha|google/i.test(v.name)
            : /female|jenny|zira|samantha|victoria|karen|aria|google uk english female/i.test(v.name)
        ) ||
        voices.find((v) => /female|woman|girl|zira|samantha|aria|jenny|google/i.test(v.name)) ||
        voices[0];

      if (preferredFemale) {
        utter.voice = preferredFemale;
        utter.lang = preferredFemale.lang;
      } else {
        utter.lang = params.language === 'ur' ? 'hi-IN' : 'en-US';
      }
      utter.rate = Math.min(1.4, Math.max(0.75, params.speed));
      utter.volume = Math.min(1, Math.max(0, params.volume));
      utter.pitch = 1.08;

      let animId = 0;
      let startTs = performance.now();
      const pumpLips = () => {
        if (params.signal.aborted) return;
        const elapsed = (performance.now() - startTs) / 1000;
        const open = 0.28 + Math.abs(Math.sin(elapsed * 11.5)) * 0.45;
        const width = 0.22 + Math.abs(Math.cos(elapsed * 8.2)) * 0.35;
        params.onLipSync?.(open, width);
        animId = requestAnimationFrame(pumpLips);
      };

      const finish = (ok: boolean) => {
        if (animId) cancelAnimationFrame(animId);
        params.onLipSync?.(0, 0);
        resolve(ok);
      };

      utter.onstart = () => {
        startTs = performance.now();
        pumpLips();
      };
      utter.onend = () => finish(true);
      utter.onerror = () => finish(false);
      params.signal.addEventListener(
        'abort',
        () => {
          window.speechSynthesis.cancel();
          finish(false);
        },
        { once: true }
      );

      // Guard if browser synthesis never fires onend in headless environments
      setTimeout(() => finish(false), Math.min(18000, Math.max(4500, params.text.length * 95)));
      window.speechSynthesis.speak(utter);
    } catch {
      resolve(false);
    }
  });
}

function waitMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

async function playBufferWithLipSync(params: {
  base64: string;
  speed: number;
  volume: number;
  signal: AbortSignal;
  onLipSync?: (openness: number, width: number) => void;
}): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  const binary = atob(params.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  } catch {
    return;
  }

  if (params.signal.aborted) return;

  return new Promise((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = params.speed;

    const gainNode = ctx.createGain();
    gainNode.gain.value = params.volume;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;

    source.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(ctx.destination);

    activeSourceNode = source;
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    let smoothOpen = 0;
    let smoothWidth = 0;

    const tick = () => {
      if (params.signal.aborted || activeSourceNode !== source) {
        params.onLipSync?.(0, 0);
        return;
      }
      analyser.getByteFrequencyData(freqData);
      // Low-mid vocal formant energy (bins 1..14)
      let lowSum = 0;
      for (let b = 1; b <= 14; b++) lowSum += freqData[b];
      const rawOpen = Math.min(1, lowSum / (14 * 125));

      // High-mid consonant/vowel articulation (bins 15..40)
      let highSum = 0;
      for (let b = 15; b <= 40; b++) highSum += freqData[b];
      const rawWidth = Math.min(1, highSum / (26 * 95));

      smoothOpen = smoothOpen * 0.45 + rawOpen * 0.55;
      smoothWidth = smoothWidth * 0.55 + rawWidth * 0.45;
      params.onLipSync?.(smoothOpen, smoothWidth);
      lipSyncRafId = requestAnimationFrame(tick);
    };

    const cleanup = () => {
      if (lipSyncRafId) {
        cancelAnimationFrame(lipSyncRafId);
        lipSyncRafId = 0;
      }
      if (activeSourceNode === source) {
        activeSourceNode = null;
      }
      params.onLipSync?.(0, 0);
      resolve();
    };

    source.onended = cleanup;
    params.signal.addEventListener('abort', cleanup, { once: true });

    try {
      source.start(0);
      tick();
    } catch {
      cleanup();
    }
  });
}

export interface SpeechRecognitionHandle {
  stop: () => void;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function startBrowserRecognition(opts: {
  lang?: string;
  continuous?: boolean;
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onError: (err: string) => void;
  onEnd: () => void;
}): SpeechRecognitionHandle | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.continuous = Boolean(opts.continuous);
  rec.interimResults = true;
  rec.lang = opts.lang || 'en-US';

  rec.onresult = (event) => {
    let combined = '';
    let isFinal = false;
    for (let i = 0; i < event.results.length; i++) {
      const resultItem = event.results[i] as unknown as {
        isFinal?: boolean;
        0?: { transcript?: string };
      };
      combined += resultItem[0]?.transcript || '';
      if (resultItem.isFinal) isFinal = true;
    }
    opts.onTranscript(combined.trim(), isFinal);
  };

  rec.onerror = (ev) => {
    opts.onError(ev.error || 'Speech recognition error');
  };

  rec.onend = () => {
    opts.onEnd();
  };

  try {
    rec.start();
  } catch (err) {
    opts.onError(err instanceof Error ? err.message : 'Unable to start speech recognition');
    return null;
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        // ignore stop errors
      }
    },
  };
}
