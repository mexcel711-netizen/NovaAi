import { useEffect, useState } from 'react';
import { Check, Heart, Plus, Sparkles, Trash2, UserCheck, X } from 'lucide-react';
import { FEMALE_VOICE_OPTIONS, MALE_VOICE_OPTIONS } from '../../lib/voiceCatalog';
import type {
  AppConfig,
  CharacterProfile,
  HairstyleOption,
  LanguageCode,
  MoodMode,
  ResponseStyle,
} from '../../types/nova';

interface CharacterViewProps {
  config: AppConfig;
  characters: CharacterProfile[];
  activeCharacter?: CharacterProfile;
  onSaveConfig: (partial: Partial<AppConfig>) => Promise<void>;
  onSelectCharacter: (idOrSlug: number | string) => Promise<void>;
  onCreateCharacter: (input: {
    name: string;
    role_title: string;
    bio: string;
    personality: ResponseStyle;
    default_mood: MoodMode;
    tts_voice: string;
    system_prompt: string;
  }) => Promise<void>;
  onDeleteCharacter: (id: number) => Promise<void>;
  onEvolveCharacter: () => Promise<void>;
}

const PERSONALITY_PRESETS: Array<{
  id: ResponseStyle;
  label: string;
  desc: string;
  prompt: string;
}> = [
  {
    id: 'warm_urdu_companion',
    label: 'Real Best Friend (ZARA)',
    desc: 'Natural Roman Urdu & Urdu warmth — straight, short, real.',
    prompt:
      'Tum ZARA ho — real-life best friend. Roman Urdu mein seedha, chhota aur dostana baat karo. User ko Boss kaho.',
  },
  {
    id: 'friendly_professional',
    label: 'Friendly & Focused',
    desc: 'Warm best friend who also helps execute study & tech tasks.',
    prompt:
      'You are ZARA, a warm, perceptive best friend and study companion fluent in Roman Urdu, Urdu, and English.',
  },
  {
    id: 'concise_technical',
    label: 'Concise & Technical',
    desc: 'Direct, structured engineering, code, and course execution.',
    prompt:
      'You are ZARA, a crisp technical partner. Deliver direct solutions, clean steps, and accurate Urdu/English terminology.',
  },
];

const HAIRSTYLE_CARDS: Array<{ id: HairstyleOption; label: string; desc: string }> = [
  { id: 'bob', label: 'Short bob', desc: 'Chin-length, soft waves' },
  { id: 'wavy', label: 'Wavy hair', desc: 'Long, flowing waves' },
  { id: 'straight', label: 'Straight hair', desc: 'Silky, flowing strands' },
];

export function CharacterView({
  config,
  characters,
  activeCharacter,
  onSaveConfig,
  onSelectCharacter,
  onCreateCharacter,
  onDeleteCharacter,
  onEvolveCharacter,
}: CharacterViewProps) {
  const [assistantName, setAssistantName] = useState(config.assistant_name);
  const [userNickname, setUserNickname] = useState(config.user_nickname || 'Boss');
  const [hairstyle, setHairstyle] = useState<HairstyleOption>(config.hairstyle || 'wavy');
  const [personality, setPersonality] = useState<ResponseStyle>(config.personality);
  const [language, setLanguage] = useState<LanguageCode>(config.language);
  const [responseTone, setResponseTone] = useState<'casual' | 'formal'>(config.response_tone);
  const [customPrompt, setCustomPrompt] = useState(config.custom_prompt);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isEvolving, setIsEvolving] = useState(false);

  // Custom Character Form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newPersonality, setNewPersonality] = useState<ResponseStyle>('warm_urdu_companion');
  const [newMood, setNewMood] = useState<MoodMode>('love');
  const [newVoice, setNewVoice] = useState('Zephyr');
  const [newPrompt, setNewPrompt] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    setAssistantName(config.assistant_name);
    setUserNickname(config.user_nickname || 'Boss');
    setHairstyle(config.hairstyle || 'wavy');
    setPersonality(config.personality);
    setLanguage(config.language);
    setResponseTone(config.response_tone);
    setCustomPrompt(config.custom_prompt);
  }, [config]);

  const handleSelectPreset = (preset: (typeof PERSONALITY_PRESETS)[number]) => {
    setPersonality(preset.id);
    setCustomPrompt(preset.prompt);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assistantName.trim()) {
      setErrorMsg('Assistant name cannot be empty.');
      return;
    }
    setErrorMsg(null);
    setIsSaving(true);
    try {
      await onSaveConfig({
        assistant_name: assistantName.trim(),
        user_nickname: userNickname.trim() || 'Boss',
        hairstyle,
        personality,
        language,
        response_tone: responseTone,
        custom_prompt: customPrompt.trim(),
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPrompt.trim()) {
      setCreateError('Character name and prompt instructions are required.');
      return;
    }
    setCreateError(null);
    await onCreateCharacter({
      name: newName.trim(),
      role_title: newRole.trim() || 'Living AI Companion',
      bio: newBio.trim() || 'Custom user-created living AI character.',
      personality: newPersonality,
      default_mood: newMood,
      tts_voice: newVoice,
      system_prompt: newPrompt.trim(),
    });
    setNewName('');
    setNewRole('');
    setNewBio('');
    setNewPrompt('');
    setShowCreateForm(false);
  };

  const handleEvolve = async () => {
    setIsEvolving(true);
    try {
      await onEvolveCharacter();
    } finally {
      setIsEvolving(false);
    }
  };

  const currentChar = activeCharacter || characters.find((c) => c.is_active) || characters[0];
  const xpIntoLevel = currentChar ? currentChar.xp % 100 : 0;

  const nick = userNickname.trim() || 'Boss';
  const previewGreeting =
    language === 'en'
      ? `Hey ${nick}! What's going on today? Tell me everything.`
      : responseTone === 'formal'
        ? `السلام علیکم ${nick}! میں ${assistantName.trim() || 'ZARA'} ہوں، بتائیے آج کیا چل رہا ہے؟`
        : `Arre ${nick}! Kya chal raha hai? Batao!`;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">
            Living Characters &amp; Self-Evolution
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Select a living companion, create new personas, and evolve traits organically from your chats.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap shrink-0"
        >
          {showCreateForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span>{showCreateForm ? 'Close Creator' : 'Create New Character'}</span>
        </button>
      </div>

      {/* Create Custom Living Character Form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateSubmit}
          className="mt-5 rounded-xl border border-cyan-500/30 bg-[#0D1117] p-5"
        >
          <h2 className="text-sm font-semibold text-white">Design Custom Living Character</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="new-char-name" className="block text-xs font-medium text-slate-300">
                Character Name
              </label>
              <input
                id="new-char-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. HIRA"
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-char-role" className="block text-xs font-medium text-slate-300">
                Role / Specialty
              </label>
              <input
                id="new-char-role"
                type="text"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                placeholder="e.g. Coding Mentor & Best Friend"
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-char-mood" className="block text-xs font-medium text-slate-300">
                Default Mood
              </label>
              <select
                id="new-char-mood"
                value={newMood}
                onChange={(e) => setNewMood(e.target.value as MoodMode)}
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
              >
                <option value="calm">Calm</option>
                <option value="happy">Happy Mode</option>
                <option value="love">Love Mode</option>
                <option value="sad">Sad Mode</option>
                <option value="surprised">Surprised</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-char-voice" className="block text-xs font-medium text-slate-300">
                Voice Persona (Female &amp; Male)
              </label>
              <select
                id="new-char-voice"
                value={newVoice}
                onChange={(e) => setNewVoice(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
              >
                <optgroup label="Female Voices (Realistic)">
                  {FEMALE_VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Male Voices (Realistic)">
                  {MALE_VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="new-char-bio" className="block text-xs font-medium text-slate-300">
                Short Bio
              </label>
              <input
                id="new-char-bio"
                type="text"
                value={newBio}
                onChange={(e) => setNewBio(e.target.value)}
                placeholder="How does this character support you every day?"
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="new-char-prompt" className="block text-xs font-medium text-slate-300">
                Personality &amp; Behavior Instructions
              </label>
              <textarea
                id="new-char-prompt"
                rows={3}
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="You are HIRA, a warm Pakistani companion who guides me on coding and speaks gently in Urdu..."
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] p-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>
          </div>
          {createError && <p className="mt-3 text-xs text-rose-400">{createError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Create Character
            </button>
          </div>
        </form>
      )}

      {/* Selectable Character Roster */}
      {characters.length > 0 && (
        <section className="mt-5" aria-label="Selectable character roster">
          <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-400">
            Selectable Characters ({characters.length})
          </h2>
          <div className="mt-2.5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {characters.map((ch) => (
              <div
                key={ch.id}
                data-testid={`character-card-${ch.slug}`}
                className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${
                  ch.is_active
                    ? 'border-cyan-400/60 bg-cyan-500/10'
                    : 'border-slate-800 bg-[#0D1117] hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{ch.name}</h3>
                        {ch.default_mood === 'love' && (
                          <Heart className="h-3.5 w-3.5 text-rose-400" />
                        )}
                      </div>
                      <p className="text-xs font-medium text-cyan-300">{ch.role_title}</p>
                    </div>
                    <span className="font-mono text-xs text-amber-300 tabular-nums shrink-0">
                      Bond Lv {ch.bond_level} · {ch.xp} XP
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{ch.bio}</p>
                  <p className="mt-2 text-[11px] text-slate-400">
                    Traits: {ch.learned_traits.slice(0, 3).join(' · ')}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs">
                  <span className="capitalize text-slate-400">
                    Mood: {ch.default_mood} · Voice: {ch.tts_voice}
                  </span>
                  <div className="flex items-center gap-2">
                    {ch.is_custom && !ch.is_active && (
                      <button
                        type="button"
                        aria-label={`Delete character ${ch.name}`}
                        onClick={() => void onDeleteCharacter(ch.id)}
                        className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={ch.is_active}
                      onClick={() => void onSelectCharacter(ch.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        ch.is_active
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                      }`}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      <span>{ch.is_active ? 'Active' : `Select ${ch.name}`}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Living Self-Development & Life Journal Panel */}
      {currentChar && (
        <section
          aria-label="Living character self-development"
          className="mt-6 rounded-xl border border-amber-500/25 bg-[#0D1117] p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                {currentChar.name} — Living Evolution &amp; Life Journal
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Every conversation, memory, and studied book grows {currentChar.name}&apos;s bond level and traits.
              </p>
            </div>
            <button
              type="button"
              disabled={isEvolving}
              onClick={() => void handleEvolve()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/25 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{isEvolving ? 'Developing...' : 'Auto-Develop Character Now'}</span>
            </button>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-300 tabular-nums">
              <span>Bond Level {currentChar.bond_level}</span>
              <span>{xpIntoLevel}/100 XP to next level ({currentChar.xp} total XP)</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-900">
              <div
                className="h-full bg-amber-400 transition-all duration-300"
                style={{ width: `${Math.max(8, xpIntoLevel)}%` }}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-[#0A101B] p-3.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                Self-Developed Traits ({currentChar.learned_traits.length})
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-200">
                {currentChar.learned_traits.map((trait) => (
                  <li key={trait} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45 bg-cyan-400" />
                    <span>{trait}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0A101B] p-3.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                Recent Life Journal
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-300">
                {currentChar.life_journal.slice(0, 4).map((entry, idx) => (
                  <li key={`${idx}-${entry.slice(0, 12)}`} className="leading-snug">
                    • {entry}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Fine-Tune Active Character Prompt & Tone */}
      <form onSubmit={handleSave} className="mt-6 space-y-5 rounded-xl border border-slate-800 bg-[#0D1117] p-5">
        <h2 className="text-sm font-semibold text-white">Fine-Tune Active Persona</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor="char-name-input" className="block text-xs font-medium text-slate-300">
              Assistant Name
            </label>
            <input
              id="char-name-input"
              type="text"
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="char-nickname-input" className="block text-xs font-medium text-slate-300">
              What She Calls You
            </label>
            <input
              id="char-nickname-input"
              type="text"
              value={userNickname}
              onChange={(e) => setUserNickname(e.target.value)}
              placeholder="Boss"
              className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="char-language-select" className="block text-xs font-medium text-slate-300">
              Language Preference
            </label>
            <select
              id="char-language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3.5 py-2.5 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
            >
              <option value="bilingual">Roman Urdu + Urdu + English</option>
              <option value="ur">Roman Urdu / Urdu Primary</option>
              <option value="en">English Primary</option>
            </select>
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-300">Holographic Hairstyle</span>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {HAIRSTYLE_CARDS.map((h) => {
              const active = hairstyle === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHairstyle(h.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-cyan-400 bg-cyan-500/15 text-white'
                      : 'border-slate-800 bg-[#111827] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <p className="text-sm font-semibold">{h.label}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{h.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-300">Personality Preset</span>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
            {PERSONALITY_PRESETS.map((preset) => {
              const active = personality === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`rounded-xl border p-3.5 text-left transition-colors ${
                    active
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
                      : 'border-slate-800 bg-[#111827] text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <p className="text-sm font-semibold">{preset.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{preset.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-slate-300">Response Style</span>
          <div className="mt-2 inline-flex rounded-lg border border-slate-800 bg-[#111827] p-1">
            {(['casual', 'formal'] as const).map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => setResponseTone(tone)}
                className={`rounded-md px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                  responseTone === tone
                    ? 'bg-cyan-500/15 text-cyan-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tone}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="char-system-prompt" className="block text-xs font-medium text-slate-300">
            System Prompt
          </label>
          <textarea
            id="char-system-prompt"
            rows={3}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-[#111827] p-3.5 text-sm leading-relaxed text-slate-100 focus:border-cyan-500/60 focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-3.5">
          <p className="text-xs font-medium text-slate-400">Live Greeting Preview</p>
          <p className="mt-1 text-sm text-cyan-200" dir="auto">{previewGreeting}</p>
        </div>

        {errorMsg && <p className="text-xs text-rose-400">{errorMsg}</p>}

        <div className="flex items-center justify-end gap-3 border-t border-slate-800/80 pt-4">
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
              <Check className="h-4 w-4" />
              Character saved
            </span>
          )}
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-cyan-400 px-5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Character'}
          </button>
        </div>
      </form>
    </div>
  );
}
