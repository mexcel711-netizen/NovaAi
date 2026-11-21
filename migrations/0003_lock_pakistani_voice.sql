-- Lock one consistent Pakistani female neural speaker across all existing profiles.
-- Safe to re-run: this only normalizes voice settings and preserves user data.

UPDATE app_config
SET value = 'ur-PK-UzmaNeural', updated_at = CURRENT_TIMESTAMP
WHERE key = 'tts_voice';

INSERT INTO app_config(key, value)
VALUES ('tts_voice', 'ur-PK-UzmaNeural')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;

UPDATE characters
SET tts_voice = 'ur-PK-UzmaNeural', updated_at = CURRENT_TIMESTAMP
WHERE tts_voice IS NULL OR tts_voice <> 'ur-PK-UzmaNeural';
