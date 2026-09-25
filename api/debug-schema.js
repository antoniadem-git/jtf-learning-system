// Temporary diagnostic endpoint - returns only field NAMES and the
// distinct category/status label values seen for a few specific
// fields (Cycle, Status, Project Status). Never returns grantee
// names, dollar amounts, notes, or any other record content.
// Remove once the real calculation is wired up.

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = 'appJZpvBPzPyZL9DS';

  if (!token) {
    res.status(200).json({ error: 'not_configured' });
    return;
  }

  async function fetchRecords(table, n) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', String(n));
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: `airtable_${r.status}` };
    const data = await r.json();
    return data.records;
  }

  function distinct(records, field) {
    if (!Array.isArray(records)) return records;
    const vals = new Set();
    records.forEach((rec) => {
      const v = rec.fields ? rec.fields[field] : undefined;
      if (v !== undefined) vals.add(typeof v === 'object' ? JSON.stringify(v) : v);
    });
    return Array.from(vals).sort();
  }

  try {
    const [grants, checkins] = await Promise.all([
      fetchRecords('Grants & Services', 100),
      fetchRecords('Grantee Check-in', 100),
    ]);

    const grantFields = Array.isArray(grants)
      ? Array.from(new Set(grants.flatMap((r) => Object.keys(r.fields || {})))).sort()
      : grants;
    const checkinFields = Array.isArray(checkins)
      ? Array.from(new Set(checkins.flatMap((r) => Object.keys(r.fields || {})))).sort()
      : checkins;

    res.status(200).json({
      grantFields,
      checkinFields,
      distinctValues: {
        'Cycle (from Proposal)': distinct(grants, 'Cycle (from Proposal)'),
        'Cycle (Archived pre-2019)': distinct(grants, 'Cycle (Archived pre-2019)'),
        'Status (grants)': distinct(grants, 'Status'),
        'Project Status (checkins)': distinct(checkins, 'Project Status'),
        'Status (checkins)': distinct(checkins, 'Status'),
        'Grant (checkins, sample shape)': Array.isArray(checkins) && checkins[0] ? checkins[0].fields['Grant'] : null,
      },
    });
  } catch (err) {
    res.status(200).json({ error: 'fetch_failed' });
  }
}
