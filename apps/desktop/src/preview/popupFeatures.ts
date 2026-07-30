/**
 * Sizing for popups opened by `window.open`.
 *
 * The features string is whatever the page passed as the third argument. It is
 * untrusted input, so values are clamped rather than believed — a page must not
 * be able to open a one-pixel window, or one larger than the screen.
 *
 * Electron-free so it can be unit-tested.
 */

export const POPUP_DEFAULT_WIDTH = 520;
export const POPUP_DEFAULT_HEIGHT = 640;
const POPUP_MIN = 240;
const POPUP_MAX = 2000;

export interface PopupSize {
  readonly width: number;
  readonly height: number;
}

function clamp(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), POPUP_MIN), POPUP_MAX);
}

/** Parses `"width=500,height=600,menubar=no"`; anything unusable falls back. */
export function parsePopupFeatures(features: string | undefined): PopupSize {
  const size = { width: POPUP_DEFAULT_WIDTH, height: POPUP_DEFAULT_HEIGHT };
  if (!features) return size;

  let width = Number.NaN;
  let height = Number.NaN;
  for (const part of features.split(",")) {
    const [rawKey, rawValue] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    const value = Number(rawValue?.trim());
    if (key === "width" || key === "innerwidth") width = value;
    if (key === "height" || key === "innerheight") height = value;
  }

  return {
    width: clamp(width, POPUP_DEFAULT_WIDTH),
    height: clamp(height, POPUP_DEFAULT_HEIGHT),
  };
}
