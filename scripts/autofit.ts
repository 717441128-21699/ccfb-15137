/**
 * 全自动标定: 对每个 (茶类, 工序) 搜索 (k, 形态指数 e)，
 * 使物理模拟的分钟级含水率曲线与参考工艺表的解析曲线最大偏差最小。
 * 输出可直接粘贴的 K_DRY_TABLE 与每道工序的形态指数。
 */
import { RECIPES } from '../src/engine/data/recipes';
import { initialState, tempDryFactor } from '../src/engine/processing';
import type { SimState } from '../src/engine/processing';
import type { StageKind } from '../src/engine/types';
import { clamp } from '../src/engine/rng';

function simCurve(
  k: number,
  e: number,
  temp: number,
  minutes: number,
  enterM: number,
  exitM: number,
): { actual: number[]; ref: number[]; maxDev: number } {
  const st = { moisture: enterM } as SimState;
  const f = tempDryFactor(temp);
  const actual: number[] = [];
  const ref: number[] = [];
  let maxDev = 0;
  for (let t = 1; t <= minutes; t++) {
    const dm = k * f * (0.82 + 0.18 * st.moisture);
    st.moisture = clamp(st.moisture - dm, 0.02, 0.95);
    const p = t / minutes;
    const rm = enterM - (enterM - exitM) * Math.pow(p, e);
    actual.push(st.moisture);
    ref.push(rm);
    maxDev = Math.max(maxDev, Math.abs(st.moisture - rm) * 100);
  }
  return { actual, ref, maxDev };
}

function fitOne(
  temp: number,
  minutes: number,
  enterM: number,
  exitM: number,
): { k: number; e: number; dev: number } {
  let best = { k: 0.001, e: 0.82, dev: Infinity };
  // 外层搜形态指数，内层二分 k 命中端点
  for (let e = 0.2; e <= 1.4; e += 0.02) {
    let lo = 1e-6;
    let hi = 0.1;
    let k = hi;
    for (let i = 0; i < 50; i++) {
      k = (lo + hi) / 2;
      const f = tempDryFactor(temp);
      const st = { moisture: enterM };
      for (let t = 0; t < minutes; t++) {
        const dm = k * f * (0.82 + 0.18 * st.moisture);
        st.moisture = clamp(st.moisture - dm, 0.02, 0.95);
      }
      if (st.moisture > exitM) lo = k;
      else hi = k;
    }
    const { maxDev } = simCurve(k, e, temp, minutes, enterM, exitM);
    if (maxDev < best.dev) best = { k, e, dev: maxDev };
  }
  return best;
}

const table: Array<{
  teaClass: string;
  kind: StageKind;
  minutes: number;
  k: number;
  e: number;
  dev: number;
}> = [];

for (const recipe of RECIPES) {
  const state = initialState(0.78);
  for (const sr of recipe.stages) {
    const fit = fitOne(
      sr.refTemp,
      sr.refDuration,
      state.moisture,
      sr.refExitMoisture,
    );
    table.push({
      teaClass: recipe.teaClass,
      kind: sr.kind,
      minutes: sr.refDuration,
      k: fit.k,
      e: fit.e,
      dev: fit.dev,
    });
    state.moisture = sr.refExitMoisture;
  }
}

for (const r of table) {
  console.log(
    `${r.teaClass.padEnd(7)} ${r.kind.padEnd(12)} ${String(r.minutes).padStart(5)}分`,
    `k=${r.k.toFixed(6)} e=${r.e.toFixed(2)} 最大偏差=${r.dev.toFixed(2)}pp`,
  );
}

console.log('\n=== 按 (kind, 时长) 合并建议 ===');
const groups = new Map<string, typeof table>();
for (const r of table) {
  const key = r.kind;
  const arr = groups.get(key) ?? [];
  arr.push(r);
  groups.set(key, arr);
}
for (const [kind, arr] of groups) {
  console.log(`\n${kind}:`);
  for (const r of arr) {
    console.log(
      `  ${String(r.minutes).padStart(5)}分 -> k=${r.k.toFixed(6)}, e=${r.e.toFixed(2)}, dev=${r.dev.toFixed(2)}pp`,
    );
  }
}
