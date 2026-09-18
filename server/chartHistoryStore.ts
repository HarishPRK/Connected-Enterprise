import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const HISTORY_RETENTION_MS = 7 * 86_400_000;
const DETAIL_MS = 3_600_000;
const ARCHIVE_BIN_MS = 300_000;

/** Keep recent observations in detail and older observations at five-minute
 * resolution. Stored timestamps/values always come from actual observations. */
export function compactHistory<T extends { t: number }>(points: readonly T[], now: number): T[] {
  const out: T[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.t) || point.t < now - HISTORY_RETENTION_MS || point.t > now + 5_000) continue;
    const last = out[out.length - 1];
    if (last && point.t < now - DETAIL_MS
      && Math.floor(last.t / ARCHIVE_BIN_MS) === Math.floor(point.t / ARCHIVE_BIN_MS)) {
      out[out.length - 1] = point;
    } else out.push(point);
  }
  return out;
}

/** Bounded selection, including both edges even when the input is oversized. */
export function sampleHistory<T>(points: readonly T[], maxPoints: number): T[] {
  const count = Number.isFinite(maxPoints) ? Math.max(2, Math.min(720, Math.floor(maxPoints))) : 360;
  if (points.length <= count) return [...points];
  return Array.from({ length: count }, (_, i) => points[Math.round(i * (points.length - 1) / (count - 1))]);
}

export class ChartHistoryStore<T extends { t: number }> {
  readonly buffers = new Map<string, T[]>();
  private file?: string;
  private timer?: ReturnType<typeof setInterval>;
  private writing = false;
  private dirty = false;

  record(key: string, point: T): void {
    const points = this.buffers.get(key) ?? [];
    if (!Number.isFinite(point.t) || (points.length && point.t - points[points.length - 1].t < 2_000)) return;
    points.push(point);
    this.buffers.set(key, compactHistory(points, point.t));
    this.dirty = true;
  }

  start(file: string, now = Date.now()): void {
    if (this.file) return;
    this.file = file;
    if (existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as { series?: Record<string, T[]> };
        for (const [key, points] of Object.entries(saved.series ?? {})) {
          if (!Array.isArray(points)) continue;
          const retained = compactHistory(points.filter((p) => p && typeof p === 'object').sort((a, b) => a.t - b.t), now);
          if (retained.length) this.buffers.set(key, retained);
        }
      } catch (error) {
        console.error('[chart-history] Could not restore history:', error);
      }
    }
    this.timer = setInterval(() => { void this.flush(); }, 30_000);
    this.timer.unref();
  }

  private snapshot(): string {
    const now = Date.now();
    for (const [key, points] of this.buffers) {
      const retained = compactHistory(points, now);
      if (retained.length) this.buffers.set(key, retained);
      else this.buffers.delete(key);
    }
    return JSON.stringify({ version: 1, series: Object.fromEntries(this.buffers) });
  }

  async flush(): Promise<void> {
    if (!this.file || this.writing || !this.dirty) return;
    this.writing = true;
    this.dirty = false;
    try {
      const data = this.snapshot();
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, data);
      await rename(`${this.file}.tmp`, this.file);
    } catch (error) {
      this.dirty = true;
      console.error('[chart-history] Could not save history:', error);
    } finally {
      this.writing = false;
    }
  }

  /** Synchronous final checkpoint is safe inside Node's exit event. */
  close(): void {
    clearInterval(this.timer);
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.exit`, this.snapshot());
      renameSync(`${this.file}.exit`, this.file);
    } catch (error) {
      console.error('[chart-history] Could not checkpoint history:', error);
    }
  }
}
