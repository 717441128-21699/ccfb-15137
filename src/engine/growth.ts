import type {
  DayWeather,
  FreshLeafBatch,
  GardenDayState,
  GardenPlot,
  GardenSeasonResult,
  GrowthStage,
  PickingAdvice,
} from './types';
import { getCultivar } from './data/cultivars';
import { aspectSunFactor } from './garden';
import { clamp, mulberry32, round2 } from './rng';

/** 海拔每升高 100m 的气温直减率 ℃ */
const LAPSE_RATE_PER_100M = 0.55;

export interface PlotDailyWeather extends DayWeather {
  /** 该地块海拔修正后的日均温 */
  plotAvgTemp: number;
  plotMaxTemp: number;
  plotMinTemp: number;
  effectiveSun: number;
}

/** 把区域天气换算成某块茶园的微气候 */
export function toPlotWeather(plot: GardenPlot, w: DayWeather): PlotDailyWeather {
  const drop = (plot.altitude / 100) * LAPSE_RATE_PER_100M;
  const sunFactor = aspectSunFactor(plot.aspect) * (1 - plot.slope / 120);
  return {
    ...w,
    plotAvgTemp: round2(w.avgTemp - drop),
    plotMaxTemp: round2(w.maxTemp - drop),
    plotMinTemp: round2(w.minTemp - drop),
    effectiveSun: round2(w.sunHours * sunFactor),
  };
}

/**
 * 单块茶园一整季的日结算。
 * 状态量: 有效积温 GDD、土壤水分、物候期、胁迫计数。
 * 全部为 O(days) 的标量运算，100 块地 × 60 天约 6000 步。
 */
export function simulatePlot(
  plot: GardenPlot,
  weather: DayWeather[],
): GardenSeasonResult {
  const cultivar = getCultivar(plot.cultivarId);
  const daily: GardenDayState[] = [];
  let gdd = 0;
  let soilWater = 0.55;
  let stressDays = 0;
  let matureDay = -1;

  for (const w of weather) {
    const pw = toPlotWeather(plot, w);
    const stress = { drought: false, heat: false, waterlogged: false, frost: false };

    // --- 土壤水分平衡: 降水/雾补给，蒸发与坡度排水消耗 ---
    const evap =
      0.045 *
      (pw.effectiveSun / 8) *
      clamp(pw.plotAvgTemp / 20, 0.2, 1.6);
    const rainIn = clamp(pw.rainMm / 40, 0, 0.6) * (0.55 + plot.soilRetention * 0.5);
    const fogIn = w.type === 'fog' ? 0.05 * plot.mistFactor : 0;
    const runoff = (plot.slope / 45) * 0.1 * (1 - plot.soilRetention);
    soilWater = clamp(soilWater + rainIn + fogIn - evap - runoff, 0.08, 1);

    if (soilWater < 0.22) stress.drought = true;
    if (soilWater > 0.92 && pw.rainMm > 12) stress.waterlogged = true;
    if (pw.plotMaxTemp >= 32) stress.heat = true;
    if (pw.plotMinTemp <= 0) stress.frost = true;

    // --- 有效积温(基准 10℃)，受水分胁迫与光照约束 ---
    const baseGdd = Math.max(0, pw.plotAvgTemp - 10);
    let waterFactor = 1;
    if (stress.drought) waterFactor = 0.35 + plot.soilRetention * 0.3;
    else if (soilWater < 0.35) waterFactor = 0.7;
    if (stress.waterlogged) waterFactor *= 0.75;
    const lightFactor = 0.72 + 0.28 * clamp(pw.effectiveSun / 8, 0, 1);
    const frostPenalty = stress.frost ? 0.25 : 1;
    gdd += baseGdd * cultivar.gddFactor * waterFactor * lightFactor * frostPenalty;
    if (stress.drought || stress.heat || stress.waterlogged || stress.frost) {
      stressDays++;
    }

    // --- 物候期 ---
    const ratio = gdd / cultivar.gddNeed;
    let stage: GrowthStage;
    if (ratio < 0.32) stage = 'dormant';
    else if (ratio < 0.72) stage = 'bud';
    else if (ratio < 1) stage = 'flush';
    else stage = 'mature';
    if (stage === 'mature' && matureDay < 0) matureDay = w.day;

    daily.push({
      day: w.day,
      gdd: round2(gdd),
      stage,
      soilWater: round2(soilWater),
      stress,
      stressDays,
    });
  }

  const advice = buildAdvice(plot, daily, matureDay);
  return { plot, daily, advice };
}

function buildAdvice(
  plot: GardenPlot,
  daily: GardenDayState[],
  matureDay: number,
): PickingAdvice {
  const cultivar = getCultivar(plot.cultivarId);
  const last = daily[daily.length - 1];
  const maturity = clamp(last.gdd / cultivar.gddNeed, 0, 1.35);
  const start = matureDay >= 0 ? matureDay : daily.length - 1;
  // 成熟窗口 5 天，过窗后鲜叶老化
  return {
    plotId: plot.id,
    windowStart: start,
    windowEnd: Math.min(start + 5, daily.length - 1),
    stage: last.stage,
    maturity: round2(maturity),
  };
}

/** 批量结算整季(Worker 与测试共用) */
export function simulateSeason(
  plots: GardenPlot[],
  weather: DayWeather[],
): GardenSeasonResult[] {
  return plots.map((p) => simulatePlot(p, weather));
}

export interface PickingOptions {
  /** 采摘标准: 单芽 / 一芽一叶 / 一芽二叶 / 一芽三叶 / 粗老叶 */
  standard: string;
  pickedDay: number;
  /** 产量修正随机种子 */
  seed: number;
}

const STANDARD_WEIGHT: Record<string, number> = {
  单芽: 0.32,
  一芽一叶: 0.55,
  一芽二叶: 0.85,
  一芽三叶: 1.05,
  粗老叶: 1.3,
};

const STANDARD_SCORE: Record<string, number> = {
  单芽: 92,
  一芽一叶: 88,
  一芽二叶: 80,
  一芽三叶: 68,
  粗老叶: 52,
};

/**
 * 采摘并评定鲜叶质量。
 * 质量 = 品种潜力 + 海拔/雾露增益 + 采时成熟度 + 胁迫惩罚 + 采摘标准。
 */
export function pickLeaves(
  result: GardenSeasonResult,
  opts: PickingOptions,
): FreshLeafBatch {
  const { plot, daily, advice } = result;
  const cultivar = getCultivar(plot.cultivarId);
  const rand = mulberry32(opts.seed + plot.id * 1009);
  const state = daily[clamp(opts.pickedDay, 0, daily.length - 1)];

  // 海拔增益: 600~1000m 最适，过高转负
  const altitudeGain =
    plot.altitude <= 1000
      ? (plot.altitude / 1000) * 7
      : 7 - ((plot.altitude - 1000) / 200) * 3;
  const mistGain = plot.mistFactor * 4;
  const sunGain = (aspectSunFactor(plot.aspect) - 0.8) * 6;

  // 采时窗口: 窗口内满分，过早欠熟(封顶低)、过窗老化
  let timingScore = 88;
  if (opts.pickedDay < advice.windowStart) {
    // 欠熟: 越早分数越低，萌芽初期封顶 50 分，临近窗口才接近 75
    const ratio = clamp(opts.pickedDay / Math.max(1, advice.windowStart), 0, 1);
    timingScore = 48 + ratio * 27;
  } else if (opts.pickedDay <= advice.windowEnd) {
    timingScore = 92 + rand() * 5;
  } else {
    timingScore = Math.max(50, 90 - (opts.pickedDay - advice.windowEnd) * 7);
  }

  // 只统计采摘前 7 天的近期胁迫(老叶受的灾不该算到新芽头上)
  const lookBack = daily.slice(Math.max(0, opts.pickedDay - 6), opts.pickedDay + 1);
  const recentStress = lookBack.filter(
    (d) => d.stress.drought || d.stress.heat || d.stress.waterlogged || d.stress.frost,
  ).length;
  const stressPenalty = recentStress * 1.4;
  const standardScore = STANDARD_SCORE[opts.standard] ?? 72;

  const quality = clamp(
    cultivar.baseQuality * 0.28 +
      timingScore * 0.4 +
      standardScore * 0.16 +
      altitudeGain +
      mistGain +
      sunGain -
      stressPenalty,
    25,
    98,
  );

  const baseYield = 18 + (plot.altitude < 700 ? 10 : 0) + rand() * 8;
  const weightKg =
    Math.round(baseYield * (STANDARD_WEIGHT[opts.standard] ?? 0.8) * 10) / 10;

  return {
    id: `FL-${plot.id}-${opts.pickedDay}-${Math.floor(rand() * 9000 + 1000)}`,
    plotId: plot.id,
    cultivarId: plot.cultivarId,
    pickedDay: opts.pickedDay,
    weightKg,
    quality: round2(quality),
    standard: opts.standard,
    initialMoisture: round2(clamp(0.76 + rand() * 0.04 - state.soilWater * 0.02, 0.7, 0.8)),
    pickedAt: Date.now(),
  };
}
