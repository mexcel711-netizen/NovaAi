import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuickUrduPhoneticScript,
  detectEmotionFromText,
  extractEmotionAndCleanText,
  formatExpressiveSpeechPrompt,
  isRomanUrduText,
  resolveActiveAiProvider,
  splitSpeechChunks,
} from './emotionAndSpeech';

test('extractEmotionAndCleanText strips explicit emotion tags and detects fallback emotions', () => {
  const tagged = extractEmotionAndCleanText('[emotion:surprised] Wah! Ye toh kamaal ho gaya!');
  assert.equal(tagged.emotion, 'surprised');
  assert.equal(tagged.cleanText, 'Wah! Ye toh kamaal ho gaya!');

  assert.equal(detectEmotionFromText('Assalamualaikum! Khushi hui aapse baat kar ke.'), 'happy');
  assert.equal(detectEmotionFromText('Mujhe afsos hai, ye task complete nahi ho saka.'), 'sad');
  assert.equal(detectEmotionFromText('Really?! That is unbelievable!'), 'surprised');
  assert.equal(detectEmotionFromText('The current time is 09:30 AM.'), 'calm');
  assert.equal(extractEmotionAndCleanText('[emotion:empathetic] I understand.').emotion, 'empathetic');
  assert.equal(extractEmotionAndCleanText('[emotion:curious] Tell me more.').emotion, 'curious');
  assert.equal(detectEmotionFromText('I am so excited, fantastic news!'), 'excited');
  assert.equal(detectEmotionFromText('Let me think about this carefully.'), 'thoughtful');
  assert.equal(detectEmotionFromText('Absolutely, you can count on me.'), 'confident');
  assert.equal(detectEmotionFromText('That is unacceptable.'), 'angry');
  assert.equal(detectEmotionFromText('Mujhe aapse bohat pyaar aur mohabbat hai, jaan.'), 'love');
  assert.equal(extractEmotionAndCleanText('[emotion:love] Always here for you with warmth.').emotion, 'love');
});

test('splitSpeechChunks splits bilingual Urdu and English text cleanly on sentence boundaries', () => {
  const input =
    'السلام علیکم! میں نووا ہوں۔ آج موسم بہت خوشگوار ہے، اور میں آپ کے تمام کاموں میں مدد کے لیے تیار ہوں۔ Let me know what you need next.';
  const chunks = splitSpeechChunks(input, 90);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 90));
});

test('formatExpressiveSpeechPrompt embeds breathing pauses and Pakistani Urdu style direction', () => {
  const res = formatExpressiveSpeechPrompt(
    'Assalamualaikum! Mein NOVA hun. Aaj kya kaam karna hai?',
    'happy'
  );
  assert.ok(res.textWithBreaths.includes('<breath>'));
  assert.ok(/pakistani/i.test(res.styleInstruction));
  assert.ok(/urdu/i.test(res.styleInstruction));
});

test('resolveActiveAiProvider prioritizes Cloudflare binding automatically on Cloudflare deploy and Google AI Studio locally', () => {
  const onCloudflare = resolveActiveAiProvider({
    preference: 'auto',
    hasCloudflareBinding: true,
    hasCloudflareRest: false,
    hasGoogleAiKey: false,
  });
  assert.equal(onCloudflare.activeProvider, 'cloudflare-binding');
  assert.equal(onCloudflare.cloudflareBindingActive, true);

  const inAiStudio = resolveActiveAiProvider({
    preference: 'auto',
    hasCloudflareBinding: false,
    hasCloudflareRest: false,
    hasGoogleAiKey: true,
  });
  assert.equal(inAiStudio.activeProvider, 'google-ai-studio');

  const cloudflareOverride = resolveActiveAiProvider({
    preference: 'cloudflare',
    hasCloudflareBinding: false,
    hasCloudflareRest: true,
    hasGoogleAiKey: true,
  });
  assert.equal(cloudflareOverride.activeProvider, 'cloudflare-rest');
});

test('isRomanUrduText identifies Roman Urdu phrases and rejects plain English', () => {
  assert.equal(isRomanUrduText('Arre Boss! Kya chal raha hai? Batao!'), true);
  assert.equal(isRomanUrduText('Raat ko jab sab so jate hain tab baat karte hain'), true);
  assert.equal(isRomanUrduText('Build a TypeScript parser for JSON configuration files.'), false);
});

test('buildQuickUrduPhoneticScript maps common Roman Urdu phrases into Urdu script instantly', () => {
  const res = buildQuickUrduPhoneticScript('Arre Boss! Kya chal raha hai? Batao!');
  assert.equal(res.matched, true);
  assert.ok(/[\u0600-\u06FF]/.test(res.converted));

  const greeting = buildQuickUrduPhoneticScript('Assalam-o-Alaikum Boss! Main ZARA hoon, bilkul tayar hoon.');
  assert.equal(greeting.matched, true);
  assert.ok(greeting.converted.includes('السلام علیکم'));
  assert.ok(greeting.converted.includes('زارا'));
});
