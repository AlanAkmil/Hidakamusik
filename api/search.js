import ytsr from '@distube/ytsr';

// ===== BLACKLIST =====
// Hanya block konten yang JELAS bukan musik
// Semua matching pakai word boundary supaya tidak nyangkut ke judul lagu biasa
const BLACKLIST_PATTERNS = [
  // Gameplay / streaming
  /\bgameplay\b/i,
  /\blet'?s play\b/i,
  /\bplaythrough\b/i,
  /\bwalkthrough\b/i,
  /\bspeedrun\b/i,
  /\bno commentary\b/i,
  /\bgaming session\b/i,
  /\bstream highlight\b/i,
  /\btwitch (highlight|clip)\b/i,
  /\branked (game|match|gameplay)\b/i,
  /\b(fps|moba|pvp|pve) gameplay\b/i,
  /\bbattle royale gameplay\b/i,
  // Reaction / review non-musik
  /\breacts? to\b/i,
  /\breacting to\b/i,
  /\bunboxing\b/i,
  /\b(phone|laptop|gpu|cpu|pc) (review|build)\b/i,
  // Vlog (hanya kalau beneran vlog, bukan judul lagu)
  /\bdaily vlog\b/i,
  /\bweekly vlog\b/i,
  /\b#vlog\b/i,
];

// Kalau judul mengandung kata ini, LOLOS meski ada kata blacklist
// (misal: "Minecraft OST", "Game Music Compilation", dll)
const WHITELIST_PATTERNS = [
  /\bost\b/i,
  /\boriginal soundtrack\b/i,
  /\bsoundtrack\b/i,
  /\bgame (music|ost|bgm|theme)\b/i,
  /\bbgm\b/i,
  /\blyrics?\b/i,
  /\bcover\b/i,
  /\bacoustic\b/i,
  /\bpiano\b/i,
  /\borchestral\b/i,
  /\bremix\b/i,
  /\bfeat\b/i,
  /\bft\.\b/i,
  /\bprod\.\b/i,
  /\baudio\b/i,
  /\bdubbing\b/i,
  /\bdub\b/i,
  /\bsub indo\b/i,
  /\bkaraoke\b/i,
];

function isMusicContent(title) {
  const tl = title.toLowerCase();

  // Cek whitelist dulu — kalau ada, langsung lolos tanpa cek blacklist
  if (WHITELIST_PATTERNS.some(p => p.test(tl))) return true;

  // Cek blacklist
  if (BLACKLIST_PATTERNS.some(p => p.test(tl))) return false;

  // Default: lolos (musik non-official, nama lagu doang, dll)
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, max = 12 } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    // Ambil lebih banyak supaya setelah difilter tetap cukup
    const fetchLimit = Math.min(parseInt(max) * 3, 50);

    const results = await ytsr(q, {
      limit: fetchLimit,
      safeSearch: false,
    });

    const tracks = results.items
      .filter(v => v.type === 'video' && v.id)
      .filter(v => isMusicContent(v.name))
      .slice(0, parseInt(max))
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
            return res.status(200).json(
              data.items
                .filter(item => isMusicContent(item.snippet.title))
                .map(item => ({
                  id: item.id.videoId,
                  title: item.snippet.title,
                  channel: item.snippet.channelTitle,
                  thumb: item.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
                }))
            );
          }
        }
      } catch {}
    }
    return res.status(500).json({ error: e.message });
  }
}
