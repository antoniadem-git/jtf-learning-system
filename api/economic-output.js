// Serverless function (runs on Vercel's servers, never in the browser).
// Sums the "Economic Output" currency field on the Grant Impact Data table
// for the current-year grant cohort in the Contacts & Grants base.
//
// Cohort rules live in ./_cohort.js (shared with /api/grantee-signal).
//
// Every Grant Impact Data record linked to a cohort grant (via its
// "Grant & Service ID" field) is counted, whether Proposed or Actual,
// except records whose "Proposed Inclusion" is set to "Exclude" (the
// table's own way of retiring a Proposed record once an Actual one
// exists, so the two aren't double-counted).

import { isCohortGrant } from './_cohort.js';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = 'appJZpvBPzPyZL9DS';

  if (!token) {
    res.status(200).json({ error: 'not_configured' });
    return;
  }

  async function fetchAll(table, fields) {
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

  const currentYear = new Date().getFullYear();

  try {
    const [grants, impact] = await Promise.all([
      fetchAll('Grants & Services', ['Grant Year', 'Status', 'Cycle (from Proposal)']),
      fetchAll('Grant Impact Data', ['Economic Output', 'Grant & Service ID', 'Proposed Inclusion']),
    ]);

    const cohortIds = new Set();
    grants.forEach((g) => {
      if (isCohortGrant(g.fields || {}, currentYear)) cohortIds.add(g.id);
    });

    let dollars = 0;
    let recordsCounted = 0;
    const grantsWithOutput = new Set();
    impact.forEach((rec) => {
      const f = rec.fields || {};
      if (f['Proposed Inclusion'] === 'Exclude') return;
      const amount = typeof f['Economic Output'] === 'number' ? f['Economic Output'] : 0;
      if (!amount) return;
      const linked = (f['Grant & Service ID'] || []).filter((id) => cohortIds.has(id));
      if (linked.length === 0) return;
      dollars += amount;
      recordsCounted += 1;
      linked.forEach((id) => grantsWithOutput.add(id));
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      year: currentYear,
      grants: cohortIds.size,
      grantsWithOutput: grantsWithOutput.size,
      recordsCounted,
      dollars,
    });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed', message: String(err) });
  }
}
