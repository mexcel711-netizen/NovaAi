import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Menu,
  MessageSquarePlus,
  X,
} from 'lucide-react';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { CharacterView } from './components/views/CharacterView';
import { HomeView, type ChatAttachmentDraft } from './components/views/HomeView';
import { MemoryView } from './components/views/MemoryView';
import { RecentView } from './components/views/RecentView';
import { SettingsView } from './components/views/SettingsView';
import { SkillsView } from './components/views/SkillsView';
import { executeDesktopCommand } from './lib/desktopIntent';
import { TOKEN_KEY } from './lib/desktopBridge';
import { linkUsbDirectoryHandle, performUsbMemoryTransfer } from './lib/usbTransfer';
import { useCameraAwareness } from './lib/useCameraAwareness';
import {
  isSpeechRecognitionSupported,
  speakText,
  startBrowserRecognition,
  stopAllSpeech,
  unlockAudioContext,
  type SpeechRecognitionHandle,
} from './lib/voiceService';
import type {
  AppConfig,
  AvatarState,
  CharacterProfile,
  ChatApiResponse,
  ChatMessage,
  FacialEmotion,
  KnowledgeKind,
  KnowledgeSource,
  MemoryRecord,
  MoodMode,
  NoteRecord,
  ProviderStatus,
  ReminderRecord,
  ResponseStyle,
  SessionSummary,
  SidebarPage,
  SkillActionType,
  SkillConfig,
} from './types/nova';

const DEFAULT_CLIENT_CONFIG: AppConfig = {
  assistant_name: 'ZARA',
  personality: 'warm_urdu_companion',
  custom_prompt:
    'Tum ZARA ho — real-life best friend. Roman Urdu mein seedha, chhota aur dostana baat karo. User ko Boss kaho.',
  language: 'bilingual',
  response_tone: 'casual',
  tts_voice: 'ur-PK-UzmaNeural',
  voice_speed: 1.0,
  voice_volume: 1.0,
  stt_model: 'base',
  wake_word: 'hey zara',
  wake_word_enabled: false,
  auto_speak: true,
  deep_thinking_mode: 'auto',
  default_model: 'gemini-4-hydrogen',
  ai_provider: 'auto',
  active_mood: 'auto',
  active_character_id: 2,
  hands_free_mode: false,
  camera_awareness_enabled: false,
  hairstyle: 'wavy',
  user_name: 'Boss',
  user_nickname: 'Boss',
  assistant_age: '21',
  whatsapp_number: '',
  referral_source: '',
  auto_usb_transfer: false,
  last_usb_sync_at: '',
  last_usb_drive_label: '',
  onboarding_completed: false,
};

const DEFAULT_PROVIDER_STATUS: ProviderStatus = {
  activeProvider: 'google-ai-studio',
  googleAiConfigured: false,
  cloudflareConfigured: false,
  cloudflareBindingActive: false,
};

const NAV_ITEMS: Array<{ id: SidebarPage; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'memory', label: 'Memory' },
  { id: 'skills', label: 'Skills' },
  { id: 'character', label: 'Character' },
  { id: 'recent', label: 'Recent' },
  { id: 'settings', label: 'Settings' },
];

function createGreetingMessage(
  sessionId: string,
  _assistantName: string,
  userNickname = 'Boss'
): ChatMessage {
  const nick = userNickname.trim() || 'Boss';
  return {
    id: `greeting-${sessionId}`,
    sessionId,
    role: 'assistant',
    content: `Hello ${nick}! Main ${_assistantName} hoon. Aapka AI assistant ready hai. Bataiye, kya karna hai?`,
    emotion: 'happy',
    language: 'ur',
    timestamp: new Date().toISOString(),
  };
}

export default function App() {
  const [activePage, setActivePage] = useState<SidebarPage>('home');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [stateLoaded, setStateLoaded] = useState(false);
  const isAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [config, setConfig] = useState<AppConfig>(DEFAULT_CLIENT_CONFIG);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(DEFAULT_PROVIDER_STATUS);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const [sessionId, setSessionId] = useState<string>(() => `session-${Date.now()}`);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createGreetingMessage(`session-${Date.now()}`, 'ZARA', 'Boss'),
  ]);

  const [inputValue, setInputValue] = useState('');
  const [forceThinking, setForceThinking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [avatarEmotion, setAvatarEmotion] = useState<FacialEmotion>('calm');
  const [micLevel, setMicLevel] = useState(0);
  const [lipOpenness, setLipOpenness] = useState(0);
  const [lipWidth, setLipWidth] = useState(0);

  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [autoWatchCamera, setAutoWatchCamera] = useState(false);
  const [requestedHubTab, setRequestedHubTab] = useState<'visual' | 'study' | 'skills' | 'voice' | 'youtube' | null>(null);
  const [requestedYouTubeSearch, setRequestedYouTubeSearch] = useState<{ query: string; id: number } | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [warningBanner, setWarningBanner] = useState<string | null>(null);
  const [launchedUrl, setLaunchedUrl] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionHandle | null>(null);
  const wakeRecRef = useRef<SpeechRecognitionHandle | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micRafRef = useRef<number>(0);
  const terminatedRef = useRef<boolean>(false);
  const spokenRemindersRef = useRef<Set<number>>(new Set());
  const startupGreetingRef = useRef(false);

  // The Windows installer carries the local bridge token in the URL fragment.
  // Fragments are not sent to the server; save the token locally and scrub the URL.
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const startupToken = fragment.get('zara-bridge');
    if (!startupToken) return;
    try {
      window.localStorage.setItem(TOKEN_KEY, startupToken);
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    } catch {
      // Local storage may be disabled; the user can still pair from Settings.
    }
  }, []);

  const activeCharacter =
    characters.find((c) => c.is_active) ||
    characters.find((c) => c.id === config.active_character_id) ||
    characters[0];

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data = (await res.json()) as {
        config: AppConfig;
        skills: SkillConfig[];
        memories: MemoryRecord[];
        notes: NoteRecord[];
        reminders: ReminderRecord[];
        sessions: SessionSummary[];
        characters?: CharacterProfile[];
        knowledge?: KnowledgeSource[];
        providerStatus?: ProviderStatus;
      };
      setConfig(data.config);
      if (data.providerStatus) setProviderStatus(data.providerStatus);
      if (data.characters) setCharacters(data.characters);
      if (data.knowledge) setKnowledge(data.knowledge);
      setSkills(data.skills);
      setMemories(data.memories);
      setNotes(data.notes);
      setReminders(data.reminders);
      setSessions(data.sessions);
      if (data.config.active_mood && data.config.active_mood !== 'auto') {
        setAvatarEmotion(data.config.active_mood);
      }
      setMessages((prev) => {
        if (prev.length === 1 && prev[0].id.startsWith('greeting-')) {
          return [
            createGreetingMessage(
              prev[0].sessionId,
              data.config.assistant_name,
              data.config.user_nickname || 'Boss'
            ),
          ];
        }
        return prev;
      });
    } catch {
      // ignore transient errors
    } finally {
      setStateLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Prime Web Audio while the browser still considers the user's first
  // pointer, touch, or keyboard action a trusted gesture. TTS completes after
  // a network request, so unlocking only when playback starts is too late.
  useEffect(() => {
    const unlock = () => unlockAudioContext();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  const stopMicMeter = useCallback(() => {
    if (micRafRef.current) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = 0;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (micAudioCtxRef.current) {
      void micAudioCtxRef.current.close().catch(() => {});
      micAudioCtxRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    stopMicMeter();
    setAvatarState((cur) => (cur === 'listening' ? 'idle' : cur));
  }, [stopMicMeter]);

  const handleTerminate = useCallback(() => {
    terminatedRef.current = true;
    stopAllSpeech();
    setLipOpenness(0);
    setLipWidth(0);
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    stopListening();
    setIsSending(false);
    setAvatarState('idle');
  }, [stopListening]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleTerminate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTerminate]);

  const startMicMeter = useCallback(async () => {
    if (micStreamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const audioCtx = new AudioContext();
      micAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;
      const loop = () => {
        analyser.getByteFrequencyData(data);
        let total = 0;
        for (let i = 0; i < data.length; i++) total += data[i];
        const raw = Math.min(1, total / data.length / 105);
        // Apply voice-activity noise gate so room silence settles cleanly to 0
        const gated = raw < 0.065 ? 0 : Math.min(1, (raw - 0.065) / 0.58);
        smoothed = smoothed * 0.55 + gated * 0.45;
        setMicLevel(smoothed < 0.02 ? 0 : smoothed);
        micRafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      setMicLevel(0.45);
    }
  }, []);

  const speakWithLipSync = useCallback(
    async (text: string, language: 'en' | 'ur', emotion: FacialEmotion) => {
      terminatedRef.current = false;
      setAvatarEmotion(emotion);
      const result = await speakText({
        text,
        voiceName: config.tts_voice,
        language,
        emotion,
        voiceSpeed: config.voice_speed,
        voiceVolume: config.voice_volume,
        onStart: () => setAvatarState('speaking'),
        onLipSync: (open, width) => {
          setLipOpenness(open);
          setLipWidth(width);
        },
        onEnd: () => {
          setLipOpenness(0);
          setLipWidth(0);
          setAvatarState('idle');
        },
      });
      if (result.engine === 'voice-unavailable') {
        setWarningBanner(`ZARA ki awaaz play nahin ho saki: ${result.error || 'Voice service unavailable.'}`);
      } else if (result.engine !== 'aborted') {
        setWarningBanner(null);
      }
    },
    [config.tts_voice, config.voice_speed, config.voice_volume]
  );


  // A Windows startup shortcut opens the app with ?autostart=1. Speak once
  // after state hydration so the greeting uses the saved voice and settings.
  useEffect(() => {
    if (!stateLoaded || !isAutostart || !config.auto_speak || startupGreetingRef.current) return;
    startupGreetingRef.current = true;
    const timer = window.setTimeout(() => {
      void speakWithLipSync(
        `Hello ${config.user_nickname || 'Boss'}! Main ${config.assistant_name || 'ZARA'} hoon. Aapka laptop ready hai. Bataiye, aaj kya karna hai?`,
        'ur',
        'happy'
      );
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [stateLoaded, isAutostart, config.auto_speak, config.user_nickname, config.assistant_name, speakWithLipSync]);

  // Spoken proactive reminder alerts when due
  useEffect(() => {
    const timer = window.setInterval(() => {
      const nowStr = new Date()
        .toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        .toLowerCase();
      for (const rem of reminders) {
        if (rem.is_done || spokenRemindersRef.current.has(rem.id)) continue;
        if (rem.remind_at.toLowerCase().includes(nowStr)) {
          spokenRemindersRef.current.add(rem.id);
          const alertText = `Reminder: ${rem.title}`;
          setMessages((prev) => [
            ...prev,
            {
              id: `rem-alert-${rem.id}-${Date.now()}`,
              sessionId,
              role: 'assistant',
              content: alertText,
              emotion: 'happy',
              language: 'en',
              timestamp: new Date().toISOString(),
              skillExecuted: 'smart_reminder_alert',
            },
          ]);
          if (config.auto_speak) {
            void speakWithLipSync(alertText, 'en', 'happy');
          }
        }
      }
    }, 20000);
    return () => window.clearInterval(timer);
  }, [reminders, sessionId, config.auto_speak, speakWithLipSync]);

  const handleSaveConfig = useCallback(async (partial: Partial<AppConfig>) => {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        config: AppConfig;
        providerStatus?: ProviderStatus;
      };
      setConfig(data.config);
      if (data.providerStatus) setProviderStatus(data.providerStatus);
    }
  }, []);

  const handleToggleAutoUsb = async (enabled: boolean) => {
    await handleSaveConfig({ auto_usb_transfer: enabled });
  };

  const handleTransferToUsb = async () => {
    const outcome = await performUsbMemoryTransfer({ interactive: true });
    if (outcome.ok) {
      await handleSaveConfig({
        last_usb_sync_at: new Date().toISOString(),
        last_usb_drive_label: outcome.driveLabel,
      });
    }
    return outcome;
  };

  const handleLinkUsbFolder = async () => linkUsbDirectoryHandle();

  const handleSelectMood = useCallback(
    async (mood: MoodMode) => {
      setAvatarEmotion(mood === 'auto' ? 'calm' : mood);
      await handleSaveConfig({ active_mood: mood });
    },
    [handleSaveConfig]
  );

  const handleSelectCharacter = useCallback(async (idOrSlug: number | string) => {
    const res = await fetch(`/api/characters/${encodeURIComponent(String(idOrSlug))}/select`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        character: CharacterProfile;
        characters: CharacterProfile[];
        config: AppConfig;
      };
      setCharacters(data.characters);
      setConfig(data.config);
      if (data.config.active_mood !== 'auto') {
        setAvatarEmotion(data.config.active_mood);
      }
    }
  }, []);

  const handleCreateCharacter = useCallback(
    async (input: {
      name: string;
      role_title: string;
      bio: string;
      personality: ResponseStyle;
      default_mood: MoodMode;
      tts_voice: string;
      system_prompt: string;
    }) => {
      const res = await fetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.ok) {
        const data = (await res.json()) as { characters: CharacterProfile[] };
        setCharacters(data.characters);
      }
    },
    []
  );

  const handleDeleteCharacter = useCallback(async (id: number) => {
    const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const data = (await res.json()) as { characters: CharacterProfile[] };
      setCharacters(data.characters);
    }
  }, []);

  const handleEvolveCharacter = useCallback(async () => {
    const res = await fetch('/api/evolve', { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as {
        character: CharacterProfile;
        characters: CharacterProfile[];
        skills: SkillConfig[];
        outcome: {
          nextBondLevel: number;
          nextXp: number;
          newTraits: string[];
          journalEntry: string;
        };
      };
      setCharacters(data.characters);
      setSkills(data.skills);
      const summary = `${data.character.name} evolved to Bond Level ${data.outcome.nextBondLevel} (${data.outcome.nextXp} XP). ${data.outcome.journalEntry}`;
      setMessages((prev) => [
        ...prev,
        {
          id: `evolve-${Date.now()}`,
          sessionId,
          role: 'assistant',
          content: summary,
          emotion: 'confident',
          language: 'en',
          timestamp: new Date().toISOString(),
          skillExecuted: 'self_evolve',
        },
      ]);
      if (config.auto_speak) {
        await speakWithLipSync(summary, 'en', 'confident');
      }
    }
  }, [sessionId, config.auto_speak, speakWithLipSync]);

  const handleAnalyzeStudy = useCallback(
    async (input: {
      kind: KnowledgeKind;
      title: string;
      goal: string;
      contentText: string;
      fileBase64?: string;
      fileMimeType?: string;
    }) => {
      setIsSending(true);
      setAvatarState('thinking');
      try {
        const res = await fetch('/api/study', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, sessionId }),
        });
        const data = (await res.json()) as {
          knowledge: KnowledgeSource[];
          memories: MemoryRecord[];
          reply: string;
          emotion: FacialEmotion;
          modelUsed: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Study analysis failed.');

        setKnowledge(data.knowledge);
        setMemories(data.memories);
        setMessages((prev) => [
          ...prev,
          {
            id: `study-user-${Date.now()}`,
            sessionId,
            role: 'user',
            content: `Read & explain ${input.kind}: ${input.title}${input.goal ? ` — Goal: ${input.goal}` : ''}`,
            language: 'en',
            timestamp: new Date().toISOString(),
          },
          {
            id: `study-assistant-${Date.now() + 1}`,
            sessionId,
            role: 'assistant',
            content: data.reply,
            emotion: data.emotion || 'confident',
            language: 'ur',
            timestamp: new Date().toISOString(),
            modelUsed: data.modelUsed,
            skillExecuted: 'study_mentor',
          },
        ]);
        setIsSending(false);
        if (config.auto_speak) {
          void speakWithLipSync(data.reply.slice(0, 420), 'ur', data.emotion || 'confident');
        } else {
          setAvatarState('idle');
        }
      } finally {
        setIsSending(false);
      }
    },
    [sessionId, config.auto_speak, speakWithLipSync]
  );

  const handleDeleteKnowledge = useCallback(async (id: number) => {
    const res = await fetch(`/api/study/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const data = (await res.json()) as { knowledge: KnowledgeSource[] };
      setKnowledge(data.knowledge);
    }
  }, []);

  const handleExecuteStudyTask = useCallback(
    async (studyId: number, taskPrompt: string) => {
      if (!taskPrompt.trim() || isSending) return;
      setErrorBanner(null);
      setMessages((prev) => [
        ...prev,
        {
          id: `study-task-user-${Date.now()}`,
          sessionId,
          role: 'user',
          content: taskPrompt.trim(),
          language: 'ur',
          timestamp: new Date().toISOString(),
        },
      ]);
      setIsSending(true);
      setAvatarState('thinking');
      try {
        const res = await fetch(`/api/study/${studyId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskPrompt: taskPrompt.trim(), sessionId }),
        });
        const data = (await res.json()) as {
          reply: string;
          emotion: FacialEmotion;
          modelUsed: string;
          notes?: NoteRecord[];
          reminders?: ReminderRecord[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Could not execute study task.');

        if (data.notes) setNotes(data.notes);
        if (data.reminders) setReminders(data.reminders);

        setMessages((prev) => [
          ...prev,
          {
            id: `study-task-assistant-${Date.now() + 1}`,
            sessionId,
            role: 'assistant',
            content: data.reply,
            emotion: data.emotion || 'confident',
            language: 'ur',
            timestamp: new Date().toISOString(),
            modelUsed: data.modelUsed,
            skillExecuted: 'study_executor',
          },
        ]);
        setIsSending(false);
        if (config.auto_speak) {
          void speakWithLipSync(data.reply.slice(0, 420), 'ur', data.emotion || 'confident');
        } else {
          setAvatarState('idle');
        }
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Unable to execute study task.');
        setAvatarState('error');
      } finally {
        setIsSending(false);
      }
    },
    [isSending, sessionId, config.auto_speak, speakWithLipSync]
  );

  const visionHandlerRef = useRef<(prompt?: string) => Promise<void>>(async () => {});
  const camera = useCameraAwareness(autoWatchCamera, () => {
    void visionHandlerRef.current('I waved or moved in front of the camera — acknowledge briefly!');
  });

  const handleCaptureVision = useCallback(
    async (prompt?: string) => {
      setErrorBanner(null);
      if (!camera.isActive) {
        const started = await camera.startCamera();
        if (!started) {
          setErrorBanner(
            camera.error ||
              'No webcam available on this device. Connect a camera or grant permission to use Vision Awareness.'
          );
          return;
        }
        // Let video metadata settle briefly before grabbing a frame
        await new Promise((r) => setTimeout(r, 450));
      }

      const snapshot = camera.captureSnapshotBase64();
      if (!snapshot) {
        setErrorBanner('Camera stream is warming up — click "Look Now" again in a second.');
        return;
      }

      setIsSending(true);
      setAvatarState('thinking');
      try {
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: snapshot,
            mimeType: 'image/jpeg',
            userPrompt: prompt,
            gestureHint: camera.lastGesture || undefined,
            sessionId,
          }),
        });
        const data = (await res.json()) as {
          reply: string;
          emotion: FacialEmotion;
          language: 'en' | 'ur';
          modelUsed: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Vision request failed.');

        setMessages((prev) => [
          ...prev,
          {
            id: `vision-${Date.now()}`,
            sessionId,
            role: 'assistant',
            content: data.reply,
            emotion: data.emotion || 'curious',
            language: data.language || 'ur',
            timestamp: new Date().toISOString(),
            modelUsed: data.modelUsed,
            skillExecuted: 'vision_awareness',
          },
        ]);
        if (config.auto_speak) {
          await speakWithLipSync(data.reply, data.language || 'ur', data.emotion || 'curious');
        } else {
          setAvatarState('idle');
        }
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Unable to analyze camera frame.');
        setAvatarState('error');
      } finally {
        setIsSending(false);
      }
    },
    [camera, sessionId, config.auto_speak, speakWithLipSync]
  );

  useEffect(() => {
    visionHandlerRef.current = handleCaptureVision;
  }, [handleCaptureVision]);

  const startVoiceListenRef = useRef<() => void>(() => {});

  const handleSendMessage = useCallback(
    async (explicitText?: string, attachment?: ChatAttachmentDraft) => {
      const text = (explicitText ?? inputValue).trim();
      if ((!text && !attachment) || isSending) return;

      const displayUserText = attachment
        ? `[Attached ${attachment.kind}: ${attachment.title}] ${text || 'Read and help me with this.'}`
        : text;

      terminatedRef.current = false;
      stopAllSpeech();
      setLipOpenness(0);
      setLipWidth(0);
      setErrorBanner(null);
      setWarningBanner(null);
      setLaunchedUrl(null);
      if (!explicitText) setInputValue('');

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sessionId,
        role: 'user',
        content: displayUserText,
        language: 'en',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);
      setAvatarState('thinking');

      const controller = new AbortController();
      chatAbortRef.current = controller;

      try {
        if (!attachment) {
          const desktopAction = await executeDesktopCommand(text);
          if (desktopAction) {
            const reply = desktopAction.reply;
            const assistantMsg: ChatMessage = {
              id: `assistant-${Date.now()}`,
              sessionId,
              role: 'assistant',
              content: reply,
              emotion: desktopAction.emotion,
              language: 'ur',
              timestamp: new Date().toISOString(),
              modelUsed: 'desktop-companion',
              providerUsed: 'local-desktop',
              thinkingUsed: false,
              skillExecuted: 'desktop_command',
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setIsSending(false);
            chatAbortRef.current = null;
            setAvatarEmotion(desktopAction.emotion);
            if (config.auto_speak) await speakWithLipSync(reply, 'ur', desktopAction.emotion);
            else setAvatarState('idle');
            return;
          }
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            sessionId,
            forceThinking,
            history: messages.slice(-8),
            attachmentTitle: attachment?.title,
            attachmentText: attachment?.text,
            attachmentKind: attachment?.kind,
          }),
          signal: controller.signal,
        });

        const data = (await res.json()) as ChatApiResponse & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || 'Assistant request failed.');
        }

        if (data.warning) {
          setWarningBanner(data.warning);
        }

        if (data.sideEffect?.type === 'open_url' && data.sideEffect.url) {
          setLaunchedUrl(data.sideEffect.url);
        } else if (data.sideEffect?.type === 'open_study') {
          setRequestedHubTab('study');
        } else if (data.sideEffect?.type === 'youtube_search' && data.sideEffect.youtubeQuery) {
          setRequestedYouTubeSearch({ query: data.sideEffect.youtubeQuery, id: Date.now() });
          setRequestedHubTab('youtube');
        } else if (data.sideEffect?.type === 'trigger_vision') {
          void handleCaptureVision(text);
        } else if (data.sideEffect?.type === 'trigger_evolve') {
          void handleEvolveCharacter();
        }

        const replyEmotion: FacialEmotion = data.emotion || 'calm';
        setAvatarEmotion(replyEmotion);

        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          sessionId,
          role: 'assistant',
          content: data.reply,
          emotion: replyEmotion,
          language: data.language,
          timestamp: new Date().toISOString(),
          modelUsed: data.modelUsed,
          providerUsed: data.providerUsed,
          thinkingUsed: data.thinkingUsed,
          skillExecuted: data.skillExecuted,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setIsSending(false);
        chatAbortRef.current = null;

        void fetchState();

        if (config.auto_speak) {
          await speakWithLipSync(data.reply, data.language, replyEmotion);
        } else {
          setAvatarState('idle');
        }

        if (config.hands_free_mode && !terminatedRef.current && isSpeechRecognitionSupported()) {
          startVoiceListenRef.current();
        }
      } catch (err) {
        if (controller.signal.aborted) {
          setAvatarState('idle');
          return;
        }
        const message = err instanceof Error ? err.message : 'Unable to reach ZARA backend.';
        setErrorBanner(message);
        setAvatarEmotion('sad');
        setAvatarState('error');
      } finally {
        setIsSending(false);
        chatAbortRef.current = null;
      }
    },
    [
      inputValue,
      isSending,
      sessionId,
      forceThinking,
      messages,
      config.auto_speak,
      config.hands_free_mode,
      fetchState,
      speakWithLipSync,
      handleCaptureVision,
      handleEvolveCharacter,
    ]
  );

  const handleToggleListening = useCallback(() => {
    if (avatarState === 'listening') {
      stopListening();
      return;
    }

    terminatedRef.current = false;
    stopAllSpeech();
    setLipOpenness(0);
    setLipWidth(0);
    setErrorBanner(null);

    if (!isSpeechRecognitionSupported()) {
      setErrorBanner(
        'Live SpeechRecognition is unavailable in this browser. Type your command below or use Chrome/Edge for voice capture.'
      );
      setAvatarState('error');
      return;
    }

    setAvatarState('listening');
    void startMicMeter();

    let latestTranscript = '';
    let sentFinal = false;
    const handle = startBrowserRecognition({
      lang: config.language === 'en' ? 'en-US' : 'ur-PK',
      continuous: false,
      onTranscript: (transcript, isFinal) => {
        latestTranscript = transcript;
        setInputValue(transcript);
        if (isFinal && transcript.trim() && !sentFinal) {
          sentFinal = true;
          stopListening();
          void handleSendMessage(transcript.trim());
        }
      },
      onError: (err) => {
        stopListening();
        if (err !== 'no-speech' && err !== 'aborted') {
          setErrorBanner(`Microphone / speech error: ${err}`);
          setAvatarState('error');
        }
      },
      onEnd: () => {
        stopMicMeter();
        recognitionRef.current = null;
        if (latestTranscript.trim() && !sentFinal) {
          sentFinal = true;
          void handleSendMessage(latestTranscript.trim());
        } else {
          setAvatarState((cur) => (cur === 'listening' ? 'idle' : cur));
        }
      },
    });
    recognitionRef.current = handle;
  }, [
    avatarState,
    config.language,
    handleSendMessage,
    startMicMeter,
    stopListening,
    stopMicMeter,
  ]);

  useEffect(() => {
    startVoiceListenRef.current = handleToggleListening;
  }, [handleToggleListening]);

  useEffect(() => {
    if (!wakeWordActive) {
      if (wakeRecRef.current) {
        wakeRecRef.current.stop();
        wakeRecRef.current = null;
      }
      return;
    }

    if (!isSpeechRecognitionSupported()) {
      setErrorBanner('Wake word listener requires browser SpeechRecognition support.');
      setWakeWordActive(false);
      return;
    }

    void startMicMeter();
    const wakePhrase = config.wake_word.toLowerCase();
    const handle = startBrowserRecognition({
      lang: 'en-US',
      continuous: true,
      onTranscript: (transcript) => {
        const lower = transcript.toLowerCase();
        if (lower.includes(wakePhrase)) {
          wakeRecRef.current?.stop();
          wakeRecRef.current = null;
          setWakeWordActive(false);
          handleToggleListening();
        }
      },
      onError: () => {
        setWakeWordActive(false);
      },
      onEnd: () => {
        wakeRecRef.current = null;
      },
    });
    wakeRecRef.current = handle;

    return () => {
      handle?.stop();
      if (!recognitionRef.current) {
        stopMicMeter();
      }
    };
  }, [wakeWordActive, config.wake_word, handleToggleListening, startMicMeter, stopMicMeter]);

  const handleNewSession = () => {
    handleTerminate();
    const nextId = `session-${Date.now()}`;
    setSessionId(nextId);
    setMessages([
      createGreetingMessage(nextId, config.assistant_name, config.user_nickname || 'Boss'),
    ]);
    setAvatarEmotion(config.active_mood === 'auto' ? 'calm' : config.active_mood);
    setLaunchedUrl(null);
    setErrorBanner(null);
    setWarningBanner(null);
    setActivePage('home');
  };

  const handleToggleSkill = async (id: number, is_enabled: boolean) => {
    const res = await fetch(`/api/skills/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled }),
    });
    if (res.ok) {
      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, is_enabled } : s)));
    }
  };

  const handleAddNote = async (title: string, content: string) => {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (res.ok) {
      const data = (await res.json()) as { notes: NoteRecord[] };
      setNotes(data.notes);
    }
  };

  const handleDeleteNote = async (id: number) => {
    const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const data = (await res.json()) as { notes: NoteRecord[] };
      setNotes(data.notes);
    }
  };

  const handleAddReminder = async (title: string, remind_at: string) => {
    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, remind_at }),
    });
    if (res.ok) {
      const data = (await res.json()) as { reminders: ReminderRecord[] };
      setReminders(data.reminders);
    }
  };

  const handleToggleReminder = async (id: number, is_done: boolean) => {
    const res = await fetch(`/api/reminders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_done }),
    });
    if (res.ok) {
      const data = (await res.json()) as { reminders: ReminderRecord[] };
      setReminders(data.reminders);
    }
  };

  const handleDeleteReminder = async (id: number) => {
    const res = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const data = (await res.json()) as { reminders: ReminderRecord[] };
      setReminders(data.reminders);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#04070D] text-slate-100">
      <OfflineIndicator />

      {/* Top Bar — Strict 3-Zone Obsidian Studio Contract */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-8 border-b border-white/[0.07] bg-[#060B14]/90 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => setActivePage('home')}
            className="font-display text-base font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            {config.assistant_name} <span className="font-normal text-cyan-400/90">AI</span>
          </button>
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-7 text-sm font-medium md:flex"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActivePage(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`border-b-2 py-4 text-xs font-medium tracking-wide transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'border-cyan-400 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          {launchedUrl && (
            <a
              href={launchedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-cyan-400 underline underline-offset-4 hover:text-cyan-300 whitespace-nowrap shrink-0"
            >
              Open launched link
            </a>
          )}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden sm:block">
            <PWAInstallButton compact onOpenLaptopTab={() => setActivePage('settings')} />
          </div>
          <button
            type="button"
            onClick={handleNewSession}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-white whitespace-nowrap shrink-0"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-cyan-400" />
            <span>New Session</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="relative flex min-h-0 flex-1">
        {mobileNavOpen && (
          <aside
            aria-label="Mobile navigation"
            className="absolute inset-y-0 left-0 z-40 flex w-60 flex-col justify-between border-r border-white/[0.08] bg-[#070C16]/95 p-4 shadow-2xl backdrop-blur-xl md:hidden"
          >
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActivePage(item.id);
                      setMobileNavOpen(false);
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200'
                        : 'border-transparent text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
                    }`}
                  >
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-white/[0.07] pt-3 text-xs text-slate-400 tabular-nums">
              <p>{memories.length} memories</p>
              <p className="mt-1">{skills.filter((s) => s.is_enabled).length} skills active</p>
            </div>
          </aside>
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-transparent">
          {activePage === 'home' && (
            <HomeView
              config={config}
              providerStatus={providerStatus}
              activeCharacter={activeCharacter}
              memories={memories}
              notes={notes}
              reminders={reminders}
              skills={skills}
              knowledge={knowledge}
              avatarState={avatarState}
              avatarEmotion={avatarEmotion}
              micLevel={micLevel}
              lipOpenness={lipOpenness}
              lipWidth={lipWidth}
              messages={messages}
              inputValue={inputValue}
              forceThinking={forceThinking}
              isSending={isSending}
              wakeWordActive={wakeWordActive}
              autoSpeak={config.auto_speak}
              handsFreeMode={config.hands_free_mode}
              autoWatchCamera={autoWatchCamera}
              camera={camera}
              requestedHubTab={requestedHubTab}
              requestedYouTubeSearch={requestedYouTubeSearch}
              errorBanner={errorBanner}
              warningBanner={warningBanner}
              onNavigate={setActivePage}
              onInputChange={setInputValue}
              onSelectMood={(mood) => void handleSelectMood(mood)}
              onSendMessage={handleSendMessage}
              onToggleForceThinking={() => setForceThinking((v) => !v)}
              onToggleListening={handleToggleListening}
              onToggleWakeWord={() => setWakeWordActive((v) => !v)}
              onToggleAutoSpeak={() => void handleSaveConfig({ auto_speak: !config.auto_speak })}
              onToggleHandsFree={() => void handleSaveConfig({ hands_free_mode: !config.hands_free_mode })}
              onToggleAutoWatchCamera={() => setAutoWatchCamera((v) => !v)}
              onCaptureVision={handleCaptureVision}
              onAnalyzeStudy={handleAnalyzeStudy}
              onExecuteStudyTask={handleExecuteStudyTask}
              onEvolveCharacter={handleEvolveCharacter}
              onTerminate={handleTerminate}
              onReplayMessage={(msg) =>
                void speakWithLipSync(msg.content, msg.language, msg.emotion || 'calm')
              }
              onDismissError={() => {
                setErrorBanner(null);
                setAvatarState('idle');
                setAvatarEmotion('calm');
              }}
              onSaveConfig={handleSaveConfig}
              onToggleSkill={handleToggleSkill}
              onAddNote={handleAddNote}
              onDeleteNote={handleDeleteNote}
              onAddReminder={handleAddReminder}
              onToggleReminder={handleToggleReminder}
              onDeleteReminder={handleDeleteReminder}
            />
          )}

          {activePage === 'memory' && (
            <MemoryView
              memories={memories}
              notes={notes}
              reminders={reminders}
              knowledge={knowledge}
              autoUsbTransfer={config.auto_usb_transfer}
              lastUsbSyncAt={config.last_usb_sync_at}
              lastUsbDriveLabel={config.last_usb_drive_label}
              onToggleAutoUsb={handleToggleAutoUsb}
              onTransferToUsb={handleTransferToUsb}
              onLinkUsbFolder={handleLinkUsbFolder}
              onAddMemory={async (input) => {
                const res = await fetch('/api/memories', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(input),
                });
                if (res.ok) {
                  const data = (await res.json()) as { memories: MemoryRecord[] };
                  setMemories(data.memories);
                }
              }}
              onDeleteMemory={async (id) => {
                const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
                if (res.ok) {
                  const data = (await res.json()) as { memories: MemoryRecord[] };
                  setMemories(data.memories);
                }
              }}
              onClearAllMemories={async () => {
                const res = await fetch('/api/memories', { method: 'DELETE' });
                if (res.ok) {
                  setMemories([]);
                }
              }}
              onAddNote={handleAddNote}
              onDeleteNote={handleDeleteNote}
              onAddReminder={handleAddReminder}
              onToggleReminder={handleToggleReminder}
              onDeleteReminder={handleDeleteReminder}
              onDeleteKnowledge={handleDeleteKnowledge}
            />
          )}

          {activePage === 'skills' && (
            <SkillsView
              skills={skills}
              knowledge={knowledge}
              onToggleSkill={handleToggleSkill}
              onCreateSkill={async (input: {
                display_name: string;
                description: string;
                trigger_phrases: string[];
                action_type: SkillActionType;
                action_value: string;
              }) => {
                const res = await fetch('/api/skills', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(input),
                });
                if (res.ok) {
                  const data = (await res.json()) as { skills: SkillConfig[] };
                  setSkills(data.skills);
                }
              }}
              onDeleteSkill={async (id) => {
                const res = await fetch(`/api/skills/${id}`, { method: 'DELETE' });
                if (res.ok) {
                  const data = (await res.json()) as { skills: SkillConfig[] };
                  setSkills(data.skills);
                }
              }}
              onDeleteKnowledge={handleDeleteKnowledge}
              onTestSkill={(phrase) => {
                setActivePage('home');
                void handleSendMessage(phrase);
              }}
              onExecuteStudyTask={(studyId, taskPrompt) => {
                setActivePage('home');
                void handleExecuteStudyTask(studyId, taskPrompt);
              }}
            />
          )}

          {activePage === 'character' && (
            <CharacterView
              config={config}
              characters={characters}
              activeCharacter={activeCharacter}
              onSaveConfig={handleSaveConfig}
              onSelectCharacter={handleSelectCharacter}
              onCreateCharacter={handleCreateCharacter}
              onDeleteCharacter={handleDeleteCharacter}
              onEvolveCharacter={handleEvolveCharacter}
            />
          )}

          {activePage === 'recent' && (
            <RecentView
              sessions={sessions}
              activeSessionId={sessionId}
              onResumeSession={async (id) => {
                const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
                if (res.ok) {
                  const data = (await res.json()) as { messages: ChatMessage[] };
                  setSessionId(id);
                  setMessages(
                    data.messages.length > 0
                      ? data.messages
                      : [
                          createGreetingMessage(
                            id,
                            config.assistant_name,
                            config.user_nickname || 'Boss'
                          ),
                        ]
                  );
                  setActivePage('home');
                }
              }}
              onDeleteSession={async (id) => {
                const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
                  method: 'DELETE',
                });
                if (res.ok) {
                  const data = (await res.json()) as { sessions: SessionSummary[] };
                  setSessions(data.sessions);
                }
              }}
            />
          )}

          {activePage === 'settings' && (
            <SettingsView
              config={config}
              providerStatus={providerStatus}
              memoryCount={memories.length}
              onSaveConfig={handleSaveConfig}
              onClearAllMemories={async () => {
                const res = await fetch('/api/memories', { method: 'DELETE' });
                if (res.ok) {
                  setMemories([]);
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
