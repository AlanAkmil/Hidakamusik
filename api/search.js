export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, max = 12 } = req.query;

  if (!q) return res.status(400).json({ error: 'Query required' });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.status(500).json({ error: 'API key not configured' });

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoCategoryId=10&maxResults=${max}&key=${key}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.items) return res.status(200).json([]);

    const tracks = data.items.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    }));

    // Cache 5 menit
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json(tracks);
  } catch (e) {
    return res.status(500).json({ error: 'Fetch failed' });
  }
}
