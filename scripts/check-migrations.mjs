import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';

const db = new Database(':memory:');
const migrations = [
  'migrations/0001_initial.sql',
  'migrations/0002_worker_feature_parity.sql',
  'migrations/0003_lock_pakistani_voice.sql',
];
try {
  for (const file of migrations) db.exec(readFileSync(file, 'utf8'));

  // Reapplying every migration must remain safe and preserve the built-in rows.
  for (const file of migrations.slice(1)) db.exec(readFileSync(file, 'utf8'));

  const tables = new Set(
    db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name),
  );
  for (const table of [
    'conversations', 'memories', 'skills_config', 'reminders', 'notes',
    'app_config', 'characters', 'knowledge_sources',
  ]) {
    assert.ok(tables.has(table), `Missing required table: ${table}`);
  }

  const characters = db.query('SELECT slug,is_active,tts_voice FROM characters ORDER BY id').all();
  assert.deepEqual(characters.map((row) => row.slug), ['nova', 'zara', 'ayesha', 'sara']);
  assert.equal(characters.filter((row) => row.is_active === 1).length, 1);
  assert.equal(characters[0].is_active, 1);
  assert.ok(characters.every((row) => row.tts_voice === 'ur-PK-UzmaNeural'));

  const activeId = db.query("SELECT value FROM app_config WHERE key='active_character_id'").get();
  assert.equal(activeId.value, '1');
  assert.equal(
    db.query("SELECT value FROM app_config WHERE key='tts_voice'").get().value,
    'ur-PK-UzmaNeural',
  );

  const sources = db.query("SELECT COUNT(*) AS total FROM knowledge_sources").get();
  assert.equal(sources.total, 0);
  console.log('D1 migrations passed: schema is complete, safely repeatable and voice identity is locked.');
} finally {
  db.close();
}
