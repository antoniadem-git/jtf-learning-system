// Serverless function (runs on Vercel's servers, never in the browser).
// Computes the "Grantee Signal" On Track percentage from the
// Contacts & Grants base:
//
//   denominator = grants with Grant Year = 2026, excluding Status =
//                 "On Hold (Matching Funds)" and Cycle = "Policy"
//   numerator   = of those, grants whose most recent check-in
//                 (by Actual Check-In Date, from the linked Grantee
//                 Check-in table) has Project Status = "On-track"

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = 'appJZpvBPzPyZL9DS';

  if (!token) {
    res.status(200).json({ error: 'not_configured' });
    return;
  }

  async function fetchAll(table, params) {
    const records = [];
    let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
      url.searchParams.set('pageSize', '100');
      Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      if (offset) url.searchParams.set('offset', offset);

      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`airtable_${r.status}`);

      const data = await r.json();
      records.push(...data.records);
      offset = data.offset;
    } while (offset);
    return records;
  }

  try {
    const grantFormula =
      'AND({Grant Year}="2026",NOT({Status}="On Hold (Matching Funds)"),NOT(ARRAYJOIN({Cycle (from Proposal)})="Policy"))';

    const [grants, checkins] = await Promise.all([
      fetchAll('Grants & Services', { filterByFormula: grantFormula }),
      fetchAll('Grantee Check-in', {}),
    ]);

    // Find the most recent check-in per linked grant record id.
    const latestByGrant = {};
    checkins.forEach((rec) => {
      const f = rec.fields || {};
      const grantIds = f['Grant'] || [];
      const dateStr = f['Actual Check-In Date'];
      if (!dateStr || grantIds.length === 0) return;
      const date = new Date(dateStr);
      grantIds.forEach((gid) => {
        const current = latestByGrant[gid];
        if (!current || date > current.date) {
          latestByGrant[gid] = { date, projectStatus: f['Project Status'] };
        }
      });
    });

    let onTrack = 0;
    grants.forEach((g) => {
      const latest = latestByGrant[g.id];
      if (latest && latest.projectStatus === 'On-track') onTrack += 1;
    });

    const total = grants.length;
    const percent = total > 0 ? Math.round((onTrack / total) * 100) : null;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ onTrack, total, percent });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed', message: String(err) });
  }
}
