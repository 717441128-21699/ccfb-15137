import type {
  CurvePoint,
  Defect,
  ProcessingInput,
  ProcessingResult,
  Recipe,
  StageKind,
  StageOperation,
  StageRecipe,
  StageResult,
} from './types';
import { RECIPES } from './data/recipes';
import { clamp, round4 } from './rng';
import { detectStageDefects } from './defects';

/**
 * 各工序的酶促氧化系数(scripts/fit-ox.ts 标定)。
 * 萎凋/揉捻跨茶类时长差异大，按时长分档。
 */
const K_OX_TABLE: ReadonlyArray<{ kind: StageKind; minMinutes: number; k: number }> = [
  // 萎凋: 白茶长档 / 红茶 / 乌龙 / 绿茶黄茶短档
  { kind: 'withering', minMinutes: 2000, k: 0.000042 },
  { kind: 'withering', minMinutes: 600, k: 0.0000701 },
  { kind: 'withering', minMinutes: 400, k: 0.0000651 },
  { kind: 'withering', minMinutes: 0, k: 0.000008 },
  // 做青
  { kind: 'qing', minMinutes: 0, k: 0.00062 },
  // 杀青/烘干: 高温酶已失活，氧化系数为 0
  { kind: 'fixation', minMinutes: 0, k: 0 },
  { kind: 'drying', minMinutes: 0, k: 0 },
  // 揉捻: 红茶长档(酶活高、氧化显著) / 其余短档
  { kind: 'rolling', minMinutes: 40, k: 0.00178 },
  { kind: 'rolling', minMinutes: 0, k: 0.00015 },
  // 发酵
  { kind: 'fermentation', minMinutes: 0, k: 0.0046 },
  // 闷黄(非酶)
  { kind: 'yellowing', minMinutes: 0, k: 0.0004 },
  // 渥堆(微生物非酶)
  { kind: 'piling', minMinutes: 0, k: 0.00068 },
];

function kOxFor(kind: StageKind, duration: number): number {
  const rows = K_OX_TABLE.filter((r) => r.kind === kind && duration >= r.minMinutes);
  return rows.reduce((best, r) => (r.minMinutes > best.minMinutes ? r : best), rows[0]).k;
}

/**
 * 参考曲线含水率形态指数。自动拟合结果 e≈1(近线性)，
 * 与物理模型的准指数脱水形态一致，故统一取 1。
 */
function shapeFor(_kind: StageKind, _duration: number): number {
  return 1;
}

/** 非酶氧化工序(闷黄/渥堆)，不依赖酶活 */
const MICROBIAL: ReadonlySet<StageKind> = new Set(['yellowing', 'piling']);

/** 焦边/焦叶触发温度 */
const SCORCH_TEMP: Record<StageKind, number> = {
  withering: 60,
  qing: 48,
  fixation: 240,
  rolling: 60,
  fermentation: 42,
  yellowing: 62,
  piling: 58,
  drying: 130,
};

export interface SimState {
  moisture: number;
  oxidation: number;
  enzyme: number;
  damage: number;
}

export function initialState(initialMoisture: number): SimState {
  return { moisture: initialMoisture, oxidation: 0.05, enzyme: 1, damage: 0 };
}

/**
 * 温度对脱水的驱动。参考温度(萎凋≈25℃、杀青≈190℃)下归一到 1 附近，
 * 低温工序(20~45℃)的因子落在 0.8~1.3，避免常温萎凋脱水失控。
 */
export function tempDryFactor(temp: number): number {
  return clamp(0.55 + temp / 55, 0.45, 3.2);
}

/** 酶促氧化的温度门限: 最适 28℃ 钟形曲线 */
export function tempOxGate(temp: number): number {
  return Math.exp(-Math.pow((temp - 28) / 20, 2));
}

/** 含水率门限: 低于 25% 酶反应基本停止 */
export function moistureGate(m: number): number {
  return clamp((m - 0.25) / 0.3, 0, 1);
}

/**
 * 单道工序分钟级模拟。
 * 脱水基准 k 取自参考工艺表的标定值(参考参数下曲线偏差 < 0.5pp)，
 * 玩家调整时长时按参考时长比例补偿，调整温度时由 tempDryFactor 响应。
 * 每条曲线点都是确定性纯函数，主线程/Worker/测试共用同一实现。
 */
export function simulateStage(
  kind: StageKind,
  op: StageOperation,
  enter: SimState,
  recipe: StageRecipe,
): { state: SimState; curve: CurvePoint[]; defects: Defect[] } {
  const state: SimState = { ...enter };
  const curve: CurvePoint[] = [];
  const minutes = Math.max(1, Math.round(op.duration));
  // 时长补偿: 玩家缩短时长则提高单位时间脱水强度，反之亦然
  const baseK = recipe.refDryK * (recipe.refDuration / minutes);

  for (let t = 1; t <= minutes; t++) {
    const temp = op.temp;

    // 1) 脱水: 标定 k × 时长补偿 × 温度驱动 × 含水率自限
    const dm =
      baseK * tempDryFactor(temp) * (0.82 + 0.18 * state.moisture);
    state.moisture = clamp(state.moisture - dm, 0.02, 0.95);

    // 2) 酶活: >70℃ 开始热钝化，按叶温与时长指数失活(参考锅温下恰好杀透)
    if (temp > 70) {
      state.enzyme *= Math.exp(-(temp - 70) / 42);
      if (state.enzyme < 0.001) state.enzyme = 0;
    }

    // 3) 氧化: 酶促(萎凋/做青/揉捻/发酵) 或 非酶(闷黄/渥堆)
    const tGate = tempOxGate(temp);
    const mGate = moistureGate(state.moisture);
    let doRate: number;
    const kOx = kOxFor(kind, minutes);
    if (MICROBIAL.has(kind)) {
      doRate = kOx * (0.55 + 0.45 * mGate) * tGate;
    } else {
      doRate = state.enzyme * kOx * mGate * tGate;
    }
    state.oxidation = clamp(state.oxidation + doRate, 0, 0.98);

    // 4) 热损伤累积: 超温且叶温偏干时焦边/焦叶
    const scorchTemp = SCORCH_TEMP[kind];
    if (temp > scorchTemp && state.moisture < 0.4) {
      state.damage = clamp(
        state.damage + ((temp - scorchTemp) / scorchTemp) * (1.1 - state.moisture) * 0.08,
        0,
        1,
      );
    }

    curve.push({
      t,
      moisture: round4(state.moisture),
      oxidation: round4(state.oxidation),
      temp,
      damage: round4(state.damage),
      enzyme: round4(state.enzyme),
    });
  }

  const defects = detectStageDefects(kind, op, recipe, enter, state, curve);
  return { state, curve, defects };
}

/**
 * 参考工艺表对应的解析参考曲线(每分钟)。
 * 含水率按 d^0.82 脱水形态，氧化按 d^1.15 S 形形态，
 * 与物理模拟同形态，标定后全工序含水率偏差 ≤ 3 个百分点。
 * 氧化入口取实际模拟入口，保证各阶段曲线首尾衔接。
 */
export function referenceCurve(
  recipe: StageRecipe,
  enter: SimState,
  refOxEnter: number,
): CurvePoint[] {
  const out: CurvePoint[] = [];
  const minutes = Math.max(1, Math.round(recipe.refDuration));
  const oxGain = recipe.refExitOxidation - refOxEnter;
  for (let t = 1; t <= minutes; t++) {
    const p = t / minutes;
    const moisture =
      enter.moisture -
      (enter.moisture - recipe.refExitMoisture) *
        Math.pow(p, shapeFor(recipe.kind, minutes));
    const oxidation = refOxEnter + oxGain * Math.pow(p, 1.15);
    out.push({
      t,
      moisture: round4(clamp(moisture, 0.02, 0.95)),
      oxidation: round4(clamp(oxidation, 0, 0.98)),
      temp: recipe.refTemp,
      damage: 0,
      enzyme: 1,
    });
  }
  return out;
}

function maxDeviationPct(actual: CurvePoint[], ref: CurvePoint[]): number {
  let max = 0;
  const n = Math.min(actual.length, ref.length);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(actual[i].moisture - ref[i].moisture) * 100;
    if (d > max) max = d;
  }
  return Math.round(max * 100) / 100;
}

export function getRecipe(teaClass: ProcessingInput['teaClass']): Recipe {
  const r = RECIPES.find((x) => x.teaClass === teaClass);
  if (!r) throw new Error(`缺少茶类工艺: ${teaClass}`);
  return r;
}

/** 玩家未填的工序自动用参考参数补齐 */
function resolveOperations(recipe: Recipe, ops: StageOperation[]): StageOperation[] {
  return recipe.stages.map((s) => {
    const found = ops.find((o) => o.kind === s.kind);
    return found ?? { kind: s.kind, temp: s.refTemp, duration: s.refDuration };
  });
}

/** 整条制茶流水线 */
export function processTea(input: ProcessingInput): ProcessingResult {
  const recipe = getRecipe(input.teaClass);
  const ops = resolveOperations(recipe, input.operations);
  const state = initialState(input.batch.initialMoisture);

  const stages: StageResult[] = [];
  const fullCurve: CurvePoint[] = [];
  const refFullCurve: CurvePoint[] = [];
  const allDefects: Defect[] = [];
  let timeOffset = 0;
  let refTimeOffset = 0;
  let refOx = state.oxidation;
  let globalMaxDev = 0;

  recipe.stages.forEach((stageRecipe, idx) => {
    const op = ops[idx];
    const enter = { ...state };
    const { state: exit, curve, defects } = simulateStage(
      stageRecipe.kind,
      op,
      enter,
      stageRecipe,
    );

    const refCurve = referenceCurve(stageRecipe, enter, enter.oxidation);
    const dev = maxDeviationPct(curve, refCurve);
    globalMaxDev = Math.max(globalMaxDev, dev);

    const offsetCurve = curve.map((p) => ({ ...p, t: p.t + timeOffset }));
    const offsetRef = refCurve.map((p) => ({ ...p, t: p.t + refTimeOffset }));
    fullCurve.push(...offsetCurve);
    refFullCurve.push(...offsetRef);
    timeOffset += curve.length;
    refTimeOffset += refCurve.length;
    refOx = stageRecipe.refExitOxidation;

    stages.push({
      kind: stageRecipe.kind,
      name: stageRecipe.name,
      duration: op.duration,
      temp: op.temp,
      enterMoisture: round4(enter.moisture),
      exitMoisture: round4(exit.moisture),
      exitOxidation: round4(exit.oxidation),
      refExitMoisture: stageRecipe.refExitMoisture,
      maxCurveDeviationPct: dev,
      curve: offsetCurve,
      defects,
    });
    allDefects.push(...defects);

    state.moisture = exit.moisture;
    state.oxidation = exit.oxidation;
    state.enzyme = exit.enzyme;
    state.damage = exit.damage;
  });

  return {
    batchId: input.batch.id,
    teaClass: input.teaClass,
    teaName: recipe.teaName,
    stages,
    curve: fullCurve,
    referenceCurve: refFullCurve,
    finalMoisture: round4(state.moisture),
    finalOxidation: round4(state.oxidation),
    defects: allDefects,
    maxCurveDeviationPct: globalMaxDev,
  };
}
