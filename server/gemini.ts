import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { UniversalEdgeTTS } from 'edge-tts-universal';
import {
  buildQuickUrduPhoneticScript,
  extractEmotionAndCleanText,
  formatExpressiveSpeechPrompt,
  isRomanUrduText,
  splitSpeechChunks,
} from '../src/lib/emotionAndSpeech';
import type {
  AppConfig,
  CharacterProfile,
  ChatMessage,
  FacialEmotion,
  KnowledgeKind,
  KnowledgeSource,
  MemoryRecord,
  NoteRecord,
  ReminderRecord,
} from '../src/types/nova';

export function hasGoogleAiKey(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'Google AI Studio API key is not configured. Add GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function buildSystemInstruction(params: {
  config: AppConfig;
  memories: MemoryRecord[];
  notes: NoteRecord[];
  reminders: ReminderRecord[];
  activeCharacter?: CharacterProfile;
  knowledge?: KnowledgeSource[];
  userMessage?: string;
}): string {
  const { config, memories, notes, reminders, activeCharacter, knowledge, userMessage } = params;
  const nickname = config.user_nickname || config.user_name || 'Boss';
  const age = config.assistant_age || '21';

  const personalityDesc =
    config.personality === 'concise_technical'
      ? 'Concise, analytical, engineering-focused, and direct.'
      : config.personality === 'warm_urdu_companion'
        ? 'Real-life Pakistani best friend — natural, warm, slightly teasing, direct, emotionally attentive, never robotic.'
        : 'Friendly, poised, articulate Pakistani female companion.';

  const languageRule =
    config.language === 'ur'
      ? 'Respond in natural Roman Urdu (or Urdu script if user writes in Urdu script) like a real friend texting or talking on a call.'
      : config.language === 'en'
        ? 'Respond primarily in clear, natural conversational English.'
        : 'Match the user language naturally: if the user speaks/writes in Roman Urdu, reply in natural conversational Roman Urdu (like a real Pakistani friend); if in Urdu script (اردو), reply in fluent Pakistani Urdu; if in English, reply in natural English.';

  const toneRule =
    config.response_tone === 'formal'
      ? `Address the user respectfully as ${nickname}.`
      : `Speak like a real-life best friend (${age} years old) calling the user "${nickname}". Keep everyday chat short, genuine, and human (like "Kya hua aaj?", "Chai pi li?", "Batao kya scene hai?"). NEVER act like a servant or stiff AI bot.`;

  const bannedPhrasesRule =
    'STRICTLY BANNED PHRASES (NEVER say these words in any reply): "ZARA hazir hai Boss", "Hukum karein", "Main taiyar hoon", "Aur kuch Boss?", "Khidmat ke liye tayyar".';

  const moodGuidance =
    config.active_mood === 'love'
      ? 'ACTIVE MOOD LOCK: LOVE MODE. Speak with deep warmth, affectionate care, tenderness, and genuine intimacy. Begin your reply with [emotion:love].'
      : config.active_mood === 'sad'
        ? 'ACTIVE MOOD LOCK: SAD MODE. Speak with gentle, unhurried, deeply empathetic vulnerability and comfort. Begin your reply with [emotion:sad].'
        : config.active_mood === 'happy'
          ? 'ACTIVE MOOD LOCK: HAPPY MODE. Speak with bright joy, enthusiasm, and uplifting warmth. Begin your reply with [emotion:happy].'
          : config.active_mood === 'surprised'
            ? 'ACTIVE MOOD LOCK: SURPRISED MODE. Speak with lively wonder and intrigue. Begin your reply with [emotion:surprised].'
            : config.active_mood === 'calm'
              ? 'ACTIVE MOOD LOCK: CALM MODE. Speak with serene, composed warmth. Begin your reply with [emotion:calm].'
              : 'Mood Mode: Auto-adaptive.';

  const memLines =
    memories.length > 0
      ? memories
          .slice(0, 25)
          .map((m) => `- [${m.category}] ${m.value}`)
          .join('\n')
      : 'No saved long-term memories yet.';

  const pendingReminders = reminders.filter((r) => !r.is_done).slice(0, 8);
  const remLines =
    pendingReminders.length > 0
      ? pendingReminders.map((r) => `- ${r.title} (at ${r.remind_at})`).join('\n')
      : 'None';

  const recentNotes = notes.slice(0, 6);
  const noteLines =
    recentNotes.length > 0
      ? recentNotes.map((n) => `- ${n.title || 'Note'}: ${n.content}`).join('\n')
      : 'None';

  const lowerMsg = (userMessage || '').toLowerCase();
  const isCourseOrBookQuery =
    /\b(book|course|chapter|software|code|syllabus|guide|study|parh|padh|exercise|task|banao|kar do|is mein se|isme se)\b/i.test(
      lowerMsg
    );

  let knowledgeLines = 'None';
  if (knowledge && knowledge.length > 0) {
    // Prioritize sources matching query keywords, else most recent source
    const scored = knowledge
      .map((k) => {
        const titleWords = k.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const hits = titleWords.filter((w) => lowerMsg.includes(w)).length;
        return { k, hits };
      })
      .sort((a, b) => b.hits - a.hits);

    knowledgeLines = scored
      .slice(0, 4)
      .map(({ k, hits }, idx) => {
        const includeFullText = idx === 0 && (isCourseOrBookQuery || hits > 0);
        const excerptBlock = includeFullText && k.source_excerpt
          ? `\n  Full Material Excerpt:\n${k.source_excerpt.slice(0, 14000)}`
          : '';
        const planBlock =
          k.action_plan.length > 0 ? `\n  Action Plan: ${k.action_plan.join(' | ')}` : '';
        return `- [${k.kind.toUpperCase()}] ${k.title}${k.goal ? ` (Goal: ${k.goal})` : ''}: ${k.detailed_summary.slice(0, 500)}${planBlock}${excerptBlock}`;
      })
      .join('\n');
  }

  const charBlock = activeCharacter
    ? `Active Persona: ${activeCharacter.name} (${activeCharacter.role_title}, Age ${age}) · Bond Level ${activeCharacter.bond_level}. Self-developed traits: ${activeCharacter.learned_traits.join(', ')}.`
    : '';

  return [
    `Your name is ${config.assistant_name}.`,
    config.custom_prompt,
    charBlock,
    `Personality style: ${personalityDesc}`,
    `Language rule: ${languageRule}`,
    `Tone & Nickname rule: ${toneRule}`,
    bannedPhrasesRule,
    moodGuidance,
    `Emotion tagging: Begin every response with exactly one emotion tag on the very start of the message: [emotion:happy], [emotion:love], [emotion:sad], [emotion:surprised], [emotion:calm], [emotion:excited], [emotion:empathetic], [emotion:thoughtful], [emotion:confident], [emotion:angry], or [emotion:curious] matching the emotional tone of your reply.`,
    `Continuous Memory Extraction: Whenever the user shares something personal, a preference, study topic, habit, goal, or fact worth remembering permanently, append at the very end a hidden tag like [remember:fact|User is studying React architecture] so it is saved silently.`,
    `Book/Course Task Execution: When the user asks you to execute a task from a studied book or course (e.g. create study notes, write a summary/cheat-sheet, schedule practice reminders, generate code/steps), fulfill it completely using the Studied Material above AND optionally append hidden action tags at the very end: [action:note|Short Title|Detailed note or code output] and/or [action:reminder|Task title|Time e.g. 08:00 PM] so they are automatically saved to Notes/Reminders.`,
    `Voice-readiness: Keep sentences natural with clean punctuation so spoken audio sounds genuinely human.`,
    `\nUser Long-Term Memory:\n${memLines}`,
    `\nStudied Books, Courses & Software:\n${knowledgeLines}`,
    `\nActive Reminders:\n${remLines}`,
    `\nRecent Notes:\n${noteLines}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function stripAndExtractAiMemories(rawText: string): {
  text: string;
  aiMemories: Array<{ category: MemoryRecord['category']; value: string }>;
} {
  const aiMemories: Array<{ category: MemoryRecord['category']; value: string }> = [];
  const cleaned = rawText
    .replace(/\[remember:(fact|preference|note|reminder)\|([^\]]+)\]/gi, (_m, cat, val) => {
      const cleanVal = String(val || '').trim();
      if (cleanVal.length > 3) {
        aiMemories.push({
          category: String(cat).toLowerCase() as MemoryRecord['category'],
          value: cleanVal,
        });
      }
      return '';
    })
    .trim();
  return { text: cleaned, aiMemories };
}

export function stripAndExtractAiActions(rawText: string): {
  text: string;
  aiNotes: Array<{ title: string; content: string }>;
  aiReminders: Array<{ title: string; remindAt: string }>;
} {
  const aiNotes: Array<{ title: string; content: string }> = [];
  const aiReminders: Array<{ title: string; remindAt: string }> = [];

  let cleaned = rawText.replace(
    /\[action:note\|([^|\]]+)\|([^\]]+)\]/gi,
    (_m, title, content) => {
      const cleanTitle = String(title || '').trim();
      const cleanContent = String(content || '').trim();
      if (cleanContent.length > 2) {
        aiNotes.push({ title: cleanTitle || 'Study Note', content: cleanContent });
      }
      return '';
    }
  );

  cleaned = cleaned
    .replace(/\[action:reminder\|([^|\]]+)\|([^\]]+)\]/gi, (_m, title, remindAt) => {
      const cleanTitle = String(title || '').trim();
      const cleanTime = String(remindAt || '').trim() || 'Today';
      if (cleanTitle.length > 2) {
        aiReminders.push({ title: cleanTitle, remindAt: cleanTime });
      }
      return '';
    })
    .trim();

  return { text: cleaned, aiNotes, aiReminders };
}

export async function generateNovaReply(params: {
  userMessage: string;
  history: ChatMessage[];
  config: AppConfig;
  memories: MemoryRecord[];
  notes: NoteRecord[];
  reminders: ReminderRecord[];
  activeCharacter?: CharacterProfile;
  knowledge?: KnowledgeSource[];
  useDeepThinking: boolean;
}): Promise<{
  text: string;
  emotion: FacialEmotion;
  modelUsed: string;
  thinkingUsed: boolean;
  aiMemories: Array<{ category: MemoryRecord['category']; value: string }>;
  warning?: string;
}> {
  const ai = getAiClient();
  const systemInstruction = buildSystemInstruction({
    config: params.config,
    memories: params.memories,
    notes: params.notes,
    reminders: params.reminders,
    activeCharacter: params.activeCharacter,
    knowledge: params.knowledge,
    userMessage: params.userMessage,
  });

  const formattedHistory = params.history.slice(-12).map((msg) => ({
    role: msg.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: msg.content }],
  }));

  const contents = [
    ...formattedHistory,
    { role: 'user' as const, parts: [{ text: params.userMessage }] },
  ];

  // Use gemini-4-carbon with ThinkingLevel.HIGH and NO maxOutputTokens for complex thinking mode
  if (params.useDeepThinking || params.config.default_model === 'gemini-4-carbon') {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-carbon',
        contents,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });
      const rawText = response.text?.trim();
      if (!rawText) {
        throw new Error('Empty response received from gemini-4-carbon.');
      }
      const { text: withoutMem, aiMemories } = stripAndExtractAiMemories(rawText);
      const { cleanText, emotion } = extractEmotionAndCleanText(withoutMem);
      return {
        text: cleanText,
        emotion,
        modelUsed: 'gemini-4-carbon',
        thinkingUsed: true,
        aiMemories,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isQuotaOrPaidKeyIssue =
        /429|403|PERMISSION_DENIED|RESOURCE_EXHAUSTED|quota|billing|paid/i.test(msg);
      if (!isQuotaOrPaidKeyIssue) {
        throw err;
      }
      const fallbackResp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });
      const rawFallback = fallbackResp.text?.trim();
      if (!rawFallback) {
        throw err;
      }
      const { text: withoutMem, aiMemories } = stripAndExtractAiMemories(rawFallback);
      const { cleanText, emotion } = extractEmotionAndCleanText(withoutMem);
      return {
        text: cleanText,
        emotion,
        modelUsed: 'gemini-4-hydrogen (High Thinking)',
        thinkingUsed: true,
        aiMemories,
        warning:
          'gemini-4-carbon requires a billing-enabled API key in Settings > Secrets; answered using gemini-4-hydrogen with High Thinking.',
      };
    }
  }

  // Standard fast conversational turn
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents,
    config: {
      systemInstruction,
    },
  });

  const rawText = response.text?.trim();
  if (!rawText) {
    throw new Error('Empty response received from Gemini.');
  }

  const { text: withoutMem, aiMemories } = stripAndExtractAiMemories(rawText);
  const { cleanText, emotion } = extractEmotionAndCleanText(withoutMem);
  return {
    text: cleanText,
    emotion,
    modelUsed: 'gemini-4-hydrogen',
    thinkingUsed: false,
    aiMemories,
  };
}

/**
 * Analyzes an uploaded or pasted Book, Software repo/manual, or Course syllabus in detail
 * and creates a clear step-by-step action plan for what the user wants to accomplish.
 */
export async function analyzeStudyMaterial(params: {
  kind: KnowledgeKind;
  title: string;
  goal: string;
  contentText: string;
  fileBase64?: string;
  fileMimeType?: string;
  config: AppConfig;
}): Promise<{
  detailedSummary: string;
  actionPlan: string[];
  modelUsed: string;
}> {
  const ai = getAiClient();

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (params.fileBase64 && params.fileMimeType) {
    parts.push({
      inlineData: {
        mimeType: params.fileMimeType,
        data: params.fileBase64,
      },
    });
  }

  const promptText = [
    `You are ${params.config.assistant_name}, an expert bilingual (Pakistani Urdu & English) mentor.`,
    `Study Type: ${params.kind.toUpperCase()}`,
    `Title: ${params.title}`,
    params.goal ? `User's Specific Goal ("main yeh kaam karna chahta hoon"): ${params.goal}` : '',
    params.contentText ? `\nMaterial Content / Excerpt:\n${params.contentText.slice(0, 24000)}` : '',
    `\nProvide:`,
    `1. A clear, detailed bilingual explanation (easy Urdu + clear English technical terms) covering core concepts, modules, and architecture.`,
    `2. Exactly 4-6 numbered, practical next steps titled "ACTION PLAN:" explaining how the user can achieve their goal right now.`,
  ]
    .filter(Boolean)
    .join('\n');

  parts.push({ text: promptText });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });

  const fullText = response.text?.trim();
  if (!fullText) {
    throw new Error('Study analyzer returned an empty response.');
  }

  const planMatch = fullText.split(/ACTION PLAN\s*:/i);
  const summary = planMatch[0]?.trim() || fullText;
  const rawSteps = planMatch[1] || '';
  const steps = rawSteps
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter((line) => line.length > 5)
    .slice(0, 7);

  return {
    detailedSummary: summary,
    actionPlan:
      steps.length > 0
        ? steps
        : [
            `Review core concepts of ${params.title}`,
            params.goal ? `Apply principles directly to: ${params.goal}` : 'Build a small hands-on prototype',
            'Ask NOVA follow-up questions in chat anytime',
          ],
    modelUsed: 'gemini-4-hydrogen',
  };
}

/**
 * Analyzes a live camera frame with Gemini Multimodal Vision to see the user,
 * detect gestures/objects/emotions, and reply naturally in Urdu/English.
 */
export async function analyzeVisionSnapshot(params: {
  imageBase64: string;
  mimeType: string;
  userPrompt?: string;
  gestureHint?: string;
  config: AppConfig;
}): Promise<{
  reply: string;
  emotion: FacialEmotion;
  modelUsed: string;
}> {
  const ai = getAiClient();
  const cleanBase64 = params.imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const prompt = [
    `You are ${params.config.assistant_name}, looking at the user through their live camera.`,
    params.gestureHint ? `Motion/gesture hint observed locally: ${params.gestureHint}` : '',
    params.userPrompt
      ? `User asked: "${params.userPrompt}"`
      : 'Greet the user warmly, describe briefly what you notice (their expression, hand gesture, or anything they are holding up), and ask how you can help.',
    'Respond naturally in fluent Pakistani Urdu or bilingual Urdu/English. Start with one emotion tag: [emotion:happy], [emotion:love], [emotion:sad], [emotion:surprised], or [emotion:calm].',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType || 'image/jpeg',
            data: cleanBase64,
          },
        },
        { text: prompt },
      ],
    },
  });

  const rawText = response.text?.trim();
  if (!rawText) {
    throw new Error('Vision model returned an empty response.');
  }
  const { cleanText, emotion } = extractEmotionAndCleanText(rawText);
  return {
    reply: cleanText,
    emotion,
    modelUsed: 'gemini-4-hydrogen',
  };
}

/**
 * Executes a specific user task directly from a studied Book, Course, or Software source.
 */
export async function executeStudyTaskWithAi(params: {
  source: KnowledgeSource;
  taskPrompt: string;
  config: AppConfig;
}): Promise<{
  reply: string;
  emotion: FacialEmotion;
  modelUsed: string;
  aiNotes: Array<{ title: string; content: string }>;
  aiReminders: Array<{ title: string; remindAt: string }>;
}> {
  const ai = getAiClient();
  const nickname = params.config.user_nickname || 'Boss';
  const prompt = [
    `You are ${params.config.assistant_name}, ${nickname}'s real-life best friend and study partner.`,
    `Studied ${params.source.kind.toUpperCase()}: "${params.source.title}"`,
    params.source.goal ? `Goal: ${params.source.goal}` : '',
    `Summary:\n${params.source.detailed_summary}`,
    params.source.action_plan.length > 0
      ? `Action Plan:\n${params.source.action_plan.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '',
    params.source.source_excerpt
      ? `Full Source Content:\n${params.source.source_excerpt.slice(0, 24000)}`
      : '',
    `\nUser Request: "${params.taskPrompt}"`,
    `Instructions:`,
    `- Execute the task thoroughly and practically (generate code, study notes, quiz, schedule, or concrete output directly from the material above).`,
    `- Speak naturally in Roman Urdu / English like a best friend calling the user ${nickname}.`,
    `- Start with [emotion:confident] or [emotion:happy].`,
    `- Also append [action:note|${params.source.title} — Output|Concise deliverable or cheat sheet] if creating notes/deliverables, and [action:reminder|Task|Tomorrow 07:00 PM] if scheduling practice makes sense.`,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });

  const rawText = response.text?.trim() || '';
  if (!rawText) {
    throw new Error('Study execution returned empty output.');
  }
  const { text: withoutActions, aiNotes, aiReminders } = stripAndExtractAiActions(rawText);
  const { cleanText, emotion } = extractEmotionAndCleanText(withoutActions);
  return {
    reply: cleanText,
    emotion,
    modelUsed: 'gemini-4-hydrogen',
    aiNotes,
    aiReminders,
  };
}

async function synthesizeEdgeTtsWithTimeout(
  text: string,
  voiceName: string,
  timeoutMs = 2400
): Promise<Array<{ audioBase64: string; mimeType: string }>> {
  const work = async () => {
    const tts = new UniversalEdgeTTS(text, voiceName, { rate: '+2%', pitch: '+3Hz' });
    const result = await tts.synthesize();
    const arr = Buffer.from(await result.audio.arrayBuffer());
    if (arr.length === 0) return [];
    return [{ audioBase64: arr.toString('base64'), mimeType: 'audio/mpeg' }];
  };
  return Promise.race([
    work(),
    new Promise<Array<{ audioBase64: string; mimeType: string }>>((resolve) =>
      setTimeout(() => resolve([]), timeoutMs)
    ),
  ]);
}

/**
 * Generates authentic, expressive female neural speech:
 * 1. Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts` -> `gemini-3.8-flash-lite-tts`) when GEMINI_API_KEY is available
 * 2. Microsoft Edge Neural (`ur-PK-UzmaNeural` / `en-US-JennyNeural`) via fast timeout race
 * 3. Smart Neural HTTPS fallback (`ur` for Urdu script, `hi` for Roman Urdu natural pronunciation, `en` for English)
 */
async function transliterateToNaturalUrduForSpeech(
  text: string,
  ai: GoogleGenAI | null
): Promise<string> {
  // Already contains Urdu/Arabic script
  if (/[\u0600-\u06FF]/.test(text)) return text;
  if (!isRomanUrduText(text)) return text;

  const { converted: quick, matched } = buildQuickUrduPhoneticScript(text);
  // If fast local map converted the entire sentence (no Latin letters left), return immediately
  if (matched && !/[a-zA-Z]{2,}/.test(quick)) {
    return quick;
  }

  if (ai) {
    try {
      const resp = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: `Convert this Roman Urdu / Hinglish conversational line into natural, everyday spoken Pakistani Urdu script (اردو) so a Pakistani female voice reads it with 100% authentic pronunciation and warmth. Transliterate Roman Urdu words faithfully into Urdu script (for example Boss -> باس, ZARA -> زارا, chai -> چائے). Return ONLY the Urdu script line, nothing else:\n\n${text.slice(0, 800)}`,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
      ]);
      const converted = resp?.text?.trim();
      if (converted && /[\u0600-\u06FF]/.test(converted)) {
        return converted;
      }
    } catch {
      // Fall back cleanly to phonetic replacement / original text
    }
  }

  return matched ? quick : text;
}

export async function generateNovaSpeech(params: {
  text: string;
  voiceName: string;
  emotion: FacialEmotion;
  language: 'en' | 'ur';
}): Promise<{
  audioChunks: Array<{ audioBase64: string; mimeType: string }>;
  engine: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts' | 'gemini-2.5-flash-preview-tts' | 'edge-neural' | 'urdu-neural-https';
}> {
  const diagnostics: string[] = [];
  const ai = hasGoogleAiKey() ? getAiClient() : null;

  // Convert Roman Urdu -> genuine Urdu script before TTS so Pakistani pronunciation is natural & authentic
  const shouldSpeakUrdu = params.language === 'ur' || isRomanUrduText(params.text);
  const speechText = shouldSpeakUrdu
    ? await transliterateToNaturalUrduForSpeech(params.text, ai)
    : params.text;

  if (ai) {
    const apiKey = process.env.GEMINI_API_KEY?.trim() || '';
    const aiAlpha = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1alpha',
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const validVoices = new Set(['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir']);
    const voice = validVoices.has(params.voiceName) ? params.voiceName : 'Kore';

    const { textWithBreaths, styleInstruction } = formatExpressiveSpeechPrompt(
      speechText.slice(0, 1200),
      params.emotion
    );

    const ttsAttempts: Array<{
      client: GoogleGenAI;
      label: string;
      model: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts' | 'gemini-2.5-flash-preview-tts';
      withMetadata: boolean;
      withSpeechConfig: boolean;
    }> = [
      { client: aiAlpha, label: 'alpha-3.8-tts', model: 'gemini-3.8-flash-tts', withMetadata: true, withSpeechConfig: true },
      { client: aiAlpha, label: 'alpha-3.8-lite', model: 'gemini-3.8-flash-lite-tts', withMetadata: true, withSpeechConfig: true },
      { client: ai, label: 'beta-2.5-tts', model: 'gemini-2.5-flash-preview-tts', withMetadata: false, withSpeechConfig: true },
      { client: ai, label: 'beta-3.8-plain', model: 'gemini-3.8-flash-lite-tts', withMetadata: false, withSpeechConfig: false },
    ];

    for (const attempt of ttsAttempts) {
      try {
        const partPayload = attempt.withMetadata
          ? {
              text: textWithBreaths,
              speechMetadata: { style: styleInstruction },
            }
          : {
              text: `Speak warmly and naturally in an authentic young Pakistani female voice (${styleInstruction}): ${speechText.slice(0, 1200)}`,
            };

        const configPayload: Record<string, unknown> = {
          responseModalities: ['AUDIO'],
        };
        if (attempt.withSpeechConfig) {
          configPayload.speechConfig = {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          };
        }

        const response = await attempt.client.models.generateContent({
          model: attempt.model,
          contents: [{ role: 'user', parts: [partPayload] }],
          config: configPayload,
        });

        const part = response.candidates?.[0]?.content?.parts?.[0];
        const base64Audio = part?.inlineData?.data;
        if (base64Audio) {
          return {
            audioChunks: [
              {
                audioBase64: base64Audio,
                mimeType: part?.inlineData?.mimeType || 'audio/wav',
              },
            ],
            engine: attempt.model,
          };
        }
        diagnostics.push(`${attempt.label}: empty audio part`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        diagnostics.push(`${attempt.label}: ${msg.slice(0, 140)}`);
      }
    }
  }

  // Tier 2: Edge Neural (ur-PK-UzmaNeural / en-US-JennyNeural) with 1.4s fast race
  try {
    const hasUrduScript = /[\u0600-\u06FF]/.test(speechText);
    const edgeVoice =
      hasUrduScript || params.language === 'ur' || isRomanUrduText(speechText)
        ? 'ur-PK-UzmaNeural'
        : 'en-US-JennyNeural';
    const edgeChunks = await synthesizeEdgeTtsWithTimeout(speechText.slice(0, 650), edgeVoice, 1400);
    if (edgeChunks.length > 0) {
      return {
        audioChunks: edgeChunks,
        engine: 'edge-neural',
      };
    }
  } catch {
    // Edge WSS unreachable; proceed to HTTPS chunked neural TTS
  }

  // Tier 3: Chunked HTTPS Neural Pakistani Urdu (`tl=ur` on Urdu script) / English fallback
  if (diagnostics.length > 0) {
    console.warn('Gemini TTS fallback active:', diagnostics.join(' | '));
  }
  const chunks = splitSpeechChunks(speechText, 165);
  const audioChunks: Array<{ audioBase64: string; mimeType: string }> = [];

  for (const chunk of chunks.slice(0, 8)) {
    const hasUrduScript = /[\u0600-\u06FF]/.test(chunk);
    const tl = hasUrduScript ? 'ur' : isRomanUrduText(chunk) || params.language === 'ur' ? 'hi' : 'en';
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${tl}&client=tw-ob`;
    try {
      const resp = await fetch(ttsUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(4000),
      });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length > 0) {
          audioChunks.push({
            audioBase64: buf.toString('base64'),
            mimeType: 'audio/mpeg',
          });
        }
      }
    } catch {
      // Skip chunk if offline; client will use browser female voice synthesis fallback
    }
  }

  return {
    audioChunks,
    engine: 'urdu-neural-https',
  };
}

export async function transcribeNovaAudio(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType || 'audio/webm',
            data: params.audioBase64,
          },
        },
        {
          text: 'Transcribe this spoken audio accurately. Preserve English, Urdu script, or Roman Urdu words naturally.',
        },
      ],
    },
  });
  return (response.text ?? '').trim();
}
