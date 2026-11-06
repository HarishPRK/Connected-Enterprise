/** Match displayed pixels (including CSS zoom), without mandatory 1.5x
 * supersampling. A 1080p render budget keeps large/high-DPI screens bounded;
 * small HiDPI surfaces retain up to 1.5x density for readable equipment labels. */
export function offeringPixelRatio(logicalWidth: number, logicalHeight: number, displayWidth: number, displayHeight: number, nativeDpr: number) {
  if (![logicalWidth, logicalHeight, displayWidth, displayHeight, nativeDpr].every(Number.isFinite) ||
    Math.min(logicalWidth, logicalHeight, displayWidth, displayHeight) <= 0) return 1;
  const density = Math.min(1.5, Math.max(1, nativeDpr));
  const budget = Math.sqrt(2_073_600 / (logicalWidth * logicalHeight));
  const scale = Math.max(displayWidth / logicalWidth, displayHeight / logicalHeight);
  return Math.min(scale * density, budget, 4096 / Math.max(logicalWidth, logicalHeight));
}
