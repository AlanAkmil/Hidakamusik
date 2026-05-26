export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, max = 12 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.darkness.services',
    'https://piped-api.garudalinux.org',
    'https://pipedapi.in.projectsegfau.lt',
  ];

  for (const base of instances) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(q)}&filter=videos`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const data = await r.json();
      if (!data.items?.length) continue;

      const tracks = data.items
        .filter(v => v.type === 'stream')
        .slice(0, Number(max))
        .map(v => ({
          id: v.url?.replace('/watch?v=', '') || '',
          title: v.title,
          channel: v.uploaderName,
          thumb: v.thumbnail,
        }))
        .filter(v => v.id);

      if (!tracks.length) continue;

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
      return res.status(200).json(tracks);
    } catch (e) {
      continue;
    }
  }

  // Fallback YouTube API
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
    } catch (e) {}
  }

  return res.status(500).json({ error: 'Semua server gagal.' });
}
