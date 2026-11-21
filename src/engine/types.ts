// 全局领域类型定义

export type TeaClass =
  | 'green' // 绿茶
  | 'white' // 白茶
  | 'yellow' // 黄茶
  | 'oolong' // 青茶(乌龙)
  | 'black' // 红茶
  | 'dark'; // 黑茶

export type Aspect = 'south' | 'east' | 'north' | 'west';

export interface CultivarDef {
  id: string;
  name: string;
  /** 适制茶类 */
  suitable: TeaClass[];
  /** 基础品质潜力 0..100 */
  baseQuality: number;
  /** 达到采摘成熟所需积温(℃·天) */
  gddNeed: number;
  /** 积温累积速率修正 */
  gddFactor: number;
  /** 抗旱能力 0..1，越高越耐旱 */
  droughtTolerance: number;
  /** 适制工艺吻合度修正(按茶类) */
  craftBonus: Partial<Record<TeaClass, number>>;
}

export type WeatherType = 'sun' | 'cloud' | 'rain' | 'fog' | 'frost';

export interface DayWeather {
  /** 季节内第几天，从 0 开始 */
  day: number;
  type: WeatherType;
  /** 日均气温 ℃ */
  avgTemp: number;
  /** 日最高气温 ℃ */
  maxTemp: number;
  /** 日最低气温 ℃ */
  minTemp: number;
  /** 降水量 mm */
  rainMm: number;
  /** 相对湿度 0..1 */
  humidity: number;
  /** 日照时数 小时 */
  sunHours: number;
}

export interface GardenPlot {
  id: number;
  name: string;
  /** 海拔 米 */
  altitude: number;
  aspect: Aspect;
  /** 坡度 度 */
  slope: number;
  cultivarId: string;
  /** 土壤持水系数 0..1 */
  soilRetention: number;
  /** 雾露系数，高海拔谷地更高 */
  mistFactor: number;
}

export type GrowthStage = 'dormant' | 'bud' | 'flush' | 'mature' | 'picked';

export interface GardenDayState {
  day: number;
  gdd: number;
  stage: GrowthStage;
  /** 土壤水分 0..1 */
  soilWater: number;
  /** 当日胁迫标记 */
  stress: {
    drought: boolean;
    heat: boolean;
    waterlogged: boolean;
    frost: boolean;
  };
  /** 当季累积胁迫天数 */
  stressDays: number;
}

export interface PickingAdvice {
  plotId: number;
  /** 建议采摘的起始天 */
  windowStart: number;
  /** 建议采摘的截止天 */
  windowEnd: number;
  stage: GrowthStage;
  /** 当前成熟度 0..1+ */
  maturity: number;
}

export interface GardenSeasonResult {
  plot: GardenPlot;
  daily: GardenDayState[];
  advice: PickingAdvice;
}

export interface FreshLeafBatch {
  id: string;
  plotId: number;
  cultivarId: string;
  /** 采摘的季节天 */
  pickedDay: number;
  /** 鲜叶重量 kg */
  weightKg: number;
  /** 鲜叶质量 0..100 */
  quality: number;
  /** 采摘标准: 单芽 / 一芽一叶 / 一芽二叶 / 一芽三叶 / 粗老叶 */
  standard: string;
  /** 初始含水率 0..1 */
  initialMoisture: number;
  pickedAt: number;
}

/** 工序种类 */
export type StageKind =
  | 'withering' // 萎凋
  | 'qing' // 做青(乌龙)
  | 'fixation' // 杀青
  | 'rolling' // 揉捻
  | 'fermentation' // 发酵(酶促氧化)
  | 'yellowing' // 闷黄
  | 'piling' // 渥堆
  | 'drying'; // 烘干

/** 每道工序的参考工艺 */
export interface StageRecipe {
  kind: StageKind;
  name: string;
  /** 参考锅温/环境温度 ℃ */
  refTemp: number;
  /** 参考时长 分钟 */
  refDuration: number;
  /** 参考出口含水率 0..1 */
  refExitMoisture: number;
  /** 该工序结束时的参考氧化程度 0..1 */
  refExitOxidation: number;
  /** 参考参数下的脱水系数标定值(scripts/autofit.ts 反解) */
  refDryK: number;
  /** 允许玩家设置的温度区间 */
  tempRange: [number, number];
  /** 允许的最长时长 分钟 */
  maxDuration: number;
  hint: string;
}

export interface Recipe {
  teaClass: TeaClass;
  teaName: string;
  stages: StageRecipe[];
  /** 成品目标含水率 */
  targetFinalMoisture: number;
  /** 成品目标氧化程度 */
  targetFinalOxidation: number;
}

/** 玩家在某道工序上的操作 */
export interface StageOperation {
  kind: StageKind;
  /** 设定温度 ℃ */
  temp: number;
  /** 实际时长 分钟 */
  duration: number;
}

/** 分钟级曲线采样点 */
export interface CurvePoint {
  t: number;
  moisture: number;
  oxidation: number;
  temp: number;
  damage: number;
  enzyme: number;
}

export interface Defect {
  stage: StageKind;
  code: string;
  name: string;
  severity: 'slight' | 'moderate' | 'severe';
  /** 扣分幅度 */
  penalty: number;
  /** 触发原因(给评茶师的归因说明) */
  reason: string;
}

export interface StageResult {
  kind: StageKind;
  name: string;
  duration: number;
  temp: number;
  enterMoisture: number;
  exitMoisture: number;
  exitOxidation: number;
  /** 参考出口含水率 */
  refExitMoisture: number;
  /** 与参考含水率曲线的最大偏差(百分点, 1 = 1%) */
  maxCurveDeviationPct: number;
  curve: CurvePoint[];
  defects: Defect[];
}

export interface ProcessingInput {
  batch: FreshLeafBatch;
  teaClass: TeaClass;
  operations: StageOperation[];
}

export interface ProcessingResult {
  batchId: string;
  teaClass: TeaClass;
  teaName: string;
  stages: StageResult[];
  curve: CurvePoint[];
  finalMoisture: number;
  finalOxidation: number;
  defects: Defect[];
  /** 全程曲线相对参考工艺的最大偏差(百分点) */
  maxCurveDeviationPct: number;
  /** 参考工艺跑出来的参考曲线 */
  referenceCurve: CurvePoint[];
}

export interface TeaScore {
  appearance: number;
  liquor: number;
  aroma: number;
  taste: number;
  total: number;
  grade: string;
}

export interface FinishedTea {
  id: string;
  batchId: string;
  teaClass: TeaClass;
  teaName: string;
  cultivarId: string;
  plotId: number;
  weightKg: number;
  moisture: number;
  oxidation: number;
  score: TeaScore;
  defects: Defect[];
  /** 工序归因: 哪道工序问题最大 */
  blamedStage: { stage: StageKind; name: string; reasons: string[] } | null;
  /** 实际加工分钟级曲线 */
  curve: CurvePoint[];
  /** 参考工艺曲线 */
  referenceCurve: CurvePoint[];
  /** 各工序玩家操作与偏差 */
  stageSummary: Array<{
    kind: StageKind;
    name: string;
    temp: number;
    duration: number;
    refTemp: number;
    refDuration: number;
    maxCurveDeviationPct: number;
  }>;
  createdAt: number;
}

/** Worker 消息 */
export interface ProcessRequest {
  type: 'process';
  input: ProcessingInput;
  /** 实时推送间隔(模拟分钟)，0 表示不推送只返回最终结果 */
  streamEvery?: number;
}

export interface ProcessTick {
  type: 'tick';
  batchId: string;
  stageIndex: number;
  stageName: string;
  point: CurvePoint;
}

export interface ProcessDone {
  type: 'done';
  result: ProcessingResult;
}

export interface SeasonRequest {
  type: 'season';
  seed: number;
  plotCount: number;
  days: number;
}

export interface SeasonDone {
  type: 'season-done';
  elapsedMs: number;
  results: GardenSeasonResult[];
  weather: DayWeather[];
}

export type WorkerRequest = ProcessRequest | SeasonRequest;
export type WorkerResponse = ProcessTick | ProcessDone | SeasonDone;
