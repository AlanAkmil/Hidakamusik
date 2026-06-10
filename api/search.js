import ytsr from '@distube/ytsr';

// ===== BLACKLIST =====
// Block konten gaming/streamer, tapi biarkan musik game & podcast lolos
const BLACKLIST_TITLE = [
  // Streamer / gameplay
  'gameplay', 'let\'s play', 'lets play', 'playthrough', 'walkthrough',
  'speedrun', 'no commentary', 'gaming session',
  // Reaction / vlog
  'reaction', 'reacts to', 'reacting to',
  'vlog', 'daily vlog', 'weekly vlog',
  // Review non-musik
  'unboxing', 'product review', 'phone review', 'laptop review',
  'gpu review', 'cpu review', 'pc build',
  // Konten streamer spesifik
  'stream highlight', 'twitch highlight', 'twitch clip',
  'ranked game', 'ranked match', 'ranked gameplay',
  'pvp', 'pve gameplay', 'battle royale gameplay',
  'fps gameplay', 'moba gameplay',
];

// Kata yang kalau muncul di judul = kemungkinan musik game, JANGAN diblock
const WHITELIST_OVERRIDE = [
  'ost', 'original soundtrack', 'soundtrack', 'game music', 'game ost',
  'bgm', 'music video', 'mv', 'official', 'lyrics', 'lyric',
  'cover', 'acoustic', 'piano', 'orchestral', 'remix',
  'ft.', 'feat.', 'prod.',
];

function isMusicContent(title, channel) {
  const tl = title.toLowerCase();
  const cl = channel.toLowerCase();

  // Kalau ada kata whitelist -> lolos (musik game/cover dll)
  if (WHITELIST_OVERRIDE.some(w => tl.includes(w))) return true;

  // Kalau ada kata blacklist di judul -> block
  if (BLACKLIST_TITLE.some(b => tl.includes(b))) return false;

  // Channel yang jelas bukan musik (opsional, bisa ditambah)
  const BLOCKED_CHANNELS = [
    'elestial', // contoh dari screenshot
  ];
  // Uncomment kalau mau block channel tertentu:
  // if (BLOCKED_CHANNELS.some(b => cl.includes(b))) return false;

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
      .filter(v => isMusicContent(v.name, v.author?.name || ''))
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
                .filter(item => isMusicContent(item.snippet.title, item.snippet.channelTitle))
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
