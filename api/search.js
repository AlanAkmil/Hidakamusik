export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, max = 12 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  const instances = [
    'https://inv.nadeko.net',
    'https://invidious.privacydev.net',
    'https://iv.datura.network',
    'https://invidious.nerdvpn.de',
    'https://yt.artemislena.eu',
  ];

  for (const base of instances) {
    try {
      const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video&page=1`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) continue;

      const tracks = data.slice(0, Number(max)).map(item => ({
        id: item.videoId,
        title: item.title,
        channel: item.author,
        thumb: item.videoThumbnails?.find(t => t.quality === 'medium')?.url
          || `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
      }));

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
      return res.status(200).json(tracks);
    } catch (e) {
      continue;
    }
  }

  return res.status(500).json({ error: 'Semua server gagal, coba lagi.' });
}
