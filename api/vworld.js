// 브이월드 중계 (키는 서버에서만 붙임)
// 배경지도: GET /api/vworld?op=tile&type=Base&z=12&y=1585&x=3493
// 장소 검색: GET /api/vworld?op=search&q=여의도한강공원
const TYPES = { Base: 'png', Satellite: 'jpeg', Hybrid: 'png', gray: 'png' };
const SITE = 'https://drone-chatbot.vercel.app';

const headers = env => ({ Referer: env.VWORLD_DOMAIN ? `https://${env.VWORLD_DOMAIN.replace(/^https?:\/\//, '')}` : SITE });

async function search(q, env) {
  const run = async (type, extra = {}) => {
    const p = new URLSearchParams({ service: 'search', request: 'search', version: '2.0', size: '8', page: '1', query: q, type, format: 'json', errorformat: 'json', crs: 'EPSG:4326', key: env.VWORLD_KEY, ...extra });
    if (env.VWORLD_DOMAIN) p.set('domain', env.VWORLD_DOMAIN);
    const r = await fetch(`https://api.vworld.kr/req/search?${p}`, { headers: headers(env), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return (j.response?.result?.items || []).map(i => ({
      name: i.title || i.address?.road || i.address?.parcel || q,
      address: i.address?.road || i.address?.parcel || (typeof i.address === 'string' ? i.address : ''),
      lat: +i.point?.y, lon: +i.point?.x,
    })).filter(i => Number.isFinite(i.lat) && Number.isFinite(i.lon));
  };
  const results = await Promise.allSettled([run('place'), run('address', { category: 'road' }), run('address', { category: 'parcel' })]);
  const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const seen = new Set();
  return all.filter(i => { const k = i.lat.toFixed(4) + i.lon.toFixed(4); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
}

export default async function handler(req, res) {
  const q = req.query || {};
  const env = process.env;
  if (!env.VWORLD_KEY) return res.status(503).send('no key');
  try {
    if (q.op === 'tile') {
      const type = String(q.type || 'Base');
      const z = parseInt(q.z, 10), x = parseInt(q.x, 10), y = parseInt(q.y, 10);
      if (!TYPES[type] || !(z >= 5 && z <= 19) || !(x >= 0) || !(y >= 0)) return res.status(400).send('bad request');
      const r = await fetch(`https://api.vworld.kr/req/wmts/1.0.0/${env.VWORLD_KEY}/${type}/${z}/${y}/${x}.${TYPES[type]}`, { headers: headers(env), signal: AbortSignal.timeout(8000) });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !ct.startsWith('image/')) { console.error('타일 실패', type, r.status, ct); return res.status(502).send('tile error'); }
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000');
      return res.status(200).send(Buffer.from(await r.arrayBuffer()));
    }
    if (q.op === 'search') {
      const query = String(q.q || '').trim().slice(0, 60);
      if (!query) return res.status(400).json({ error: '검색어가 필요해요' });
      const items = await search(query, env);
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      return res.status(200).json({ items });
    }
    res.status(400).send('bad op');
  } catch (e) {
    console.error('vworld 오류', e.message);
    res.status(504).json({ error: e.message });
  }
}
