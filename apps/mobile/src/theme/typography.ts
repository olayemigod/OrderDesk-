export const SELLERTRAY_MIN_READABLE_FONT_SIZE = 14;

export function sellerTrayScaledFontSize(fontSize: number, fontScale: number): number {
  return Math.max(
    SELLERTRAY_MIN_READABLE_FONT_SIZE,
    Number((fontSize * fontScale).toFixed(2)),
  );
}

export function sellerTrayScaledLineHeight(
  lineHeight: number,
  fontScale: number,
  scaledFontSize: number,
): number {
  return Math.max(
    scaledFontSize,
    Number((lineHeight * fontScale).toFixed(2)),
  );
}
