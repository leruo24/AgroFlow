// One way to write an area (AF-07), the same as the server's AreaFormat and the admin site's
// formatArea: hectares to the precision the value needs, never "0 ha" for a real small field, and
// square metres beside it under a hectare: "0.02 ha (200 m²)". Cases: docs/audit/fixtures/area-cases.json.

export const M2_PER_HA = 10_000;

export function hectaresText(ha: number): string {
  if (!Number.isFinite(ha) || ha <= 0) return '0 ha';
  const decimals = ha >= 0.01 ? 2 : ha >= 0.001 ? 3 : 4;
  const factor = 10 ** decimals;
  let rounded = Math.round(ha * factor + Number.EPSILON) / factor;
  if (rounded <= 0) rounded = 1 / factor;
  return `${Number(rounded.toFixed(decimals))} ha`;
}

export function squareMetresText(m2: number): string {
  const rounded = m2 < 10 ? Math.round(m2 * 10) / 10 : Math.round(m2);
  const [whole, fraction] = String(rounded).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? `.${fraction}` : ''} m²`;
}

/** "0.02 ha (200 m²)", "1.5 ha", or null when there is no area. */
export function formatArea(hectares: number | null | undefined): string | null {
  if (hectares == null || !Number.isFinite(hectares) || hectares <= 0) return null;
  return hectares < 1 ? `${hectaresText(hectares)} (${squareMetresText(hectares * M2_PER_HA)})` : hectaresText(hectares);
}

/** The same, from square metres (zone.area_m2). */
export function formatAreaM2(m2: number | null | undefined): string | null {
  return m2 == null ? null : formatArea(m2 / M2_PER_HA);
}

/** Where a shown area comes from: saved on the server, or only a suggestion to confirm. */
export type AreaSource = 'saved' | 'suggested' | 'none';
