import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSafeArithmetic,
  isComplexThinkingQuery,
  matchSkillCommand,
} from './skillMatcher';
import type { SkillConfig } from '../types/nova';

const baseSkills: SkillConfig[] = [
  {
    id: 1,
    skill_name: 'app_launcher',
    display_name: 'App & Web Launcher',
    description: 'Open apps and websites',
    trigger_phrases: ['open', 'launch', 'kholo'],
    action_type: 'launch',
    action_value: '',
    is_enabled: true,
    is_custom: false,
    created_at: '2026-11-17T00:00:00Z',
  },
  {
    id: 2,
    skill_name: 'notes_manager',
    display_name: 'Notes Manager',
    description: 'Create notes',
    trigger_phrases: ['create note', 'note likho'],
    action_type: 'note',
    action_value: '',
    is_enabled: true,
    is_custom: false,
    created_at: '2026-11-17T00:00:00Z',
  },
  {
    id: 3,
    skill_name: 'reminders_manager',
    display_name: 'Reminders',
    description: 'Set reminders',
    trigger_phrases: ['remind me', 'yaad dilao'],
    action_type: 'reminder',
    action_value: '',
    is_enabled: true,
    is_custom: false,
    created_at: '2026-11-17T00:00:00Z',
  },
  {
    id: 4,
    skill_name: 'calculator',
    display_name: 'Calculator',
    description: 'Arithmetic evaluation',
    trigger_phrases: ['calculate'],
    action_type: 'calc',
    action_value: '',
    is_enabled: true,
    is_custom: false,
    created_at: '2026-11-17T00:00:00Z',
  },
  {
    id: 5,
    skill_name: 'time_date',
    display_name: 'Time & Date',
    description: 'Current time and date',
    trigger_phrases: ['what time', 'waqt'],
    action_type: 'system',
    action_value: '',
    is_enabled: true,
    is_custom: false,
    created_at: '2026-11-17T00:00:00Z',
  },
];

test('evaluateSafeArithmetic handles precedence and parentheses', () => {
  assert.equal(evaluateSafeArithmetic('2 + 3 * 4'), 14);
  assert.equal(evaluateSafeArithmetic('(10 + 5) / 3'), 5);
  assert.equal(evaluateSafeArithmetic('10 / 0'), null);
  assert.equal(evaluateSafeArithmetic('process.exit()'), null);
});

test('matchSkillCommand executes bilingual Roman Urdu app launch', () => {
  const res = matchSkillCommand('Chrome kholo', baseSkills);
  assert.equal(res.matched, true);
  assert.equal(res.skillName, 'app_launcher');
  assert.equal(res.language, 'ur');
  assert.equal(res.sideEffect?.type, 'open_url');

  const inlineCalc = matchSkillCommand('My name is Inam and calculate 25 * 14', baseSkills);
  assert.equal(inlineCalc.matched, true);
  assert.equal(inlineCalc.skillName, 'calculator');
  assert.equal(inlineCalc.responseText, '25 * 14 equals 350.');
});

test('matchSkillCommand parses notes and reminders accurately', () => {
  const noteRes = matchSkillCommand('create note: Prepare Q4 architecture review', baseSkills);
  assert.equal(noteRes.matched, true);
  assert.equal(noteRes.sideEffect?.type, 'create_note');
  assert.equal(noteRes.sideEffect?.noteContent, 'Prepare Q4 architecture review');

  const remRes = matchSkillCommand('remind me to submit tax forms at 5:30 PM', baseSkills);
  assert.equal(remRes.matched, true);
  assert.equal(remRes.sideEffect?.type, 'create_reminder');
  assert.equal(remRes.sideEffect?.reminderTitle, 'submit tax forms');
  assert.equal(remRes.sideEffect?.reminderAt, '5:30 PM');
});

test('matchSkillCommand respects disabled skills and custom skill triggers', () => {
  const disabledSkills = baseSkills.map((s) =>
    s.skill_name === 'calculator' ? { ...s, is_enabled: false } : s
  );
  assert.equal(matchSkillCommand('calculate 12 * 12', disabledSkills).matched, false);

  const withCustom: SkillConfig[] = [
    ...baseSkills,
    {
      id: 99,
      skill_name: 'daily_standup',
      display_name: 'Daily Standup Board',
      description: 'Opens team board',
      trigger_phrases: ['open standup', 'standup board'],
      action_type: 'url',
      action_value: 'https://linear.app',
      is_enabled: true,
      is_custom: true,
      created_at: '2026-11-17T00:00:00Z',
    },
  ];
  const customHit = matchSkillCommand('Please open standup now', withCustom);
  assert.equal(customHit.matched, true);
  assert.equal(customHit.skillName, 'daily_standup');
  assert.equal(customHit.sideEffect?.url, 'https://linear.app');
});

test('isComplexThinkingQuery classifies deep reasoning prompts vs simple greetings', () => {
  assert.equal(isComplexThinkingQuery('Hello Nova, how are you?'), false);
  assert.equal(
    isComplexThinkingQuery('Design a distributed architecture for high-throughput event streaming and compare trade-offs'),
    true
  );
  assert.equal(isComplexThinkingQuery('Is algorithm ki time complexity tafseel se samjhao'), true);
});

test('matchSkillCommand handles mood switch, character switch, and camera vision triggers', () => {
  const loveRes = matchSkillCommand('love mode on karo', baseSkills);
  assert.equal(loveRes.matched, true);
  assert.equal(loveRes.skillName, 'mood_switcher');
  assert.equal(loveRes.sideEffect?.mood, 'love');

  const sadRes = matchSkillCommand('sad mode', baseSkills);
  assert.equal(sadRes.matched, true);
  assert.equal(sadRes.sideEffect?.mood, 'sad');

  const charRes = matchSkillCommand('Select Zara', baseSkills);
  assert.equal(charRes.matched, true);
  assert.equal(charRes.sideEffect?.type, 'switch_character');
  assert.equal(charRes.sideEffect?.characterSlug, 'zara');

  const visionRes = matchSkillCommand('mujhe dekho camera se', baseSkills);
  assert.equal(visionRes.matched, true);
  assert.equal(visionRes.sideEffect?.type, 'trigger_vision');
});

test('matchSkillCommand executes USB transfer, auto-USB sync, UI navigation, and Urdu script commands', () => {
  const usbNow = matchSkillCommand('یو ایس بی میں ٹرانسفر کر دو', baseSkills);
  assert.equal(usbNow.matched, true);
  assert.equal(usbNow.skillName, 'usb_memory_sync');
  assert.equal(usbNow.sideEffect?.type, 'transfer_usb');

  const usbAuto = matchSkillCommand('خود بخود یو ایس بی میں ٹرانسفر کر دو', baseSkills);
  assert.equal(usbAuto.matched, true);
  assert.equal(usbAuto.sideEffect?.type, 'toggle_auto_usb');
  assert.equal(usbAuto.sideEffect?.autoUsbEnabled, true);

  const usbAutoOff = matchSkillCommand('auto USB transfer band karo', baseSkills);
  assert.equal(usbAutoOff.matched, true);
  assert.equal(usbAutoOff.sideEffect?.type, 'toggle_auto_usb');
  assert.equal(usbAutoOff.sideEffect?.autoUsbEnabled, false);

  const navMem = matchSkillCommand('میموری کھولو', baseSkills);
  assert.equal(navMem.matched, true);
  assert.equal(navMem.sideEffect?.type, 'navigate_page');
  assert.equal(navMem.sideEffect?.navigatePage, 'memory');

  const newChat = matchSkillCommand('نئی چیٹ', baseSkills);
  assert.equal(newChat.matched, true);
  assert.equal(newChat.sideEffect?.type, 'new_session');

  const urNote = matchSkillCommand('نوٹ لکھو: کل پروجیکٹ ریویو کرنا ہے', baseSkills);
  assert.equal(urNote.matched, true);
  assert.equal(urNote.sideEffect?.type, 'create_note');

  const urNoteBuild = matchSkillCommand('نوٹ بناؤ کل 10 بجے میٹنگ ہے', baseSkills);
  assert.equal(urNoteBuild.matched, true);
  assert.equal(urNoteBuild.sideEffect?.type, 'create_note');
  assert.equal(urNoteBuild.sideEffect?.noteContent, 'کل 10 بجے میٹنگ ہے');

  const urReminder = matchSkillCommand('یاد دہانی لگاؤ دوائی کھانی ہے', baseSkills);
  assert.equal(urReminder.matched, true);
  assert.equal(urReminder.sideEffect?.type, 'create_reminder');
  assert.equal(urReminder.sideEffect?.reminderTitle, 'دوائی کھانی ہے');

  const urApp = matchSkillCommand('یوٹیوب کھولو', baseSkills);
  assert.equal(urApp.matched, true);
  assert.equal(urApp.sideEffect?.type, 'open_url');
  assert.equal(urApp.sideEffect?.url, 'https://www.youtube.com');
});

