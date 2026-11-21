import { describe, expect, it } from 'vitest';
import { generateClimate } from '../src/engine/climate';
import { generateGardens } from '../src/engine/garden';
import { pickLeaves, simulateSeason } from '../src/engine/growth';

describe('百园整季生长结算性能', () => {
  it('100 块茶园 × 60 天结算耗时 < 1000ms', () => {
    const weather = generateClimate(20260301, 60);
    const plots = generateGardens(20260301, 100);
    expect(plots).toHaveLength(100);

    const t0 = performance.now();
    const results = simulateSeason(plots, weather);
    const elapsed = performance.now() - t0;

    // 硬指标 2: 一整季结算不超过 1 秒
    expect(elapsed).toBeLessThan(1000);
    expect(results).toHaveLength(100);
    for (const r of results) {
      expect(r.daily).toHaveLength(60);
      // 积温单调不减
      for (let i = 1; i < r.daily.length; i++) {
        expect(r.daily[i].gdd).toBeGreaterThanOrEqual(r.daily[i - 1].gdd);
      }
      // 每块地都要有采摘建议窗口
      expect(r.advice.windowEnd).toBeGreaterThanOrEqual(r.advice.windowStart);
      expect(r.advice.maturity).toBeGreaterThan(0);
    }
  });

  it('同种子结果可复现(确定性)', () => {
    const w1 = generateClimate(42, 60);
    const w2 = generateClimate(42, 60);
    expect(w1).toEqual(w2);
    const p1 = generateGardens(42, 100);
    const p2 = generateGardens(42, 100);
    expect(p1).toEqual(p2);
  });

  it('海拔/坡向/天气确实影响生长: 高海拔积温更低', () => {
    const weather = generateClimate(7, 60);
    const plots = generateGardens(7, 100);
    const results = simulateSeason(plots, weather);
    const byAlt = [...results].sort((a, b) => a.plot.altitude - b.plot.altitude);
    const low = byAlt.slice(0, 10).reduce((s, r) => s + r.daily[59].gdd, 0) / 10;
    const high = byAlt.slice(-10).reduce((s, r) => s + r.daily[59].gdd, 0) / 10;
    expect(high).toBeLessThan(low);
  });

  it('采摘时间与标准影响鲜叶质量', () => {
    const weather = generateClimate(7, 60);
    const plots = generateGardens(7, 100);
    const results = simulateSeason(plots, weather);
    // 选取季内能够成熟的地块(高海拔地块可能积温不足，属经营风险)
    const target = results.find((r) => r.advice.windowStart < 55)!;
    expect(target).toBeDefined();

    const early = pickLeaves(target, { standard: '一芽二叶', pickedDay: 2, seed: 1 });
    const inWindow = pickLeaves(target, {
      standard: '一芽二叶',
      pickedDay: target.advice.windowStart + 1,
      seed: 1,
    });
    const late = pickLeaves(target, {
      standard: '一芽二叶',
      pickedDay: 59,
      seed: 1,
    });
    expect(inWindow.quality).toBeGreaterThan(early.quality);
    expect(inWindow.quality).toBeGreaterThan(late.quality);

    const bud = pickLeaves(target, { standard: '单芽', pickedDay: 30, seed: 2 });
    const coarse = pickLeaves(target, { standard: '粗老叶', pickedDay: 30, seed: 2 });
    expect(bud.quality).toBeGreaterThan(coarse.quality);
    expect(bud.weightKg).toBeLessThan(coarse.weightKg);
  });
});
