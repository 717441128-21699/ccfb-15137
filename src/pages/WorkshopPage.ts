import type {
  CurvePoint,
  FreshLeafBatch,
  StageOperation,
  StageRecipe,
  TeaClass,
} from '../engine/types';
import { RECIPES } from '../engine/data/recipes';
import { getCultivar } from '../engine/data/cultivars';
import { gameStore } from '../store';
import { el, pct, toast } from '../ui/dom';
import { processTea } from '../engine/processing';
import { evaluate } from '../engine/evaluation';

const TEA_ORDER: TeaClass[] = ['green', 'white', 'yellow', 'oolong', 'black', 'dark'];

export class WorkshopPage {
  private root = el('div');
  private batchId: string | null = null;
  private teaClass: TeaClass = 'green';
  /** 每道工序的玩家参数 key: stage kind */
  private params = new Map<string, { temp: number; duration: number }>();
  private running = false;
  private livePoint: CurvePoint | null = null;
  private liveStageName = '';

  constructor(private rerender: () => void, navigate: (tab: string) => void) {
    this.navigate = navigate;
  }

  private navigate: (tab: string) => void = () => {};

  mount(): HTMLElement {
    this.render();
    return this.root;
  }

  private get batch(): FreshLeafBatch | null {
    const state = gameStore.getState();
    return state.leafBatches.find((b) => b.id === this.batchId) ?? state.leafBatches[0] ?? null;
  }

  private render(): void {
    this.root.innerHTML = '';
    const state = gameStore.getState();
    const head = el('div', 'card');
    head.appendChild(el('h2', undefined, '🍵 制茶车间'));
    head.appendChild(
      el(
        'p',
        'muted',
        '萎凋 → 杀青 → 揉捻 → 发酵/做青/闷黄/渥堆 → 烘干，每道工序自行设定温度与时长。叶子的含水率、氧化程度按分钟级物理曲线变化，做坏会出现焦边、红梗等缺陷。',
      ),
    );
    this.root.appendChild(head);

    if (!state.leafBatches.length) {
      this.root.appendChild(
        el('div', 'card empty', '暂无鲜叶。先到「茶山地图」采摘一批鲜叶再来制茶。'),
      );
      return;
    }

    const current = this.batch;
    if (current) this.batchId = current.id;

    // 批次与茶类选择
    const selCard = el('div', 'card');
    selCard.appendChild(el('h3', undefined, '① 选择鲜叶批次'));
    const batchSel = document.createElement('select');
    state.leafBatches.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      const cultivar = getCultivar(b.cultivarId);
      opt.textContent = `${b.id}｜${cultivar.name}｜${b.standard}｜质量${b.quality.toFixed(0)}｜${b.weightKg}kg`;
      if (b.id === this.batchId) opt.selected = true;
      batchSel.appendChild(opt);
    });
    batchSel.onchange = () => {
      this.batchId = batchSel.value;
      this.params.clear();
      this.rerender();
    };
    selCard.appendChild(batchSel);

    selCard.appendChild(el('h3', undefined, '② 选择目标茶类(决定工艺路线)'));
    const teaWrap = el('div', 'pill-select');
    TEA_ORDER.forEach((tc) => {
      const recipe = RECIPES.find((r) => r.teaClass === tc)!;
      const b = el('button', tc === this.teaClass ? 'active' : undefined, recipe.teaName);
      b.onclick = () => {
        this.teaClass = tc;
        this.params.clear();
        this.rerender();
      };
      teaWrap.appendChild(b);
    });
    selCard.appendChild(teaWrap);
    this.root.appendChild(selCard);

    if (!current) return;
    const recipe = RECIPES.find((r) => r.teaClass === this.teaClass)!;

    // 工序参数
    const stageCard = el('div', 'card');
    stageCard.appendChild(el('h3', undefined, '③ 逐道工序设定温度与时长(虚线范围内可调)'));
    const stageGrid = el('div', 'grid cols-2');
    recipe.stages.forEach((sr, idx) => {
      stageGrid.appendChild(this.stageControl(sr, idx + 1));
    });
    stageCard.appendChild(stageGrid);

    const actionRow = el('div', 'row-actions');
    actionRow.style.marginTop = '14px';
    const runBtn = el('button', 'btn') as HTMLButtonElement;
    runBtn.textContent = this.running ? '模拟进行中…' : '▶ 开始制茶模拟 (Worker 实时推流)';
    runBtn.disabled = this.running;
    runBtn.onclick = () => this.runProcess(current, recipe, runBtn);
    actionRow.appendChild(runBtn);

    const refBtn = el('button', 'btn ghost small', '一键填入参考工艺');
    refBtn.onclick = () => {
      this.params.clear();
      toast('已恢复参考工艺参数(该参数下含水率曲线偏差 < 1%)');
      this.rerender();
    };
    actionRow.appendChild(refBtn);
    stageCard.appendChild(actionRow);

    // 实时读数
    if (this.livePoint) {
      const live = el('div', 'live-readout');
      live.append(
        this.miniStat('当前工序', this.liveStageName),
        this.miniStat('含水率', pct(this.livePoint.moisture)),
        this.miniStat('氧化程度', pct(this.livePoint.oxidation)),
        this.miniStat('热损伤', pct(this.livePoint.damage)),
      );
      stageCard.appendChild(live);
    }
    this.root.appendChild(stageCard);
  }

  private miniStat(label: string, value: string): HTMLElement {
    const s = el('div', 'stat');
    s.append(el('div', 'label', label), el('div', 'value', value));
    return s;
  }

  private stageControl(sr: StageRecipe, index: number): HTMLElement {
    const saved = this.params.get(sr.kind);
    const temp = saved?.temp ?? sr.refTemp;
    const duration = saved?.duration ?? sr.refDuration;
    const box = el('div', 'stat');
    const title = el('strong', undefined, `${index}. ${sr.name}`);
    box.appendChild(title);
    box.appendChild(el('div', 'muted', sr.hint));

    // 温度
    const tempHead = el('div', 'ctrl-head');
    tempHead.append(el('span', undefined, `温度 (${sr.tempRange[0]}~${sr.tempRange[1]}℃)`), el('span', 'num', `${temp}℃`));
    const tempRange = document.createElement('input');
    tempRange.type = 'range';
    tempRange.min = String(sr.tempRange[0]);
    tempRange.max = String(sr.tempRange[1]);
    tempRange.value = String(temp);
    const tempLabel = el('label', 'control');
    tempLabel.append(tempHead, tempRange);

    // 时长
    const durHead = el('div', 'ctrl-head');
    durHead.append(
      el('span', undefined, `时长 (参考 ${sr.refDuration} 分钟)`),
      el('span', 'num', `${duration} 分`),
    );
    const durRange = document.createElement('input');
    durRange.type = 'range';
    durRange.min = '1';
    durRange.max = String(sr.maxDuration);
    durRange.value = String(duration);
    const durLabel = el('label', 'control');
    durLabel.append(durHead, durRange);

    const refLine = el(
      'div',
      'muted',
      `参考: ${sr.refTemp}℃ × ${sr.refDuration}分 → 出口含水率 ${pct(sr.refExitMoisture)} / 氧化 ${pct(sr.refExitOxidation)}`,
    );

    tempRange.oninput = () => {
      const t = Number(tempRange.value);
      this.saveParam(sr, t, Number(durRange.value));
      tempHead.querySelector('.num')!.textContent = `${t}℃`;
    };
    durRange.oninput = () => {
      const d = Number(durRange.value);
      this.saveParam(sr, Number(tempRange.value), d);
      durHead.querySelector('.num')!.textContent = `${d} 分`;
    };

    box.append(tempLabel, durLabel, refLine);
    return box;
  }

  private saveParam(sr: StageRecipe, temp: number, duration: number): void {
    this.params.set(sr.kind, { temp, duration });
  }

  private collectOps(recipe: (typeof RECIPES)[number]): StageOperation[] {
    return recipe.stages.map((sr) => {
      const p = this.params.get(sr.kind);
      return { kind: sr.kind, temp: p?.temp ?? sr.refTemp, duration: p?.duration ?? sr.refDuration };
    });
  }

  private async runProcess(
    batch: FreshLeafBatch,
    recipe: (typeof RECIPES)[number],
    btn: HTMLButtonElement,
  ): Promise<void> {
    this.running = true;
    this.livePoint = null;
    btn.disabled = true;
    btn.textContent = '模拟进行中…';

    const operations = this.collectOps(recipe);
    // 先在主线程做一次确定性计算(结果与 Worker 完全一致，保证曲线与入库数据同源)
    const preview = processTea({ batch, teaClass: this.teaClass, operations });

    gameStore.worker.onTick = (tick) => {
      this.livePoint = tick.point;
      this.liveStageName = tick.stageName;
      this.rerender();
    };

    await gameStore.worker.runProcess({
      type: 'process',
      input: { batch, teaClass: this.teaClass, operations },
      // 约 60 个实时点，避免高频整页重绘打断滑杆操作
      streamEvery: Math.max(1, Math.round(preview.curve.length / 60)),
    });

    const tea = evaluate(batch, preview);
    gameStore.addFinishedTea(tea, batch.id);
    this.running = false;
    gameStore.worker.onTick = null;
    toast(`制茶完成: ${tea.teaName} 总分 ${tea.score.total}，已入茶仓，可前往评茶页查看归因`);
    this.navigate('review');
  }
}
