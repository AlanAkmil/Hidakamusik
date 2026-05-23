import YouTubesr from 'youtube-sr';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, max = 12 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const results = await YouTubesr.default.search(q, {
      limit: parseInt(max),
      type: 'video',
    });

    const tracks = results.map(v => ({
      id: v.id,
      title: v.title,
      channel: v.channel?.name || '',
      thumb: v.thumbnail?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(tracks);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}