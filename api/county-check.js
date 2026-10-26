// Temporary: confirms the server token can read JTF County Data.
// Returns only a status and a yes/no - no record content. Delete after use.
export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'not_configured' }); return; }
  const url = new URL('https://api.airtable.com/v0/appaRgCRhALmxR9by/' + encodeURIComponent('County Master List'));
  url.searchParams.set('pageSize', '1');
  url.searchParams.set('fields[]', 'County Name');
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let hasRecords = null;
  if (r.ok) { const d = await r.json(); hasRecords = Array.isArray(d.records) && d.records.length > 0; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: r.ok, status: r.status, hasRecords });
}
