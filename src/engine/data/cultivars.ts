import type { CultivarDef } from '../types';

/**
 * 八个虚构/常见茶树品种数据(数值为游戏平衡用，非严谨农艺数据)
 * gddNeed: 萌芽到采摘成熟所需 ≥10℃ 有效积温(℃·天)
 */
export const CULTIVARS: CultivarDef[] = [
  {
    id: 'longjing43',
    name: '龙井43号',
    suitable: ['green'],
    baseQuality: 78,
    gddNeed: 140,
    gddFactor: 1.12,
    droughtTolerance: 0.62,
    craftBonus: { green: 8 },
  },
  {
    id: 'fuding-dabai',
    name: '福鼎大白茶',
    suitable: ['white', 'black'],
    baseQuality: 75,
    gddNeed: 150,
    gddFactor: 0.98,
    droughtTolerance: 0.5,
    craftBonus: { white: 8, black: 4 },
  },
  {
    id: 'fuding-dahao',
    name: '福鼎大毫',
    suitable: ['white', 'black'],
    baseQuality: 72,
    gddNeed: 155,
    gddFactor: 0.95,
    droughtTolerance: 0.46,
    craftBonus: { white: 6, black: 5 },
  },
  {
    id: 'zhenghe-dabai',
    name: '政和大白',
    suitable: ['white', 'black'],
    baseQuality: 73,
    gddNeed: 158,
    gddFactor: 0.92,
    droughtTolerance: 0.55,
    craftBonus: { white: 7, black: 4 },
  },
  {
    id: 'tieguanyin',
    name: '铁观音',
    suitable: ['oolong'],
    baseQuality: 81,
    gddNeed: 162,
    gddFactor: 0.9,
    droughtTolerance: 0.42,
    craftBonus: { oolong: 10 },
  },
  {
    id: 'huangdan',
    name: '黄旦',
    suitable: ['oolong'],
    baseQuality: 70,
    gddNeed: 132,
    gddFactor: 1.18,
    droughtTolerance: 0.5,
    craftBonus: { oolong: 5 },
  },
  {
    id: 'yunnan-daye',
    name: '云南大叶种',
    suitable: ['black', 'dark'],
    baseQuality: 77,
    gddNeed: 172,
    gddFactor: 0.86,
    droughtTolerance: 0.72,
    craftBonus: { black: 6, dark: 9 },
  },
  {
    id: 'junshan-qunti',
    name: '君山群体种',
    suitable: ['yellow', 'green'],
    baseQuality: 72,
    gddNeed: 145,
    gddFactor: 1.02,
    droughtTolerance: 0.48,
    craftBonus: { yellow: 9, green: 3 },
  },
];

const cultivarMap = new Map(CULTIVARS.map((c) => [c.id, c]));

export function getCultivar(id: string): CultivarDef {
  const c = cultivarMap.get(id);
  if (!c) throw new Error(`未知茶树品种: ${id}`);
  return c;
}
