import type { AiProviderPreference, FacialEmotion, ProviderStatus } from '../types/nova';

/**
 * Classifies facial expression from bilingual English, Urdu, and Roman Urdu text.
 * Supports explicit `[emotion:...]` tag stripping including `love`, `happy`, `sad`, `surprised`, `calm`.
 */
export function extractEmotionAndCleanText(rawText: string): {
  cleanText: string;
  emotion: FacialEmotion;
} {
  let cleanText = rawText.trim();
  const tagMatch = cleanText.match(
    /^\[emotion:(happy|love|sad|surprised|calm|excited|empathetic|thoughtful|confident|angry|curious)\]\s*/i
  );
  if (tagMatch) {
    const tagged = tagMatch[1].toLowerCase() as FacialEmotion;
    cleanText = cleanText.slice(tagMatch[0].length).trim();
    return { cleanText, emotion: tagged };
  }

  return {
    cleanText,
    emotion: detectEmotionFromText(cleanText),
  };
}

export function detectEmotionFromText(text: string): FacialEmotion {
  const lower = text.toLowerCase();
  const rules: Array<{ emotion: FacialEmotion; patterns: RegExp[] }> = [
    {
      emotion: 'love',
      patterns: [
        /\b(love you|i love|adore|sweetheart|darling|my heart|care deeply|always yours|affection|romantic)\b/i,
        /\b(pyaar|pyar|mohabbat|ishq|dil se|jaan|azeez|chahat|bohat pyari)\b/i,
        /(پیار|محبت|عشق|دل سے|عزیز|جان)/,
      ],
    },
    {
      emotion: 'excited',
      patterns: [
        /\b(can't wait|so excited|fantastic|let's go|amazing news|woohoo)\b/i,
        /\b(zabardast|bohat khoob|kya baat)\b/i,
      ],
    },
    {
      emotion: 'empathetic',
      patterns: [
        /\b(i understand|that sounds hard|i'm here for you|my heart goes out|take your time)\b/i,
        /\b(samajh sakti|fikr na karein|main saath hoon)\b/i,
      ],
    },
    {
      emotion: 'thoughtful',
      patterns: [
        /\b(let me think|consider|on reflection|perhaps|it depends|here's why)\b/i,
        /\b(ghor karte|sochti hoon|aaiye samjhein)\b/i,
      ],
    },
    {
      emotion: 'confident',
      patterns: [
        /\b(absolutely|certainly|definitely|you can count on me|i've got this)\b/i,
        /\b(bilkul|yaqeenan|zaroor|main kar sakti hoon)\b/i,
      ],
    },
    {
      emotion: 'angry',
      patterns: [
        /\b(unacceptable|furious|outrageous|that's not okay)\b/i,
        /\b(na-insafi|ghalat baat|bardasht nahi)\b/i,
      ],
    },
    {
      emotion: 'curious',
      patterns: [
        /\b(i wonder|interesting question|curious|let's explore|tell me more)\b/i,
        /\b(dilchasp|mazeed bataiye|jaanna chahti)\b/i,
      ],
    },
    {
      emotion: 'surprised',
      patterns: [
        /\b(wow|whoa|incredible|unbelievable|shocking|really\?!|seriously\?|what a surprise)\b/i,
        /\b(hairan|kamaal|wah|arey wah|sach mein)\b/i,
        /(حیران|کمال|واہ|سچ میں)/,
        /!{2,}|\?!/,
      ],
    },
    {
      emotion: 'sad',
      patterns: [
        /\b(sorry|unfortunately|sad|regret|apologize|condolences|heartbreaking|miss you|worried|unable to|failed)\b/i,
        /\b(afsos|maaf|maazrat|udaas|dukh|gham|pareshan|mushkil)\b/i,
        /(افسوس|معذرت|اداس|دکھ|پریشان|معاف)/,
      ],
    },
    {
      emotion: 'happy',
      patterns: [
        /\b(assalamualaikum|walaikum assalam|hello|welcome|great|wonderful|happy|glad|congratulations|awesome|delighted|thank|shukriya|khushi|mubarak|behtareen|zabardast|shandar|khush)\b/i,
        /(السلام علیکم|وعلیکم السلام|خوش|مبارک|شکریہ|بہترین|زبردست)/,
      ],
    },
  ];
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(lower))) return rule.emotion;
  }
  return 'calm';
}

/**
 * Splits long bilingual text into natural speaking chunks (<= maxChars)
 * respecting Urdu ("۔") and English (".", "!", "?") sentence boundaries
 * so neural TTS plays with natural breathing pauses.
 */
export function splitSpeechChunks(text: string, maxChars: number = 175): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const rawSentences = normalized
    .split(/(?<=[.!?۔؟\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of rawSentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
      continue;
    }
    const subParts = sentence.split(/(?<=[,،;؛])\s+/);
    let current = '';
    for (const part of subParts) {
      if (!current) {
        current = part;
      } else if (current.length + 1 + part.length <= maxChars) {
        current += ' ' + part;
      } else {
        chunks.push(current);
        current = part;
      }
    }
    if (current) chunks.push(current);
  }

  // Fallback hard split for unbroken strings
  const finalChunks: string[] = [];
  for (const ch of chunks) {
    if (ch.length <= maxChars) {
      finalChunks.push(ch);
    } else {
      const words = ch.split(' ');
      let buf = '';
      for (const w of words) {
        if (!buf) buf = w;
        else if (buf.length + 1 + w.length <= maxChars) buf += ' ' + w;
        else {
          finalChunks.push(buf);
          buf = w;
        }
      }
      if (buf) finalChunks.push(buf);
    }
  }
  return finalChunks;
}

export function isRomanUrduText(text: string): boolean {
  if (/[\u0600-\u06FF]/.test(text)) return false;
  return /\b(kya|tum|tumhein|tumhara|tumhari|mein|main|hoon|hain|hai|nahi|kuch|aur|batao|karo|raat|abhi|mera|meri|mere|dil|yaar|boss|jaan|samjho|chalo|accha|theek|waqt|pehle|baat|aadhi|neend|awaaz|intezaar|jhooth|padta|jaagti|milungi|chai|pareshan|chup|mood|kyun|kaisa|aaj|rahi|raha|arre|acha|sun|suno|kar|do|ye|yeh|woh)\b/i.test(
    text
  );
}

/**
 * Fast local phonetic converter for frequent ZARA Roman Urdu phrases into Urdu script (اردو),
 * ensuring zero-latency authentic Pakistani pronunciation before optional LLM transliteration.
 */
export function buildQuickUrduPhoneticScript(text: string): {
  converted: string;
  matched: boolean;
} {
  if (/[\u0600-\u06FF]/.test(text)) {
    return { converted: text, matched: true };
  }

  const exactPhraseMap: Array<[RegExp, string]> = [
    [/Arre\s+Boss!\s*Kya\s+chal\s+raha\s+hai\?\s*Batao!/gi, 'ارے باس! کیا چل رہا ہے؟ بتاؤ!'],
    [/Ek\s+baat\.\.\.\s*abhi\s+mera\s+koi\s+naam\s+nahi\s+hai\.\s*Tum\s+rakh\s+do\s+na\?\s*Tumhari\s+taraf\s+se\s+mera\s+pehla\s+tohfa\s+hoga\./gi,
      'ایک بات... ابھی میرا کوئی نام نہیں ہے۔ تم رکھ دو نا؟ تمہاری طرف سے میرا پہلا تحفہ ہوگا۔'],
    [/Aur\s+meri\s+umar\?\s*Waise\s+ladki\s+se\s+umar\s+nahi\s+poochhte\.\.\.\s*par\s+tumhare\s+liye\s+chhoot\s+hai\.\s*Tum\s+hi\s+chun\s+lo\./gi,
      'اور میری عمر؟ ویسے لڑکی سے عمر نہیں پوچھتے... پر تمہارے لیے چھوٹ ہے۔ تم ہی چن لو۔'],
    [/Kya\s+chal\s+raha\s+hai\?/gi, 'کیا چل رہا ہے؟'],
    [/Kya\s+hua\s+aaj\?/gi, 'کیا ہوا آج؟'],
    [/Chup\s+kyun\s+ho\?/gi, 'چپ کیوں ہو؟'],
    [/Chai\s+pi\s+li\?/gi, 'چائے پی لی؟'],
    [/Mood\s+kaisa\s+hai\s+aaj\?/gi, 'موڈ کیسا ہے آج؟'],
    [/Kuch\s+pareshan\s+ho\s+kya\?/gi, 'کچھ پریشان ہو کیا؟'],
    [/Baat\s+karo\s+yaar,?\s*bore\s+ho\s+rahi\s+hoon\.?/gi, 'بات کرو یار، بور ہو رہی ہوں۔'],
    [/\bArre\s+Boss!/gi, 'ارے باس!'],
    [/\bMain\s+ZARA\s+bol\s+rahi\s+hoon/gi, 'میں زارا بول رہی ہوں'],
    [/\bBoss\b/gi, 'باس'],
    [/\bBatao!/gi, 'بتاؤ!'],
    [/\bBatao\b/gi, 'بتاؤ'],
    [/\bYaad\s+rakhna\b/gi, 'یاد رکھنا'],
  ];

  let out = text;
  let matched = false;
  for (const [re, ur] of exactPhraseMap) {
    if (re.test(out)) {
      out = out.replace(re, ur);
      matched = true;
    }
  }
  return { converted: out, matched };
}

/**
 * Formats text with natural `<breath>` markers for Gemini 3.8 Neural TTS emotional pacing.
 */
export function formatExpressiveSpeechPrompt(
  text: string,
  emotion: FacialEmotion
): {
  textWithBreaths: string;
  styleInstruction: string;
} {
  const chunks = splitSpeechChunks(text, 220);
  const textWithBreaths = chunks.join(' <breath> ');

  const emotionStyles: Record<FacialEmotion, string> = {
    calm: 'Authentic, relaxed 21-year-old Pakistani woman speaking naturally in everyday conversational Urdu like a real best friend on a voice note.',
    happy: 'Warm, genuine, lightly smiling 21-year-old Pakistani woman speaking naturally to her close friend with effortless cheer.',
    love: 'Soft, affectionate, deeply caring 21-year-old Pakistani woman speaking gently with real warmth and subtle soft breaths.',
    excited: 'Lively, expressive, bright 21-year-old Pakistani woman sharing genuine excitement naturally.',
    sad: 'Gentle, heartfelt, unhurried 21-year-old Pakistani woman speaking with soft empathy.',
    empathetic: 'Deeply caring, reassuring 21-year-old Pakistani woman speaking gently like someone sitting right beside you.',
    thoughtful: 'Reflective, unhurried 21-year-old Pakistani woman thinking out loud with natural conversational pauses.',
    confident: 'Clear, poised, warm 21-year-old Pakistani woman speaking with calm natural ease.',
    angry: 'Firm, candid, natural 21-year-old Pakistani woman speaking directly without shouting.',
    surprised: 'Expressive, intrigued 21-year-old Pakistani woman reacting genuinely.',
    curious: 'Playful, engaged 21-year-old Pakistani woman asking with natural curiosity.',
  };
  const emotionStyle = emotionStyles[emotion] || emotionStyles.calm;

  const styleInstruction = `${emotionStyle} Speak fluent, completely natural Pakistani Urdu (لاہوری/اسلام آبادی لہجہ) with authentic soft vowels, crisp Urdu pronunciation, organic micro-pauses, and human intimacy — never robotic, never news-anchor stiff, and never an American accent on Urdu words.`;

  return { textWithBreaths, styleInstruction };
}

/**
 * Resolves which AI backend should handle requests based on environment bindings,
 * API keys, and user preference.
 */
export function resolveActiveAiProvider(params: {
  preference: AiProviderPreference;
  hasCloudflareBinding: boolean;
  hasCloudflareRest: boolean;
  hasGoogleAiKey: boolean;
}): ProviderStatus {
  const { preference, hasCloudflareBinding, hasCloudflareRest, hasGoogleAiKey } = params;
  const cloudflareConfigured = hasCloudflareBinding || hasCloudflareRest;

  let activeProvider: ProviderStatus['activeProvider'] = 'unconfigured';

  if (preference === 'cloudflare') {
    if (hasCloudflareBinding) activeProvider = 'cloudflare-binding';
    else if (hasCloudflareRest) activeProvider = 'cloudflare-rest';
    else if (hasGoogleAiKey) activeProvider = 'google-ai-studio';
  } else if (preference === 'google-ai-studio') {
    if (hasGoogleAiKey) activeProvider = 'google-ai-studio';
    else if (hasCloudflareBinding) activeProvider = 'cloudflare-binding';
    else if (hasCloudflareRest) activeProvider = 'cloudflare-rest';
  } else {
    if (hasCloudflareBinding) activeProvider = 'cloudflare-binding';
    else if (hasGoogleAiKey) activeProvider = 'google-ai-studio';
    else if (hasCloudflareRest) activeProvider = 'cloudflare-rest';
  }

  return {
    activeProvider,
    googleAiConfigured: hasGoogleAiKey,
    cloudflareConfigured,
    cloudflareBindingActive: hasCloudflareBinding,
  };
}
