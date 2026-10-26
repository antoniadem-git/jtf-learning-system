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
//
// The total is also split by the grant's Strategy (the record's
// "Strategy (from Grant Proposal)" lookup). The dashboard's three
// categories map to the Strategy values as: Workforce = "Workforce",
// Entrepreneurship = "CED", Infrastructure = "Infrastructure". Any other
// strategy is reported under "other" so the pieces always add up to the
// total.
//
// It also sums the current-year cohort grants' "Grant Amount" awards by the
// same three categories (using each grant's "Strategy (from Proposal)")
// and returns ROI per category = economic output / grant awards.

import { isCohortGrant } from './_cohort.js';

const STRATEGY_CATEGORY = {
  Workforce: 'workforce',
  CED: 'entrepreneurship',
  Infrastructure: 'infrastructure',
};

function categoryOf(strategyField) {
  const list = Array.isArray(strategyField) ? strategyField : strategyField ? [strategyField] : [];
  for (const name of list) {
    if (STRATEGY_CATEGORY[name]) return STRATEGY_CATEGORY[name];
  }
  return 'other';
}

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
      fetchAll('Grants & Services', [
        'Grant Year',
        'Status',
        'Cycle (from Proposal)',
        'Grant Amount',
        'Strategy (from Proposal)',
      ]),
      fetchAll('Grant Impact Data', [
        'Economic Output',
        'Grant & Service ID',
        'Proposed Inclusion',
        'Strategy (from Grant Proposal)',
      ]),
    ]);

    const cohortIds = new Set();
    const awardsByStrategy = { workforce: 0, entrepreneurship: 0, infrastructure: 0, other: 0 };
    const grantCountByStrategy = { workforce: 0, entrepreneurship: 0, infrastructure: 0, other: 0 };
    grants.forEach((g) => {
      const f = g.fields || {};
      if (!isCohortGrant(f, currentYear)) return;
      cohortIds.add(g.id);
      const category = categoryOf(f['Strategy (from Proposal)']);
      awardsByStrategy[category] += typeof f['Grant Amount'] === 'number' ? f['Grant Amount'] : 0;
      grantCountByStrategy[category] += 1;
    });

    let dollars = 0;
    let recordsCounted = 0;
    const byStrategy = { workforce: 0, entrepreneurship: 0, infrastructure: 0, other: 0 };
    const grantsWithOutput = new Set();
    impact.forEach((rec) => {
      const f = rec.fields || {};
      if (f['Proposed Inclusion'] === 'Exclude') return;
      const amount = typeof f['Economic Output'] === 'number' ? f['Economic Output'] : 0;
      if (!amount) return;
      const linked = (f['Grant & Service ID'] || []).filter((id) => cohortIds.has(id));
      if (linked.length === 0) return;
      dollars += amount;
      byStrategy[categoryOf(f['Strategy (from Grant Proposal)'])] += amount;
      recordsCounted += 1;
      linked.forEach((id) => grantsWithOutput.add(id));
    });

    const roiByStrategy = {};
    ['workforce', 'entrepreneurship', 'infrastructure'].forEach((key) => {
      roiByStrategy[key] = awardsByStrategy[key] > 0 ? byStrategy[key] / awardsByStrategy[key] : null;
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      year: currentYear,
      grants: cohortIds.size,
      grantsWithOutput: grantsWithOutput.size,
      recordsCounted,
      dollars,
      byStrategy,
      awardsByStrategy,
      grantCountByStrategy,
      roiByStrategy,
    });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed', message: String(err) });
  }
}
