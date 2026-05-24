export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Video ID required' });

  try {
    const infoRes = await fetch(
      `https://ytstream-download-youtube-videos.p.rapidapi.com/dl?id=${id}`,
      {
        headers: {
          'X-RapidAPI-Key': '05d72b013cmshde1758b1360e267p1051efjsna1e9c06d073a',
          'X-RapidAPI-Host': 'ytstream-download-youtube-videos.p.rapidapi.com'
        }
      }
    );

    if (!infoRes.ok) return res.status(502).json({ error: `RapidAPI error ${infoRes.status}` });

    const data = await infoRes.json();
    const allFormats = [...(data.adaptiveFormats || []), ...(data.formats || [])];

    // Prioritas: audio/webm atau audio/mp4
    const audioFmt = allFormats.find(f => f.mimeType?.includes('audio/webm') && f.url)
      || allFormats.find(f => f.mimeType?.includes('audio') && f.url);

    if (!audioFmt?.url) return res.status(404).json({ error: 'No audio format found' });

    // Proxy audio stream langsung ke client
    const audioRes = await fetch(audioFmt.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!audioRes.ok) return res.status(502).json({ error: 'Failed to fetch audio stream' });

    const title = (data.title || id).replace(/[<>:"/\\|?*]/g, '').trim();
    res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/webm');
    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.setHeader('Cache-Control', 's-maxage=3600');

    const buffer = await audioRes.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}