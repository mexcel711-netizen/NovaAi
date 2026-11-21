import { useState } from 'react';
import { BookOpen, Play, Plus, Trash2, X } from 'lucide-react';
import type { KnowledgeSource, SkillActionType, SkillConfig } from '../../types/nova';

interface SkillsViewProps {
  skills: SkillConfig[];
  knowledge: KnowledgeSource[];
  onToggleSkill: (id: number, isEnabled: boolean) => Promise<void>;
  onCreateSkill: (input: {
    display_name: string;
    description: string;
    trigger_phrases: string[];
    action_type: SkillActionType;
    action_value: string;
  }) => Promise<void>;
  onDeleteSkill: (id: number) => Promise<void>;
  onDeleteKnowledge: (id: number) => Promise<void>;
  onTestSkill: (phrase: string) => void;
  onExecuteStudyTask?: (studyId: number, taskPrompt: string) => void;
}

export function SkillsView({
  skills,
  knowledge,
  onToggleSkill,
  onCreateSkill,
  onDeleteSkill,
  onDeleteKnowledge,
  onTestSkill,
  onExecuteStudyTask,
}: SkillsViewProps) {
  const [studyTaskDrafts, setStudyTaskDrafts] = useState<Record<number, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [triggersText, setTriggersText] = useState('');
  const [actionType, setActionType] = useState<SkillActionType>('url');
  const [actionValue, setActionValue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const triggers = triggersText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!displayName.trim()) {
      setFormError('Skill name is required.');
      return;
    }
    if (triggers.length === 0) {
      setFormError('Enter at least one trigger phrase (comma-separated).');
      return;
    }
    if (!actionValue.trim()) {
      setFormError('Action target (URL, message, or command) is required.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      await onCreateSkill({
        display_name: displayName.trim(),
        description: description.trim() || 'Custom automation skill',
        trigger_phrases: triggers,
        action_type: actionType,
        action_value: actionValue.trim(),
      });
      setDisplayName('');
      setDescription('');
      setTriggersText('');
      setActionValue('');
      setShowAddForm(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">
            Skills, Study Knowledge &amp; Automation
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage built-in &amp; custom voice skills alongside Books, Software, and Courses NOVA has read.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap shrink-0"
        >
          {showAddForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span>{showAddForm ? 'Close Form' : 'Add Custom Skill'}</span>
        </button>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleSubmit}
          className="mt-5 rounded-xl border border-cyan-500/30 bg-[#0D1117] p-5"
        >
          <h2 className="text-sm font-semibold text-white">Create Custom Skill</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="skill-name-input" className="block text-xs font-medium text-slate-300">
                Skill Name
              </label>
              <input
                id="skill-name-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Open Project Board"
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="skill-action-type" className="block text-xs font-medium text-slate-300">
                Action Type
              </label>
              <select
                id="skill-action-type"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as SkillActionType)}
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white focus:border-cyan-500/60 focus:outline-none"
              >
                <option value="url">Open Website URL</option>
                <option value="note">Save Note Template</option>
                <option value="system">Custom Reply / System Message</option>
              </select>
            </div>

            <div>
              <label htmlFor="skill-triggers-input" className="block text-xs font-medium text-slate-300">
                Trigger Phrases (comma-separated)
              </label>
              <input
                id="skill-triggers-input"
                type="text"
                value={triggersText}
                onChange={(e) => setTriggersText(e.target.value)}
                placeholder="e.g. open board, board kholo"
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="skill-action-value" className="block text-xs font-medium text-slate-300">
                Action Target
              </label>
              <input
                id="skill-action-value"
                type="text"
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                placeholder={
                  actionType === 'url'
                    ? 'https://github.com'
                    : 'Note text or response template'
                }
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="skill-desc-input" className="block text-xs font-medium text-slate-300">
                Description (optional)
              </label>
              <input
                id="skill-desc-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly describe what this skill automates"
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-[#111827] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
              />
            </div>
          </div>

          {formError && <p className="mt-3 text-xs text-rose-400">{formError}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Skill'}
            </button>
          </div>
        </form>
      )}

      {/* Studied Books / Software / Courses Library */}
      {knowledge.length > 0 && (
        <section className="mt-5" aria-label="Studied books, software, and courses">
          <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-cyan-300">
            Studied Books, Software &amp; Courses ({knowledge.length})
          </h2>
          <div className="mt-2.5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {knowledge.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-cyan-500/25 bg-[#0D1117] p-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-cyan-400 shrink-0" />
                        <h3 className="truncate text-sm font-semibold text-white">{item.title}</h3>
                      </div>
                      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">
                        {item.kind} {item.goal ? `· Goal: ${item.goal}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete studied item "${item.title}"`}
                      onClick={() => void onDeleteKnowledge(item.id)}
                      className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-300" dir="auto">
                    {item.detailed_summary}
                  </p>
                  {item.action_plan.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                      {item.action_plan.slice(0, 3).map((step, i) => (
                        <li key={i} className="truncate">
                          {i + 1}. {step}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-3 space-y-2 border-t border-slate-800/80 pt-2.5">
                  {onExecuteStudyTask && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        aria-label={`Task from ${item.title}`}
                        value={studyTaskDrafts[item.id] ?? ''}
                        onChange={(e) =>
                          setStudyTaskDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        placeholder="Is course mein se yeh kar do..."
                        className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-[#111827] px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={!(studyTaskDrafts[item.id] ?? '').trim()}
                        onClick={() => {
                          const prompt = (studyTaskDrafts[item.id] ?? '').trim();
                          if (!prompt) return;
                          setStudyTaskDrafts((prev) => ({ ...prev, [item.id]: '' }));
                          onExecuteStudyTask(item.id, prompt);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-45 whitespace-nowrap shrink-0"
                      >
                        <Play className="h-3 w-3" />
                        <span>Execute Task</span>
                      </button>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        onTestSkill(
                          `Explain the next practical step from "${item.title}"${
                            item.goal ? ` for my goal: ${item.goal}` : ''
                          }`
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300"
                    >
                      <Play className="h-3 w-3" />
                      <span>Discuss in Chat</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {skills.map((skill) => {
          const sampleTrigger = skill.trigger_phrases[0] || skill.display_name;
          return (
            <div
              key={skill.id}
              className="flex flex-col justify-between rounded-xl border border-slate-800 bg-[#0D1117] p-5"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-white">{skill.display_name}</h3>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <span>{skill.is_custom ? 'Custom' : 'Built-in'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">Type: {skill.action_type}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={skill.is_enabled}
                      aria-label={`Toggle ${skill.display_name}`}
                      onClick={() => onToggleSkill(skill.id, !skill.is_enabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                        skill.is_enabled
                          ? 'border-cyan-400 bg-cyan-400/20'
                          : 'border-slate-700 bg-slate-900'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                          skill.is_enabled
                            ? 'translate-x-5 bg-cyan-400'
                            : 'translate-x-1 bg-slate-500'
                        }`}
                      />
                    </button>
                    {skill.is_custom && (
                      <button
                        type="button"
                        aria-label={`Delete custom skill "${skill.display_name}"`}
                        onClick={() => onDeleteSkill(skill.id)}
                        className="rounded-md p-1 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">{skill.description}</p>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
                <p className="truncate text-xs text-slate-500">
                  Triggers: {skill.trigger_phrases.join(' · ')}
                </p>
                <button
                  type="button"
                  disabled={!skill.is_enabled}
                  onClick={() =>
                    onTestSkill(
                      skill.skill_name === 'calculator'
                        ? 'calculate 24 * 15'
                        : skill.skill_name === 'notes_manager'
                          ? 'create note: Skill verification test'
                          : skill.skill_name === 'reminders_manager'
                            ? 'remind me to check logs at 7pm'
                            : skill.skill_name === 'app_launcher'
                              ? 'Chrome kholo'
                              : sampleTrigger
                    )
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400 transition-colors hover:text-cyan-300 disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Play className="h-3 w-3" />
                  <span>Test</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
