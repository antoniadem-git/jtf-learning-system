// Serverless function (runs on Vercel's servers, never in the browser).
// Computes the "Grantee Signal" On Track percentage, plus the three
// drill-down lists, from the Contacts & Grants base:
//
//   percent (2026 cohort)  = grants with Grant Year = 2026, excluding
//                            Status = "On Hold (Matching Funds)" and
//                            Cycle = "Policy"; numerator = of those,
//                            grants whose most recent COMPLETED
//                            check-in has Project Status = "On-track"
//   On Track / At Risk list = driven directly by the Grantee Check-in
//                            table: every grant with a completed
//                            check-in, any year, bucketed by that
//                            check-in's Project Status
//   No Data list           = 2026-cohort grants with no completed
//                            check-in at all

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

  function orgNameOf(fields) {
    const raw = fields['Org Short Name'];
    return (Array.isArray(raw) ? raw.join(', ') : raw) || 'Unnamed grantee';
  }

  function isPolicyCycle(fields) {
    const c = fields['Cycle (from Proposal)'];
    const joined = Array.isArray(c) ? c.join(',') : c || '';
    return joined === 'Policy';
  }

  try {
    const [allGrants, checkins] = await Promise.all([
      fetchAll('Grants & Services', {}),
      fetchAll('Grantee Check-in', {}),
    ]);

    const orgByGrantId = {};
    allGrants.forEach((g) => {
      orgByGrantId[g.id] = orgNameOf(g.fields || {});
    });

    // Find the most recent COMPLETED check-in per linked grant record id,
    // across the full Grantee Check-in table (any grant, any year).
    const latestByGrant = {};
    checkins.forEach((rec) => {
      const f = rec.fields || {};
      const grantIds = f['Grant'] || [];
      const dateStr = f['Actual Check-In Date'];
      if (!dateStr || grantIds.length === 0) return;
      if (f['Status'] !== 'Completed') return;
      const date = new Date(dateStr);
      grantIds.forEach((gid) => {
        const current = latestByGrant[gid];
        if (!current || date > current.date) {
          latestByGrant[gid] = { date, projectStatus: f['Project Status'] };
        }
      });
    });

    // On Track / At Risk lists: every grant the check-in table knows
    // about, bucketed by its latest completed check-in's Project Status.
    const onTrackGrants = [];
    const atRiskGrants = [];
    Object.keys(latestByGrant).forEach((gid) => {
      const { projectStatus } = latestByGrant[gid];
      const org = orgByGrantId[gid] || 'Unnamed grantee';
      if (projectStatus === 'On-track') {
        onTrackGrants.push({ org });
      } else {
        atRiskGrants.push({ org, projectStatus: projectStatus || null });
      }
    });

    // 2026 cohort (drives the percentage and the No Data list).
    const cohort2026 = allGrants.filter((g) => {
      const f = g.fields || {};
      return (
        f['Grant Year'] === '2026' &&
        f['Status'] !== 'On Hold (Matching Funds)' &&
        !isPolicyCycle(f)
      );
    });

    const noDataGrants = cohort2026
      .filter((g) => !latestByGrant[g.id])
      .map((g) => ({ org: orgByGrantId[g.id] || 'Unnamed grantee' }));

    const onTrack = cohort2026.filter(
      (g) => latestByGrant[g.id] && latestByGrant[g.id].projectStatus === 'On-track'
    ).length;
    const total = cohort2026.length;
    const percent = total > 0 ? Math.round((onTrack / total) * 100) : null;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      onTrack,
      total,
      percent,
      onTrackGrants,
      atRiskGrants,
      noDataGrants,
    });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed', message: String(err) });
  }
}
