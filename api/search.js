import ytsr from '@distube/ytsr';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, max = 12 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const results = await ytsr(q, {
      limit: parseInt(max),
      safeSearch: false,
    });

    const tracks = results.items
      .filter(v => v.type === 'video' && v.id)
      .map(v => ({
        id: v.id,
        title: v.name,
        channel: v.author?.name || '',
        thumb: v.bestThumbnail?.url || v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
      }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.status(200).json(tracks);
  } catch (e) {
    // Fallback ke YouTube API kalau ytsr gagal
    const key = process.env.YOUTUBE_API_KEY;
    if (key) {
      try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=${max}&key=${key}`;
        const r = await fetch(url);
        if (r.ok) {
          const data = await r.json();
          if (data.items?.length) {
            return res.status(200).json(data.items.map(item => ({
              id: item.id.videoId,
              title: item.snippet.title,
              channel: item.snippet.channelTitle,
              thumb: item.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
            })));
          }
        }
      } catch {}
    }
    return res.status(500).json({ error: e.message });
  }
}
