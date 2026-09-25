// Serverless function (runs on Vercel's servers, never in the browser).
// Counts 2026 grants in the "Contacts & Grants" base, excluding grants
// on hold for matching funds. Read-only diagnostic endpoint for now —
// not yet wired into the dashboard's rendered percentage.

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = 'appJZpvBPzPyZL9DS';
  const table = 'Grants & Services';

  if (!token) {
    res.status(200).json({ count: null, error: 'not_configured' });
    return;
  }

  const formula = 'AND({Grant Year}="2026",NOT({Status}="On Hold (Matching Funds)"))';

  try {
    let count = 0;
    let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('filterByFormula', formula);
      url.searchParams.set('fields[]', 'Grant Year'); // only need the count, not full records
      if (offset) url.searchParams.set('offset', offset);

      const airtableRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!airtableRes.ok) {
        const body = await airtableRes.text();
        res.status(200).json({ count: null, error: `airtable_${airtableRes.status}`, detail: body });
        return;
      }

      const data = await airtableRes.json();
      count += data.records.length;
      offset = data.offset;
    } while (offset);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ count });
  } catch (err) {
    res.status(200).json({ count: null, error: 'fetch_failed' });
  }
}
