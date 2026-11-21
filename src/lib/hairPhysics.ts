import type { AvatarState, HairstyleOption } from '../types/nova';

export const MIC_NOISE_FLOOR = 0.06;
export const LIP_NOISE_FLOOR = 0.03;
export const AMBIENT_BREEZE_WIND = 0.32;

export interface HairWindInput {
  state: AvatarState;
  micLevel: number;
  lipOpenness: number;
  ambientBreeze?: boolean;
}

export interface HairOffsetResult {
  dx: number;
  dy: number;
  mask: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Computes normalized ambient float/glow intensity [0..1].
 * Intentionally invariant to speaking state, lipOpenness, and micLevel so that
 * hair never jerks, speeds up, or moves differently when talking.
 */
export function computeTargetHairWind({
  ambientBreeze = true,
}: HairWindInput): number {
  return ambientBreeze ? AMBIENT_BREEZE_WIND : 0;
}

/**
 * Smoothly ramps ambient breeze toward target.
 */
export function stepHairWind(currentWind: number, targetWind: number, dtScale = 1): number {
  const cur = clamp01(currentWind);
  const tgt = clamp01(targetWind);
  const factor = tgt > cur ? Math.min(1, 0.22 * dtScale) : Math.min(1, 0.09 * dtScale);
  const next = cur + (tgt - cur) * factor;
  if (tgt === 0 && next < 0.004) {
    return 0;
  }
  return clamp01(next);
}

/**
 * Spatial hair region mask [0..1] for the 512x512 portrait:
 * - Inner face oval, crown root, neck, collarbones, shoulders, and shawl = 0
 * - Outer flowing left/right/crown hair locks = > 0
 */
export function computeHairRegionMask(
  colNorm: number,
  rowNorm: number,
  hairstyle: HairstyleOption = 'wavy'
): number {
  const faceDx = (colNorm - 0.555) / 0.12;
  const faceDy = (rowNorm - 0.295) / 0.135;
  const faceDist = Math.hypot(faceDx, faceDy);
  const outsideFace = smoothstep(0.88, 1.32, faceDist);

  const crownFade = smoothstep(0.11, 0.20, rowNorm);

  const torsoDepth = smoothstep(0.34, 0.43, rowNorm);
  const torsoHalfWidth = 0.115 + smoothstep(0.42, 0.55, rowNorm) * 0.13;
  const bodyNormX = Math.abs(colNorm - 0.555) / torsoHalfWidth;
  const outsideTorsoBand = smoothstep(0.85, 1.24, bodyNormX);
  const outsideNeckAndChest = 1 - torsoDepth * (1 - clamp01(outsideTorsoBand));

  let shawlClear: number;
  if (hairstyle === 'bob') {
    shawlClear = 1 - smoothstep(0.42, 0.49, rowNorm);
  } else if (hairstyle === 'straight') {
    const upperSideLocks = 1 - smoothstep(0.45, 0.54, rowNorm);
    const leftLongStrand =
      (1 - smoothstep(0.28, 0.40, colNorm)) * (1 - smoothstep(0.70, 0.86, rowNorm));
    shawlClear = Math.max(upperSideLocks, leftLongStrand);
  } else {
    shawlClear = 1 - smoothstep(0.46, 0.54, rowNorm);
  }

  const leftHair = 1 - smoothstep(0.33, 0.46, colNorm);
  const rightHair = smoothstep(0.64, 0.75, colNorm);
  const upperHalo = (1 - smoothstep(0.23, 0.33, rowNorm)) * crownFade;
  const hairZones = clamp01(Math.max(leftHair, rightHair, upperHalo));

  return clamp01(outsideFace * crownFade * outsideNeckAndChest * shawlClear * hairZones);
}

/**
 * Portrait bitmap mesh offset is strictly zero so the portrait image never
 * bends, tears, or looks crooked ("تصویر ٹیڑھی میڑی نہ ہو").
 */
export function computeHairMeshOffset(params: {
  colNorm: number;
  rowNorm: number;
  wind: number;
  phase: number;
  amplitudePx?: number;
  hairstyle?: HairstyleOption;
}): HairOffsetResult {
  const mask = computeHairRegionMask(params.colNorm, params.rowNorm, params.hairstyle ?? 'wavy');
  return { dx: 0, dy: 0, mask };
}

export interface HairAirWisp {
  x0: number;
  y0: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x1: number;
  y1: number;
  alpha: number;
  lineWidth: number;
}

interface WispAnchor {
  x0: number;
  y0: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x1: number;
  y1: number;
  driftX: number;
  driftY: number;
  speed: number;
  phaseOffset: number;
  baseAlpha: number;
  width: number;
}

const WISP_ANCHORS: Record<HairstyleOption, WispAnchor[]> = {
  wavy: [
    // Left billowing waves drifting softly into the air
    { x0: 0.46, y0: 0.16, cx1: 0.35, cy1: 0.17, cx2: 0.28, cy2: 0.26, x1: 0.21, y1: 0.29, driftX: -0.016, driftY: -0.014, speed: 0.9, phaseOffset: 0.0, baseAlpha: 0.28, width: 1.7 },
    { x0: 0.43, y0: 0.22, cx1: 0.32, cy1: 0.25, cx2: 0.26, cy2: 0.34, x1: 0.19, y1: 0.38, driftX: -0.018, driftY: -0.012, speed: 1.05, phaseOffset: 1.2, baseAlpha: 0.25, width: 1.5 },
    { x0: 0.41, y0: 0.31, cx1: 0.31, cy1: 0.36, cx2: 0.25, cy2: 0.42, x1: 0.20, y1: 0.47, driftX: -0.014, driftY: -0.015, speed: 0.85, phaseOffset: 2.4, baseAlpha: 0.22, width: 1.3 },
    { x0: 0.49, y0: 0.13, cx1: 0.42, cy1: 0.11, cx2: 0.34, cy2: 0.14, x1: 0.28, y1: 0.20, driftX: -0.012, driftY: -0.016, speed: 0.95, phaseOffset: 3.3, baseAlpha: 0.24, width: 1.4 },
    // Right delicate aura strands
    { x0: 0.62, y0: 0.17, cx1: 0.67, cy1: 0.22, cx2: 0.70, cy2: 0.31, x1: 0.71, y1: 0.41, driftX: 0.012, driftY: -0.012, speed: 0.88, phaseOffset: 1.7, baseAlpha: 0.21, width: 1.3 },
    { x0: 0.65, y0: 0.25, cx1: 0.70, cy1: 0.31, cx2: 0.72, cy2: 0.39, x1: 0.73, y1: 0.46, driftX: 0.014, driftY: -0.010, speed: 1.0, phaseOffset: 4.1, baseAlpha: 0.18, width: 1.15 },
  ],
  bob: [
    // Soft bob curves floating around crown and chin-length ends
    { x0: 0.47, y0: 0.15, cx1: 0.37, cy1: 0.18, cx2: 0.30, cy2: 0.28, x1: 0.27, y1: 0.38, driftX: -0.013, driftY: -0.012, speed: 0.92, phaseOffset: 0.4, baseAlpha: 0.26, width: 1.5 },
    { x0: 0.42, y0: 0.26, cx1: 0.33, cy1: 0.32, cx2: 0.28, cy2: 0.40, x1: 0.33, y1: 0.46, driftX: -0.015, driftY: -0.010, speed: 1.04, phaseOffset: 1.9, baseAlpha: 0.23, width: 1.35 },
    { x0: 0.51, y0: 0.13, cx1: 0.43, cy1: 0.12, cx2: 0.36, cy2: 0.18, x1: 0.32, y1: 0.26, driftX: -0.010, driftY: -0.014, speed: 0.84, phaseOffset: 3.1, baseAlpha: 0.22, width: 1.3 },
    { x0: 0.62, y0: 0.18, cx1: 0.67, cy1: 0.25, cx2: 0.70, cy2: 0.34, x1: 0.68, y1: 0.42, driftX: 0.012, driftY: -0.011, speed: 0.9, phaseOffset: 2.5, baseAlpha: 0.20, width: 1.25 },
  ],
  straight: [
    // Long silky straight luminescent strands floating gently along outer cascade
    { x0: 0.47, y0: 0.14, cx1: 0.38, cy1: 0.22, cx2: 0.32, cy2: 0.40, x1: 0.23, y1: 0.58, driftX: -0.014, driftY: -0.012, speed: 0.86, phaseOffset: 0.2, baseAlpha: 0.26, width: 1.5 },
    { x0: 0.41, y0: 0.28, cx1: 0.33, cy1: 0.44, cx2: 0.24, cy2: 0.60, x1: 0.16, y1: 0.72, driftX: -0.016, driftY: -0.014, speed: 0.96, phaseOffset: 1.6, baseAlpha: 0.24, width: 1.4 },
    { x0: 0.34, y0: 0.48, cx1: 0.28, cy1: 0.62, cx2: 0.26, cy2: 0.76, x1: 0.31, y1: 0.87, driftX: -0.012, driftY: -0.013, speed: 0.82, phaseOffset: 2.9, baseAlpha: 0.20, width: 1.25 },
    { x0: 0.63, y0: 0.18, cx1: 0.67, cy1: 0.28, cx2: 0.70, cy2: 0.39, x1: 0.73, y1: 0.48, driftX: 0.012, driftY: -0.011, speed: 0.9, phaseOffset: 3.8, baseAlpha: 0.20, width: 1.2 },
  ],
};

/**
 * Generates ethereal glowing hair-light wisps that float and glow gently in the air
 * around the outer hair silhouette, without ever warping the underlying portrait bitmap.
 */
export function computeHairAirWisps(params: {
  hairstyle: HairstyleOption;
  phase: number;
  drawX: number;
  drawY: number;
  drawSize: number;
  intensity?: number;
}): HairAirWisp[] {
  const { hairstyle, phase, drawX, drawY, drawSize, intensity = 1 } = params;
  const gain = clamp01(intensity);
  if (gain <= 0.01 || drawSize <= 0) return [];

  const anchors = WISP_ANCHORS[hairstyle] || WISP_ANCHORS.wavy;
  return anchors.map((a) => {
    const wave1 = Math.sin(phase * a.speed + a.phaseOffset);
    const wave2 = Math.cos(phase * a.speed * 0.75 + a.phaseOffset * 1.3);
    const pulse = 0.7 + 0.3 * Math.sin(phase * 1.2 + a.phaseOffset);

    const dxMid = a.driftX * wave1 * drawSize;
    const dyMid = a.driftY * (0.5 + 0.5 * wave2) * drawSize;
    const dxTip = a.driftX * 1.45 * wave1 * drawSize + Math.sin(phase * 1.4 + a.phaseOffset) * drawSize * 0.006;
    const dyTip = a.driftY * 1.35 * (0.5 + 0.5 * wave2) * drawSize;

    return {
      x0: drawX + a.x0 * drawSize,
      y0: drawY + a.y0 * drawSize,
      cx1: drawX + a.cx1 * drawSize + dxMid * 0.55,
      cy1: drawY + a.cy1 * drawSize + dyMid * 0.55,
      cx2: drawX + a.cx2 * drawSize + dxMid,
      cy2: drawY + a.cy2 * drawSize + dyMid,
      x1: drawX + a.x1 * drawSize + dxTip,
      y1: drawY + a.y1 * drawSize + dyTip,
      alpha: Number((a.baseAlpha * pulse * gain).toFixed(3)),
      lineWidth: Math.max(0.8, a.width * (drawSize / 235)),
    };
  });
}

export interface VoiceWaveBarsInput {
  state: AvatarState;
  micLevel: number;
  lipOpenness: number;
  lipWidth?: number;
  phase: number;
  barCount?: number;
}

export interface VoiceWaveBarsResult {
  active: boolean;
  energy: number;
  bars: number[];
}

/**
 * Computes normalized equalizer bar scales [0.12..1.0] for the compact voice waves
 * rendered below ZARA's holographic circle. Reacts prominently when ZARA speaks or
 * hears voice input on the mic, and rests gently at a subtle minimal baseline when silent.
 */
export function computeVoiceWaveBars({
  state,
  micLevel,
  lipOpenness,
  lipWidth = 0,
  phase,
  barCount = 15,
}: VoiceWaveBarsInput): VoiceWaveBarsResult {
  const count = Math.max(5, Math.min(31, Math.round(barCount)));
  const mic = clamp01(micLevel);
  const lip = clamp01(lipOpenness);
  const widthBoost = clamp01(lipWidth);

  const isSpeaking = state === 'speaking' || lip > LIP_NOISE_FLOOR;
  const isListeningVoice = state === 'listening' || mic > MIC_NOISE_FLOOR;
  const active = isSpeaking || isListeningVoice;

  let energy = 0;
  if (isSpeaking) {
    energy = clamp01(Math.max(0.46, 0.42 + lip * 0.52 + widthBoost * 0.14));
  } else if (isListeningVoice) {
    const gatedMic = mic > MIC_NOISE_FLOOR ? (mic - MIC_NOISE_FLOOR) / (1 - MIC_NOISE_FLOOR) : 0;
    energy = clamp01(Math.max(0.32, 0.28 + gatedMic * 0.72));
  }

  const mid = (count - 1) / 2;
  const bars: number[] = [];

  for (let i = 0; i < count; i++) {
    const normDist = mid > 0 ? Math.abs(i - mid) / mid : 0;
    const bellEnvelope = Math.exp(-normDist * normDist * 2.35);

    if (!active) {
      const idleRipple = 0.03 * Math.sin(phase * 1.4 + i * 0.65);
      bars.push(Number((0.14 + bellEnvelope * 0.05 + Math.abs(idleRipple)).toFixed(3)));
    } else {
      const h1 = 0.5 + 0.5 * Math.sin(phase * 6.8 + i * 0.92);
      const h2 = 0.5 + 0.5 * Math.cos(phase * 10.4 - i * 1.35);
      const harmonic = h1 * 0.62 + h2 * 0.38;
      const height = 0.18 + energy * bellEnvelope * (0.34 + 0.56 * harmonic);
      bars.push(Number(clamp01(height).toFixed(3)));
    }
  }

  return { active, energy, bars };
}
