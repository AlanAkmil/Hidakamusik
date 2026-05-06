export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { title, artist } = req.query;
  if (!title) return res.status(400).json([]);

  const tries = [
    `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist||'')}`,
    `https://lrclib.net/api/search?q=${encodeURIComponent(title)}`,
    `https://lrclib.net/api/search?q=${encodeURIComponent((title+' '+(artist||'')).trim())}`,
  ];

  for (const url of tries) {
    try {
      const r = await fetch(url, {
        headers: { 'Lrclib-Client': 'NadaMusic/1.0', 'User-Agent': 'NadaMusic/1.0' }
      });
      const data = await r.json();
      if (Array.isArray(data) && data.length) {
        return res.status(200).json(data);
      }
    } catch {}
  }
  return res.status(404).json([]);
}