const ytsr = require('@distube/ytsr');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { list } = req.query;
  if (!list) return res.status(400).json({ error: 'Playlist ID required' });

  try {
    // Fetch playlist langsung dari YouTube tanpa library
    const playlistUrl = `https://www.youtube.com/playlist?list=${list}`;
    const response = await fetch(playlistUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await response.text();

    // Extract ytInitialData dari HTML
    const match = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s) ||
                  html.match(/ytInitialData\s*=\s*({.+?});\s*(?:var|window|<\/script>)/s);
    
    if (!match) throw new Error('Tidak bisa parse playlist YouTube');

    const data = JSON.parse(match[1]);
    
    // Navigate ke playlist items
    const contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
      ?.itemSectionRenderer?.contents?.[0]
      ?.playlistVideoListRenderer?.contents || [];

    const title = data?.header?.playlistHeaderRenderer?.title?.runs?.[0]?.text || 'Playlist YouTube';

    const tracks = contents
      .filter(item => item.playlistVideoRenderer)
      .map(item => {
        const v = item.playlistVideoRenderer;
        const id = v.videoId;
        const trackTitle = v.title?.runs?.[0]?.text || '';
        const channel = v.shortBylineText?.runs?.[0]?.text || '';
        const thumb = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
        return { id, title: trackTitle, channel, thumb };
      })
      .filter(t => t.id && t.title);

    if (!tracks.length) throw new Error('Playlist kosong atau tidak bisa diakses');

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ title, tracks });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
