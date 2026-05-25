export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Artist name required' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Tulis bio artis musik "${name}" dalam bahasa Indonesia, 3-4 kalimat yang panjang dan natural. Ceritakan genre musiknya, gaya bermusik, hal unik yang membuat mereka berbeda, dan dampaknya terhadap pendengar. Kalau artis ini tidak terkenal, buat bio yang masuk akal berdasarkan nama dan kemungkinan genre musiknya. Jangan tulis "saya tidak tahu" atau "tidak ada info". Langsung tulis bionya saja tanpa intro atau kata pembuka.`
          }
        ]
      })
    });

    const data = await response.json();
    const bio = data.choices?.[0]?.message?.content || '';
    if (!bio) throw new Error('Empty response');

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    return res.status(200).json({ bio });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
