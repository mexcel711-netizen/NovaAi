import { useEffect, useRef } from 'react';
import {
  computeHairAirWisps,
  computeTargetHairWind,
  computeVoiceWaveBars,
  stepHairWind,
} from '../lib/hairPhysics';
import type { AvatarState, FacialEmotion, HairstyleOption } from '../types/nova';

interface HolographicAvatarProps {
  state: AvatarState;
  emotion: FacialEmotion;
  assistantName: string;
  hairstyle?: HairstyleOption;
  variant?: 'stage' | 'hero' | 'compact';
  showRadarRing?: boolean;
  showVoiceWaves?: boolean;
  micLevel?: number;
  lipOpenness?: number;
  lipWidth?: number;
}

const HAIRSTYLE_IMAGES: Record<HairstyleOption, string> = {
  bob: '/src/assets/images/zara_bob_hologram_1795079124903.jpg',
  wavy: '/src/assets/images/nova_wavy_hologram_1795067914360.jpg',
  straight: '/src/assets/images/zara_straight_hologram_1795079125416.jpg',
};

const OFFSCREEN_SIZE = 512;
const VOICE_WAVE_BAR_COUNT = 15;

interface HoloParticle {
  x: number;
  y: number;
  r: number;
  speedY: number;
  drift: number;
  alpha: number;
  phaseOffset: number;
}


export function HolographicAvatar({
  state,
  emotion,
  assistantName,
  hairstyle = 'wavy',
  variant = 'stage',
  showRadarRing = true,
  showVoiceWaves,
  micLevel = 0,
  lipOpenness = 0,
  lipWidth = 0,
}: HolographicAvatarProps) {
  const shouldShowWaves = showVoiceWaves ?? variant !== 'compact';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveContainerRef = useRef<HTMLDivElement | null>(null);
  const waveBarRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const stateRef = useRef<AvatarState>(state);
  const emotionRef = useRef<FacialEmotion>(emotion);
  const hairstyleRef = useRef<HairstyleOption>(hairstyle);
  const showRingRef = useRef<boolean>(showRadarRing);
  const micRef = useRef<number>(micLevel);
  const lipOpenRef = useRef<number>(lipOpenness);
  const lipWidthRef = useRef<number>(lipWidth);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    emotionRef.current = emotion;
  }, [emotion]);

  useEffect(() => {
    hairstyleRef.current = hairstyle;
  }, [hairstyle]);

  useEffect(() => {
    showRingRef.current = showRadarRing;
  }, [showRadarRing]);

  useEffect(() => {
    micRef.current = micLevel;
  }, [micLevel]);

  useEffect(() => {
    lipOpenRef.current = lipOpenness;
  }, [lipOpenness]);

  useEffect(() => {
    lipWidthRef.current = lipWidth;
  }, [lipWidth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Preload all 3 hairstyle portraits into feathered offscreen canvases for instant switching
    const offscreenCache: Partial<Record<HairstyleOption, HTMLCanvasElement>> = {};
    (['wavy', 'bob', 'straight'] as HairstyleOption[]).forEach((styleKey) => {
      const img = new Image();
      img.onload = () => {
        const off = document.createElement('canvas');
        off.width = OFFSCREEN_SIZE;
        off.height = OFFSCREEN_SIZE;
        const offCtx = off.getContext('2d');
        if (offCtx) {
          offCtx.clearRect(0, 0, OFFSCREEN_SIZE, OFFSCREEN_SIZE);
          offCtx.drawImage(img, 0, 0, OFFSCREEN_SIZE, OFFSCREEN_SIZE);
          offCtx.save();
          offCtx.globalCompositeOperation = 'destination-in';
          const feather = offCtx.createRadialGradient(256, 246, 112, 256, 256, 238);
          feather.addColorStop(0, 'rgba(0,0,0,1)');
          feather.addColorStop(0.64, 'rgba(0,0,0,0.94)');
          feather.addColorStop(0.85, 'rgba(0,0,0,0.34)');
          feather.addColorStop(1, 'rgba(0,0,0,0)');
          offCtx.fillStyle = feather;
          offCtx.fillRect(0, 0, OFFSCREEN_SIZE, OFFSCREEN_SIZE);
          offCtx.restore();
          offscreenCache[styleKey] = off;
        }
      };
      img.src = HAIRSTYLE_IMAGES[styleKey];
    });

    const particles: HoloParticle[] = Array.from(
      { length: variant === 'compact' ? 14 : 30 },
      (_, idx) => ({
        x: 0.14 + ((idx * 37) % 72) / 100,
        y: 0.12 + ((idx * 53) % 76) / 100,
        r: 0.8 + (idx % 3) * 0.55,
        speedY: 0.00038 + (idx % 5) * 0.00014,
        drift: 0.0045 + (idx % 4) * 0.002,
        alpha: 0.25 + (idx % 4) * 0.16,
        phaseOffset: idx * 0.7,
      })
    );

    const emotionWeights: Record<FacialEmotion, number> = {
      calm: 1,
      happy: 0,
      love: 0,
      sad: 0,
      surprised: 0,
      excited: 0,
      empathetic: 0,
      thoughtful: 0,
      confident: 0,
      angry: 0,
      curious: 0,
    };

    const canvasLogicalSize = variant === 'hero' ? 360 : variant === 'compact' ? 200 : 280;

    let rafId = 0;
    let phase = 0;
    let windPhase = 0;
    let currentWind = 0.32;
    let lastWindAttr = '';
    let lastWaveActiveAttr = '';
    let lastDrawTime = 0;
    const minFrameMs = variant === 'compact' ? 42 : 28;

    const drawGlowingHairAir = (
      drawX: number,
      drawY: number,
      drawSize: number,
      hairPhase: number,
      styleKey: HairstyleOption,
      glowPrimary: string,
      glowSoft: string
    ) => {
      // 1. Soft breathing holographic glow localized over the hair crown & flowing locks
      const haloBreath = 0.8 + 0.2 * Math.sin(hairPhase * 1.15);
      const hairGlowX =
        styleKey === 'bob'
          ? drawX + drawSize * 0.48
          : styleKey === 'straight'
            ? drawX + drawSize * 0.42
            : drawX + drawSize * 0.44;
      const hairGlowY = drawY + drawSize * 0.29;
      const hairGlowR = drawSize * 0.36;

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const hairHalo = ctx.createRadialGradient(
        hairGlowX,
        hairGlowY,
        drawSize * 0.04,
        hairGlowX,
        hairGlowY,
        hairGlowR
      );
      hairHalo.addColorStop(0, glowPrimary);
      hairHalo.addColorStop(0.55, glowSoft);
      hairHalo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = 0.34 * haloBreath;
      ctx.fillStyle = hairHalo;
      ctx.beginPath();
      ctx.arc(hairGlowX, hairGlowY, hairGlowR, 0, Math.PI * 2);
      ctx.fill();

      // 2. Weightless luminous hair strands floating gently in the air (zero portrait distortion)
      const wisps = computeHairAirWisps({
        hairstyle: styleKey,
        phase: hairPhase,
        drawX,
        drawY,
        drawSize,
        intensity: prefersReducedMotion ? 0.4 : 0.92,
      });

      ctx.lineCap = 'round';
      for (const w of wisps) {
        const grad = ctx.createLinearGradient(w.x0, w.y0, w.x1, w.y1);
        grad.addColorStop(0, 'rgba(165, 243, 252, 0)');
        grad.addColorStop(0.38, `rgba(165, 243, 252, ${w.alpha})`);
        grad.addColorStop(0.75, `rgba(103, 232, 249, ${(w.alpha * 0.85).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');

        ctx.globalAlpha = 1;
        ctx.strokeStyle = grad;
        ctx.lineWidth = w.lineWidth;
        ctx.beginPath();
        ctx.moveTo(w.x0, w.y0);
        ctx.bezierCurveTo(w.cx1, w.cy1, w.cx2, w.cy2, w.x1, w.y1);
        ctx.stroke();
      }
      ctx.restore();
    };

    const renderFrame = (now: number = 0) => {
      if (!prefersReducedMotion && lastDrawTime !== 0 && now - lastDrawTime < minFrameMs) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }
      lastDrawTime = now;

      const dpr = variant === 'compact' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const width = canvasLogicalSize;
      const height = canvasLogicalSize;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const curState = stateRef.current;
      const curEmotion = emotionRef.current;
      const curStyle = hairstyleRef.current;
      const curMic = micRef.current;
      const curLipOpen = lipOpenRef.current;
      const curLipWidth = lipWidthRef.current;

      (Object.keys(emotionWeights) as FacialEmotion[]).forEach((k) => {
        const target = k === curEmotion ? 1 : 0;
        emotionWeights[k] += (target - emotionWeights[k]) * 0.08;
      });

      const targetWind = prefersReducedMotion
        ? 0
        : computeTargetHairWind({
            state: curState,
            micLevel: curMic,
            lipOpenness: curLipOpen,
            ambientBreeze: true,
          });
      currentWind = prefersReducedMotion ? 0 : stepHairWind(currentWind, targetWind);

      const windLabel = currentWind.toFixed(2);
      if (containerRef.current && windLabel !== lastWindAttr) {
        lastWindAttr = windLabel;
        containerRef.current.dataset.hairWind = windLabel;
      }

      const waveSpeed =
        curState === 'thinking'
          ? 0.042
          : curState === 'speaking'
            ? 0.036
            : curState === 'listening'
              ? 0.028
              : 0.018;
      if (!prefersReducedMotion) {
        phase += waveSpeed;
        // Hair aura and floating wisps stay at one serene constant pace even while speaking
        windPhase += 0.026;
      }

      if (waveContainerRef.current) {
        const waveState = computeVoiceWaveBars({
          state: curState,
          micLevel: curMic,
          lipOpenness: curLipOpen,
          lipWidth: curLipWidth,
          phase: prefersReducedMotion ? 0 : phase,
          barCount: VOICE_WAVE_BAR_COUNT,
        });
        const activeStr = waveState.active ? 'true' : 'false';
        if (activeStr !== lastWaveActiveAttr) {
          lastWaveActiveAttr = activeStr;
          waveContainerRef.current.dataset.active = activeStr;
        }
        waveState.bars.forEach((barScale, idx) => {
          const barEl = waveBarRefs.current[idx];
          if (!barEl) return;
          const safeScale = prefersReducedMotion ? (waveState.active ? 0.55 : 0.16) : barScale;
          barEl.style.transform = `scaleY(${safeScale})`;
          barEl.style.opacity = waveState.active
            ? `${(0.48 + safeScale * 0.52).toFixed(2)}`
            : '0.32';
        });
      }

      const palette =
        curState === 'error' || curEmotion === 'angry'
          ? { primary: '#FF4D6D', secondary: '#FB7185', glow: 'rgba(255,77,109,0.28)', tint: 'rgba(255,77,109,0.22)' }
          : curEmotion === 'love'
            ? { primary: '#FB7185', secondary: '#F472B6', glow: 'rgba(251,113,133,0.32)', tint: 'rgba(244,114,182,0.24)' }
            : curEmotion === 'excited'
              ? { primary: '#38BDF8', secondary: '#34D399', glow: 'rgba(56,189,248,0.28)', tint: 'rgba(52,211,153,0.16)' }
              : curEmotion === 'sad'
                ? { primary: '#60A5FA', secondary: '#818CF8', glow: 'rgba(96,165,250,0.26)', tint: 'rgba(79,70,229,0.22)' }
                : curEmotion === 'happy'
                  ? { primary: '#22D3EE', secondary: '#10B981', glow: 'rgba(16,185,129,0.26)', tint: 'rgba(16,185,129,0.14)' }
                  : curEmotion === 'surprised'
                    ? { primary: '#7DD3FC', secondary: '#38BDF8', glow: 'rgba(125,211,252,0.34)', tint: 'rgba(56,189,248,0.20)' }
                    : { primary: '#38BDF8', secondary: '#22D3EE', glow: 'rgba(34,211,238,0.26)', tint: 'rgba(34,211,238,0.08)' };

      // 1. Crisp Circular Radar Degree-Tick Ring (matching reference onboarding screenshots)
      const ringRadius = width * 0.455;
      if (showRingRef.current) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle =
          curState === 'speaking' ? 'rgba(56, 189, 248, 0.34)' : 'rgba(56, 189, 248, 0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Inner thin ring
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius - 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 72 Precision degree ticks around perimeter
        const tickRot = prefersReducedMotion ? 0 : phase * 0.08;
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2 + tickRot;
          const isMajor = i % 6 === 0;
          const rIn = ringRadius + 2;
          const rOut = ringRadius + (isMajor ? 8 : 4);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
          ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
          ctx.strokeStyle = isMajor ? 'rgba(103, 232, 249, 0.48)' : 'rgba(103, 232, 249, 0.16)';
          ctx.lineWidth = isMajor ? 1.2 : 0.8;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 2. Central radial volumetric glow inside circle (steady ambient radiance)
      const auraRadius = ringRadius * 0.92;
      const aura = ctx.createRadialGradient(cx, cy - 6, width * 0.06, cx, cy, auraRadius);
      aura.addColorStop(0, palette.glow);
      aura.addColorStop(0.58, 'rgba(14, 116, 144, 0.10)');
      aura.addColorStop(1, 'rgba(3, 10, 19, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, cy, auraRadius, 0, Math.PI * 2);
      ctx.fill();

      // 3. Crisp Undistorted Holographic Portrait + Floating Glowing Hair Wisps in the Air
      const drawSize = width * 0.84;
      const drawX = cx - drawSize / 2;
      const drawY = cy - drawSize / 2 + 2;
      const offscreen = offscreenCache[curStyle] || offscreenCache.wavy;

      if (offscreen) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(offscreen, drawX, drawY, drawSize, drawSize);
        drawGlowingHairAir(
          drawX,
          drawY,
          drawSize,
          windPhase,
          curStyle,
          palette.glow,
          palette.tint
        );
        ctx.restore();

        if (emotionWeights.love + emotionWeights.sad + emotionWeights.happy + emotionWeights.angry > 0.1) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          const emoGrad = ctx.createRadialGradient(cx, cy - 12, 10, cx, cy, ringRadius * 0.9);
          emoGrad.addColorStop(0, palette.tint);
          emoGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = emoGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // 4. Drifting starlight particles floating calmly inside the circular halo
      if (!prefersReducedMotion) {
        ctx.save();
        for (const p of particles) {
          const py = ((p.y - windPhase * p.speedY * 20) % 1 + 1) % 1;
          const px = p.x + Math.sin(windPhase * 1.1 + p.phaseOffset) * p.drift;
          const xPos = px * width;
          const yPos = py * height;
          const distFromCenter = Math.hypot(xPos - cx, yPos - cy);
          if (distFromCenter < ringRadius - 6) {
            const twinkle = 0.45 + 0.55 * Math.sin(windPhase * 2.1 + p.phaseOffset);
            ctx.fillStyle =
              emotionWeights.love > 0.35
                ? `rgba(251, 182, 206, ${p.alpha * twinkle})`
                : `rgba(165, 243, 252, ${p.alpha * twinkle})`;
            ctx.beginPath();
            ctx.arc(xPos, yPos, p.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      ctx.restore();

      if (!prefersReducedMotion) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [variant]);

  const sizeClasses =
    variant === 'hero'
      ? 'h-[280px] w-[280px] sm:h-[340px] sm:w-[340px]'
      : variant === 'compact'
        ? 'h-[172px] w-[172px]'
        : 'h-[214px] w-[214px] sm:h-[234px] sm:w-[234px]';

  const waveActive =
    state === 'speaking' ||
    state === 'listening' ||
    lipOpenness > 0.03 ||
    micLevel > 0.06;

  const waveBarTone =
    state === 'error' || emotion === 'angry'
      ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.55)]'
      : emotion === 'love'
        ? 'bg-pink-400 shadow-[0_0_8px_rgba(244,114,182,0.55)]'
        : state === 'listening'
          ? 'bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.55)]'
          : 'bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.55)]';

  return (
    <div
      ref={containerRef}
      className="relative flex w-full flex-col items-center justify-center"
      data-testid="holographic-avatar"
      data-state={state}
      data-emotion={emotion}
      data-hairstyle={hairstyle}
      data-hair-wind="0.32"
    >
      <canvas
        ref={canvasRef}
        className={sizeClasses}
        aria-label={`${assistantName} ${hairstyle}-hair holographic portrait: ${state}, expression ${emotion}`}
      />

      {shouldShowWaves && (
        <div
          ref={waveContainerRef}
          data-testid="avatar-voice-waves"
          data-active={waveActive ? 'true' : 'false'}
          aria-hidden="true"
          className="mt-1 flex h-[20px] items-center justify-center gap-[3.5px] px-3"
        >
          {Array.from({ length: VOICE_WAVE_BAR_COUNT }, (_, idx) => (
            <span
              key={idx}
              ref={(el) => {
                waveBarRefs.current[idx] = el;
              }}
              className={`h-full w-[2.5px] origin-center rounded-full transition-colors duration-200 ${waveBarTone}`}
              style={{ transform: 'scaleY(0.16)', opacity: 0.34 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
