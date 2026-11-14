/**
 * Presentation geometry that is part of the deterministic layout contract.
 *
 * A zone renders a two-line header (label + zone kind). Child geometry must
 * start below this reserved band; otherwise React Flow children can cover the
 * zone title even while still being technically inside the parent rectangle.
 */
export const ROOT_LAYOUT_PADDING = Object.freeze({
  top: 32,
  left: 32,
  bottom: 32,
  right: 32,
});

export const ZONE_CONTENT_PADDING = Object.freeze({
  // The rendered Arvidsjaur group header contains an icon, a primary label
  // and a secondary provenance line. Reserve a full card-height band before
  // ELK places the first child; 64px was enough for the old zone-only canvas
  // but allowed compact Chromium cards to touch the header after scaling.
  top: 112,
  left: 32,
  bottom: 32,
  right: 32,
});

export const ZONE_HEADER_RESERVED_HEIGHT = ZONE_CONTENT_PADDING.top;

export function elkPadding(value: Readonly<{top:number;left:number;bottom:number;right:number}>): string {
  return `[top=${value.top},left=${value.left},bottom=${value.bottom},right=${value.right}]`;
}
