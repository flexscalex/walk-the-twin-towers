// Tints for the tower view. Pure module, safe to import from client components.
//
// Industry labels come from the source rows verbatim; colors are assigned by
// sorted label at build time (lib/floors.ts) so the mapping is stable across
// builds as long as the set of labels is stable. The palette is mid-saturation
// and warm-biased so it sits on the paper background in daylight.

export const PALETTE: string[] = [
  "#b8862b", "#c2643a", "#7a8f3c", "#3f7f7a", "#4d6fa8", "#8a5aa8", "#b5486e", "#d18f2b",
  "#5f8f5c", "#2f6f8f", "#a0522d", "#6b8e23", "#c48a6a", "#5a7d9a", "#9c7a3c", "#7f6b8f",
  "#b0713f", "#4f8a8b", "#a05a5a", "#6a8c69", "#8f7a52", "#c9a227", "#6d7f9c", "#a8743d",
];

/** Floor has tenant rows, but every row leaves industry blank in the source. */
export const INDUSTRY_BLANK_COLOR = "#a89c8c";
/** No tenant row places anything on this floor. Desaturated, close to the paper. */
export const NO_RECORD_COLOR = "#e6dfd0";
/** No tenant row, and geometry-params lists the floor as mechanical. */
export const NO_RECORD_MECHANICAL_COLOR = "#d3cab8";

export const PAPER = "#f7f1e6";
export const PAPER_2 = "#efe7d8";
export const BRASS = "#b8862b";
export const INK = "#2a2520";

export function colorForIndustry(industry: string, index: Record<string, string>): string {
  return index[industry] ?? INDUSTRY_BLANK_COLOR;
}
