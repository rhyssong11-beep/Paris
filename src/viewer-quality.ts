export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityMode = 'auto' | QualityLevel;
export const QUALITY = {
  low: { pixelRatio: 1, shadow: 1024, samples: 0, aoScale: 0, bloom: false },
  medium: { pixelRatio: 1.5, shadow: 2048, samples: 2, aoScale: 0.6, bloom: true },
  high: { pixelRatio: 2, shadow: 4096, samples: 4, aoScale: 1, bloom: true },
} as const;
const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];
const LABELS = { low: '절약', medium: '균형', high: '높음' };
const STORAGE_KEY = 'paris-viewer-quality';

/** Automatic quality only changes after sustained frame pressure, avoiding visible oscillation. */
export class ViewerQuality {
  mode: QualityMode = 'auto';
  level: QualityLevel;
  private frames = 0;
  private elapsed = 0;
  private slow = 0;
  private fast = 0;
  private warmup = 2;

  constructor(private select: HTMLSelectElement, private changed: () => void) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'auto' || LEVELS.includes(saved as QualityLevel)) this.mode = saved as QualityMode;
    } catch { /* Private browsing may disable storage. */ }
    this.level = this.mode === 'auto' ? this.ceiling() : this.mode;
    select.value = this.mode;
    this.label();
    select.addEventListener('change', () => {
      this.mode = select.value as QualityMode;
      this.level = this.mode === 'auto' ? this.ceiling() : this.mode;
      this.slow = this.fast = this.frames = this.elapsed = 0;
      this.warmup = 2;
      try { localStorage.setItem(STORAGE_KEY, this.mode); } catch { /* Optional preference. */ }
      this.label();
      this.changed();
    });
  }

  private ceiling(): QualityLevel {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if ((memory && memory <= 2) || navigator.hardwareConcurrency <= 2) return 'low';
    return window.innerWidth < 760 || (memory && memory <= 4) ? 'medium' : 'high';
  }

  private label() {
    this.select.options[0].textContent = `자동 · ${LABELS[this.level]}`;
    this.select.dataset.level = this.level;
  }

  resize() {
    if (this.mode === 'auto' && LEVELS.indexOf(this.level) > LEVELS.indexOf(this.ceiling())) {
      this.level = this.ceiling();
      this.label();
    }
  }

  sample(dt: number) {
    if (this.mode !== 'auto' || document.hidden || dt <= 0 || dt > 1) return;
    if (this.warmup > 0) { this.warmup -= dt; return; }
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 1) return;
    const ms = this.elapsed * 1000 / this.frames;
    this.frames = this.elapsed = 0;
    this.slow = ms > 34 ? this.slow + 1 : 0;
    this.fast = ms < 19 ? this.fast + 1 : 0;
    const index = LEVELS.indexOf(this.level);
    const next = this.slow >= 3 ? Math.max(0, index - 1)
      : this.fast >= 12 ? Math.min(LEVELS.indexOf(this.ceiling()), index + 1) : index;
    if (next === index) return;
    this.level = LEVELS[next];
    this.slow = this.fast = 0;
    this.warmup = 3;
    this.label();
    this.changed();
  }
}
