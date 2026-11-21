/**
 * 氧化系数自动标定: 对每道含氧化的工序二分 K_OX，
 * 使参考参数下出口氧化程度命中 refExitOxidation。
 */
import { RECIPES } from '../src/engine/data/recipes';
import { initialState, tempOxGate, moistureGate } from '../src/engine/processing';
import type { SimState } from '../src/engine/processing';
import type { StageKind } from '../src/engine/types';
import { clamp } from '../src/engine/rng';

const MICROBIAL = new Set(['yellowing', 'piling']);

function runOx(
  kind: StageKind,
  k: number,
  temp: number,
  minutes: number,
  enter: SimState,
  enzymeKills: boolean,
): number {
  const st = { ...enter };
  for (let t = 0; t < minutes; t++) {
    if (enzymeKills && temp > 58) {
      st.enzyme *= Math.exp(-(temp - 58) / 9);
      if (st.enzyme < 0.001) st.enzyme = 0;
    }
    const tGate = tempOxGate(temp);
    const mGate = moistureGate(st.moisture);
    const rate = MICROBIAL.has(kind)
      ? k * (0.55 + 0.45 * mGate) * tGate
      : st.enzyme * k * mGate * tGate;
    st.oxidation = clamp(st.oxidation + rate, 0, 0.98);
  }
  return st.oxidation;
}

const suggested = new Map<StageKind, number[]>();

for (const recipe of RECIPES) {
  const state = initialState(0.78);
  console.log(`\n=== ${recipe.teaName} ===`);
  for (const sr of recipe.stages) {
    // 用参考表含水率串联(标定氧化时忽略脱水耦合的微小偏差)
    state.moisture = sr === recipe.stages[0] ? state.moisture : recipe.stages[recipe.stages.indexOf(sr) - 1].refExitMoisture;
    const target = sr.refExitOxidation;
    let lo = 0;
    let hi = 0.05;
    let k = 0;
    for (let i = 0; i < 60; i++) {
      k = (lo + hi) / 2;
      const ox = runOx(sr.kind, k, sr.refTemp, sr.refDuration, state, sr.kind === 'fixation' || sr.kind === 'drying');
      if (ox < target) lo = k;
      else hi = k;
    }
    const got = runOx(sr.kind, k, sr.refTemp, sr.refDuration, state, sr.kind === 'fixation' || sr.kind === 'drying');
    if (k > 1e-7) {
      const arr = suggested.get(sr.kind) ?? [];
      arr.push(k);
      suggested.set(sr.kind, arr);
    }
    console.log(
      sr.name.padEnd(10),
      `K_OX=${k.toFixed(7)}`,
      `OX ${(got * 100).toFixed(1)}% / 表 ${(target * 100).toFixed(0)}%`,
    );
    state.oxidation = target;
    state.enzyme = sr.kind === 'fixation' ? 0 : state.enzyme;
  }
}

console.log('\n=== 建议 K_OX ===');
for (const [kind, arr] of suggested) {
  console.log(`${kind}: ${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(7)}, // n=${arr.length} 各值: ${arr.map((x) => x.toFixed(6)).join(', ')}`);
}
