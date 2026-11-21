import type { Aspect, GardenPlot } from './types';
import { CULTIVARS } from './data/cultivars';
import { mulberry32 } from './rng';

const ASPECTS: Aspect[] = ['south', 'east', 'north', 'west'];
const ASPECT_SUN: Record<Aspect, number> = {
  south: 1.0,
  east: 0.86,
  west: 0.8,
  north: 0.62,
};

export function aspectSunFactor(a: Aspect): number {
  return ASPECT_SUN[a];
}

/**
 * 程序化生成一批茶园。海拔 220~1180m，坡向/坡度/土壤/雾况各异，
 * 品种在其适制区间内轮换分配。
 */
export function generateGardens(seed: number, count = 100): GardenPlot[] {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const plots: GardenPlot[] = [];
  for (let i = 0; i < count; i++) {
    const altitude = Math.round(220 + rand() * 960);
    const aspect = ASPECTS[Math.floor(rand() * ASPECTS.length)];
    const slope = Math.round((6 + rand() * 26) * 10) / 10;
    const cultivar = CULTIVARS[Math.floor(rand() * CULTIVARS.length)];
    // 高海拔坡地排水好、持水弱；谷地雾多
    const soilRetention =
      Math.round(clamp01(0.62 - altitude / 4200 + (rand() - 0.5) * 0.18) * 100) /
      100;
    const mistFactor =
      Math.round(clamp01(0.35 + altitude / 2200 + (rand() - 0.5) * 0.16) * 100) /
      100;
    plots.push({
      id: i + 1,
      name: `${altitude}m${aspectName(aspect)}坡·${cultivar.name}`,
      altitude,
      aspect,
      slope,
      cultivarId: cultivar.id,
      soilRetention,
      mistFactor,
    });
  }
  return plots;
}

export function aspectName(a: Aspect): string {
  return { south: '南', east: '东', north: '北', west: '西' }[a];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
