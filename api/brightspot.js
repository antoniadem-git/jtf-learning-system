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
      fetchAll(LEL_BASE, 'LEL Step 2 Application', ['ID', 'LEL Program (from Step 1)', 'Step 1 Application']),
    ]);

    // TEMP DIAGNOSTIC (aggregate counts only) - remove after use.
    if (req.query && req.query.debug === '1') {
      const step1 = await fetchAll(LEL_BASE, 'LEL Step 1 Application', ['LEL Program', 'Grant Proposal', 'Submission Date']);
      const pn = new Map();
      proposals.forEach((p) => { const n = nameKey((p.fields || {})['ID']); if (n) pn.set(p.id, n); });
      const cohortNames = new Set();
      grants.forEach((g) => {
        const f = g.fields || {};
        if (!isCohortGrant(f, currentYear)) return;
        (f['Grant Proposals'] || []).forEach((id) => pn.get(id) && cohortNames.add(pn.get(id)));
      });
      const matched = lelProposals.filter((p) => cohortNames.has(nameKey((p.fields || {})['ID'])));
      const matchedIds = new Set(matched.map((p) => p.id));
      const tally = (arr) => arr.reduce((a, v) => { a[v] = (a[v] || 0) + 1; return a; }, {});
      const shape = (v) => (Array.isArray(v) ? 'array:' + v.map((x) => typeof x).join(',') : typeof v);
      const s1Prog = step1.filter((r) => (r.fields || {})['LEL Program']);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        cohortProposalNames: cohortNames.size,
        step2Total: lelProposals.length,
        step2Matched: matched.length,
        step2MatchedWithStep1Link: matched.filter((p) => ((p.fields || {})['Step 1 Application'] || []).length > 0).length,
        step2MatchedWithProgramLookup: matched.filter((p) => ((p.fields || {})['LEL Program (from Step 1)'] || []).length > 0).length,
        step2MatchedLookupShapes: tally(matched.map((p) => shape((p.fields || {})['LEL Program (from Step 1)']))),
        step2AllWithProgramLookup: lelProposals.filter((p) => ((p.fields || {})['LEL Program (from Step 1)'] || []).length > 0).length,
        step1Total: step1.length,
        step1WithProgram: s1Prog.length,
        step1ProgramValues: tally(s1Prog.map((r) => r.fields['LEL Program'])),
        step1ProgramBySubmissionYear: tally(s1Prog.map((r) => String((r.fields['Submission Date'] || '').slice(0, 4) || 'none'))),
        step1AllBySubmissionYear: tally(step1.map((r) => String(((r.fields || {})['Submission Date'] || '').slice(0, 4) || 'none'))),
        step1WithProgramAndLinkToMatchedStep2: s1Prog.filter((r) => (r.fields['Grant Proposal'] || []).some((id) => matchedIds.has(id))).length,
      });
      return;
    }

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
