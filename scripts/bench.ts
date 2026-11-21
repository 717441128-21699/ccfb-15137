/** 性能基准: 100 块茶园整季结算，多种子测量，对照 1 秒硬指标 */
import { generateClimate } from '../src/engine/climate';
import { generateGardens } from '../src/engine/garden';
import { simulateSeason } from '../src/engine/growth';
import { processTea } from '../src/engine/processing';
import { RECIPES } from '../src/engine/data/recipes';
import type { FreshLeafBatch } from '../src/engine/types';

const batch: FreshLeafBatch = {
  id: 'BENCH', plotId: 1, cultivarId: 'longjing43', pickedDay: 20,
  weightKg: 20, quality: 80, standard: '一芽一叶', initialMoisture: 0.78, pickedAt: 0,
};

console.log('=== 100 地块 × 60 天整季生长结算 ===');
const times: number[] = [];
for (const seed of [1, 42, 20260301, 777, 99999]) {
  const weather = generateClimate(seed, 60);
  const plots = generateGardens(seed, 100);
  const t0 = performance.now();
  const results = simulateSeason(plots, weather);
  const ms = performance.now() - t0;
  times.push(ms);
  const matured = results.filter((r) => r.advice.windowStart < 59).length;
  console.log(`seed ${String(seed).padStart(8)}: ${ms.toFixed(2)} ms, 季内成熟 ${matured}/100`);
}
console.log(`平均 ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)} ms，最大 ${Math.max(...times).toFixed(2)} ms (限额 1000ms)`);

console.log('\n=== 六大茶类制茶模拟耗时 ===');
for (const recipe of RECIPES) {
  const t0 = performance.now();
  const r = processTea({
    batch,
    teaClass: recipe.teaClass,
    operations: recipe.stages.map((s) => ({ kind: s.kind, temp: s.refTemp, duration: s.refDuration })),
  });
  const ms = performance.now() - t0;
  console.log(
    `${recipe.teaName.padEnd(8)} ${ms.toFixed(2)} ms, 曲线点 ${r.curve.length}, 最大偏差 ${r.maxCurveDeviationPct}pp`,
  );
}
