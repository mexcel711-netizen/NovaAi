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
