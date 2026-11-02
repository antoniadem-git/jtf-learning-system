// Shared definition of "the current-year grants we're working with".
// Used by both /api/grantee-signal and /api/economic-output so the two
// always filter identically. (The leading underscore keeps Vercel from
// publishing this file as its own endpoint.)
//
// A Grants & Services record is in the cohort when:
//   - Grant Year is the current calendar year
//   - Strategy (from Proposal) is not State Policy, Federal Policy or Convening
//   - Status is not "On Hold (Matching Funds)", "On Hold (Future Multi-Year)"
//     or "Never Paid Out"
//   - Service Type is not "TA" (technical assistance; these carry no grant
//     amount)
//
// This mirrors the "2026 Grants (LEARNING SYSTEM)" view in Airtable.

export const EXCLUDED_STRATEGIES = ['State Policy', 'Federal Policy', 'Convening'];
export const EXCLUDED_SERVICE_TYPES = ['TA'];
export const EXCLUDED_STATUSES = ['On Hold (Matching Funds)', 'On Hold (Future Multi-Year)', 'Never Paid Out'];

export function isCohortGrant(fields, year) {
  if (Number(fields['Grant Year']) !== year) return false;
  if (EXCLUDED_STATUSES.includes(fields['Status'])) return false;
  if (EXCLUDED_SERVICE_TYPES.includes(fields['Service Type'])) return false;
  const strategy = fields['Strategy (from Proposal)'];
  const strategies = Array.isArray(strategy) ? strategy : strategy ? [strategy] : [];
  if (strategies.some((x) => EXCLUDED_STRATEGIES.includes(x))) return false;
  return true;
}
