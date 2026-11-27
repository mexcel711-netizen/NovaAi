import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { searchYouTubeVideos, YouTubeApiError } from './src/lib/youtube';
import { generateCloudflareRestReply } from './server/cloudflare';
import {
  addKnowledgeSource,
  addMemory,
  addNote,
  addReminder,
  clearAllMemories,
  createCharacter,
  createSkill,
  deleteCharacter,
  deleteKnowledgeSource,
  deleteMemory,
  deleteNote,
  deleteReminder,
  deleteSession,
  deleteSkill,
  getActiveCharacter,
  getCharacters,
  getConfig,
  getConversationMessages,
  getKnowledgeSources,
  getMemories,
  getNotes,
  getRecentConversationsForExport,
  getRecentUserMessages,
  getReminders,
  getSessionSummaries,
  getSkills,
  saveConversationTurn,
  saveOnboarding,
  selectCharacterByIdOrSlug,
  toggleReminder,
  toggleSkill,
  updateCharacterEvolution,
  updateConfig,
} from './server/db';
import {
  analyzeStudyMaterial,
  analyzeVisionSnapshot,
  buildSystemInstruction,
  executeStudyTaskWithAi,
  generateNovaReply,
  generateNovaSpeech,
  hasGoogleAiKey,
  stripAndExtractAiActions,
  transcribeNovaAudio,
} from './server/gemini';
import { computeEvolutionProgress } from './src/lib/characterEngine';
import {
  detectEmotionFromText,
  extractEmotionAndCleanText,
  resolveActiveAiProvider,
} from './src/lib/emotionAndSpeech';
import { buildLocalConversationalReply } from './src/lib/localBrain';
import { extractMemoriesFromUtterance } from './src/lib/memoryExtractor';
import { detectUrduIntent, isComplexThinkingQuery, matchSkillCommand } from './src/lib/skillMatcher';
import { buildMemoryVaultPayload, formatMemoryVaultMarkdown } from './src/lib/usbTransfer';
import type {
  ChatApiResponse,
  FacialEmotion,
  KnowledgeKind,
  MoodMode,
  OnboardingPayload,
  ProviderStatus,
  ResponseStyle,
  SkillActionType,
} from './src/types/nova';

const PORT = 3000;
const ALLOWED_SKILL_ACTION_TYPES = new Set<SkillActionType>([
  'launch',
  'url',
  'system',
  'ai',
  'note',
  'reminder',
  'calc',
  'study',
  'vision',
  'evolve',
  'desktop',
]);

function parsePositiveId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getProviderStatus(): ProviderStatus {
  const config = getConfig();
  const hasCfRest = Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim()
  );
  return resolveActiveAiProvider({
    preference: config.ai_provider,
    hasCloudflareBinding: false,
    hasCloudflareRest: hasCfRest,
    hasGoogleAiKey: hasGoogleAiKey(),
  });
}

function buildLocalStructuredStudy(params: {
  kind: KnowledgeKind;
  title: string;
  goal: string;
  contentText: string;
}): { detailedSummary: string; actionPlan: string[] } {
  const cleanLines = params.contentText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3);
  const headings = cleanLines.filter((l) => /^#{1,3}\s+/.test(l) || /^[A-Z0-9][^.!?]{4,60}:$/.test(l)).slice(0, 5);
  const keySnippets = cleanLines.slice(0, 6).join(' ');
  const summaryParts = [
    `Local Structured Study Outline (Configure GEMINI_API_KEY in Secrets for deep AI commentary):`,
    `• Source (${params.kind.toUpperCase()}): ${params.title}`,
    params.goal ? `• Your Goal: ${params.goal}` : '',
    headings.length > 0 ? `• Detected Sections: ${headings.join(' | ')}` : '',
    keySnippets ? `• Core Excerpt: ${keySnippets.slice(0, 420)}` : '',
  ].filter(Boolean);

  const actionPlan = [
    `Read & review the ${cleanLines.length || 1} parsed lines from "${params.title}"`,
    params.goal
      ? `Break "${params.goal}" into small testable steps using the core concepts`
      : `Identify the primary workflow or chapter exercise in ${params.title}`,
    'Ask ZARA in chat about any section or code block for follow-up guidance',
    'Run the character Self-Develop action to turn this knowledge into active AI traits',
  ];

  return {
    detailedSummary: summaryParts.join('\n'),
    actionPlan,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      providerStatus: getProviderStatus(),
    });
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      config: getConfig(),
      skills: getSkills(),
      memories: getMemories(),
      notes: getNotes(),
      reminders: getReminders(),
      sessions: getSessionSummaries(),
      characters: getCharacters(),
      activeCharacter: getActiveCharacter(),
      knowledge: getKnowledgeSources(),
      providerStatus: getProviderStatus(),
    });
  });

  app.get('/api/memory/export', (_req, res) => {
    const vault = buildMemoryVaultPayload({
      config: getConfig(),
      memories: getMemories(),
      notes: getNotes(),
      reminders: getReminders(),
      knowledge: getKnowledgeSources(),
      characters: getCharacters(),
      sessions: getSessionSummaries(),
      recentConversations: getRecentConversationsForExport(250),
    });
    res.json({
      vault,
      markdown: formatMemoryVaultMarkdown(vault),
    });
  });

  app.get('/api/conversations/:sessionId', (req, res) => {
    const messages = getConversationMessages(req.params.sessionId);
    res.json({ messages });
  });

  app.delete('/api/conversations/:sessionId', (req, res) => {
    deleteSession(req.params.sessionId);
    res.json({ ok: true, sessions: getSessionSummaries() });
  });

  app.post('/api/onboarding', (req, res) => {
    try {
      const payload = req.body as OnboardingPayload;
      const result = saveOnboarding(payload);
      res.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save onboarding.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const {
        message,
        sessionId,
        forceThinking,
        attachmentTitle,
        attachmentText,
        attachmentKind,
      } = req.body as {
        message?: string;
        sessionId?: string;
        forceThinking?: boolean;
        attachmentTitle?: string;
        attachmentText?: string;
        attachmentKind?: KnowledgeKind;
      };

      const cleanMessage = (message ?? '').trim();
      const activeSession = (sessionId ?? '').trim() || `session-${Date.now()}`;

      if (!cleanMessage && !attachmentText?.trim()) {
        res.status(400).json({ error: 'Message cannot be empty.' });
        return;
      }

      const config = getConfig();
      const skills = getSkills();
      const characters = getCharacters();
      const activeCharacter = getActiveCharacter();
      const effectiveMessage =
        cleanMessage || `Read and explain "${attachmentTitle || 'Attached Material'}"`;
      const userLang: 'en' | 'ur' = detectUrduIntent(effectiveMessage) ? 'ur' : 'en';

      let studiedTitle: string | undefined;
      if (attachmentText?.trim()) {
        const cleanTitle = (attachmentTitle ?? '').trim() || 'Attached Study Material';
        const cleanKind: KnowledgeKind =
          attachmentKind === 'software' || attachmentKind === 'course' ? attachmentKind : 'book';
        let detailedSummary = '';
        let actionPlan: string[] = [];
        if (hasGoogleAiKey()) {
          try {
            const analysis = await analyzeStudyMaterial({
              kind: cleanKind,
              title: cleanTitle,
              goal: effectiveMessage,
              contentText: attachmentText.trim(),
              config,
            });
            detailedSummary = analysis.detailedSummary;
            actionPlan = analysis.actionPlan;
          } catch {
            const local = buildLocalStructuredStudy({
              kind: cleanKind,
              title: cleanTitle,
              goal: effectiveMessage,
              contentText: attachmentText.trim(),
            });
            detailedSummary = local.detailedSummary;
            actionPlan = local.actionPlan;
          }
        } else {
          const local = buildLocalStructuredStudy({
            kind: cleanKind,
            title: cleanTitle,
            goal: effectiveMessage,
            contentText: attachmentText.trim(),
          });
          detailedSummary = local.detailedSummary;
          actionPlan = local.actionPlan;
        }
        addKnowledgeSource({
          kind: cleanKind,
          title: cleanTitle,
          goal: effectiveMessage,
          source_excerpt: attachmentText.trim(),
          detailed_summary: detailedSummary,
          action_plan: actionPlan,
        });
        addMemory({
          category: 'fact',
          key: `studied_${cleanKind}`,
          value: `Read ${cleanKind}: ${cleanTitle}`,
          source: 'user_stated',
          confidence: 0.96,
        });
        studiedTitle = cleanTitle;
      }

      // Persist user message
      saveConversationTurn({
        sessionId: activeSession,
        role: 'user',
        content: studiedTitle ? `[Attached ${studiedTitle}] ${effectiveMessage}` : effectiveMessage,
        language: userLang,
        emotion: detectEmotionFromText(effectiveMessage),
      });

      // Extract explicit long-term facts/preferences from user statement
      const extracted = extractMemoriesFromUtterance(effectiveMessage);
      for (const item of extracted) {
        addMemory({
          category: item.category,
          key: item.key,
          value: item.value,
          source: item.source,
          confidence: item.confidence,
        });
      }

      // Organic character XP & trait evolution from every conversation
      const evoOutcome = computeEvolutionProgress({
        character: activeCharacter,
        xpGain: 12,
        recentUserMessages: [effectiveMessage, ...getRecentUserMessages(8)],
        memories: getMemories(),
        knowledge: getKnowledgeSources(),
      });
      const updatedChar = updateCharacterEvolution({
        id: activeCharacter.id,
        xp: evoOutcome.nextXp,
        bondLevel: evoOutcome.nextBondLevel,
        learnedTraits: [...activeCharacter.learned_traits, ...evoOutcome.newTraits],
        lifeJournal:
          evoOutcome.leveledUp || evoOutcome.newTraits.length > 0
            ? [evoOutcome.journalEntry, ...activeCharacter.life_journal]
            : activeCharacter.life_journal,
      });

      // 1. Check direct skills first (instant execution when not an attached study doc)
      const skillMatch = studiedTitle
        ? { matched: false as const }
        : matchSkillCommand(
            effectiveMessage,
            skills,
            new Date(),
            characters.map((c) => ({ slug: c.slug, name: c.name }))
          );
      if (skillMatch.matched && skillMatch.responseText) {
        const sideEffect = skillMatch.sideEffect;
        let finalReply = skillMatch.responseText;

        if (sideEffect?.type === 'create_note' && sideEffect.noteContent) {
          addNote(sideEffect.noteTitle ?? 'Quick Note', sideEffect.noteContent, ['voice']);
        } else if (sideEffect?.type === 'create_reminder' && sideEffect.reminderTitle) {
          addReminder(sideEffect.reminderTitle, sideEffect.reminderAt ?? 'Today');
        } else if (sideEffect?.type === 'switch_mood' && sideEffect.mood) {
          updateConfig({ active_mood: sideEffect.mood });
        } else if (sideEffect?.type === 'switch_character' && sideEffect.characterSlug) {
          selectCharacterByIdOrSlug(sideEffect.characterSlug);
        } else if (sideEffect?.type === 'toggle_auto_usb') {
          updateConfig({ auto_usb_transfer: Boolean(sideEffect.autoUsbEnabled) });
        } else if (sideEffect?.type === 'list_memories') {
          const currentMems = getMemories().slice(0, 6);
          if (currentMems.length > 0) {
            finalReply =
              userLang === 'ur'
                ? `آپ کی محفوظ یادداشتیں (${getMemories().length} کل): ${currentMems.map((m) => m.value).join(' · ')}`
                : `Your recorded memories (${getMemories().length} total): ${currentMems.map((m) => m.value).join(' · ')}`;
          } else {
            finalReply =
              userLang === 'ur'
                ? 'ابھی تک کوئی یادداشت محفوظ نہیں ہے۔ اپنا نام، شہر یا کوئی بات بتائیں، میں فوراً محفوظ کر لوں گی۔'
                : 'No recorded memories yet. Tell me anything about yourself and I will remember it.';
          }
        }

        const replyLang = skillMatch.language ?? userLang;
        const skillEmotion: FacialEmotion =
          skillMatch.emotion || detectEmotionFromText(finalReply);

        saveConversationTurn({
          sessionId: activeSession,
          role: 'assistant',
          content: finalReply,
          language: replyLang,
          emotion: skillEmotion,
          modelUsed: 'skill-engine',
          providerUsed: 'local-skill',
          thinkingUsed: false,
          skillExecuted: skillMatch.skillName,
        });

        const payload: ChatApiResponse = {
          reply: finalReply,
          emotion: skillEmotion,
          language: replyLang,
          modelUsed: 'skill-engine',
          providerUsed: 'local-skill',
          thinkingUsed: false,
          skillExecuted: skillMatch.skillName,
          sideEffect,
          extractedMemories: extracted.map((m) => ({
            category: m.category,
            key: m.key,
            value: m.value,
          })),
          characterUpdate: updatedChar
            ? {
                bondLevel: updatedChar.bond_level,
                xp: updatedChar.xp,
                newTrait: evoOutcome.newTraits[0],
              }
            : undefined,
        };
        res.json(payload);
        return;
      }

      // 2. Route to active AI provider (Google AI Studio or Cloudflare Workers AI)
      const history = getConversationMessages(activeSession).slice(0, -1);
      const memories = getMemories();
      const notes = getNotes();
      const reminders = getReminders();
      const knowledge = getKnowledgeSources();
      const providerStatus = getProviderStatus();

      const shouldThink =
        Boolean(forceThinking) ||
        config.deep_thinking_mode === 'always' ||
        (config.deep_thinking_mode === 'auto' && isComplexThinkingQuery(effectiveMessage));

      let replyText = '';
      let replyEmotion: FacialEmotion = 'calm';
      let modelUsed = '';
      let thinkingUsed = false;
      let warning: string | undefined;
      let aiMemories: Array<{ category: 'fact' | 'preference' | 'note' | 'reminder'; value: string }> = [];
      let aiNotes: Array<{ title: string; content: string }> = [];
      let aiReminders: Array<{ title: string; remindAt: string }> = [];

      if (providerStatus.activeProvider === 'unconfigured') {
        const localReply = buildLocalConversationalReply({
          userMessage: effectiveMessage,
          config,
          activeCharacter: updatedChar || activeCharacter,
          memories,
          notes,
          reminders,
          knowledge,
          extractedMemoriesCount: extracted.length,
        });
        replyText = localReply.reply;
        replyEmotion = localReply.emotion;
        modelUsed = 'local-companion-brain';
      } else if (providerStatus.activeProvider === 'cloudflare-rest') {
        try {
          const systemInstruction = buildSystemInstruction({
            config,
            memories,
            notes,
            reminders,
            activeCharacter: updatedChar || activeCharacter,
            knowledge,
            userMessage: effectiveMessage,
          });
          const cfResult = await generateCloudflareRestReply({
            userMessage: effectiveMessage,
            history,
            config,
            memories,
            notes,
            reminders,
            systemInstruction,
          });
          const actParsed = stripAndExtractAiActions(cfResult.text);
          aiNotes = actParsed.aiNotes;
          aiReminders = actParsed.aiReminders;
          const parsed = extractEmotionAndCleanText(actParsed.text);
          replyText = parsed.cleanText;
          replyEmotion = parsed.emotion;
          modelUsed = cfResult.modelUsed;
        } catch (cfErr) {
          const localReply = buildLocalConversationalReply({
            userMessage: effectiveMessage,
            config,
            activeCharacter: updatedChar || activeCharacter,
            memories,
            notes,
            reminders,
            knowledge,
            extractedMemoriesCount: extracted.length,
          });
          replyText = localReply.reply;
          replyEmotion = localReply.emotion;
          modelUsed = 'local-companion-brain';
          warning = cfErr instanceof Error ? cfErr.message : 'Cloudflare AI unavailable';
        }
      } else {
        try {
          const aiResult = await generateNovaReply({
            userMessage: effectiveMessage,
            history,
            config,
            memories,
            notes,
            reminders,
            activeCharacter: updatedChar || activeCharacter,
            knowledge,
            useDeepThinking: shouldThink,
          });
          const actParsed = stripAndExtractAiActions(aiResult.text);
          replyText = actParsed.text;
          aiNotes = actParsed.aiNotes;
          aiReminders = actParsed.aiReminders;
          replyEmotion = aiResult.emotion;
          modelUsed = aiResult.modelUsed;
          thinkingUsed = aiResult.thinkingUsed;
          aiMemories = aiResult.aiMemories;
          warning = aiResult.warning;
        } catch (aiErr) {
          const matchedSource = knowledge.find((k) =>
            effectiveMessage.toLowerCase().includes(k.title.toLowerCase())
          );
          if (matchedSource) {
            const nick = config.user_nickname || config.user_name || 'Boss';
            replyText = `${nick}, "${matchedSource.title}" mere paas saved hai — pehla step: ${matchedSource.action_plan[0] || matchedSource.detailed_summary.slice(0, 140)}`;
            replyEmotion = 'calm';
          } else {
            const localReply = buildLocalConversationalReply({
              userMessage: effectiveMessage,
              config,
              activeCharacter: updatedChar || activeCharacter,
              memories,
              notes,
              reminders,
              knowledge,
              extractedMemoriesCount: extracted.length,
            });
            replyText = localReply.reply;
            replyEmotion = localReply.emotion;
          }
          modelUsed = 'local-companion-brain';
          warning = aiErr instanceof Error ? aiErr.message : 'Transient upstream model error';
        }
      }

      // Apply AI-inferred continuous memories silently
      for (const mem of aiMemories) {
        addMemory({
          category: mem.category,
          key: 'ai_learned',
          value: mem.value,
          source: 'ai_inferred',
          confidence: 0.9,
        });
      }

      // Execute AI-created notes and reminders from studied courses/books or chat
      for (const n of aiNotes) {
        addNote(n.title, n.content, studiedTitle ? ['study', studiedTitle] : ['zara-action']);
      }
      for (const r of aiReminders) {
        addReminder(r.title, r.remindAt);
      }

      // Respect locked mood override if user selected love/sad/happy explicitly
      if (config.active_mood !== 'auto' && !skillMatch.matched) {
        replyEmotion = config.active_mood;
      }

      const replyLang: 'en' | 'ur' = detectUrduIntent(replyText) ? 'ur' : userLang;

      saveConversationTurn({
        sessionId: activeSession,
        role: 'assistant',
        content: replyText,
        language: replyLang,
        emotion: replyEmotion,
        modelUsed,
        providerUsed: providerStatus.activeProvider,
        thinkingUsed,
      });

      const payload: ChatApiResponse = {
        reply: replyText,
        emotion: replyEmotion,
        language: replyLang,
        modelUsed,
        providerUsed: providerStatus.activeProvider,
        thinkingUsed,
        createdNotesCount: aiNotes.length,
        createdRemindersCount: aiReminders.length,
        studiedTitle,
        extractedMemories: [
          ...extracted.map((m) => ({
            category: m.category,
            key: m.key,
            value: m.value,
          })),
          ...aiMemories.map((m) => ({
            category: m.category,
            key: 'ai_learned',
            value: m.value,
          })),
        ],
        characterUpdate: updatedChar
          ? {
              bondLevel: updatedChar.bond_level,
              xp: updatedChar.xp,
              newTrait: evoOutcome.newTraits[0],
            }
          : undefined,
        warning,
      };
      res.json(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to process assistant turn.';
      res.status(500).json({ error: msg });
    }
  });

  // Living Characters & Self-Development
  app.post('/api/characters', (req, res) => {
    const {
      name,
      role_title,
      bio,
      personality,
      default_mood,
      tts_voice,
      system_prompt,
    } = req.body as {
      name?: string;
      role_title?: string;
      bio?: string;
      personality?: ResponseStyle;
      default_mood?: MoodMode;
      tts_voice?: string;
      system_prompt?: string;
    };

    if (!name?.trim() || !system_prompt?.trim()) {
      res.status(400).json({ error: 'Character name and personality prompt are required.' });
      return;
    }

    const created = createCharacter({
      name: name.trim(),
      role_title: role_title?.trim() || 'Custom Living Companion',
      bio: bio?.trim() || 'Custom user-designed living AI character.',
      personality: personality || 'friendly_professional',
      default_mood: default_mood || 'calm',
      tts_voice: tts_voice || 'Kore',
      system_prompt: system_prompt.trim(),
    });
    res.json({ character: created, characters: getCharacters() });
  });

  app.post('/api/characters/:id/select', (req, res) => {
    const idParam = req.params.id;
    const numeric = Number(idParam);
    const selected = selectCharacterByIdOrSlug(Number.isFinite(numeric) ? numeric : idParam);
    if (!selected) {
      res.status(404).json({ error: 'Character not found.' });
      return;
    }
    res.json({
      character: selected,
      characters: getCharacters(),
      config: getConfig(),
    });
  });

  app.delete('/api/characters/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid character id.' });
      return;
    }
    deleteCharacter(id);
    res.json({ ok: true, characters: getCharacters() });
  });

  app.post('/api/evolve', (_req, res) => {
    const active = getActiveCharacter();
    const recentUserMessages = getRecentUserMessages(20);
    const memories = getMemories();
    const knowledge = getKnowledgeSources();
    const outcome = computeEvolutionProgress({
      character: active,
      xpGain: 35,
      recentUserMessages,
      memories,
      knowledge,
    });

    const mergedTraits = [...active.learned_traits];
    for (const t of outcome.newTraits) {
      if (!mergedTraits.includes(t)) mergedTraits.push(t);
    }

    const updated = updateCharacterEvolution({
      id: active.id,
      xp: outcome.nextXp,
      bondLevel: outcome.nextBondLevel,
      learnedTraits: mergedTraits,
      lifeJournal: [outcome.journalEntry, ...active.life_journal],
    });

    if (outcome.suggestedSkill) {
      const existing = getSkills().some(
        (s) => s.display_name.toLowerCase() === outcome.suggestedSkill!.display_name.toLowerCase()
      );
      if (!existing) {
        createSkill(outcome.suggestedSkill);
      }
    }

    res.json({
      character: updated,
      characters: getCharacters(),
      skills: getSkills(),
      outcome,
    });
  });

  // Book / Software / Course Reader & Study Mentor
  app.post('/api/study', async (req, res) => {
    try {
      const { kind, title, goal, contentText, fileBase64, fileMimeType, sessionId } = req.body as {
        kind?: KnowledgeKind;
        title?: string;
        goal?: string;
        contentText?: string;
        fileBase64?: string;
        fileMimeType?: string;
        sessionId?: string;
      };

      const cleanTitle = (title ?? '').trim() || 'Untitled Study Source';
      const cleanKind: KnowledgeKind = kind === 'software' || kind === 'course' ? kind : 'book';
      const cleanGoal = (goal ?? '').trim();
      const cleanText = (contentText ?? '').trim();

      if (!cleanText && !fileBase64) {
        res.status(400).json({ error: 'Paste content or upload a file to study.' });
        return;
      }

      const config = getConfig();
      let detailedSummary = '';
      let actionPlan: string[] = [];
      let modelUsed = 'local-structured-parser';

      let usedAiStudy = false;
      if (hasGoogleAiKey()) {
        try {
          const result = await analyzeStudyMaterial({
            kind: cleanKind,
            title: cleanTitle,
            goal: cleanGoal,
            contentText: cleanText,
            fileBase64,
            fileMimeType,
            config,
          });
          detailedSummary = result.detailedSummary;
          actionPlan = result.actionPlan;
          modelUsed = result.modelUsed;
          usedAiStudy = true;
        } catch {
          // Graceful fallback to structured local study parser on upstream 503/rate-limit
        }
      }
      if (!usedAiStudy) {
        const local = buildLocalStructuredStudy({
          kind: cleanKind,
          title: cleanTitle,
          goal: cleanGoal,
          contentText: cleanText || `Uploaded file (${fileMimeType || 'document'})`,
        });
        detailedSummary = local.detailedSummary;
        actionPlan = local.actionPlan;
      }

      const entry = addKnowledgeSource({
        kind: cleanKind,
        title: cleanTitle,
        goal: cleanGoal,
        source_excerpt: cleanText || `Uploaded ${fileMimeType || 'file'}`,
        detailed_summary: detailedSummary,
        action_plan: actionPlan,
      });

      addMemory({
        category: 'fact',
        key: `studied_${cleanKind}`,
        value: `Studied ${cleanKind}: ${cleanTitle}${cleanGoal ? ` (Goal: ${cleanGoal})` : ''}`,
        source: 'ai_inferred',
        confidence: 0.95,
      });

      const chatReply = [
        `${cleanTitle} (${cleanKind.toUpperCase()}) مکمل پڑھ کر سمجھ لیا ہے:`,
        '',
        detailedSummary,
        '',
        'ACTION PLAN:',
        ...actionPlan.map((step, i) => `${i + 1}. ${step}`),
      ].join('\n');

      if (sessionId) {
        saveConversationTurn({
          sessionId,
          role: 'assistant',
          content: chatReply,
          language: detectUrduIntent(chatReply) ? 'ur' : 'en',
          emotion: 'confident',
          modelUsed,
          providerUsed: hasGoogleAiKey() ? 'google-ai-studio' : 'local-parser',
          thinkingUsed: hasGoogleAiKey(),
          skillExecuted: 'study_mentor',
        });
      }

      res.json({
        entry,
        knowledge: getKnowledgeSources(),
        memories: getMemories(),
        reply: chatReply,
        emotion: 'confident' as FacialEmotion,
        modelUsed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to analyze study material.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/study/:id/execute', async (req, res) => {
    try {
      const studyId = Number(req.params.id);
      const { taskPrompt, sessionId } = req.body as {
        taskPrompt?: string;
        sessionId?: string;
      };
      const source = getKnowledgeSources().find((k) => k.id === studyId);
      if (!source) {
        res.status(404).json({ error: 'Studied book or course not found.' });
        return;
      }
      const cleanTask = (taskPrompt ?? '').trim() || `Execute the key practical steps from "${source.title}"`;
      const config = getConfig();

      let replyText = '';
      let emotion: FacialEmotion = 'confident';
      let modelUsed = 'local-study-executor';
      let createdNotesCount = 0;
      let createdRemindersCount = 0;

      let usedAiExec = false;
      if (hasGoogleAiKey()) {
        try {
          const result = await executeStudyTaskWithAi({
            source,
            taskPrompt: cleanTask,
            config,
          });
          replyText = result.reply;
          emotion = result.emotion;
          modelUsed = result.modelUsed;
          for (const n of result.aiNotes) {
            addNote(n.title, n.content, ['study', source.title]);
            createdNotesCount++;
          }
          for (const r of result.aiReminders) {
            addReminder(r.title, r.remindAt);
            createdRemindersCount++;
          }
          usedAiExec = true;
        } catch {
          // Fall back cleanly to local structured deliverable builder
        }
      }
      if (!usedAiExec) {
        const noteBody = [
          `Course/Book: ${source.title}`,
          `Task: ${cleanTask}`,
          source.action_plan.length > 0
            ? `Action Steps:\n${source.action_plan.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
            : `Summary:\n${source.detailed_summary.slice(0, 500)}`,
        ].join('\n\n');
        addNote(`${source.title} — Task`, noteBody, ['study', source.title]);
        createdNotesCount = 1;
        replyText = `${config.user_nickname || 'Boss'}, "${source.title}" mein se tumhara task ("${cleanTask}") ready karke Notes mein save kar diya hai! Step 1: ${source.action_plan[0] || source.detailed_summary.slice(0, 180)}`;
      }

      if (sessionId) {
        saveConversationTurn({
          sessionId,
          role: 'assistant',
          content: replyText,
          language: detectUrduIntent(replyText) ? 'ur' : 'en',
          emotion,
          modelUsed,
          providerUsed: hasGoogleAiKey() ? 'google-ai-studio' : 'local-study-executor',
          thinkingUsed: hasGoogleAiKey(),
          skillExecuted: 'study_executor',
        });
      }

      res.json({
        reply: replyText,
        emotion,
        modelUsed,
        createdNotesCount,
        createdRemindersCount,
        notes: getNotes(),
        reminders: getReminders(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to execute study task.';
      res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/study/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid study source id.' });
      return;
    }
    deleteKnowledgeSource(id);
    res.json({ ok: true, knowledge: getKnowledgeSources() });
  });

  // Camera Vision & Gesture Awareness
  app.post('/api/vision', async (req, res) => {
    try {
      const { imageBase64, mimeType, userPrompt, gestureHint, sessionId } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        userPrompt?: string;
        gestureHint?: string;
        sessionId?: string;
      };

      if (!imageBase64) {
        res.status(400).json({ error: 'Camera snapshot payload is required.' });
        return;
      }

      const config = getConfig();
      if (!hasGoogleAiKey()) {
        const localMsg = gestureHint
          ? `لوکل کیمرہ سینسر نے "${gestureHint}" اشارہ/حرکت محسوس کی ہے۔ مکمل بصری تجزیے (Vision) کے لیے Settings > Secrets میں GEMINI_API_KEY شامل کریں۔`
          : 'Camera frame captured cleanly. Add GEMINI_API_KEY in Secrets to enable full multimodal AI visual recognition.';
        res.json({
          reply: localMsg,
          emotion: 'curious' as FacialEmotion,
          language: 'ur' as const,
          modelUsed: 'local-motion-sensor',
        });
        return;
      }

      const visionResult = await analyzeVisionSnapshot({
        imageBase64,
        mimeType: mimeType || 'image/jpeg',
        userPrompt,
        gestureHint,
        config,
      });

      if (sessionId) {
        saveConversationTurn({
          sessionId,
          role: 'assistant',
          content: visionResult.reply,
          language: detectUrduIntent(visionResult.reply) ? 'ur' : 'en',
          emotion: visionResult.emotion,
          modelUsed: visionResult.modelUsed,
          providerUsed: 'google-ai-studio',
          skillExecuted: 'vision_awareness',
        });
      }

      res.json({
        reply: visionResult.reply,
        emotion: visionResult.emotion,
        language: detectUrduIntent(visionResult.reply) ? 'ur' : 'en',
        modelUsed: visionResult.modelUsed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera analysis failed.';
      res.status(500).json({ error: msg });
    }
  });

  // Shareable Laptop / Desktop Installer Download
  app.get('/api/desktop/installer', (req, res) => {
    const osParam = String(req.query.os || 'win').toLowerCase();
    const agentPath = path.resolve(process.cwd(), 'desktop-companion/agent.mjs');
    const agentSource = fs.existsSync(agentPath)
      ? fs.readFileSync(agentPath, 'utf8')
      : 'console.log("ZARA Desktop Companion missing");';

    if (osParam === 'agent') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="zara-agent.mjs"');
      res.send(agentSource);
      return;
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    if (osParam === 'unix' || osParam === 'mac' || osParam === 'linux') {
      const sh = [
        '#!/usr/bin/env bash',
        'set -e',
        'mkdir -p "$HOME/.nova-desktop"',
        'cat << \'EOF\' > "$HOME/.nova-desktop/agent.mjs"',
        agentSource,
        'EOF',
        'echo "ZARA Desktop Companion installed in $HOME/.nova-desktop/agent.mjs"',
        `echo "Open ZARA in your browser (${origin}) and paste the pairing token printed below."`,
        'node "$HOME/.nova-desktop/agent.mjs"',
      ].join('\n');
      res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="zara-desktop-setup.sh"');
      res.send(sh);
      return;
    }

    const encodedAgent = Buffer.from(agentSource, 'utf8').toString('base64');
    const bat = [
      '@echo off',
      'setlocal',
      'set NOVA_DIR=%USERPROFILE%\\.nova-desktop',
      'if not exist "%NOVA_DIR%" mkdir "%NOVA_DIR%"',
      `powershell -NoProfile -Command "[IO.File]::WriteAllBytes('%NOVA_DIR%\\agent.mjs',[Convert]::FromBase64String('${encodedAgent}'))"`,
      'echo.',
      'echo ===================================================',
      'echo   ZARA AI Laptop Companion Installed Successfully!',
      `echo   Web App URL: ${origin}`,
      'echo   Copy the pairing token below into Settings ^> Laptop',
      'echo ===================================================',
      'echo.',
      'node "%NOVA_DIR%\\agent.mjs"',
      'pause',
    ].join('\r\n');
    res.setHeader('Content-Type', 'application/bat; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ZARA-Desktop-Setup.bat"');
    res.send(bat);
  });

  app.get('/api/youtube/search', async (req, res) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const items = await searchYouTubeVideos(process.env.YOUTUBE_API_KEY, query);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ items });
    } catch (error) {
      const status = error instanceof YouTubeApiError ? error.status : 500;
      const message = error instanceof Error ? error.message : 'YouTube search failed.';
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/tts', async (req, res) => {
    try {
      const { text, voiceName, emotion, language } = req.body as {
        text?: string;
        voiceName?: string;
        emotion?: FacialEmotion;
        language?: 'en' | 'ur';
      };
      if (!text?.trim()) {
        res.status(400).json({ error: 'Text is required for speech synthesis.' });
        return;
      }

      const config = getConfig();
      const detectedLang: 'en' | 'ur' =
        language || (detectUrduIntent(text) ? 'ur' : 'en');
      const resolvedEmotion: FacialEmotion = emotion || detectEmotionFromText(text);

      const audio = await generateNovaSpeech({
        text: text.trim(),
        voiceName: voiceName || config.tts_voice,
        emotion: resolvedEmotion,
        language: detectedLang,
      });
      res.json(audio);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Speech synthesis failed.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType } = req.body as { audioBase64?: string; mimeType?: string };
      if (!audioBase64) {
        res.status(400).json({ error: 'Audio payload is required.' });
        return;
      }
      const text = await transcribeNovaAudio({
        audioBase64,
        mimeType: mimeType || 'audio/webm',
      });
      res.json({ text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Audio transcription failed.';
      res.status(500).json({ error: msg });
    }
  });

  // Memories CRUD
  app.post('/api/memories', (req, res) => {
    const { category, key, value } = req.body as {
      category?: 'preference' | 'fact' | 'reminder' | 'note';
      key?: string;
      value?: string;
    };
    if (!value?.trim()) {
      res.status(400).json({ error: 'Memory content is required.' });
      return;
    }
    const created = addMemory({
      category: category || 'fact',
      key: key?.trim() || 'manual_entry',
      value: value.trim(),
      source: 'manual',
      confidence: 1.0,
    });
    res.json({ memory: created, memories: getMemories() });
  });

  app.delete('/api/memories/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid memory id.' });
      return;
    }
    deleteMemory(id);
    res.json({ ok: true, memories: getMemories() });
  });

  app.delete('/api/memories', (_req, res) => {
    clearAllMemories();
    res.json({ ok: true, memories: getMemories() });
  });

  // Notes CRUD
  app.post('/api/notes', (req, res) => {
    const { title, content, tags } = req.body as {
      title?: string;
      content?: string;
      tags?: string[];
    };
    if (!content?.trim()) {
      res.status(400).json({ error: 'Note content is required.' });
      return;
    }
    const note = addNote(title?.trim() || null, content.trim(), Array.isArray(tags) ? tags : []);
    res.json({ note, notes: getNotes() });
  });

  app.delete('/api/notes/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid note id.' });
      return;
    }
    deleteNote(id);
    res.json({ ok: true, notes: getNotes() });
  });

  // Reminders CRUD
  app.post('/api/reminders', (req, res) => {
    const { title, remind_at } = req.body as { title?: string; remind_at?: string };
    if (!title?.trim()) {
      res.status(400).json({ error: 'Reminder title is required.' });
      return;
    }
    const reminder = addReminder(title.trim(), remind_at?.trim() || 'Today');
    res.json({ reminder, reminders: getReminders() });
  });

  app.patch('/api/reminders/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid reminder id.' });
      return;
    }
    const { is_done } = req.body as { is_done?: boolean };
    toggleReminder(id, Boolean(is_done));
    res.json({ ok: true, reminders: getReminders() });
  });

  app.delete('/api/reminders/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid reminder id.' });
      return;
    }
    deleteReminder(id);
    res.json({ ok: true, reminders: getReminders() });
  });

  // Skills CRUD
  app.post('/api/skills', (req, res) => {
    const { display_name, description, trigger_phrases, action_type, action_value } = req.body as {
      display_name?: string;
      description?: string;
      trigger_phrases?: string[];
      action_type?: SkillActionType;
      action_value?: string;
    };
    if (!display_name?.trim() || !Array.isArray(trigger_phrases) || trigger_phrases.length === 0) {
      res.status(400).json({ error: 'Skill name and at least one trigger phrase are required.' });
      return;
    }
    const resolvedActionType: SkillActionType =
      action_type && ALLOWED_SKILL_ACTION_TYPES.has(action_type) ? action_type : 'url';
    const cleanActionValue = action_value?.trim() || '';
    if ((resolvedActionType === 'url' || resolvedActionType === 'launch') && cleanActionValue) {
      if (!isSafeHttpUrl(cleanActionValue)) {
        res.status(400).json({ error: 'Skill URL must use http:// or https://.' });
        return;
      }
    }
    const skill = createSkill({
      display_name: display_name.trim(),
      description: description?.trim() || 'Custom user automation skill',
      trigger_phrases: trigger_phrases.map((t) => t.trim()).filter(Boolean),
      action_type: resolvedActionType,
      action_value: cleanActionValue,
    });
    res.json({ skill, skills: getSkills() });
  });

  app.patch('/api/skills/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid skill id.' });
      return;
    }
    const { is_enabled } = req.body as { is_enabled?: boolean };
    toggleSkill(id, Boolean(is_enabled));
    res.json({ ok: true, skills: getSkills() });
  });

  app.delete('/api/skills/:id', (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid skill id.' });
      return;
    }
    deleteSkill(id);
    res.json({ ok: true, skills: getSkills() });
  });

  // Config update
  app.put('/api/config', (req, res) => {
    const updated = updateConfig(req.body);
    res.json({ config: updated, providerStatus: getProviderStatus() });
  });

  const httpServer = http.createServer(app);

  // Vite / Static serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ZARA AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ZARA AI server:', err);
  process.exit(1);
});
