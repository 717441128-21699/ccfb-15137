import type { DayWeather, GardenSeasonResult, GrowthStage } from '../engine/types';
import { gameStore } from '../store';
import { el, pct, toast } from '../ui/dom';
import { lineChart } from '../ui/chart';
import { pickLeaves } from '../engine/growth';
import { aspectName } from '../engine/garden';
import { getCultivar } from '../engine/data/cultivars';

const STAGE_LABEL: Record<GrowthStage, string> = {
  dormant: '休眠',
  bud: '萌芽',
  flush: '展叶',
  mature: '成熟',
  picked: '已采',
};

const WEATHER_ICON: Record<DayWeather['type'], string> = {
  sun: '☀️',
  cloud: '⛅',
  rain: '🌧️',
  fog: '🌫️',
  frost: '❄️',
};

const STAGE_COLOR: Record<GrowthStage, string> = {
  dormant: '#c9c4b4',
  bud: '#a9cf8f',
  flush: '#6fae63',
  mature: '#357a3c',
  picked: '#8d7b5e',
};

const PICK_STANDARDS = ['单芽', '一芽一叶', '一芽二叶', '一芽三叶', '粗老叶'];

export class MountainMapPage {
  private root = el('div');
  private selected: GardenSeasonResult | null = null;

  constructor(private rerender: () => void) {}

  mount(): HTMLElement {
    this.render();
    return this.root;
  }

  private render(): void {
    this.root.innerHTML = '';
    const state = gameStore.getState();

    // 顶部统计与结算按钮
    const head = el('div', 'card');
    head.appendChild(el('h2', undefined, '🏔️ 茶山地图'));
    const stats = el('div', 'grid cols-4');
    const ready = state.gardenResults.filter(
      (r) => r.advice.windowStart < state.weather.length && r.daily.at(-1)?.stage === 'mature',
    ).length;
    stats.append(
      this.stat('茶园地块', `${state.gardenResults.length || 100} 块`),
      this.stat('当前可采', `${ready} 块`),
      this.stat('春茶季天数', `${state.weather.length || 60} 天`),
      this.stat(
        '整季结算耗时',
        state.seasonElapsedMs == null ? '—' : `${state.seasonElapsedMs.toFixed(0)} ms`,
      ),
    );
    head.appendChild(stats);

    const btnRow = el('div', 'row-actions');
    btnRow.style.marginTop = '14px';
    const runBtn = el('button', 'btn') as HTMLButtonElement;
    runBtn.textContent = state.gardenResults.length ? '重新结算整季生长' : '开始整季生长结算 (Worker)';
    runBtn.onclick = async () => {
      runBtn.disabled = true;
      runBtn.textContent = '结算中…';
      const res = await gameStore.worker.runSeason({
        type: 'season',
        seed: state.seed,
        plotCount: 100,
        days: 60,
      });
      gameStore.setSeason(res.weather, res.results, res.elapsedMs);
      toast(`100 块茶园结算完成，耗时 ${res.elapsedMs.toFixed(1)} ms`);
      runBtn.disabled = false;
      this.rerender();
    };
    btnRow.appendChild(runBtn);
    head.appendChild(btnRow);
    this.root.appendChild(head);

    if (!state.gardenResults.length) {
      const empty = el('div', 'card empty', '点击上方按钮，由 Web Worker 完成 100 块茶园一整季的生长结算。');
      this.root.appendChild(empty);
      return;
    }

    // 天气带
    const weatherCard = el('div', 'card');
    weatherCard.appendChild(el('h2', undefined, '🌦️ 春茶季天气'));
    const strip = el('div', 'weather-strip');
    for (const w of state.weather) {
      const d = el('div', 'weather-day');
      d.append(
        el('div', undefined, `D${w.day + 1}`),
        el('div', 'w-icon', WEATHER_ICON[w.type]),
        el('div', undefined, `${w.avgTemp.toFixed(0)}℃`),
      );
      strip.appendChild(d);
    }
    weatherCard.appendChild(strip);
    this.root.appendChild(weatherCard);

    // 百园地图
    const mapCard = el('div', 'card');
    mapCard.appendChild(el('h2', undefined, '🗺️ 百园分布图(颜色=物候期，悬浮看名称，点击查看)'));
    const wrap = el('div', 'map-wrap');
    wrap.appendChild(this.buildMap(state.gardenResults));
    mapCard.appendChild(wrap);
    const legend = el('div', 'legend');
    for (const stage of Object.keys(STAGE_LABEL) as GrowthStage[]) {
      const item = el('span');
      item.innerHTML = `<i style="background:${STAGE_COLOR[stage]}"></i>${STAGE_LABEL[stage]}`;
      legend.appendChild(item);
    }
    mapCard.appendChild(legend);
    this.root.appendChild(mapCard);

    // 详情面板
    if (this.selected) {
      this.root.appendChild(this.buildDetail(this.selected));
    }
  }

  private stat(label: string, value: string): HTMLElement {
    const s = el('div', 'stat');
    s.append(el('div', 'label', label), el('div', 'value', value));
    return s;
  }

  private buildMap(results: GardenSeasonResult[]): SVGSVGElement {
    const svgNS = 'http://www.w3.org/2000/svg';
    const cols = 10;
    const cell = 58;
    const rows = Math.ceil(results.length / cols);
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${cols * cell} ${rows * cell}`);
    svg.style.width = '100%';
    svg.style.maxWidth = '720px';
    svg.style.display = 'block';
    svg.style.margin = '0 auto';

    results.forEach((r, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const stage = r.daily.at(-1)!.stage;
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'plot-cell');
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(col * cell + 4));
      rect.setAttribute('y', String(row * cell + 4));
      rect.setAttribute('width', String(cell - 8));
      rect.setAttribute('height', String(cell - 8));
      rect.setAttribute('rx', '8');
      rect.setAttribute('fill', STAGE_COLOR[stage]);
      rect.setAttribute('stroke', '#fffdf6');
      rect.setAttribute('stroke-width', '1.5');
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `${r.plot.name}｜海拔${r.plot.altitude}m｜${STAGE_LABEL[stage]}｜采摘窗 D${r.advice.windowStart + 1}-D${r.advice.windowEnd + 1}`;
      rect.appendChild(title);

      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('x', String(col * cell + cell / 2));
      txt.setAttribute('y', String(row * cell + cell / 2 + 4));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '11');
      txt.setAttribute('fill', stage === 'dormant' ? '#6a665a' : '#fff');
      txt.setAttribute('pointer-events', 'none');
      txt.textContent = `${r.plot.altitude}`;

      g.append(rect, txt);
      g.onclick = () => {
        this.selected = r;
        this.rerender();
      };
      svg.appendChild(g);
    });
    return svg;
  }

  private buildDetail(r: GardenSeasonResult): HTMLElement {
    const card = el('div', 'card');
    const cultivar = getCultivar(r.plot.cultivarId);
    card.appendChild(el('h2', undefined, `📍 地块 #${r.plot.id} ${r.plot.name}`));

    const info = el('div', 'grid cols-3');
    const addInfo = (k: string, v: string) => {
      const s = el('div', 'stat');
      s.append(el('div', 'label', k), el('div', 'value', v));
      info.appendChild(s);
    };
    addInfo('海拔 / 坡度', `${r.plot.altitude}m / ${r.plot.slope}°`);
    addInfo('坡向', `${aspectName(r.plot.aspect)}坡`);
    addInfo('品种', cultivar.name);
    addInfo('土壤持水', pct(r.plot.soilRetention, 0));
    addInfo('雾露系数', pct(r.plot.mistFactor, 0));
    addInfo(
      '采摘窗口',
      `D${r.advice.windowStart + 1} ~ D${r.advice.windowEnd + 1}`,
    );
    card.appendChild(info);

    // 生长曲线: 积温 + 土壤水分
    const gddPts = r.daily.map((d) => ({ t: d.day + 1, v: d.gdd / cultivar.gddNeed }));
    const waterPts = r.daily.map((d) => ({ t: d.day + 1, v: d.soilWater }));
    const stressPts = r.daily.map((d) => ({
      t: d.day + 1,
      v: d.stressDays / Math.max(1, d.day + 1),
    }));
    const chart = lineChart(
      [
        { points: gddPts, color: '#4a7c4e', label: '积温/需求' },
        { points: waterPts, color: '#3f6d8e', label: '土壤水分' },
        { points: stressPts, color: '#b34a3a', label: '胁迫占比', dashed: true },
      ],
      { yMax: 1.2, height: 230 },
    );
    const chartBox = el('div', 'chart-box');
    chartBox.appendChild(chart);
    const lg = el('div', 'chart-legend');
    lg.innerHTML =
      '<span><i style="background:#4a7c4e"></i>积温成熟度</span><span><i style="background:#3f6d8e"></i>土壤水分</span><span><i style="background:#b34a3a"></i>胁迫占比</span>';
    chartBox.appendChild(lg);
    card.appendChild(chartBox);

    // 近期胁迫说明
    const lastStress = r.daily.filter((d) => d.stress.drought || d.stress.heat || d.stress.waterlogged || d.stress.frost).slice(-5);
    if (lastStress.length) {
      const names = lastStress
        .map((d) => {
          const tags: string[] = [];
          if (d.stress.drought) tags.push('干旱');
          if (d.stress.heat) tags.push('高温');
          if (d.stress.waterlogged) tags.push('渍水');
          if (d.stress.frost) tags.push('霜冻');
          return `D${d.day + 1}(${tags.join('/')})`;
        })
        .join('、');
      card.appendChild(el('p', 'muted', `近期胁迫: ${names}`));
    }

    // 采摘操作
    card.appendChild(el('h3', undefined, '🧺 采摘鲜叶'));
    const pickRow = el('div', 'section-flex');
    const left = el('div');
    left.appendChild(el('div', 'muted', '采摘标准'));
    const stdWrap = el('div', 'pill-select');
    let standard = '一芽二叶';
    PICK_STANDARDS.forEach((std) => {
      const b = el('button', std === standard ? 'active' : undefined, std);
      b.onclick = () => {
        standard = std;
        stdWrap.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.refreshPreview();
      };
      stdWrap.appendChild(b);
    });
    left.appendChild(stdWrap);

    const dayLabel = el('div', 'muted', '采摘日');
    const dayInput = document.createElement('input');
    dayInput.type = 'range';
    dayInput.min = '0';
    dayInput.max = String(r.daily.length - 1);
    dayInput.value = String(r.advice.windowStart);
    dayLabel.textContent = `采摘日: D${Number(dayInput.value) + 1}`;
    dayInput.oninput = () => {
      dayLabel.textContent = `采摘日: D${Number(dayInput.value) + 1}`;
      this.refreshPreview();
    };
    left.append(dayLabel, dayInput);

    const preview = el('div', 'stat');
    preview.style.marginTop = '12px';
    const refreshPreview = () => {
      const leaf = pickLeaves(r, {
        standard,
        pickedDay: Number(dayInput.value),
        seed: gameStore.getState().seed,
      });
      preview.innerHTML = '';
      preview.append(
        el('div', 'label', '预计鲜叶质量与产量'),
        el('div', 'value', `${leaf.quality.toFixed(1)} 分 / ${leaf.weightKg} kg`),
        el('div', 'muted', `初始含水率 ${pct(leaf.initialMoisture)}`),
      );
    };
    left.appendChild(preview);
    this.refreshPreview = refreshPreview;
    refreshPreview();

    const pickBtn = el('button', 'btn', '采摘并送入制茶车间');
    pickBtn.style.marginTop = '12px';
    pickBtn.onclick = () => {
      const leaf = pickLeaves(r, {
        standard,
        pickedDay: Number(dayInput.value),
        seed: gameStore.getState().seed + Date.now() % 100000,
      });
      gameStore.addLeafBatch(leaf);
      toast(`已采摘 ${leaf.weightKg}kg 鲜叶，质量 ${leaf.quality.toFixed(1)} 分`);
      this.rerender();
    };
    left.appendChild(pickBtn);

    pickRow.appendChild(left);
    pickRow.appendChild(el('div', 'muted', '提示: 窗口内采摘的鲜叶成熟度最佳；过早欠熟、过窗老化，近期遇到旱/热/渍/霜都会拉低质量。'));
    card.appendChild(pickRow);

    return card;
  }

  private refreshPreview: () => void = () => {};
}
