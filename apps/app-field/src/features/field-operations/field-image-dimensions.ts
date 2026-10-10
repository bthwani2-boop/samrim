// DSH's ValidateImageBytes requires positive dimensions no larger than 6000 px per axis.
// This is a client-side preflight only; DSH validates the decoded image bytes independently.
export function fieldJoiningImageDimensionsSupported(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width >= 1 && width <= 6000 && height >= 1 && height <= 6000;
}
