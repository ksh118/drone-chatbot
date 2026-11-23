// 지도용 브이월드 WMS 중계 (키는 서버에서만 붙임, 브라우저에 노출 안 됨)
// GET /api/wms?layers=lt_c_uo301&bbox=...&width=256&height=256 (Leaflet WMS 요청 그대로)
import { EXTRA_LAYERS } from '../lib/extra.js';

const ALLOWED = new Set(EXTRA_LAYERS.map(l => l.id));

export default async function handler(req, res) {
  const q = req.query || {};
  const layer = String(q.layers || q.LAYERS || '').toLowerCase();
  const bbox = String(q.bbox || q.BBOX || '');
  if (!ALLOWED.has(layer) || !/^[-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+$/.test(bbox)) {
    return res.status(400).send('bad request');
  }
  if (!process.env.VWORLD_KEY) return res.status(503).send('no key');
  const size = n => String(Math.min(512, Math.max(64, parseInt(n, 10) || 256)));
  const p = new URLSearchParams({
    service: 'WMS', request: 'GetMap', version: '1.3.0', layers: layer, styles: layer,
    crs: 'EPSG:3857', bbox, width: size(q.width || q.WIDTH), height: size(q.height || q.HEIGHT),
    format: 'image/png', transparent: 'true', key: process.env.VWORLD_KEY,
  });
  if (process.env.VWORLD_DOMAIN) p.set('domain', process.env.VWORLD_DOMAIN);
  try {
    const r = await fetch(`https://api.vworld.kr/req/wms?${p}`, { signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) {
      console.error('WMS 실패', layer, r.status, type);
      return res.status(502).send('wms error');
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('WMS 오류', layer, e.message);
    res.status(504).send('timeout');
  }
}
