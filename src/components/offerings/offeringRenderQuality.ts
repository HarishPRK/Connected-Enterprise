/** Size the drawing buffer for displayed pixels, including the app's CSS zoom.
 * Supersample ordinary monitors; retain native density up to 2x on HiDPI.
 * Bound large screens to a 4K-sized framebuffer and an 8192 px side. */
export function offeringPixelRatio(logicalWidth: number, logicalHeight: number, displayWidth: number, displayHeight: number, nativeDpr: number) {
  if (Math.min(logicalWidth, logicalHeight, displayWidth, displayHeight) <= 0) return 1.5;
  const density = Math.min(2, Math.max(1.5, nativeDpr));
  const budget = Math.sqrt(8_294_400 / (displayWidth * displayHeight));
  const scale = Math.max(displayWidth / logicalWidth, displayHeight / logicalHeight);
  return Math.min(scale * Math.min(density, Math.max(1, budget)), 8192 / Math.max(logicalWidth, logicalHeight));
}
