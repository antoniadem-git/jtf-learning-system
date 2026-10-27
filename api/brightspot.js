// Serverless function (runs on Vercel's servers, never in the browser).
// Two counts over the current-year cohort, both from the Local Economy Lab
// (LEL) base:
//   - brightSpot:  cohort grants whose proposal is a Bright Spot proposal
//                  ("Brightspot candidates").
//   - inPipeline:  cohort grants whose proposal has ANY non-empty LEL
//                  Program ("Bright Spot" or "Get Ready"), used for
//                  "Projects in pipeline". byProgram breaks that count down
//                  by program value as a sanity check.
//
// How a grant is matched to the LEL base:
//   1. A cohort grant (Contacts & Grants base, rules in ./_cohort.js) links
//      to its proposal(s) through "Grants & Services" > "Grant Proposals".
//   2. The Proposals table's "ID" text (e.g. "Wind River-CED-07/08/2025")
//      is the proposal's name. The two bases use different record IDs, so
//      this name is the shared key.
//   3. In the Local Economy Lab base, "LEL Step 2 Application" holds the
//      proposals under the same "ID" name, and its "LEL Program (from Step 1)"
//      lookup says whether the proposal came in as "Bright Spot".
// A grant counts once per count, however many proposals it has.

import { isCohortGrant } from './_cohort.js';

const CG_BASE = 'appJZpvBPzPyZL9DS';
const LEL_BASE = 'appgeINSbkSpmdB0F';
const BRIGHT_SPOT = 'Bright Spot';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;

  if (!token) {
    res.status(200).json({ error: 'not_configured' });
    return;
  }

  async function fetchAll(baseId, table, fields) {
    const records = [];
    let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
      url.searchParams.set('pageSize', '100');
      fields.forEach((f) => url.searchParams.append('fields[]', f));
      if (offset) url.searchParams.set('offset', offset);

      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`airtable_${r.status}`);

      const data = await r.json();
      records.push(...data.records);
      offset = data.offset;
    } while (offset);
    return records;
  }

  const nameKey = (v) => (typeof v === 'string' ? v.trim() : '');
  const currentYear = new Date().getFullYear();

  try {
    const [grants, proposals, lelProposals] = await Promise.all([
      fetchAll(CG_BASE, 'Grants & Services', [
        'Grant Year',
        'Status',
        'Cycle (from Proposal)',
        'Grant Proposals',
      ]),
      fetchAll(CG_BASE, 'Proposals', ['ID']),
      fetchAll(LEL_BASE, 'LEL Step 2 Application', ['ID', 'LEL Program (from Step 1)']),
    ]);

    const proposalNameById = new Map();
    proposals.forEach((p) => {
      const name = nameKey((p.fields || {})['ID']);
      if (name) proposalNameById.set(p.id, name);
    });

    const lelProgramsByName = new Map();
    lelProposals.forEach((p) => {
      const f = p.fields || {};
      const name = nameKey(f['ID']);
      if (!name) return;
      const raw = f['LEL Program (from Step 1)'];
      const programs = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const existing = lelProgramsByName.get(name) || [];
      lelProgramsByName.set(name, existing.concat(programs));
    });

    let cohortGrants = 0;
    let matchedInLel = 0;
    let brightSpot = 0;
    let inPipeline = 0;
    const byProgram = {};
    grants.forEach((g) => {
      const f = g.fields || {};
      if (!isCohortGrant(f, currentYear)) return;
      cohortGrants += 1;

      const names = (f['Grant Proposals'] || []).map((id) => proposalNameById.get(id)).filter(Boolean);
      const inLel = names.filter((n) => lelProgramsByName.has(n));
      if (inLel.length > 0) matchedInLel += 1;
      if (inLel.some((n) => lelProgramsByName.get(n).includes(BRIGHT_SPOT))) brightSpot += 1;

      const programs = new Set();
      inLel.forEach((n) =>
        lelProgramsByName.get(n).forEach((p) => {
          if (typeof p === 'string' && p.trim()) programs.add(p.trim());
        })
      );
      if (programs.size > 0) {
        inPipeline += 1;
        programs.forEach((p) => {
          byProgram[p] = (byProgram[p] || 0) + 1;
        });
      }
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ year: currentYear, grants: cohortGrants, matchedInLel, brightSpot, inPipeline, byProgram });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed', message: String(err) });
  }
}
