export const DEFAULT_VISION_PAGE_LIMIT = 3;
export const DEFAULT_VISION_MODE = 'first3';
export const VISION_TIMEOUT_MS_PER_PAGE = 10_000;
export const VISION_ROUTE_TIMEOUT_MS = DEFAULT_VISION_PAGE_LIMIT * VISION_TIMEOUT_MS_PER_PAGE;

export type VisionMode = typeof DEFAULT_VISION_MODE;

export function getVisionPageLimit(mode: string = DEFAULT_VISION_MODE): number | undefined {
  if (mode === DEFAULT_VISION_MODE) return DEFAULT_VISION_PAGE_LIMIT;
  return undefined;
}
