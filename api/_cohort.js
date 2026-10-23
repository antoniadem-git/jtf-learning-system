// Shared definition of "the current-year grants we're working with".
// Used by both /api/grantee-signal and /api/economic-output so the two
// always filter identically. (The leading underscore keeps Vercel from
// publishing this file as its own endpoint.)
//
// A Grants & Services record is in the cohort when:
//   - Grant Year is the current calendar year
//   - Cycle (from Proposal) is not Policy or Convening
//   - Status is not "On Hold (Matching Funds)" or "On Hold (Future Multi-Year)"

export const EXCLUDED_CYCLES = ['Policy', 'Convening'];
export const EXCLUDED_STATUSES = ['On Hold (Matching Funds)', 'On Hold (Future Multi-Year)'];

export function isCohortGrant(fields, year) {
  if (Number(fields['Grant Year']) !== year) return false;
  if (EXCLUDED_STATUSES.includes(fields['Status'])) return false;
  const cycle = fields['Cycle (from Proposal)'];
  const cycles = Array.isArray(cycle) ? cycle : cycle ? [cycle] : [];
  if (cycles.some((c) => EXCLUDED_CYCLES.includes(c))) return false;
  return true;
}
