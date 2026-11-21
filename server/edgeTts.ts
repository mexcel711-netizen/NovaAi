import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  EDGE_TTS_CHROMIUM_VERSION,
  EDGE_TTS_TRUSTED_CLIENT_TOKEN,
  generateSecMsGec,
} from '../src/lib/edgeTtsSecurity';

export const NOVA_FIXED_VOICE = 'ur-PK-UzmaNeural';
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/${EDGE_TTS_CHROMIUM_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_VERSION.split('.')[0]}.0.0.0`;

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character] || character);
}

function readPath(message: string): string {
  const header = message.split('\r\n\r\n', 1)[0] || message;
  const line = header.split('\r\n').find((item) => item.startsWith('Path:'));
  return line?.slice(5).trim() || '';
}

function asBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error('Edge TTS returned an unsupported audio frame.');
}

function buildSpeechConfig(): string {
  return [
    'Content-Type:application/json; charset=utf-8',
    'Path:speech.config',
    '',
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
            outputFormat: OUTPUT_FORMAT,
          },
        },
      },
    }),
  ].join('\r\n');
}

function buildSsml(text: string, requestId: string): string {
  const safeText = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
  return [
    `X-RequestId:${requestId}`,
    'Content-Type:application/ssml+xml',
    'Path:ssml',
    '',
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ur-PK"><voice name="${NOVA_FIXED_VOICE}"><prosody rate="+0%" pitch="+0Hz" volume="+0%">${escapeXml(safeText)}</prosody></voice></speak>`,
  ].join('\r\n');
}

/**
 * Returns one complete MP3 stream from Microsoft Edge Read Aloud.
 * Sec-MS-GEC v2 is required by the upstream service; the older v1 token
 * used by edge-tts-universal 1.4.0 is rejected by current endpoints.
 */
export async function synthesizeUzma(text: string, timeoutMs = 30000): Promise<Buffer> {
  const cleanText = text.trim();
  if (!cleanText) throw new Error('Speech text is empty.');
  if (cleanText.length > 6000) throw new Error('Speech text exceeds the 6000-character safe limit.');

  const token = await generateSecMsGec(EDGE_TTS_TRUSTED_CLIENT_TOKEN);
  const url = new URL('wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1');
  url.searchParams.set('Ocp-Apim-Subscription-Key', EDGE_TTS_TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', token);
  url.searchParams.set('Sec-MS-GEC-Version', `2-${EDGE_TTS_CHROMIUM_VERSION}`);

  return await new Promise<Buffer>((resolve, reject) => {
    const audio: Buffer[] = [];
    let settled = false;
    const socket = new WebSocket(url, {
      perMessageDeflate: false,
      handshakeTimeout: Math.min(timeoutMs, 15000),
      headers: {
        Host: 'speech.platform.bing.com',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
      },
    });

    const timer = setTimeout(() => finish(new Error('Urdu voice synthesis timed out.')), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeAllListeners();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        try { socket.terminate(); } catch { /* already closed */ }
        reject(error);
        return;
      }
      if (!audio.length) {
        reject(new Error('Urdu voice provider returned no audio data.'));
        return;
      }
      resolve(Buffer.concat(audio));
      try { socket.close(); } catch { /* already closed */ }
    };

    socket.once('open', () => {
      try {
        socket.send(buildSpeechConfig());
        socket.send(buildSsml(cleanText, randomUUID().replace(/-/g, '')));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Unable to start Urdu voice synthesis.'));
      }
    });

    socket.on('message', (raw: unknown, isBinary: boolean) => {
      if (settled) return;
      try {
        if (!isBinary) {
          const message = asBuffer(raw).toString('utf8');
          const path = readPath(message);
          if (path === 'turn.end') {
            finish();
          } else if (path && !['response', 'turn.start', 'audio.metadata'].includes(path)) {
            finish(new Error(`Urdu voice provider returned ${path}.`));
          }
          return;
        }

        const frame = asBuffer(raw);
        if (frame.length < 2) throw new Error('Urdu voice provider returned a truncated frame.');
        const headerLength = frame.readUInt16BE(0);
        const bodyOffset = headerLength + 2;
        if (bodyOffset > frame.length) throw new Error('Urdu voice provider returned an invalid audio frame.');
        const header = frame.subarray(2, bodyOffset).toString('utf8');
        if (!header.includes('Path:audio')) return;
        const body = frame.subarray(bodyOffset);
        if (body.length) audio.push(body);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Failed to read Urdu voice audio.'));
      }
    });

    socket.once('error', (error) => finish(error));
    socket.once('close', (code: number, reason: Buffer) => {
      if (!settled) finish(new Error(`Urdu voice connection closed before completion (${code}): ${reason.toString().slice(0, 120)}`));
    });
    socket.once('unexpected-response', (_request: unknown, response: { statusCode?: number }) => {
      finish(new Error(`Urdu voice provider rejected the connection (HTTP ${response.statusCode || 'unknown'}).`));
    });
  });
}

export function encodeAudioBase64(audio: Buffer): string {
  return audio.toString('base64');
}
