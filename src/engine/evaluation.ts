import type {
  FinishedTea,
  FreshLeafBatch,
  ProcessingResult,
  StageKind,
  TeaScore,
} from './types';
import { getCultivar } from './data/cultivars';
import { getRecipe } from './processing';
import { clamp } from './rng';

/**
 * 评茶师打分: 外形 25% / 汤色 25% / 香气 25% / 滋味 25%，
 * 满分 100。鲜叶原料决定上限，工艺缺陷按工序归因扣分。
 */
export function evaluate(
  batch: FreshLeafBatch,
  result: ProcessingResult,
): FinishedTea {
  const recipe = getRecipe(result.teaClass);
  const cultivar = getCultivar(batch.cultivarId);
  const craftBonus = cultivar.craftBonus[result.teaClass] ?? 0;
  // 标定: 优质鲜叶(80+)零缺陷可达特级(85+)，普通鲜叶(70+)零缺陷约一级(78+)
  const base = batch.quality * 0.9 + craftBonus + 5;

  // 终态偏离目标(含水率/氧化)
  const moistureMiss =
    Math.abs(result.finalMoisture - recipe.targetFinalMoisture) * 220;
  const oxidationMiss =
    Math.abs(result.finalOxidation - recipe.targetFinalOxidation) * 42;

  const penalties = {
    appearance: 0,
    liquor: 0,
    aroma: 0,
    taste: 0,
  };

  // 缺陷到审评维度的映射
  for (const d of result.defects) {
    const p = d.penalty;
    switch (d.code) {
      case 'F_BURNT':
      case 'Q_EDGE':
        penalties.appearance += p * 1.2;
        penalties.aroma += p * 0.8;
        break;
      case 'F_RED_STEM':
      case 'Q_DEAD':
        penalties.liquor += p * 1.1;
        penalties.appearance += p * 0.7;
        break;
      case 'F_RAW':
      case 'W_UNDER':
        penalties.taste += p;
        penalties.aroma += p * 0.6;
        break;
      case 'R_BROKEN':
      case 'R_LOOSE':
        penalties.appearance += p * 1.3;
        break;
      case 'R_STEWED':
        penalties.aroma += p;
        penalties.liquor += p * 0.6;
        break;
      case 'OX_LOW':
      case 'Q_LIGHT':
        penalties.liquor += p * 0.8;
        penalties.taste += p * 0.8;
        break;
      case 'OX_SOUR':
      case 'P_BURNT':
      case 'P_MUSTY':
        penalties.taste += p * 1.4;
        penalties.aroma += p;
        break;
      case 'OX_DULL':
        penalties.liquor += p * 1.2;
        break;
      case 'D_BURNT':
      case 'D_FIRE':
        penalties.aroma += p * 1.3;
        penalties.taste += p * 0.6;
        break;
      case 'D_DAMP':
        penalties.appearance += p * 0.5;
        penalties.taste += p * 0.8;
        break;
      case 'W_RED':
      case 'W_OVER':
      case 'Y_DARK':
        penalties.liquor += p;
        penalties.aroma += p * 0.7;
        break;
      case 'Y_LIGHT':
      case 'P_LIGHT':
        penalties.liquor += p * 0.9;
        penalties.aroma += p * 0.5;
        break;
      default:
        penalties.taste += p * 0.5;
    }
  }

  const dim = (raw: number, extra: number): number =>
    Math.round(clamp(raw - extra, 30, 99) * 10) / 10;

  const appearance = dim(base + 3, penalties.appearance + moistureMiss * 0.25);
  const liquor = dim(
    base + 1,
    penalties.liquor + oxidationMiss * 0.5 + moistureMiss * 0.15,
  );
  const aroma = dim(base + 2, penalties.aroma + moistureMiss * 0.2);
  const taste = dim(
    base,
    penalties.taste + oxidationMiss * 0.4 + moistureMiss * 0.3,
  );
  // 四维各为百分制，等权平均即总分(满分 100)
  const total =
    Math.round(((appearance + liquor + aroma + taste) / 4) * 10) / 10;

  const score: TeaScore = {
    appearance,
    liquor,
    aroma,
    taste,
    total,
    grade: gradeOf(total),
  };

  return {
    id: `TEA-${batch.id}-${result.teaClass}`,
    batchId: batch.id,
    teaClass: result.teaClass,
    teaName: result.teaName,
    cultivarId: batch.cultivarId,
    plotId: batch.plotId,
    weightKg: Math.round(batch.weightKg * 0.24 * 10) / 10, // 制茶折干率约 4:1
    moisture: result.finalMoisture,
    oxidation: result.finalOxidation,
    score,
    defects: result.defects,
    blamedStage: blameStage(result),
    curve: result.curve,
    referenceCurve: result.referenceCurve,
    stageSummary: result.stages.map((s) => ({
      kind: s.kind,
      name: s.name,
      temp: s.temp,
      duration: s.duration,
      refTemp: recipe.stages.find((r) => r.kind === s.kind)!.refTemp,
      refDuration: recipe.stages.find((r) => r.kind === s.kind)!.refDuration,
      maxCurveDeviationPct: s.maxCurveDeviationPct,
    })),
    createdAt: Date.now(),
  };
}

function gradeOf(total: number): string {
  if (total >= 92) return '极品';
  if (total >= 85) return '特级';
  if (total >= 78) return '一级';
  if (total >= 70) return '二级';
  if (total >= 60) return '三级';
  return '等外';
}

/**
 * 工序归因: 找出扣分最多的工序，并附上该工序全部缺陷的原因。
 * 做坏的批次在评茶页直接展示"问题出在哪道工序、为什么"。
 */
export function blameStage(result: ProcessingResult): {
  stage: StageKind;
  name: string;
  reasons: string[];
} | null {
  if (result.defects.length === 0) return null;
  const tally = new Map<StageKind, { name: string; penalty: number; reasons: string[] }>();
  for (const d of result.defects) {
    const cur =
      tally.get(d.stage) ?? { name: stageName(result, d.stage), penalty: 0, reasons: [] };
    cur.penalty += d.penalty;
    cur.reasons.push(`${d.name}：${d.reason}`);
    tally.set(d.stage, cur);
  }
  let worst: { stage: StageKind; name: string; reasons: string[]; penalty: number } | null =
    null;
  for (const [stage, v] of tally) {
    if (!worst || v.penalty > worst.penalty) {
      worst = { stage, ...v };
    }
  }
  if (!worst) return null;
  return { stage: worst.stage, name: worst.name, reasons: worst.reasons };
}

function stageName(result: ProcessingResult, kind: StageKind): string {
  const found = result.stages.find((s) => s.kind === kind);
  return found?.name ?? kind;
}
