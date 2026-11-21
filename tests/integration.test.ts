import { describe, expect, it } from 'vitest';
import { generateClimate } from '../src/engine/climate';
import { generateGardens } from '../src/engine/garden';
import { pickLeaves, simulateSeason } from '../src/engine/growth';
import { processTea } from '../src/engine/processing';
import { evaluate } from '../src/engine/evaluation';
import { RECIPES } from '../src/engine/data/recipes';

describe('经营全链路集成', () => {
  it('整季生长 → 采摘 → 按参考工艺制茶 → 审评合格入库', () => {
    const weather = generateClimate(11, 60);
    const plots = generateGardens(11, 100);
    const season = simulateSeason(plots, weather);
    const target = season.find((r) => r.advice.windowStart < 55)!;
    expect(target).toBeDefined();

    const leaf = pickLeaves(target, {
      standard: '一芽一叶',
      pickedDay: target.advice.windowStart,
      seed: 99,
    });
    expect(leaf.quality).toBeGreaterThan(60);

    const recipe = RECIPES.find((r) => r.teaClass === 'green')!;
    const result = processTea({
      batch: leaf,
      teaClass: 'green',
      operations: recipe.stages.map((s) => ({
        kind: s.kind,
        temp: s.refTemp,
        duration: s.refDuration,
      })),
    });
    const tea = evaluate(leaf, result);

    expect(tea.defects).toHaveLength(0);
    expect(tea.blamedStage).toBeNull();
    expect(tea.score.total).toBeGreaterThanOrEqual(78);
    expect(tea.curve.length).toBeGreaterThan(100);
    expect(tea.referenceCurve.length).toBeGreaterThan(100);
    expect(tea.stageSummary).toHaveLength(4);
    // 折干率合理(约 4:1)
    expect(tea.weightKg).toBeLessThan(leaf.weightKg * 0.3);
  });

  it('六大茶类各做一批参考工艺，全部零缺陷且终态命中目标', () => {
    const weather = generateClimate(23, 60);
    const plots = generateGardens(23, 100);
    const season = simulateSeason(plots, weather);
    const target = season.find((r) => r.advice.windowStart < 55)!;

    for (const recipe of RECIPES) {
      const leaf = pickLeaves(target, {
        standard: '一芽二叶',
        pickedDay: target.advice.windowStart,
        seed: 5,
      });
      const result = processTea({
        batch: leaf,
        teaClass: recipe.teaClass,
        operations: recipe.stages.map((s) => ({
          kind: s.kind,
          temp: s.refTemp,
          duration: s.refDuration,
        })),
      });
      const tea = evaluate(leaf, result);
      expect(tea.defects, `${recipe.teaName} 不应有缺陷`).toHaveLength(0);
      expect(Math.abs(tea.moisture - recipe.targetFinalMoisture)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(tea.oxidation - recipe.targetFinalOxidation)).toBeLessThanOrEqual(0.1);
    }
  });

  it('故意做坏一批红茶，评茶能指出发酵工序的具体问题', () => {
    const weather = generateClimate(31, 60);
    const plots = generateGardens(31, 100);
    const season = simulateSeason(plots, weather);
    const target = season.find((r) => r.advice.windowStart < 55)!;
    const leaf = pickLeaves(target, {
      standard: '一芽二叶',
      pickedDay: target.advice.windowStart,
      seed: 8,
    });

    const recipe = RECIPES.find((r) => r.teaClass === 'black')!;
    const badOps = recipe.stages.map((s) =>
      s.kind === 'fermentation'
        ? { kind: s.kind, temp: 40, duration: 350 }
        : { kind: s.kind, temp: s.refTemp, duration: s.refDuration },
    );
    const result = processTea({ batch: leaf, teaClass: 'black', operations: badOps });
    const tea = evaluate(leaf, result);

    expect(result.defects.length).toBeGreaterThan(0);
    expect(tea.blamedStage?.stage).toBe('fermentation');
    // 原因文案要能讲清楚
    expect(tea.blamedStage!.reasons.join('').length).toBeGreaterThan(8);
    // 做坏的茶评分明显低于合格线
    expect(tea.score.total).toBeLessThan(78);
  });
});
