// Temporary diagnostic endpoint - returns only FIELD NAMES (schema
// shape), never field values, from Grants & Services and Grantee
// Check-in. No record content is exposed. Remove once the real
// calculation is wired up.

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = 'appJZpvBPzPyZL9DS';

  if (!token) {
    res.status(200).json({ error: 'not_configured' });
    return;
  }

  async function fieldNames(table, n) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', String(n));
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: `airtable_${r.status}` };
    const data = await r.json();
    const keys = new Set();
    data.records.forEach((rec) => Object.keys(rec.fields || {}).forEach((k) => keys.add(k)));
    return Array.from(keys).sort();
  }

  try {
    const [grantFields, checkinFields] = await Promise.all([
      fieldNames('Grants & Services', 5),
      fieldNames('Grantee Check-in', 5),
    ]);
    res.status(200).json({ grantFields, checkinFields });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed' });
  }
}
