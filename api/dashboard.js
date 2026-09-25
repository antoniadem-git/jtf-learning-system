// Serverless function (runs on Vercel's servers, never in the browser).
// Reads goal-tracking metrics from Airtable and returns them as shaped JSON.
// The Airtable token stays server-side via environment variables.

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

    const metrics = records
      .map((rec) => {
        const f = rec.fields || {};
        return {
          metric: f['Metric'] || '',
          category: f['Category'] || '',
          period: f['Period'] || '',
          current: typeof f['Current'] === 'number' ? f['Current'] : 0,
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

    // Cache at Vercel's edge for 60s, serve stale for up to 5min while revalidating,
    // so normal traffic doesn't hammer Airtable's rate limit.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ metrics, topNeeds });
  } catch (err) {
    res.status(200).json({ metrics: [], error: 'fetch_failed' });
  }
}
