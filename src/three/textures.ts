import * as THREE from 'three';
import type { FloorType } from '../model/types';

/** Flat colours used by the 2D plan and as a base for the 3D textures. */
export const FLOOR_COLORS: Record<FloorType, string> = {
  wood: '#c79a63',
  stone: '#a8a39a',
  tile: '#e4e1da',
  carpet: '#8a7f9e',
  concrete: '#b5b5b2',
  marble: '#efece6',
};

// Deterministic pseudo random so textures look the same every time.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function shade(hex: string, amount: number) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
}

interface TextureDef {
  /** Real-world size covered by one texture tile, in metres. */
  size: number;
  draw: (ctx: CanvasRenderingContext2D, px: number) => void;
}

const DEFS: Record<FloorType, TextureDef> = {
  wood: {
    size: 1.2,
    draw(ctx, px) {
      const r = rng(7);
      const planks = 8;
      const h = px / planks;
      for (let i = 0; i < planks; i++) {
        const offset = r() * px;
        for (const x0 of [offset - px, offset]) {
          ctx.fillStyle = shade(FLOOR_COLORS.wood, (r() - 0.5) * 0.12);
          ctx.fillRect(x0, i * h, px, h);
        }
        ctx.strokeStyle = 'rgba(60,35,10,0.18)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 6; g++) {
          const y = i * h + r() * h;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(px * 0.3, y + (r() - 0.5) * 4, px * 0.6, y + (r() - 0.5) * 4, px, y);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(50,30,10,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-2, i * h, px + 4, h);
        ctx.beginPath();
        ctx.moveTo(offset, i * h);
        ctx.lineTo(offset, (i + 1) * h);
        ctx.stroke();
      }
    },
  },
  stone: {
    size: 1.6,
    draw(ctx, px) {
      const r = rng(3);
      ctx.fillStyle = '#6f6b64';
      ctx.fillRect(0, 0, px, px);
      const rows = 4;
      const h = px / rows;
      for (let i = 0; i < rows; i++) {
        let x = -r() * h;
        while (x < px) {
          const w = h * (0.8 + r() * 0.9);
          ctx.fillStyle = shade(FLOOR_COLORS.stone, (r() - 0.5) * 0.18);
          ctx.fillRect(x + 3, i * h + 3, Math.min(w, px - x) - 6, h - 6);
          if (x < 0) ctx.fillRect(px + x + 3, i * h + 3, -x - 6, h - 6);
          x += w;
        }
      }
    },
  },
  tile: {
    size: 0.6,
    draw(ctx, px) {
      ctx.fillStyle = '#b9b5ad';
      ctx.fillRect(0, 0, px, px);
      const r = rng(11);
      const n = 2;
      const s = px / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = shade(FLOOR_COLORS.tile, (r() - 0.5) * 0.04);
          ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
        }
    },
  },
  carpet: {
    size: 0.5,
    draw(ctx, px) {
      ctx.fillStyle = FLOOR_COLORS.carpet;
      ctx.fillRect(0, 0, px, px);
      const r = rng(5);
      for (let i = 0; i < 9000; i++) {
        ctx.fillStyle = shade(FLOOR_COLORS.carpet, (r() - 0.5) * 0.15);
        ctx.fillRect(r() * px, r() * px, 2, 2);
      }
    },
  },
  concrete: {
    size: 2,
    draw(ctx, px) {
      ctx.fillStyle = FLOOR_COLORS.concrete;
      ctx.fillRect(0, 0, px, px);
      const r = rng(13);
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`;
        ctx.beginPath();
        ctx.arc(r() * px, r() * px, 4 + r() * 30, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  marble: {
    size: 1.2,
    draw(ctx, px) {
      ctx.fillStyle = FLOOR_COLORS.marble;
      ctx.fillRect(0, 0, px, px);
      const r = rng(17);
      ctx.strokeStyle = 'rgba(120,120,130,0.35)';
      for (let i = 0; i < 14; i++) {
        ctx.lineWidth = 0.5 + r() * 1.5;
        ctx.beginPath();
        let x = r() * px;
        let y = 0;
        ctx.moveTo(x, y);
        while (y < px) {
          x += (r() - 0.5) * 40;
          y += 10 + r() * 30;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(160,155,145,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, px, px);
    },
  },
};

const cache = new Map<FloorType, THREE.Texture>();

export function floorTexture(type: FloorType): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cached = cache.get(type);
  if (cached) return cached;
  const def = DEFS[type];
  const px = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  def.draw(ctx, px);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / def.size, 1 / def.size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.name = `floor-${type}`;
  cache.set(type, tex);
  return tex;
}

/** Real-world size (cm) of one texture tile, for 2D patterns. */
export const floorTextureSizeCm = (type: FloorType) => DEFS[type].size * 100;

const urlCache = new Map<FloorType, string>();

/** The 3D floor texture as a data URL, so the 2D plan can use the same look. */
export function floorTextureDataUrl(type: FloorType): string | null {
  const cached = urlCache.get(type);
  if (cached) return cached;
  const tex = floorTexture(type);
  const img = tex?.image as HTMLCanvasElement | undefined;
  if (!img?.toDataURL) return null;
  const url = img.toDataURL('image/jpeg', 0.85);
  urlCache.set(type, url);
  return url;
}
