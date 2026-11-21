import { describe, expect, it } from 'vitest';
import { processTea } from '../src/engine/processing';
import { evaluate } from '../src/engine/evaluation';
import { RECIPES } from '../src/engine/data/recipes';
import type { FreshLeafBatch } from '../src/engine/types';

function makeBatch(over: Partial<FreshLeafBatch> = {}): FreshLeafBatch {
  return {
    id: 'BAD',
    plotId: 3,
    cultivarId: 'longjing43',
    pickedDay: 20,
    weightKg: 18,
    quality: 80,
    standard: '一芽二叶',
    initialMoisture: 0.78,
    pickedAt: 0,
    ...over,
  };
}

describe('做坏批次的工序归因', () => {
  it('杀青温度过低 -> 红梗红叶，归因到杀青工序', () => {
    const recipe = RECIPES.find((r) => r.teaClass === 'green')!;
    const ops = recipe.stages.map((s) =>
      s.kind === 'fixation'
        ? { kind: s.kind, temp: 120, duration: 4 }
        : { kind: s.kind, temp: s.refTemp, duration: s.refDuration },
    );
    const result = processTea({ batch: makeBatch(), teaClass: 'green', operations: ops });
    const tea = evaluate(makeBatch(), result);

    expect(result.defects.length).toBeGreaterThan(0);
    const redStem = result.defects.find((d) => d.code === 'F_RED_STEM');
    expect(redStem).toBeDefined();
    expect(redStem!.stage).toBe('fixation');
    // 硬指标: 评茶结论必须指出问题工序
    expect(tea.blamedStage).not.toBeNull();
    expect(tea.blamedStage!.stage).toBe('fixation');
    expect(tea.blamedStage!.reasons.join('')).toContain('红梗');
    expect(tea.score.total).toBeLessThan(85);
  });

  it('杀青超温 -> 焦边焦叶，归因到杀青且带原因说明', () => {
    const recipe = RECIPES.find((r) => r.teaClass === 'green')!;
    const ops = recipe.stages.map((s) =>
      s.kind === 'fixation'
        ? { kind: s.kind, temp: 275, duration: 12 }
        : { kind: s.kind, temp: s.refTemp, duration: s.refDuration },
    );
    const result = processTea({ batch: makeBatch(), teaClass: 'green', operations: ops });
    const tea = evaluate(makeBatch(), result);

    const burnt = result.defects.find((d) => d.code === 'F_BURNT');
    expect(burnt).toBeDefined();
    expect(tea.blamedStage!.stage).toBe('fixation');
    expect(tea.blamedStage!.reasons.join('')).toContain('焦');
  });

  it('红茶发酵温度过高 -> 酸馊味，归因到发酵工序', () => {
    const recipe = RECIPES.find((r) => r.teaClass === 'black')!;
    const ops = recipe.stages.map((s) =>
      s.kind === 'fermentation'
        ? { kind: s.kind, temp: 40, duration: 320 }
        : { kind: s.kind, temp: s.refTemp, duration: s.refDuration },
    );
    const result = processTea({
      batch: makeBatch({ cultivarId: 'yunnan-daye' }),
      teaClass: 'black',
      operations: ops,
    });
    const tea = evaluate(makeBatch({ cultivarId: 'yunnan-daye' }), result);

    const sour = result.defects.find((d) => d.code === 'OX_SOUR');
    expect(sour).toBeDefined();
    expect(sour!.stage).toBe('fermentation');
    expect(tea.blamedStage!.stage).toBe('fermentation');
    expect(tea.blamedStage!.reasons.join('')).toContain('酸');
  });

  it('烘干不足 -> 干度不足缺陷，归因到烘干工序', () => {
    const recipe = RECIPES.find((r) => r.teaClass === 'green')!;
    const ops = recipe.stages.map((s) =>
      s.kind === 'drying'
        ? { kind: s.kind, temp: 65, duration: 8 }
        : { kind: s.kind, temp: s.refTemp, duration: s.refDuration },
    );
    const result = processTea({ batch: makeBatch(), teaClass: 'green', operations: ops });
    const tea = evaluate(makeBatch(), result);

    const damp = result.defects.find((d) => d.code === 'D_DAMP');
    expect(damp).toBeDefined();
    expect(tea.blamedStage!.stage).toBe('drying');
    // 成品含水率确实超标
    expect(result.finalMoisture).toBeGreaterThan(0.08);
  });

  it('乌龙做青温度过高 -> 死青红变，归因到做青', () => {
    const recipe = RECIPES.find((r) => r.teaClass === 'oolong')!;
    const ops = recipe.stages.map((s) =>
      s.kind === 'qing'
        ? { kind: s.kind, temp: 39, duration: 900 }
        : { kind: s.kind, temp: s.refTemp, duration: s.refDuration },
    );
    const result = processTea({
      batch: makeBatch({ cultivarId: 'tieguanyin' }),
      teaClass: 'oolong',
      operations: ops,
    });
    const tea = evaluate(makeBatch({ cultivarId: 'tieguanyin' }), result);
    expect(tea.blamedStage!.stage).toBe('qing');
  });

  it('多工序出错时归因到扣分最重的工序', () => {
    const recipe = RECIPES.find((r) => r.teaClass === 'green')!;
    const ops = recipe.stages.map((s) => {
      if (s.kind === 'fixation') return { kind: s.kind, temp: 125, duration: 3 };
      if (s.kind === 'drying') return { kind: s.kind, temp: 135, duration: 45 };
      return { kind: s.kind, temp: s.refTemp, duration: s.refDuration };
    });
    const result = processTea({ batch: makeBatch(), teaClass: 'green', operations: ops });
    const tea = evaluate(makeBatch(), result);
    expect(result.defects.length).toBeGreaterThan(1);
    expect(tea.blamedStage).not.toBeNull();
    // blamedStage 的扣分应是所有工序里最高的
    const byStage = new Map<string, number>();
    for (const d of result.defects) {
      byStage.set(d.stage, (byStage.get(d.stage) ?? 0) + d.penalty);
    }
    const maxPenalty = Math.max(...byStage.values());
    const blamedSum = result.defects
      .filter((d) => d.stage === tea.blamedStage!.stage)
      .reduce((sum, d) => sum + d.penalty, 0);
    expect(blamedSum).toBeCloseTo(maxPenalty, 5);
  });
});
