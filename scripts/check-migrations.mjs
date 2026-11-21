import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';

const db = new Database(':memory:');
try {
  for (const file of ['migrations/0001_initial.sql', 'migrations/0002_worker_feature_parity.sql']) {
    db.exec(readFileSync(file, 'utf8'));
  }

  // Reapplying the migration must be safe and must not duplicate built-in data.
  db.exec(readFileSync('migrations/0002_worker_feature_parity.sql', 'utf8'));

  const tables = new Set(
    db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name),
  );
  for (const table of [
    'conversations', 'memories', 'skills_config', 'reminders', 'notes',
    'app_config', 'characters', 'knowledge_sources',
  ]) {
    assert.ok(tables.has(table), `Missing required table: ${table}`);
  }

  const characters = db.query('SELECT slug,is_active FROM characters ORDER BY id').all();
  assert.deepEqual(characters.map((row) => row.slug), ['nova', 'zara', 'ayesha', 'sara']);
  assert.equal(characters.filter((row) => row.is_active === 1).length, 1);
  assert.equal(characters[0].is_active, 1);

  const activeId = db.query("SELECT value FROM app_config WHERE key='active_character_id'").get();
  assert.equal(activeId.value, '1');

  const sources = db.query("SELECT COUNT(*) AS total FROM knowledge_sources").get();
  assert.equal(sources.total, 0);
  console.log('D1 migrations passed: schema is complete and safe to reapply.');
} finally {
  db.close();
}
