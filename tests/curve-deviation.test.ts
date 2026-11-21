import { describe, expect, it } from 'vitest';
import { RECIPES } from '../src/engine/data/recipes';
import { processTea } from '../src/engine/processing';
import type { FreshLeafBatch } from '../src/engine/types';

const batch: FreshLeafBatch = {
  id: 'TEST',
  plotId: 1,
  cultivarId: 'longjing43',
  pickedDay: 20,
  weightKg: 20,
  quality: 82,
  standard: '一芽一叶',
  initialMoisture: 0.78,
  pickedAt: 0,
};

describe('参考工艺含水率曲线精度', () => {
  for (const recipe of RECIPES) {
    it(`${recipe.teaName} 全程曲线与参考工艺表偏差 ≤ 3 个百分点`, () => {
      const result = processTea({
        batch,
        teaClass: recipe.teaClass,
        operations: recipe.stages.map((s) => ({
          kind: s.kind,
          temp: s.refTemp,
          duration: s.refDuration,
        })),
      });

      // 硬指标 1: 全程最大偏差
      expect(result.maxCurveDeviationPct).toBeLessThanOrEqual(3);

      // 每道工序单独的偏差也要 ≤ 3pp
      for (const stage of result.stages) {
        expect(stage.maxCurveDeviationPct).toBeLessThanOrEqual(3);
        // 逐分钟比对参考曲线
        expect(stage.curve.length).toBeGreaterThan(0);
        const refStage = recipe.stages.find((s) => s.kind === stage.kind)!;
        for (const p of stage.curve) {
          const refPoint = result.referenceCurve.find((r) => r.t === p.t);
          expect(refPoint).toBeDefined();
          void refStage;
          expect(Math.abs(p.moisture - refPoint!.moisture) * 100).toBeLessThanOrEqual(
            3,
          );
        }
      }

      // 成品含水率命中目标
      expect(
        Math.abs(result.finalMoisture - recipe.targetFinalMoisture),
      ).toBeLessThanOrEqual(0.02);
    });

    it(`${recipe.teaName} 参考工艺零缺陷`, () => {
      const result = processTea({
        batch,
        teaClass: recipe.teaClass,
        operations: recipe.stages.map((s) => ({
          kind: s.kind,
          temp: s.refTemp,
          duration: s.refDuration,
        })),
      });
      expect(result.defects).toHaveLength(0);
    });
  }
});
