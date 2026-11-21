import { detectEmotionFromText } from './emotionAndSpeech';
import { detectUrduIntent } from './skillMatcher';
import type {
  AppConfig,
  CharacterProfile,
  FacialEmotion,
  KnowledgeSource,
  MemoryRecord,
  NoteRecord,
  ReminderRecord,
} from '../types/nova';

export interface LocalBrainContext {
  userMessage: string;
  config: AppConfig;
  activeCharacter?: CharacterProfile | null;
  memories: MemoryRecord[];
  notes: NoteRecord[];
  reminders: ReminderRecord[];
  knowledge: KnowledgeSource[];
  extractedMemoriesCount: number;
}

export interface LocalBrainReply {
  reply: string;
  emotion: FacialEmotion;
  language: 'en' | 'ur';
}

/**
 * Provides fast, warm, offline-capable bilingual Urdu/Roman Urdu/English responses
 * grounded in the user's real SQLite memories, notes, reminders, and study sources
 * whenever no external cloud LLM key is configured or an upstream request fails.
 */
export function buildLocalConversationalReply(ctx: LocalBrainContext): LocalBrainReply {
  const { userMessage, config, activeCharacter, memories, notes, reminders, knowledge, extractedMemoriesCount } = ctx;
  const trimmed = userMessage.trim();
  const lower = trimmed.toLowerCase();
  const isUrduScript = /[\u0600-\u06FF]/.test(trimmed);
  const isUrdu = isUrduScript || detectUrduIntent(trimmed) || config.language === 'ur';
  const botName = activeCharacter?.name || config.assistant_name || 'ZARA';
  const userName = config.user_nickname || config.user_name || 'Boss';

  // 1) Status / greeting / onboarding quick intro
  if (/^01\s+baat\s+karo|^(salam|assalam|hello|hi|hey|kya haal|kaise ho|mood kaisa|chai)/i.test(lower) || /السلام|کیسے ہو|موڈ کیسا|بات کرو/.test(trimmed)) {
    const reply = isUrduScript
      ? `وعلیکم السلام ${userName}! میں ${botName} ہوں اور بالکل تیار ہوں۔ آپ جو بھی بات کریں یا یاد رکھنے کو کہیں، میں سب میموری میں محفوظ کرتی رہوں گی۔`
      : isUrdu
        ? `Assalam-o-Alaikum ${userName}! Main ${botName} hoon, bilkul fresh aur tayar hoon. Aap jo bhi baat karein, note likhwayein ya USB mein memory save karne ko bolein — main foran kar doongi.`
        : `Hey ${userName}! I'm ${botName}, awake and ready. Talk to me, save notes, record memories, or ask me to back everything up to USB anytime.`;
    return { reply, emotion: 'happy', language: isUrdu ? 'ur' : 'en' };
  }

  // 2) Memory recall questions ("mere baare mein kya yaad hai", "what do you remember")
  if (
    /\b(kya yaad|remember about me|my memories|meri memory|kya save|record kiya)\b/i.test(lower) ||
    /کیا یاد|میری میموری|کیا محفوظ/.test(trimmed)
  ) {
    const top = memories.slice(0, 6).map((m) => m.value);
    if (top.length === 0) {
      return {
        reply: isUrduScript
          ? `ابھی تک آپ کے بارے میں کوئی خاص بات محفوظ نہیں ہوئی ${userName}۔ اپنا نام، شہر یا پسند بتائیں، میں فوراً یاد کر لوں گی۔`
          : isUrdu
            ? `Abhi tak kuch save nahi hua ${userName}. Apna naam, shehar ya pasand batayein, main foran memory mein record kar loongi.`
            : `I haven't recorded any personal facts yet, ${userName}. Tell me your name, city, or preferences and I'll remember them continuously.`,
        emotion: 'curious',
        language: isUrdu ? 'ur' : 'en',
      };
    }
    return {
      reply: isUrduScript
        ? `${userName}، مجھے آپ کے بارے میں ${memories.length} باتیں یاد ہیں: ${top.join(' · ')}۔`
        : isUrdu
          ? `${userName}, mujhe aap ke baare mein ${memories.length} cheezein yaad hain: ${top.join(' · ')}.`
          : `Here is what I have recorded for you (${memories.length} total): ${top.join(' · ')}.`,
      emotion: 'happy',
      language: isUrdu ? 'ur' : 'en',
    };
  }

  // 3) Reminders or Notes summary questions
  if (
    (/\b(reminder|reminders|yaad dehani|tasks?)\b/i.test(lower) || /یاد دہانی|ریمائنڈر/.test(trimmed)) &&
    !/لگاؤ|بناؤ|سیٹ|\b(lagao|banao|set|add)\b/i.test(trimmed)
  ) {
    const pending = reminders.filter((r) => !r.is_done).slice(0, 5);
    if (pending.length === 0) {
      return {
        reply: isUrdu
          ? `${userName}, abhi koi pending reminder nahi hai. Agar kuch set karna ho toh bolein "Yaad dilana 5 baje call karni hai".`
          : `${userName}, you have no pending reminders right now.`,
        emotion: 'calm',
        language: isUrdu ? 'ur' : 'en',
      };
    }
    return {
      reply: isUrdu
        ? `Aap ke ${pending.length} active reminders hain: ${pending.map((r) => `${r.title} (${r.remind_at})`).join(', ')}.`
        : `You have ${pending.length} active reminders: ${pending.map((r) => `${r.title} (${r.remind_at})`).join(', ')}.`,
      emotion: 'confident',
      language: isUrdu ? 'ur' : 'en',
    };
  }

  if (/\b(my notes|notes dikhao|saved notes)\b/i.test(lower) || /میرے نوٹس/.test(trimmed)) {
    const topNotes = notes.slice(0, 4).map((n) => `${n.title || 'Note'}: ${n.content.slice(0, 60)}`);
    return {
      reply: topNotes.length
        ? isUrdu
          ? `Aap ke ${notes.length} notes saved hain: ${topNotes.join(' | ')}`
          : `You have ${notes.length} saved notes: ${topNotes.join(' | ')}`
        : isUrdu
          ? `Abhi koi note saved nahi hai. "Note likho ..." bol kar foran save karwa sakte hain.`
          : `No notes saved yet. Say "Note that ..." anytime to save one.`,
      emotion: 'calm',
      language: isUrdu ? 'ur' : 'en',
    };
  }

  // 4) Capabilities ("kya kya kar sakti ho", "help", "02".."04")
  if (/\b(kya kar sakti|what can you do|help|madad|features|commands)\b/i.test(lower) || /کیا کر سکتی|مدد/.test(trimmed)) {
    return {
      reply: isUrduScript
        ? `${userName}، میں آپ کی باتیں مسلسل میموری میں ریکارڈ کرتی ہوں، USB میں مینوئل یا خودکار بیک اپ ٹرانسفر کر سکتی ہوں، نوٹس اور ریمائنڈرز سیو کرتی ہوں، وقت و حساب بتاتی ہوں اور آپ کے کہے گئے کمانڈز چلاتی ہوں۔`
        : isUrdu
          ? `${userName}, main aap ki baatein continuously memory mein record karti hoon, USB mein manual ya khud-bakhud backup transfer kar sakti hoon, notes & reminders save karti hoon, books/courses study karti hoon aur har command execute karti hoon.`
          : `${userName}, I continuously record memories, transfer or auto-sync backups to USB, save notes and reminders, study material, check time/math, and run your workspace commands.`,
      emotion: 'confident',
      language: isUrdu ? 'ur' : 'en',
    };
  }

  // 5) Study quick check
  if (knowledge.length > 0 && /\b(study|book|course|parha)\b/i.test(lower)) {
    const latest = knowledge[0];
    return {
      reply: isUrdu
        ? `Abhi hum ne "${latest.title}" (${latest.kind}) study kiya hai. ${latest.detailed_summary.slice(0, 180)}`
        : `Most recently studied "${latest.title}" (${latest.kind}): ${latest.detailed_summary.slice(0, 180)}`,
      emotion: 'thoughtful',
      language: isUrdu ? 'ur' : 'en',
    };
  }

  // 6) Newly recorded memory acknowledgement + natural empathetic conversational reply
  const detectedEmotion = detectEmotionFromText(trimmed);
  if (extractedMemoriesCount > 0) {
    return {
      reply: isUrduScript
        ? `جی ${userName}، میں نے یہ بات ہمیشہ کے لیے اپنی میموری میں ریکارڈ کر لی ہے! جب چاہیں کہیں "یو ایس بی میں ٹرانسفر کر دو" تو میں فوراً بیک اپ کر دوں گی۔`
        : isUrdu
          ? `Ji ${userName}, main ne yeh baat apni memory mein record kar li hai! Jab bolein gi, main USB mein bhi transfer kar doongi.`
          : `Got it, ${userName} — I've recorded that in my persistent memory for you! Just say "transfer to USB" whenever you want a backup.`,
      emotion: 'happy',
      language: isUrdu ? 'ur' : 'en',
    };
  }

  const reply = isUrduScript
    ? `جی ${userName}، میں آپ کی بات غور سے سن رہی ہوں۔ آپ کوئی کام، نوٹ، ریمائنڈر، یا یو ایس بی میموری ٹرانسفر بتائیں — میں فوراً کر دوں گی۔`
    : isUrdu
      ? `Ji ${userName}, main samajh gayi! Aap ki baat note kar li hai — agar koi note, reminder, study task ya USB transfer karwana ho toh seedha bol dein.`
      : `I hear you, ${userName}. Tell me anything to remember, create a note or reminder, or say "transfer memory to USB" anytime.`;

  return {
    reply,
    emotion: detectedEmotion === 'calm' ? 'empathetic' : detectedEmotion,
    language: isUrdu ? 'ur' : 'en',
  };
}
