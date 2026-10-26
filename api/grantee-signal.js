// Serverless function (runs on Vercel's servers, never in the browser).
// Computes the "Grantee Signal" On Track percentage, plus the three
// drill-down lists, from the Contacts & Grants base. Everything below
// is scoped to the CURRENT calendar year, computed dynamically so it
// rolls over automatically each January, and to the shared grant
// cohort defined in ./_cohort.js (same rules as /api/economic-output:
// excludes Policy and Convening cycles and the On Hold (Matching Funds)
// / On Hold (Future Multi-Year) statuses):
//
//   percent (current-year cohort) = numerator = cohort grants whose
//                            most recent COMPLETED check-in has
//                            Project Status = "On-track"
//   On Track / At Risk list = driven by the Grantee Check-in table:
//                            check-ins whose own "Grant Year (from
//                            Grant)" is the current year, Status =
//                            "Completed", for cohort grants only,
//                            bucketed by the most recent one's Project
//                            Status per grant. Display name resolved
//                            from each check-in's "Organization (from
//                            Grant)" link against the Organizations
//                            table's "Org Name" field.
//   No Data list           = cohort grants with no completed check-in
//                            at all; display name resolved the same way
//                            via the grant's own "Organization" link.
//   Reports Due            = report records in the "Grant Reports"
//                            table linked to cohort grants whose
//                            "Report Received Date" is empty (received
//                            reports are excluded), counted per
//                            "Report Due Date" and sorted
//                            chronologically.

import { isCohortGrant } from './_cohort.js';

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

  function flatten(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  const currentYear = new Date().getFullYear();

  try {
    const [allGrants, checkins, organizations, grantReports] = await Promise.all([
      fetchAll('Grants & Services', {}),
      fetchAll('Grantee Check-in', {}),
      fetchAll('Organizations', {}),
      fetchAll('Grant Reports', {}),
    ]);

    const orgNameById = {};
    organizations.forEach((org) => {
      orgNameById[org.id] = (org.fields || {})['Org Name'];
    });

    function resolveOrg(linkValue) {
      const id = flatten(linkValue);
      return (id && orgNameById[id]) || 'Unnamed grantee';
    }

    // Grant record id -> org name, via each grant's own "Organization" link.
    const orgByGrantId = {};
    allGrants.forEach((g) => {
      orgByGrantId[g.id] = resolveOrg((g.fields || {})['Organization']);
    });

    // Latest COMPLETED, current-year check-in per linked grant record id,
    // read directly off the Grantee Check-in table's own "Grant Year
    // (from Grant)" field (not the Grants & Services cohort).
    const latestByGrant = {};
    checkins.forEach((rec) => {
      const f = rec.fields || {};
      if (f['Status'] !== 'Completed') return;

      const grantYear = Number(flatten(f['Grant Year (from Grant)']));
      if (grantYear !== currentYear) return;

      const grantIds = f['Grant'] || [];
      const dateStr = f['Actual Check-In Date'];
      if (!dateStr || grantIds.length === 0) return;

      const date = new Date(dateStr);
      const org = resolveOrg(f['Organization (from Grant)']);
      grantIds.forEach((gid) => {
        const current = latestByGrant[gid];
        if (!current || date > current.date) {
          latestByGrant[gid] = { date, projectStatus: f['Project Status'], org };
        }
      });
    });

    // Current-year cohort (drives the percentage, the No Data list, and
    // which grants may appear in the On Track / At Risk lists).
    const cohort = allGrants.filter((g) => isCohortGrant(g.fields || {}, currentYear));
    const cohortIds = new Set(cohort.map((g) => g.id));

    // On Track / At Risk lists: cohort grants the check-in table knows
    // about, bucketed by their latest check-in's Project Status.
    const onTrackGrants = [];
    const atRiskGrants = [];
    Object.keys(latestByGrant).forEach((gid) => {
      if (!cohortIds.has(gid)) return;
      const { projectStatus, org } = latestByGrant[gid];
      if (projectStatus === 'On-track') {
        onTrackGrants.push({ org });
      } else {
        atRiskGrants.push({ org, projectStatus: projectStatus || null });
      }
    });

    const noDataGrants = cohort
      .filter((g) => !latestByGrant[g.id])
      .map((g) => ({ org: orgByGrantId[g.id] || 'Unnamed grantee' }));

    const onTrack = cohort.filter(
      (g) => latestByGrant[g.id] && latestByGrant[g.id].projectStatus === 'On-track'
    ).length;
    const total = cohort.length;
    const percent = total > 0 ? Math.round((onTrack / total) * 100) : null;
    const noData = noDataGrants.length;
    const atRisk = total - onTrack - noData;
    const atRiskPercent = total > 0 ? Math.round((atRisk / total) * 100) : null;
    const noDataPercent = total > 0 ? Math.round((noData / total) * 100) : null;

    // Reports Due: outstanding reports (no Report Received Date) for the
    // current-year cohort, counted per due date.
    const countByDate = {};
    grantReports.forEach((rep) => {
      const f = rep.fields || {};
      if (f['Report Received Date']) return;
      const dueDate = f['Report Due Date'];
      if (!dueDate) return;
      const linkedGrants = f['Grant Id'] || [];
      if (!linkedGrants.some((gid) => cohortIds.has(gid))) return;
      countByDate[dueDate] = (countByDate[dueDate] || 0) + 1;
    });
    const reportsDue = Object.keys(countByDate)
      .sort()
      .map((date) => ({ date, count: countByDate[date] }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      onTrack,
      total,
      percent,
      atRisk,
      noData,
      atRiskPercent,
      noDataPercent,
      onTrackGrants,
      atRiskGrants,
      noDataGrants,
      reportsDue,
    });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed', message: String(err) });
  }
}
