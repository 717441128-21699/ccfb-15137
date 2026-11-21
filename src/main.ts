import './styles.css';
import { gameStore } from './store';
import { el, toast } from './ui/dom';
import { MountainMapPage } from './pages/MountainMapPage';
import { WorkshopPage } from './pages/WorkshopPage';
import { ReviewPage } from './pages/ReviewPage';
import { WarehousePage } from './pages/WarehousePage';

type Tab = 'mountain' | 'workshop' | 'review' | 'warehouse';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'mountain', label: '🏔️ 茶山地图' },
  { key: 'workshop', label: '🍵 制茶车间' },
  { key: 'review', label: '🧐 评茶' },
  { key: 'warehouse', label: '📦 茶仓' },
];

class App {
  private current: Tab = 'mountain';
  private container = el('div');
  private pages: Record<Tab, { mount: () => HTMLElement }>;

  constructor() {
    this.pages = {
      mountain: new MountainMapPage(() => this.rerender()),
      workshop: new WorkshopPage(() => this.rerender(), (t) => this.navigate(t as Tab)),
      review: new ReviewPage(() => this.rerender()),
      warehouse: new WarehousePage(() => this.rerender(), (t) => this.navigate(t as Tab)),
    };
  }

  start(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.appendChild(this.buildTopbar());
    app.appendChild(this.container);
    gameStore.subscribe(() => this.rerender());
    this.rerender();
  }

  private buildTopbar(): HTMLElement {
    const header = el('header', 'topbar');
    header.appendChild(el('div', 'logo', '茶山经营 · 制茶工坊'));

    const nav = el('nav', 'tabs');
    for (const t of TABS) {
      const btn = el('button', t.key === this.current ? 'active' : undefined, t.label);
      btn.onclick = () => this.navigate(t.key);
      btn.dataset.tab = t.key;
      nav.appendChild(btn);
    }
    header.appendChild(nav);

    const seedBox = el('div', 'seed-box');
    seedBox.appendChild(el('span', undefined, '季节种子'));
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.value = String(gameStore.getState().seed);
    const applyBtn = el('button', 'btn ghost small', '换季重开');
    applyBtn.onclick = () => {
      const seed = Number(seedInput.value) || 20260301;
      gameStore.reset(seed);
      toast(`已切换到种子 ${seed} 的新茶季`);
      this.navigate('mountain');
    };
    seedBox.append(seedInput, applyBtn);
    header.appendChild(seedBox);
    return header;
  }

  private navigate(tab: Tab): void {
    this.current = tab;
    this.rerender();
  }

  private rerender(): void {
    // 更新导航高亮
    document.querySelectorAll<HTMLButtonElement>('nav.tabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === this.current);
    });
    this.container.innerHTML = '';
    this.container.appendChild(this.pages[this.current].mount());
  }
}

new App().start();
