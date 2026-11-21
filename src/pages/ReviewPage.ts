import type { FinishedTea } from '../engine/types';
import { gameStore } from '../store';
import { el, pct, toast } from '../ui/dom';
import {
  damageSeries,
  lineChart,
  moistureSeries,
  oxidationSeries,
} from '../ui/chart';
import { getCultivar } from '../engine/data/cultivars';
import { getRecipe } from '../engine/processing';

const SEVERITY_LABEL = { slight: '轻微', moderate: '中等', severe: '严重' } as const;

export class ReviewPage {
  private root = el('div');
  private selectedId: string | null = null;

  constructor(private rerender: () => void) {}

  mount(): HTMLElement {
    this.render();
    return this.root;
  }

  private render(): void {
    this.root.innerHTML = '';
    const state = gameStore.getState();
    const head = el('div', 'card');
    head.appendChild(el('h2', undefined, '🧐 评茶师审评'));
    head.appendChild(
      el('p', 'muted', '按外形、汤色、香气、滋味四维等权打分；做坏的批次会明确指出问题出在哪道工序、为什么。'),
    );
    this.root.appendChild(head);

    if (!state.warehouse.length) {
      this.root.appendChild(el('div', 'card empty', '茶仓里还没有成品。先到制茶车间完成一批茶。'));
      return;
    }

    const layout = el('div', 'section-flex');
    const listCard = el('div', 'card');
    listCard.appendChild(el('h3', undefined, '成品批次'));
    const selected =
      state.warehouse.find((t) => t.id === this.selectedId) ?? state.warehouse[0];
    this.selectedId = selected.id;
    for (const tea of state.warehouse) {
      const item = el('div', 'stat');
      item.style.marginBottom = '8px';
      item.style.cursor = 'pointer';
      if (tea.id === selected.id) item.style.outline = '2px solid var(--green)';
      const cultivar = getCultivar(tea.cultivarId);
      item.append(
        el('strong', undefined, `${tea.teaName} · ${tea.score.total}分`),
        el('div', 'muted', `${cultivar.name}｜${tea.weightKg}kg｜${tea.score.grade}${tea.defects.length ? `｜${tea.defects.length}项缺陷` : '｜无缺陷'}`),
      );
      item.onclick = () => {
        this.selectedId = tea.id;
        this.rerender();
      };
      listCard.appendChild(item);
    }
    layout.appendChild(listCard);
    layout.appendChild(this.buildDetail(selected));
    this.root.appendChild(layout);
  }

  private buildDetail(tea: FinishedTea): HTMLElement {
    const card = el('div', 'card');
    const cultivar = getCultivar(tea.cultivarId);
    const recipe = getRecipe(tea.teaClass);

    const top = el('div', 'grid cols-2');
    const left = el('div');
    left.append(el('h2', undefined, `${tea.teaName} · ${tea.score.grade}`));
    left.append(el('div', 'muted', `批次 ${tea.batchId}｜品种 ${cultivar.name}｜地块 #${tea.plotId}｜成品 ${tea.weightKg}kg`));
    left.append(
      el(
        'div',
        'muted',
        `终态含水率 ${pct(tea.moisture)}(目标 ${pct(recipe.targetFinalMoisture)})｜氧化 ${pct(tea.oxidation)}(目标 ${pct(recipe.targetFinalOxidation)})`,
      ),
    );
    const scoreBox = el('div', 'stat');
    scoreBox.style.textAlign = 'center';
    scoreBox.append(
      el('div', 'label', '综合总分'),
      el('div', 'score-big', String(tea.score.total)),
      el('div', 'muted', tea.score.grade),
    );
    top.append(left, scoreBox);
    card.appendChild(top);

    card.appendChild(el('h3', undefined, '四维评分'));
    const dims: Array<[string, number]> = [
      ['外形', tea.score.appearance],
      ['汤色', tea.score.liquor],
      ['香气', tea.score.aroma],
      ['滋味', tea.score.taste],
    ];
    for (const [name, val] of dims) {
      const row = el('div', 'dim-bar');
      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill');
      fill.style.width = `${val}%`;
      track.appendChild(fill);
      row.append(el('div', 'dim-name', name), track, el('div', 'dim-val', val.toFixed(1)));
      card.appendChild(row);
    }

    // 工序归因(硬指标 1 的展示侧)
    card.appendChild(el('h3', undefined, '🔎 工序问题归因'));
    if (!tea.blamedStage) {
      const ok = el('div', 'badge green', '✓ 各工序均未发现明显问题');
      ok.style.fontSize = '14px';
      ok.style.padding = '8px 16px';
      card.appendChild(ok);
    } else {
      const blame = el('div', 'defect-item');
      const head = el('div', 'd-head');
      head.append(
        el('span', undefined, `主要问题工序: ${tea.blamedStage.name}`),
        el('span', 'd-stage', `共 ${tea.defects.length} 项缺陷`),
      );
      blame.appendChild(head);
      const ul = document.createElement('ul');
      ul.style.margin = '6px 0 0';
      ul.style.paddingLeft = '18px';
      for (const reason of tea.blamedStage.reasons) {
        ul.appendChild(el('li', undefined, reason));
      }
      blame.appendChild(ul);
      card.appendChild(blame);
    }

    if (tea.defects.length) {
      card.appendChild(el('h3', undefined, '缺陷明细'));
      for (const d of tea.defects) {
        const item = el('div', `defect-item ${d.severity === 'slight' ? 'slight' : ''}`);
        const head = el('div', 'd-head');
        head.append(
          el('span', undefined, d.name),
          el('span', 'badge', `${SEVERITY_LABEL[d.severity]} · 扣${d.penalty.toFixed(1)}分`),
        );
        item.append(head, el('div', 'muted', d.reason));
        card.appendChild(item);
      }
    }

    // 逐工序参数偏差表
    card.appendChild(el('h3', undefined, '逐工序参数与曲线偏差'));
    const table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th>工序</th><th>设定(℃×分)</th><th>参考(℃×分)</th><th>含水率曲线最大偏差</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const s of tea.stageSummary) {
      const tr = document.createElement('tr');
      const devBadge =
        s.maxCurveDeviationPct <= 3
          ? `<span class="badge green">${s.maxCurveDeviationPct.toFixed(2)}pp</span>`
          : `<span class="badge red">${s.maxCurveDeviationPct.toFixed(2)}pp</span>`;
      tr.innerHTML = `
        <td>${s.name}</td>
        <td>${s.temp}℃ × ${s.duration}分</td>
        <td class="muted">${s.refTemp}℃ × ${s.refDuration}分</td>
        <td>${devBadge}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);

    // 曲线对照
    card.appendChild(el('h3', undefined, '📈 加工曲线(实线=实际，虚线=参考工艺)'));
    const curveBox = el('div', 'chart-box');
    const chart = lineChart(
      [
        moistureSeries(tea.curve),
        { points: tea.referenceCurve.map((p) => ({ t: p.t, v: p.moisture })), color: '#3f6d8e', label: '参考含水率', dashed: true },
        oxidationSeries(tea.curve),
        { points: tea.referenceCurve.map((p) => ({ t: p.t, v: p.oxidation })), color: '#b07d2b', label: '参考氧化', dashed: true },
        damageSeries(tea.curve),
      ],
      { height: 260 },
    );
    curveBox.appendChild(chart);
    const lg = el('div', 'chart-legend');
    lg.innerHTML =
      '<span><i style="background:#3f6d8e"></i>含水率</span><span><i style="background:#b07d2b"></i>氧化</span><span><i style="background:#b34a3a"></i>热损伤</span><span>虚线=参考工艺</span>';
    curveBox.appendChild(lg);
    card.appendChild(curveBox);

    const delBtn = el('button', 'btn danger small', '销毁该批次');
    delBtn.style.marginTop = '12px';
    delBtn.onclick = () => {
      gameStore.removeFinishedTea(tea.id);
      toast('批次已销毁');
      this.rerender();
    };
    card.appendChild(delBtn);
    return card;
  }
}
