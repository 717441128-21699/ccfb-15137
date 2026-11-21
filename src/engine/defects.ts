import type {
  CurvePoint,
  Defect,
  StageKind,
  StageOperation,
  StageRecipe,
} from './types';
import { clamp } from './rng';
import type { SimState } from './processing';

interface DefectRule {
  code: string;
  name: string;
  reason: string;
  test: (ctx: DefectContext) => number; // 返回严重度 0..1，0 = 不触发
}

interface DefectContext {
  kind: StageKind;
  op: StageOperation;
  recipe: StageRecipe;
  enter: SimState;
  exit: SimState;
  curve: CurvePoint[];
}

function severityOf(v: number): Defect['severity'] {
  if (v >= 0.66) return 'severe';
  if (v >= 0.33) return 'moderate';
  return 'slight';
}

function penaltyOf(v: number): number {
  return Math.round(clamp(v, 0.05, 1) * 12 * 10) / 10;
}

/** 温度相对参考值的偏离比例(正向超温) */
function overTemp(ctx: DefectContext, threshold: number): number {
  return clamp((ctx.op.temp - ctx.recipe.refTemp - threshold) / 30, 0, 1);
}

/** 时长相对参考值的偏离比例 */
function overTime(ctx: DefectContext, thresholdRatio: number): number {
  return clamp(
    (ctx.op.duration / ctx.recipe.refDuration - 1 - thresholdRatio) / 0.6,
    0,
    1,
  );
}

function underTime(ctx: DefectContext, thresholdRatio: number): number {
  return clamp(
    (1 - ctx.op.duration / ctx.recipe.refDuration - thresholdRatio) / 0.5,
    0,
    1,
  );
}

function underTemp(ctx: DefectContext, threshold: number): number {
  return clamp((ctx.recipe.refTemp - ctx.op.temp - threshold) / 40, 0, 1);
}

/** 各工序专属缺陷规则，全部带工序归因 */
const RULES: Record<StageKind, DefectRule[]> = {
  withering: [
    {
      code: 'W_RED',
      name: '红变暗条',
      reason: '萎凋堆叶过厚、温度偏高，叶片提前酶促氧化',
      test: (c) => (c.kind === 'withering' ? overTemp(c, 6) * (c.exit.oxidation > 0.16 ? 1 : 0.4) : 0),
    },
    {
      code: 'W_UNDER',
      name: '萎凋不足',
      reason: '萎凋时间过短，含水率偏高，后续揉捻易断碎、茶汤青涩',
      test: (c) => underTime(c, 0.25) * (c.exit.moisture > c.recipe.refExitMoisture + 0.06 ? 1 : 0.3),
    },
    {
      code: 'W_OVER',
      name: '萎凋过度',
      reason: '萎凋时间过长，叶片失水干瘪，香气低闷',
      test: (c) => overTime(c, 0.3) * (c.exit.moisture < c.recipe.refExitMoisture - 0.06 ? 1 : 0.3),
    },
  ],
  qing: [
    {
      code: 'Q_DEAD',
      name: '死青红变',
      reason: '做青温度过高、走水不畅，叶内酶促氧化失控',
      test: (c) => overTemp(c, 5) * (c.exit.oxidation > 0.42 ? 1 : 0.5),
    },
    {
      code: 'Q_LIGHT',
      name: '做青不足',
      reason: '摇青次数/时长不够，红镶边未形成，花香寡淡',
      test: (c) => underTime(c, 0.3) * (c.exit.oxidation < c.recipe.refExitOxidation - 0.1 ? 1 : 0.3),
    },
    {
      code: 'Q_EDGE',
      name: '焦边',
      reason: '做青环境温度过高且叶温偏干，叶缘受热损伤',
      test: (c) => clamp(c.exit.damage * 2.2, 0, 1),
    },
  ],
  fixation: [
    {
      code: 'F_BURNT',
      name: '焦边焦叶',
      reason: '杀青锅温过高、翻炒不匀，叶缘碳化产生焦味',
      test: (c) => clamp(c.exit.damage * 2 + overTemp(c, 25) * 0.6, 0, 1),
    },
    {
      code: 'F_RED_STEM',
      name: '红梗红叶',
      reason: '杀青温度不足或时间太短，酶未钝化，后续继续氧化发红',
      test: (c) => {
        // 以参考锅温/时长为基准: 温度越低、时间越短，酶残留风险越高
        const cold = clamp((c.recipe.refTemp - c.op.temp) / 55, 0, 1);
        const quick = clamp(1 - c.op.duration / c.recipe.refDuration, 0, 1);
        const enzymeLeft = clamp(c.exit.enzyme * 1.5, 0, 1);
        // 参数偏离与酶残留任一显著即成立，参考参数下三者都为 0
        return clamp(Math.max(cold, quick) * 0.75 + enzymeLeft * 0.5, 0, 1);
      },
    },
    {
      code: 'F_RAW',
      name: '生青气',
      reason: '杀青不透，青草气残留，茶汤青涩',
      test: (c) =>
        clamp(
          (c.exit.moisture > c.recipe.refExitMoisture + 0.08 ? 0.8 : 0) +
            underTime(c, 0.15) * 0.4,
          0,
          1,
        ),
    },
  ],
  rolling: [
    {
      code: 'R_BROKEN',
      name: '碎茶断条',
      reason: '揉捻时间过长、投叶偏干，条索断碎',
      test: (c) => overTime(c, 0.35) * (c.enter.moisture < 0.4 ? 1 : 0.4),
    },
    {
      code: 'R_STEWED',
      name: '闷熟味',
      reason: '揉捻温度过高、时间长，叶色泛黄产生闷熟气',
      test: (c) => overTemp(c, 8) * overTime(c, 0.15),
    },
    {
      code: 'R_LOOSE',
      name: '条索松泡',
      reason: '揉捻不足，茶汁未挤出，外形松泡不耐泡',
      test: (c) => underTime(c, 0.35),
    },
  ],
  fermentation: [
    {
      code: 'OX_LOW',
      name: '发酵不足',
      reason: '发酵温度低或时间短，氧化程度不够，叶色花杂、味青涩',
      test: (c) => {
        const gap = c.recipe.refExitOxidation - c.exit.oxidation;
        return clamp((gap - 0.08) / 0.25 + underTemp(c, -2) * 0.4, 0, 1);
      },
    },
    {
      code: 'OX_SOUR',
      name: '酸馊味',
      reason: '发酵堆温过高、湿热闷积，有益酶受抑制并产生酸败',
      test: (c) => clamp(overTemp(c, 6) + overTime(c, 0.3) * 0.5, 0, 1),
    },
    {
      code: 'OX_DULL',
      name: '乌暗发闷',
      reason: '发酵过度，茶黄素进一步聚合，汤色暗钝鲜爽度下降',
      test: (c) => {
        const over = c.exit.oxidation - c.recipe.refExitOxidation;
        return clamp((over - 0.08) / 0.18 + overTime(c, 0.25) * 0.3, 0, 1);
      },
    },
  ],
  yellowing: [
    {
      code: 'Y_LIGHT',
      name: '黄变不足',
      reason: '闷黄温湿度或时间不够，黄汤黄叶特征不明显',
      test: (c) =>
        clamp(
          (c.recipe.refExitOxidation - c.exit.oxidation > 0.05 ? 0.7 : 0) +
            underTime(c, 0.3) * 0.5,
          0,
          1,
        ),
    },
    {
      code: 'Y_DARK',
      name: '黄暗',
      reason: '闷黄过久、温湿过高，色泽黄暗欠鲜亮',
      test: (c) => overTime(c, 0.3) * (overTemp(c, 6) + 0.4),
    },
  ],
  piling: [
    {
      code: 'P_BURNT',
      name: '烧堆酸味',
      reason: '渥堆堆温过高未及时翻堆，微生物活动失控产酸',
      test: (c) => overTemp(c, 6) * (overTime(c, 0.15) + 0.3),
    },
    {
      code: 'P_LIGHT',
      name: '渥堆不足',
      reason: '渥堆时间短、氧化程度低，陈香未形成、汤色不红浓',
      test: (c) => {
        const gap = c.recipe.refExitOxidation - c.exit.oxidation;
        return clamp((gap - 0.2) / 0.22 + underTime(c, 0.3) * 0.4, 0, 1);
      },
    },
    {
      code: 'P_MUSTY',
      name: '霉怪味',
      reason: '渥堆湿度过大、通风差，杂霉滋生',
      test: (c) => (c.exit.moisture > 0.36 ? overTime(c, 0.2) : 0),
    },
  ],
  drying: [
    {
      code: 'D_BURNT',
      name: '高火焦味',
      reason: '烘干温度过高，糖类焦化，香气带焦烟火气',
      test: (c) => clamp(overTemp(c, 15) + c.exit.damage * 2, 0, 1),
    },
    {
      code: 'D_DAMP',
      name: '干度不足',
      reason: '烘干时间短或温度低，成品含水率超标，易返潮霉变',
      test: (c) =>
        clamp((c.exit.moisture - (c.recipe.refExitMoisture + 0.025)) / 0.06 + underTime(c, 0.25), 0, 1),
    },
    {
      code: 'D_FIRE',
      name: '火功过猛',
      reason: '长时间高温慢烘，内质熟化过度，香低味淡',
      test: (c) => overTemp(c, 8) * overTime(c, 0.2),
    },
  ],
};

export function detectStageDefects(
  kind: StageKind,
  op: StageOperation,
  recipe: StageRecipe,
  enter: SimState,
  exit: SimState,
  curve: CurvePoint[],
): Defect[] {
  const ctx: DefectContext = { kind, op, recipe, enter, exit, curve };
  const out: Defect[] = [];
  for (const rule of RULES[kind]) {
    const v = rule.test(ctx);
    if (v > 0.08) {
      out.push({
        stage: kind,
        code: rule.code,
        name: rule.name,
        severity: severityOf(v),
        penalty: penaltyOf(v),
        reason: rule.reason,
      });
    }
  }
  return out;
}
