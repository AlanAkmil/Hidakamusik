const ytsr = require('@distube/ytsr');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { list } = req.query;
  if (!list) return res.status(400).json({ error: 'Playlist ID required' });

  try {
    // Search playlist by ID
    const results = await ytsr(`https://www.youtube.com/playlist?list=${list}`, {
      limit: 50,
      type: 'video'
    });

    if (!results || !results.items || !results.items.length) {
      return res.status(404).json({ error: 'Playlist tidak ditemukan atau kosong' });
    }

    const tracks = results.items
      .filter(v => v.type === 'video' && v.id)
      .map(v => ({
        id: v.id,
        title: v.name,
        channel: v.author?.name || '',
        thumb: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
      }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({
      title: results.originalQuery || 'Playlist YouTube',
      tracks
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
