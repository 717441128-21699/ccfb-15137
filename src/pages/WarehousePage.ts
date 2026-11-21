import type { FinishedTea, TeaClass } from '../engine/types';
import { RECIPES } from '../engine/data/recipes';
import { getCultivar } from '../engine/data/cultivars';
import { gameStore } from '../store';
import { el, pct, toast } from '../ui/dom';

const CLASS_COLOR: Record<TeaClass, string> = {
  green: 'green',
  white: 'gray',
  yellow: 'amber',
  oolong: 'blue',
  black: 'red',
  dark: 'red',
};

export class WarehousePage {
  private root = el('div');
  private filter: TeaClass | 'all' = 'all';

  constructor(private rerender: () => void, private navigate: (tab: string) => void) {}

  mount(): HTMLElement {
    this.render();
    return this.root;
  }

  private render(): void {
    this.root.innerHTML = '';
    const state = gameStore.getState();

    const head = el('div', 'card');
    head.appendChild(el('h2', undefined, '📦 茶仓'));
    const totalKg = state.warehouse.reduce((s, t) => s + t.weightKg, 0);
    const avgScore = state.warehouse.length
      ? state.warehouse.reduce((s, t) => s + t.score.total, 0) / state.warehouse.length
      : 0;
    const stats = el('div', 'grid cols-4');
    stats.append(
      this.stat('成品批次', `${state.warehouse.length} 批`),
      this.stat('总库存', `${totalKg.toFixed(1)} kg`),
      this.stat('平均评分', avgScore ? avgScore.toFixed(1) : '—'),
      this.stat('鲜叶待制', `${state.leafBatches.length} 批`),
    );
    head.appendChild(stats);
    this.root.appendChild(head);

    // 茶类筛选
    const filterCard = el('div', 'card');
    const wrap = el('div', 'pill-select');
    const opts: Array<{ key: TeaClass | 'all'; label: string }> = [
      { key: 'all', label: '全部' },
      ...RECIPES.map((r) => ({ key: r.teaClass, label: r.teaName })),
    ];
    for (const o of opts) {
      const b = el('button', o.key === this.filter ? 'active' : undefined, o.label);
      b.onclick = () => {
        this.filter = o.key;
        this.rerender();
      };
      wrap.appendChild(b);
    }
    filterCard.appendChild(wrap);
    this.root.appendChild(filterCard);

    if (!state.warehouse.length) {
      const empty = el('div', 'card empty', '茶仓空空如也。');
      const go = el('button', 'btn', '去制茶车间');
      go.style.marginTop = '12px';
      go.onclick = () => this.navigate('workshop');
      empty.appendChild(go);
      this.root.appendChild(empty);
      return;
    }

    const list = state.warehouse.filter((t) => this.filter === 'all' || t.teaClass === this.filter);
    const grid = el('div', 'grid cols-3');
    for (const tea of list) {
      grid.appendChild(this.teaCard(tea));
    }
    this.root.appendChild(grid);
  }

  private stat(label: string, value: string): HTMLElement {
    const s = el('div', 'stat');
    s.append(el('div', 'label', label), el('div', 'value', value));
    return s;
  }

  private teaCard(tea: FinishedTea): HTMLElement {
    const card = el('div', 'card');
    card.style.marginBottom = '0';
    const cultivar = getCultivar(tea.cultivarId);
    const titleRow = el('div', 'row-actions');
    titleRow.style.justifyContent = 'space-between';
    titleRow.append(
      el('strong', undefined, tea.teaName),
      el('span', `badge ${CLASS_COLOR[tea.teaClass]}`, tea.score.grade),
    );
    card.appendChild(titleRow);

    const info = el('div', 'muted');
    info.style.margin = '8px 0';
    info.innerHTML = `品种 ${cultivar.name}<br/>批次 ${tea.batchId}<br/>库存 ${tea.weightKg}kg · 含水率 ${pct(tea.moisture)} · 氧化 ${pct(tea.oxidation)}`;
    card.appendChild(info);

    const scoreLine = el('div', 'stat');
    scoreLine.append(
      el('div', 'label', `总分 ${tea.score.total}｜形${tea.score.appearance} 汤${tea.score.liquor} 香${tea.score.aroma} 味${tea.score.taste}`),
    );
    scoreLine.style.padding = '8px 12px';
    card.appendChild(scoreLine);

    if (tea.defects.length) {
      const warn = el('div', 'badge red', `${tea.defects.length} 项缺陷 · ${tea.blamedStage?.name ?? ''}`);
      warn.style.marginTop = '8px';
      card.appendChild(warn);
    } else {
      const ok = el('div', 'badge green', '工艺合格');
      ok.style.marginTop = '8px';
      card.appendChild(ok);
    }

    const actions = el('div', 'row-actions');
    actions.style.marginTop = '12px';
    const reviewBtn = el('button', 'btn ghost small', '查看审评');
    reviewBtn.onclick = () => this.navigate('review');
    const delBtn = el('button', 'btn danger small', '下架');
    delBtn.onclick = () => {
      gameStore.removeFinishedTea(tea.id);
      toast('已从茶仓下架');
      this.rerender();
    };
    actions.append(reviewBtn, delBtn);
    card.appendChild(actions);
    return card;
  }
}
