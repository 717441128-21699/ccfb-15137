/// <reference lib="webworker" />
import type {
  ProcessDone,
  ProcessRequest,
  ProcessTick,
  SeasonDone,
  SeasonRequest,
  WorkerRequest,
  WorkerResponse,
} from '../engine/types';
import { processTea, simulateStage, initialState, getRecipe } from '../engine/processing';
import { generateClimate } from '../engine/climate';
import { generateGardens } from '../engine/garden';
import { simulateSeason } from '../engine/growth';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'process') {
    handleProcess(msg);
  } else if (msg.type === 'season') {
    handleSeason(msg);
  }
};

/**
 * 制茶模拟: 复用引擎的分钟级模型，按 streamEvery 间隔推送实时曲线点，
 * 结束后返回完整 ProcessingResult。
 */
function handleProcess(req: ProcessRequest): void {
  const { input, streamEvery = 0 } = req;
  if (streamEvery <= 0) {
    const result = processTea(input);
    const done: ProcessDone = { type: 'done', result };
    ctx.postMessage(done);
    return;
  }

  // 流式模式: 逐工序逐分钟跑并推实时点，最后用确定性实现产出最终结果，
  // 保证流式过程与一次性入库结果同源、完全一致
  const recipe = getRecipe(input.teaClass);
  const state = initialState(input.batch.initialMoisture);
  recipe.stages.forEach((sr, idx) => {
    const op =
      input.operations.find((o) => o.kind === sr.kind) ?? {
        kind: sr.kind,
        temp: sr.refTemp,
        duration: sr.refDuration,
      };
    const enter = { ...state };
    const { state: exit, curve } = simulateStage(sr.kind, op, enter, sr);
    for (const p of curve) {
      if (p.t % streamEvery === 0) {
        const tick: ProcessTick = {
          type: 'tick',
          batchId: input.batch.id,
          stageIndex: idx,
          stageName: sr.name,
          point: p,
        };
        ctx.postMessage(tick);
      }
    }
    state.moisture = exit.moisture;
    state.oxidation = exit.oxidation;
    state.enzyme = exit.enzyme;
    state.damage = exit.damage;
  });

  const result = processTea(input);
  const done: ProcessDone = { type: 'done', result };
  ctx.postMessage(done);
}

/** 整季生长结算: 100 块地 × 60 天的标量运算，要求 1 秒内完成 */
function handleSeason(req: SeasonRequest): void {
  const start =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const weather = generateClimate(req.seed, req.days);
  const plots = generateGardens(req.seed, req.plotCount);
  const results = simulateSeason(plots, weather);
  const elapsedMs =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
  const msg: SeasonDone = { type: 'season-done', elapsedMs, results, weather };
  ctx.postMessage(msg);
}

export type { WorkerResponse };
