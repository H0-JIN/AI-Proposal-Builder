export const DEFAULT_VISION_CHUNK_SIZE = 3;
export const DEFAULT_VISION_PAGE_LIMIT = DEFAULT_VISION_CHUNK_SIZE;
export const DEFAULT_VISION_MODE = 'chunk';
export const VISION_TIMEOUT_MS_PER_PAGE = 10_000;
export const VISION_ROUTE_TIMEOUT_MS = DEFAULT_VISION_CHUNK_SIZE * VISION_TIMEOUT_MS_PER_PAGE;

export type VisionMode = typeof DEFAULT_VISION_MODE | 'first3';

export function getVisionChunkSize(mode: string = DEFAULT_VISION_MODE): number | undefined {
  if (mode === DEFAULT_VISION_MODE || mode === 'first3') return DEFAULT_VISION_CHUNK_SIZE;
  return undefined;
}

export function getVisionPageLimit(mode: string = DEFAULT_VISION_MODE): number | undefined {
  return getVisionChunkSize(mode);
}
