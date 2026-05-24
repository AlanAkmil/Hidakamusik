const ytsr = require('@distube/ytsr');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, max = 12 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const results = await ytsr(q, { limit: parseInt(max) });

    const tracks = results.items.map(v => ({
      id: v.id,
      title: v.name,
      channel: v.author?.name || '',
      thumb: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(tracks);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}