// Serverless function (runs on Vercel's servers, never in the browser).
// Reads goal-tracking metrics from Airtable and returns them as shaped JSON.
// The Airtable token stays server-side via environment variables.

// Reach metrics come from the JTF County Data base (County Master List),
// counting Core counties (2023 Prioritization = "Core"):
//   Total communities reached = 2026 = "Y"
//   New reached via LEL       = First Reach Cycle contains FAC, Local
//                               Economy Lab or Policy
//   New reached via TE        = First Reach Cycle contains Transition Exchange
const COUNTY_BASE_ID = 'appaRgCRhALmxR9by';
const COUNTY_TABLE = 'County Master List';

async function fetchReachCounts(token) {
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${COUNTY_BASE_ID}/${encodeURIComponent(COUNTY_TABLE)}`);
    url.searchParams.set('pageSize', '100');
    ['2023 Prioritization', '2026', 'First Reach Cycle'].forEach((f) => url.searchParams.append('fields[]', f));
    if (offset) url.searchParams.set('offset', offset);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`County data responded ${r.status}`);
    const data = await r.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  const text = (v) => (Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v)).toLowerCase();
  const core = records.filter((rec) => text((rec.fields || {})['2023 Prioritization']).trim() === 'core');
  const cycleHas = (rec, needles) => {
    const c = text((rec.fields || {})['First Reach Cycle']);
    return needles.some((n) => c.includes(n.toLowerCase()));
  };
  return {
    'Total communities reached': core.filter(
      (rec) => text((rec.fields || {})['2026']).trim() === 'y'
    ).length,
    'New reached via LEL': core.filter((rec) => cycleHas(rec, ['FAC', 'Local Economy Lab', 'Policy'])).length,
    'New reached via TE': core.filter((rec) => cycleHas(rec, ['Transition Exchange'])).length,
  };
}

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID || 'appW88cboHe8nuhwK';
  const table = process.env.AIRTABLE_METRICS_TABLE || 'Dashboard Metrics';

  if (!token) {
    res.status(200).json({ metrics: [], error: 'not_configured' });
    return;
  }

  try {
    const records = [];
    let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const airtableRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!airtableRes.ok) throw new Error(`Airtable responded ${airtableRes.status}`);

      const data = await airtableRes.json();
      records.push(...data.records);
      offset = data.offset;
    } while (offset);

    // Reach values come from County Data; if that fetch fails, fall back to
    // whatever is in the Dashboard Metrics table.
    // Opt-in (?reach=county) so only pages that ask for it switch sources.
    let reach = null;
    if (req.query && req.query.reach === 'county') {
      try {
        reach = await fetchReachCounts(token);
      } catch (e) {
        reach = null;
      }
    }

    const metrics = records
      .map((rec) => {
        const f = rec.fields || {};
        return {
          metric: f['Metric'] || '',
          category: f['Category'] || '',
          period: f['Period'] || '',
          current:
            reach && f['Metric'] in reach
              ? reach[f['Metric']]
              : typeof f['Current'] === 'number' ? f['Current'] : 0,
          target: typeof f['Target'] === 'number' ? f['Target'] : 0,
          prefix: f['Prefix'] || '',
          suffix: f['Suffix'] || '',
          status: f['Status'] || 'On Track',
          order: typeof f['Order'] === 'number' ? f['Order'] : 0,
        };
      })
      .sort((a, b) => a.order - b.order);

    // "Top Three Needs" is a special record: its Text Summary field holds
    // newline-separated phrases rather than a current/target metric.
    const topNeedsRecord = records.find((rec) => (rec.fields || {})['Metric'] === 'Top Three Needs');
    const topNeedsText = topNeedsRecord ? topNeedsRecord.fields['Text Summary'] : '';
    const topNeeds = (topNeedsText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);

    // "Check-In Trends" works the same way: newline-separated bullets in the
    // Text Summary field, written by staff (themes only, no grantee names).
    const trendsRecord = records.find((rec) => (rec.fields || {})['Metric'] === 'Check-In Trends');
    const checkinTrends = ((trendsRecord && trendsRecord.fields['Text Summary']) || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);

    // Cache at Vercel's edge for 60s, serve stale for up to 5min while revalidating,
    // so normal traffic doesn't hammer Airtable's rate limit.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ metrics, topNeeds, checkinTrends, reachSource: reach ? 'county-data' : 'dashboard-metrics' });
  } catch (err) {
    res.status(200).json({ metrics: [], error: 'fetch_failed' });
  }
}
