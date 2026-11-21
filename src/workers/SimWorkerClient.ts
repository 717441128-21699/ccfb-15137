import type {
  ProcessDone,
  ProcessRequest,
  ProcessTick,
  SeasonDone,
  SeasonRequest,
  WorkerResponse,
} from '../engine/types';

/**
 * Worker 客户端封装: 主线程通过 Promise 调用制茶/生长结算，
 * 流式曲线点通过 onTick 回调推送，保证 UI 不被分钟级模拟阻塞。
 */
export class SimWorkerClient {
  private worker: Worker | null = null;
  private processResolver: ((r: ProcessDone) => void) | null = null;
  private seasonResolver: ((r: SeasonDone) => void) | null = null;
  onTick: ((tick: ProcessTick) => void) | null = null;

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === 'tick') {
          this.onTick?.(msg);
        } else if (msg.type === 'done') {
          this.processResolver?.(msg);
          this.processResolver = null;
        } else if (msg.type === 'season-done') {
          this.seasonResolver?.(msg);
          this.seasonResolver = null;
        }
      };
      this.worker.onerror = (e) => {
        console.error('制茶 Worker 异常', e);
      };
    }
    return this.worker;
  }

  runProcess(req: ProcessRequest): Promise<ProcessDone> {
    return new Promise((resolve) => {
      this.processResolver = resolve;
      this.ensure().postMessage(req);
    });
  }

  runSeason(req: SeasonRequest): Promise<SeasonDone> {
    return new Promise((resolve) => {
      this.seasonResolver = resolve;
      this.ensure().postMessage(req);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
