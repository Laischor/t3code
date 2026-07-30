import { describe, expect, it } from "vite-plus/test";

import { parsePopupFeatures, POPUP_DEFAULT_HEIGHT, POPUP_DEFAULT_WIDTH } from "./popupFeatures.ts";

describe("parsePopupFeatures", () => {
  it("reads width and height", () => {
    expect(parsePopupFeatures("width=500,height=600")).toEqual({ width: 500, height: 600 });
  });

  it("ignores the other features a page may pass", () => {
    expect(parsePopupFeatures("menubar=no,width=500,toolbar=0,height=600,scrollbars=yes")).toEqual({
      width: 500,
      height: 600,
    });
  });

  it("accepts the inner* spellings and tolerates spacing", () => {
    expect(parsePopupFeatures(" innerWidth = 480 , innerHeight = 700 ")).toEqual({
      width: 480,
      height: 700,
    });
  });

  it("falls back when the string is missing or useless", () => {
    const fallback = { width: POPUP_DEFAULT_WIDTH, height: POPUP_DEFAULT_HEIGHT };
    expect(parsePopupFeatures(undefined)).toEqual(fallback);
    expect(parsePopupFeatures("")).toEqual(fallback);
    expect(parsePopupFeatures("menubar=no")).toEqual(fallback);
    expect(parsePopupFeatures("width=abc,height=NaN")).toEqual(fallback);
  });

  it("clamps values a page must not be able to ask for", () => {
    // A sliver of a window, or one bigger than any screen.
    expect(parsePopupFeatures("width=1,height=1")).toEqual({ width: 240, height: 240 });
    expect(parsePopupFeatures("width=99999,height=99999")).toEqual({ width: 2000, height: 2000 });
    expect(parsePopupFeatures("width=-500,height=-500")).toEqual({ width: 240, height: 240 });
  });

  it("rounds fractional sizes", () => {
    expect(parsePopupFeatures("width=500.6,height=600.2")).toEqual({ width: 501, height: 600 });
  });
});
