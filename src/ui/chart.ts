import type { CurvePoint } from '../engine/types';

export interface ChartSeries {
  points: { t: number; v: number }[];
  color: string;
  label: string;
  dashed?: boolean;
}

/**
 * 轻量 SVG 折线图，无第三方依赖。
 * 多条曲线共享同一时间轴，值域 0..1(含水率/氧化程度)。
 */
export function lineChart(
  series: ChartSeries[],
  opts: { width?: number; height?: number; yMax?: number; yLabel?: string } = {},
): SVGSVGElement {
  const width = opts.width ?? 640;
  const height = opts.height ?? 260;
  const padL = 46;
  const padR = 14;
  const padT = 14;
  const padB = 30;
  const yMax = opts.yMax ?? 1;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(height));
  svg.style.display = 'block';

  const tMax = Math.max(1, ...series.map((s) => s.points.at(-1)?.t ?? 0));
  const x = (t: number) => padL + (t / tMax) * (width - padL - padR);
  const y = (v: number) =>
    padT + (1 - Math.min(v, yMax) / yMax) * (height - padT - padB);

  // 网格 + Y 轴刻度(百分比)
  for (let i = 0; i <= 5; i++) {
    const val = (yMax / 5) * i;
    const yy = y(val);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(padL));
    line.setAttribute('x2', String(width - padR));
    line.setAttribute('y1', String(yy));
    line.setAttribute('y2', String(yy));
    line.setAttribute('stroke', '#e3ddcc');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', String(padL - 6));
    text.setAttribute('y', String(yy + 4));
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', '#8a8f83');
    text.textContent = `${Math.round(val * 100)}%`;
    svg.appendChild(text);
  }

  // X 轴刻度(时间，分钟)
  const tickCount = 6;
  for (let i = 0; i <= tickCount; i++) {
    const t = Math.round((tMax / tickCount) * i);
    const xx = x(t);
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', String(xx));
    text.setAttribute('y', String(height - 8));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', '#8a8f83');
    text.textContent = `${t}分`;
    svg.appendChild(text);
  }

  // 曲线
  for (const s of series) {
    if (s.points.length === 0) continue;
    // 长曲线抽稀到 ≤ 300 个点，避免 SVG 节点过多
    const stride = Math.max(1, Math.ceil(s.points.length / 300));
    const sampled = s.points.filter((_, i) => i % stride === 0);
    const d = sampled
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
      .join(' ');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', s.color);
    path.setAttribute('stroke-width', '2');
    if (s.dashed) path.setAttribute('stroke-dasharray', '6 4');
    svg.appendChild(path);
  }

  return svg;
}

export function moistureSeries(curve: CurvePoint[], color = '#3f6d8e'): ChartSeries {
  return {
    points: curve.map((p) => ({ t: p.t, v: p.moisture })),
    color,
    label: '含水率',
  };
}

export function oxidationSeries(curve: CurvePoint[], color = '#b07d2b'): ChartSeries {
  return {
    points: curve.map((p) => ({ t: p.t, v: p.oxidation })),
    color,
    label: '氧化程度',
  };
}

export function damageSeries(curve: CurvePoint[], color = '#b34a3a'): ChartSeries {
  return {
    points: curve.map((p) => ({ t: p.t, v: p.damage })),
    color,
    label: '热损伤',
  };
}
