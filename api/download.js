export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Video ID required' });

  try {
    // Ambil info video dari RapidAPI
    const infoRes = await fetch(`https://ytstream-download-youtube-videos.p.rapidapi.com/dl?id=${id}`, {
      headers: {
        'X-RapidAPI-Key': '05d72b013cmshde1758b1360e267p1051efjsna1e9c06d073a',
        'X-RapidAPI-Host': 'ytstream-download-youtube-videos.p.rapidapi.com'
      }
    });
    const data = await infoRes.json();

    const allFormats = [...(data.adaptiveFormats || []), ...(data.formats || [])];
    const audioFmt = allFormats.find(f => f.mimeType?.includes('audio') && f.url);
    if (!audioFmt?.url) return res.status(404).json({ error: 'No audio format found' });

    // Fetch audio dari server (bypass CORS)
    const audioRes = await fetch(audioFmt.url);
    if (!audioRes.ok) return res.status(502).json({ error: 'Failed to fetch audio' });

    // Stream langsung ke client
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.mp3"`);
    res.setHeader('Cache-Control', 's-maxage=3600');

    const buffer = await audioRes.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}