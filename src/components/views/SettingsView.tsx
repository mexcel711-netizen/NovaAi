import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Mic, Play, Share2, Square, Trash2 } from 'lucide-react';
import { speakText, stopAllSpeech } from '../../lib/voiceService';
import type { AiProviderPreference, AppConfig, HairstyleOption, ProviderStatus } from '../../types/nova';
import { ConfirmDialog } from '../ConfirmDialog';
import { DesktopBridgePanel } from '../DesktopBridgePanel';
import { PWAInstallButton } from '../PWAInstallButton';

interface SettingsViewProps {
  config: AppConfig;
  providerStatus: ProviderStatus;
  memoryCount: number;
  onSaveConfig: (partial: Partial<AppConfig>) => Promise<void>;
  onClearAllMemories: () => Promise<void>;
}

type SettingsTab = 'ai' | 'voice' | 'mic' | 'laptop' | 'privacy';

const VOICE_OPTIONS = [
  { id: 'ur-PK-UzmaNeural', label: 'Uzma Neural — Pakistani Urdu Female (Locked)' },
];

export function SettingsView({
  config,
  providerStatus,
  memoryCount,
  onSaveConfig,
  onClearAllMemories,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');
  const [draft, setDraft] = useState<AppConfig>(config);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);

  const [micTesting, setMicTesting] = useState(false);
  const [micTestLevel, setMicTestLevel] = useState(0);
  const [micTestError, setMicTestError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  useEffect(() => {
    return () => {
      stopMicTest();
    };
  }, []);

  const stopMicTest = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setMicTesting(false);
    setMicTestLevel(0);
  };

  const startMicTest = async () => {
    if (micTesting) {
      stopMicTest();
      return;
    }
    setMicTestError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicTestError('Microphone capture is not available in this browser context.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      setMicTesting(true);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        setMicTestLevel(Math.min(100, Math.round(avg * 220)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      setMicTestError(
        err instanceof Error ? err.message : 'Microphone permission denied or device unavailable.'
      );
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveConfig(draft);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleVoicePreview = async () => {
    if (previewPlaying) {
      stopAllSpeech();
      setPreviewPlaying(false);
      return;
    }
    setVoicePreviewError(null);
    setPreviewPlaying(true);
    const result = await speakText({
      text: `Arre ${draft.user_nickname || 'Boss'}! Main ${draft.assistant_name} bol rahi hoon... mood kaisa hai aaj?`,
      voiceName: draft.tts_voice,
      language: 'ur',
      emotion: 'happy',
      voiceSpeed: draft.voice_speed,
      voiceVolume: draft.voice_volume,
      onEnd: () => setPreviewPlaying(false),
    });
    if (result.engine === 'voice-unavailable') {
      setVoicePreviewError(result.error || 'Pakistani Urdu voice playback failed.');
    }
  };

  const shareUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const copyShareUrl = async () => {
    if (!shareUrl || !navigator.clipboard) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Configure AI provider routing, Pakistani Urdu neural voice, laptop installer, and privacy.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedToast && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
              <Check className="h-4 w-4" />
              Settings saved
            </span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex flex-wrap items-center gap-1 self-start rounded-lg border border-slate-800 bg-[#0D1117] p-1">
        {(
          [
            { id: 'ai', label: 'AI & Deployment' },
            { id: 'voice', label: 'Urdu Neural Voice' },
            { id: 'mic', label: 'Wake Word & Mic' },
            { id: 'laptop', label: 'Laptop & Installer' },
            { id: 'privacy', label: 'Privacy & Data' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-6 space-y-5">
        {activeTab === 'ai' && (
          <div className="space-y-5 rounded-xl border border-slate-800 bg-[#0D1117] p-5">
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 text-xs text-slate-300">
              <p className="font-semibold text-white">Active Deployment &amp; AI Binding Status</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-slate-400">
                <span>
                  Active Backend:{' '}
                  <strong className="text-cyan-300">{providerStatus.activeProvider}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Google AI Studio:{' '}
                  {providerStatus.googleAiConfigured ? 'Connected' : 'Configure in Secrets'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Cloudflare AI Binding:{' '}
                  {providerStatus.cloudflareBindingActive
                    ? 'Auto-Bound'
                    : providerStatus.cloudflareConfigured
                      ? 'REST Configured'
                      : 'Auto-activates on Cloudflare Deploy'}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="settings-ai-provider"
                className="block text-xs font-medium text-slate-300"
              >
                AI Provider Routing
              </label>
              <select
                id="settings-ai-provider"
                value={draft.ai_provider}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    ai_provider: e.target.value as AiProviderPreference,
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
              >
                <option value="auto">
                  Auto — Cloudflare Workers AI Binding on deploy, Google AI Studio locally
                </option>
                <option value="google-ai-studio">Google AI Studio (Gemini 4)</option>
                <option value="cloudflare">Cloudflare Workers AI</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-default-model"
                className="block text-xs font-medium text-slate-300"
              >
                Primary Conversational Model
              </label>
              <select
                id="settings-default-model"
                value={draft.default_model}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    default_model: e.target.value as AppConfig['default_model'],
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
              >
                <option value="gemini-4-hydrogen">
                  Gemini 4 Hydrogen — Low-latency daily voice &amp; chat
                </option>
                <option value="gemini-4-carbon">
                  Gemini 4 Carbon — High Thinking reasoning (paid tier)
                </option>
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-thinking-mode"
                className="block text-xs font-medium text-slate-300"
              >
                Deep Thinking Routing (ThinkingLevel.HIGH on Gemini 4 Carbon)
              </label>
              <select
                id="settings-thinking-mode"
                value={draft.deep_thinking_mode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    deep_thinking_mode: e.target.value as AppConfig['deep_thinking_mode'],
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
              >
                <option value="auto">
                  Auto — Route complex architecture, debugging &amp; multi-step queries to High Thinking
                </option>
                <option value="always">Always — Use High Thinking on every AI query</option>
                <option value="manual">Manual — Only when High Thinking toggle is enabled</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === 'voice' && (
          <div className="space-y-5 rounded-xl border border-slate-800 bg-[#0D1117] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Auto-Speak Every Response</p>
                <p className="text-xs text-slate-400">
                  Automatically speak ZARA&apos;s Urdu and English replies with synchronized lip movement.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.auto_speak}
                aria-label="Toggle auto-speak responses"
                onClick={() => setDraft({ ...draft, auto_speak: !draft.auto_speak })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                  draft.auto_speak
                    ? 'border-cyan-400 bg-cyan-400/20'
                    : 'border-slate-700 bg-slate-900'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                    draft.auto_speak
                      ? 'translate-x-5 bg-cyan-400'
                      : 'translate-x-1 bg-slate-500'
                  }`}
                />
              </button>
            </div>

            <div>
              <label
                htmlFor="settings-tts-voice"
                className="block text-xs font-medium text-slate-300"
              >
                Fixed Pakistani Female Neural Voice
              </label>
              <p className="mt-1 text-xs leading-relaxed text-cyan-200/75">ZARA ka speaker lock hai: Microsoft Edge Neural ur-PK-UzmaNeural. Urdu, English, mood ya character change honay par bhi awaaz nahi badlay gi. Audio service unavailable ho to ZARA doosri system voice par switch nahi karegi.</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <select
                  disabled
                  aria-label="Fixed Pakistani Urdu voice"
                  id="settings-tts-voice"
                  value={draft.tts_voice}
                  onChange={(e) => setDraft({ ...draft, tts_voice: e.target.value })}
                  className="flex-1 rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleVoicePreview}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20 whitespace-nowrap shrink-0"
                >
                  {previewPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{previewPlaying ? 'Stop Preview' : 'Preview Urdu Voice'}</span>
                </button>
              </div>
              {voicePreviewError && (
                <p role="alert" className="mt-2 text-xs text-rose-300">
                  ZARA voice preview failed: {voicePreviewError}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-slate-800/80 pt-4 sm:grid-cols-2">
              <div>
                <label htmlFor="settings-user-nickname" className="block text-xs font-medium text-slate-300">
                  What {draft.assistant_name} Calls You
                </label>
                <input
                  id="settings-user-nickname"
                  type="text"
                  value={draft.user_nickname || 'Boss'}
                  onChange={(e) => setDraft({ ...draft, user_nickname: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="settings-hairstyle" className="block text-xs font-medium text-slate-300">
                  Hologram Hairstyle
                </label>
                <select
                  id="settings-hairstyle"
                  value={draft.hairstyle || 'wavy'}
                  onChange={(e) =>
                    setDraft({ ...draft, hairstyle: e.target.value as HairstyleOption })
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
                >
                  <option value="bob">Short bob</option>
                  <option value="wavy">Wavy hair</option>
                  <option value="straight">Straight hair</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 border-t border-slate-800/80 pt-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="settings-voice-speed" className="font-medium text-slate-300">
                    Voice Speed
                  </label>
                  <span className="font-mono tabular-nums text-cyan-300">
                    {draft.voice_speed.toFixed(2)}x
                  </span>
                </div>
                <input
                  id="settings-voice-speed"
                  type="range"
                  min="0.75"
                  max="1.40"
                  step="0.05"
                  value={draft.voice_speed}
                  onChange={(e) =>
                    setDraft({ ...draft, voice_speed: Number(e.target.value) })
                  }
                  className="mt-2 w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="settings-voice-volume" className="font-medium text-slate-300">
                    Voice Volume
                  </label>
                  <span className="font-mono tabular-nums text-cyan-300">
                    {Math.round(draft.voice_volume * 100)}%
                  </span>
                </div>
                <input
                  id="settings-voice-volume"
                  type="range"
                  min="0.1"
                  max="1.5"
                  step="0.05"
                  value={draft.voice_volume}
                  onChange={(e) =>
                    setDraft({ ...draft, voice_volume: Number(e.target.value) })
                  }
                  className="mt-2 w-full accent-cyan-400"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mic' && (
          <div className="space-y-5 rounded-xl border border-slate-800 bg-[#0D1117] p-5">
            <div>
              <label
                htmlFor="settings-wake-word"
                className="block text-xs font-medium text-slate-300"
              >
                Wake Word Phrase
              </label>
              <input
                id="settings-wake-word"
                type="text"
                value={draft.wake_word}
                onChange={(e) => setDraft({ ...draft, wake_word: e.target.value })}
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-slate-800/80 pt-4">
              <div>
                <p className="text-sm font-medium text-white">Hands-Free Continuous Voice Loop</p>
                <p className="text-xs text-slate-400">
                  Automatically resume listening right after ZARA finishes speaking a response.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.hands_free_mode}
                aria-label="Toggle hands-free voice loop"
                onClick={() => setDraft({ ...draft, hands_free_mode: !draft.hands_free_mode })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                  draft.hands_free_mode
                    ? 'border-cyan-400 bg-cyan-400/20'
                    : 'border-slate-700 bg-slate-900'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                    draft.hands_free_mode
                      ? 'translate-x-5 bg-cyan-400'
                      : 'translate-x-1 bg-slate-500'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-slate-800/80 pt-4">
              <div>
                <p className="text-sm font-medium text-white">Microphone Input Test</p>
                <p className="text-xs text-slate-400">
                  Verify your browser microphone signal level in real time.
                </p>
              </div>
              <button
                type="button"
                onClick={startMicTest}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  micTesting
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-500/40'
                }`}
              >
                <Mic className="h-3.5 w-3.5" />
                <span>{micTesting ? 'Stop Test' : 'Test Microphone'}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-400 tabular-nums">
                <span>Input Signal Level</span>
                <span>{micTestLevel}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-900">
                <div
                  className="h-full bg-cyan-400 transition-all duration-75"
                  style={{ width: `${micTestLevel}%` }}
                />
              </div>
              {micTestError && <p className="text-xs text-rose-400">{micTestError}</p>}
            </div>
          </div>
        )}

        {activeTab === 'laptop' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-800 bg-[#0D1117] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Installable App &amp; Shareable Laptop Package
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Install ZARA directly onto your laptop/desktop, or share the link &amp; setup script so anyone can run it on their own computer.
                  </p>
                </div>
                <PWAInstallButton />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-[#111827] p-3">
                <Share2 className="h-4 w-4 text-cyan-400 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">
                  {shareUrl || 'https://your-zara-app-url'}
                </span>
                <button
                  type="button"
                  onClick={() => void copyShareUrl()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 whitespace-nowrap shrink-0"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>{copiedUrl ? 'Link Copied' : 'Copy Share Link'}</span>
                </button>
              </div>

              <div className="mt-4 border-t border-slate-800/80 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Windows Desktop Installer &amp; Startup
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  On Windows, run the installer to create a ZARA desktop shortcut and optionally start ZARA automatically when you sign in. It also starts the secure local companion for app launching, approved user-folder access, and system information (Node.js 18+ required).
                </p>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  <a
                    href="/api/desktop/installer?os=win"
                    download="ZARA-Desktop-Setup.bat"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Windows Installer (.bat)</span>
                  </a>
                  <a
                    href="/api/desktop/installer?os=unix"
                    download="zara-desktop-setup.sh"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Mac / Linux Installer (.sh)</span>
                  </a>
                  <a
                    href="/api/desktop/installer?os=agent"
                    download="zara-agent.mjs"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Direct Agent (.mjs)</span>
                  </a>
                </div>
              </div>
            </div>

            <DesktopBridgePanel />
          </div>
        )}

        {activeTab === 'privacy' && (
          <div className="space-y-5 rounded-xl border border-slate-800 bg-[#0D1117] p-5">

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Local SQLite Memory Storage</h2>
                <p className="mt-1 text-xs text-slate-400 tabular-nums">
                  Currently storing {memoryCount} long-term memory entries locally on your server.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmClearOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear All Memory</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmClearOpen}
        title="Clear all stored memories?"
        description="Kya aap saari memories delete karna chahte hain? This action removes all saved facts and preferences."
        confirmLabel="Clear All"
        onConfirm={async () => {
          await onClearAllMemories();
          setConfirmClearOpen(false);
        }}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}
