-- Switch the built-in assistant identity from the legacy NOVA profile to ZARA.
-- Preserve all conversations, memories, settings, and character progress.
UPDATE characters SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE slug = 'nova';
UPDATE characters SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE slug = 'zara';

INSERT INTO app_config (key, value, updated_at) VALUES
  ('assistant_name', 'ZARA', CURRENT_TIMESTAMP),
  ('wake_word', 'hey zara', CURRENT_TIMESTAMP),
  ('active_character_id', '2', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = CURRENT_TIMESTAMP;
