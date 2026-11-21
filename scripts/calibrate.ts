/**
 * 标定脚本: npx tsx scripts/calibrate.ts (或用 vitest 临时跑)
 * 输出每道工序参考参数下的实际出口状态 vs 参考表，以及曲线最大偏差。
 */
import { RECIPES } from '../src/engine/data/recipes';
import {
  initialState,
  processTea,
  referenceCurve,
  simulateStage,
} from '../src/engine/processing';
import type { FreshLeafBatch } from '../src/engine/types';

const batch: FreshLeafBatch = {
  id: 'CAL',
  plotId: 1,
  cultivarId: 'longjing43',
  pickedDay: 20,
  weightKg: 20,
  quality: 80,
  standard: '一芽一叶',
  initialMoisture: 0.78,
  pickedAt: 0,
};

for (const recipe of RECIPES) {
  console.log(`\n=== ${recipe.teaName} ===`);
  const state = initialState(0.78);
  let refOx = state.oxidation;
  for (const sr of recipe.stages) {
    const op = { kind: sr.kind, temp: sr.refTemp, duration: sr.refDuration };
    const enter = { ...state };
    const { state: exit, curve } = simulateStage(sr.kind, op, enter, sr);
    const ref = referenceCurve(sr, enter, refOx);
    let maxDev = 0;
    for (let i = 0; i < curve.length; i++) {
      maxDev = Math.max(maxDev, Math.abs(curve[i].moisture - ref[i].moisture) * 100);
    }
    console.log(
      sr.name.padEnd(10),
      `M: ${(enter.moisture * 100).toFixed(1)}% -> ${(exit.moisture * 100).toFixed(1)}%`,
      `(表 ${(sr.refExitMoisture * 100).toFixed(1)}%)`,
      `OX: ${(exit.oxidation * 100).toFixed(1)}%`,
      `(表 ${(sr.refExitOxidation * 100).toFixed(1)}%)`,
      `酶: ${exit.enzyme.toFixed(3)}`,
      `曲线偏差: ${maxDev.toFixed(2)}pp`,
    );
    state.moisture = exit.moisture;
    state.oxidation = exit.oxidation;
    state.enzyme = exit.enzyme;
    state.damage = exit.damage;
    refOx = sr.refExitOxidation;
  }
  const result = processTea({
    batch,
    teaClass: recipe.teaClass,
    operations: recipe.stages.map((s) => ({
      kind: s.kind,
      temp: s.refTemp,
      duration: s.refDuration,
    })),
  });
  console.log(
    '成品:',
      `M ${(result.finalMoisture * 100).toFixed(1)}% (目标 ${recipe.targetFinalMoisture * 100}%)`,
      `OX ${(result.finalOxidation * 100).toFixed(1)}% (目标 ${recipe.targetFinalOxidation * 100}%)`,
      `全程最大偏差 ${result.maxCurveDeviationPct}pp`,
      `缺陷 ${result.defects.length}`,
  );
}
