import type {
  FinishedTea,
  FreshLeafBatch,
  GardenSeasonResult,
  DayWeather,
} from './engine/types';
import { SimWorkerClient } from './workers/SimWorkerClient';

export interface GameState {
  seed: number;
  seasonDay: number;
  weather: DayWeather[];
  gardenResults: GardenSeasonResult[];
  leafBatches: FreshLeafBatch[];
  warehouse: FinishedTea[];
  seasonElapsedMs: number | null;
}

const STORAGE_KEY = 'tea-mountain-save-v1';

function freshState(seed: number): GameState {
  return {
    seed,
    seasonDay: 0,
    weather: [],
    gardenResults: [],
    leafBatches: [],
    warehouse: [],
    seasonElapsedMs: null,
  };
}

type Listener = () => void;

/**
 * 极简响应式仓库: 单一状态树 + 订阅通知 + localStorage 持久化。
 * 重型计算(生长/制茶)全部走 Worker，仓库只存结果。
 */
class GameStore {
  private state: GameState;
  private listeners = new Set<Listener>();
  readonly worker = new SimWorkerClient();

  constructor() {
    this.state = this.load() ?? freshState(20260301);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.save();
    this.listeners.forEach((fn) => fn());
  }

  getState(): GameState {
    return this.state;
  }

  update(mut: (s: GameState) => void): void {
    mut(this.state);
    this.emit();
  }

  addLeafBatch(batch: FreshLeafBatch): void {
    this.update((s) => {
      s.leafBatches = [batch, ...s.leafBatches].slice(0, 30);
    });
  }

  removeLeafBatch(id: string): void {
    this.update((s) => {
      s.leafBatches = s.leafBatches.filter((b) => b.id !== id);
    });
  }

  addFinishedTea(tea: FinishedTea, consumedBatchId: string): void {
    this.update((s) => {
      // 曲线数据较大，限制茶仓条目以规避 localStorage 配额
      s.warehouse = [tea, ...s.warehouse].slice(0, 40);
      s.leafBatches = s.leafBatches.filter((b) => b.id !== consumedBatchId);
    });
  }

  removeFinishedTea(id: string): void {
    this.update((s) => {
      s.warehouse = s.warehouse.filter((t) => t.id !== id);
    });
  }

  setSeason(
    weather: DayWeather[],
    results: GardenSeasonResult[],
    elapsedMs: number,
  ): void {
    this.update((s) => {
      s.weather = weather;
      s.gardenResults = results;
      s.seasonElapsedMs = elapsedMs;
      s.seasonDay = weather.length ? weather.length - 1 : 0;
    });
  }

  reset(seed?: number): void {
    this.state = freshState(seed ?? this.state.seed);
    this.emit();
  }

  private load(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as GameState) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 存储配额或隐私模式下静默失败
    }
  }
}

export const gameStore = new GameStore();
