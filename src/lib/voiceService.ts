import type { FacialEmotion } from '../types/nova';

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
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    params.onLipSync?.(0, 0);
    if (activeAbortController === controller) activeAbortController = null;
    params.onEnd?.();
  };
  params.onStart?.();

  try {
    // The server always synthesizes the same ur-PK-UzmaNeural speaker.
    // Language, emotion, active character and device never select another voice.
    let response: Response | null = null;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voiceName: 'ur-PK-UzmaNeural',
            emotion: params.emotion || 'calm',
            language: params.language,
          }),
          signal: controller.signal,
        });
        if (response.ok) break;
        const body = await response.json().catch(() => ({})) as { error?: string };
        lastError = new Error(body.error || `Voice service returned HTTP ${response.status}.`);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        lastError = error instanceof Error ? error : new Error('Voice service unavailable.');
      }
      if (attempt === 0 && !controller.signal.aborted) await waitMs(350, controller.signal);
    }

    if (!response?.ok) throw lastError || new Error('Pakistani Urdu voice is temporarily unavailable.');
    const data = await response.json() as {
      audioChunks?: Array<{ audioBase64: string; mimeType: string }>;
      engine?: string;
      voice?: string;
    };
    const chunks = data.audioChunks ?? [];
    if (!chunks.length) throw new Error('Pakistani Urdu voice returned no audio.');
    const speed = Math.min(1.6, Math.max(0.65, params.voiceSpeed ?? 1));
    const volume = Math.min(1.5, Math.max(0, params.voiceVolume ?? 1));

    for (const chunk of chunks) {
      if (controller.signal.aborted) break;
      await playBufferWithLipSync({
        base64: chunk.audioBase64,
        speed,
        volume,
        signal: controller.signal,
        onLipSync: params.onLipSync,
      });
    }
    finish();
    return { engine: data.engine || 'edge-neural-v2' };
  } catch (error) {
    finish();
    if (controller.signal.aborted) return { engine: 'aborted' };
    // Never switch to another system voice. Chat text stays available while
    // the same fixed neural speaker can be retried on the next interaction.
    return { engine: 'voice-unavailable' };
  }
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

async function playMp3Element(
  base64: string,
  speed: number,
  volume: number,
  signal: AbortSignal,
): Promise<void> {
  if (typeof Audio === 'undefined' || signal.aborted) return;
  const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
  audio.preload = 'auto';
  audio.playbackRate = Math.min(1.6, Math.max(0.65, speed));
  audio.volume = Math.min(1, Math.max(0, volume));
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      audio.pause();
      audio.currentTime = 0;
      finish();
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error('Audio playback failed.'));
    signal.addEventListener('abort', onAbort, { once: true });
    void audio.play().catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error('Audio playback is blocked.'));
    });
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
  if (!ctx) {
    await playMp3Element(params.base64, params.speed, params.volume, params.signal);
    return;
  }

  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    await playMp3Element(params.base64, params.speed, params.volume, params.signal);
    return;
  }

  const binary = atob(params.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  } catch {
    await playMp3Element(params.base64, params.speed, params.volume, params.signal);
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
