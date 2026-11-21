let toastEl: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, ms = 2600): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.hidden = true;
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.hidden = false;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (toastEl) toastEl.hidden = true;
  }, ms);
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
