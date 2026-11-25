// 지도에서 누른 지점 정보: GET /api/spot?lat=37.5&lon=126.9
import { getSpot } from '../lib/spot.js';
import { guard } from '../lib/guard.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'spot', 40)) return;
  const q = req.query || {};
  const lat = +(+q.lat).toFixed(5), lon = +(+q.lon).toFixed(5);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 32 || lat > 39.5 || lon < 123 || lon > 132.5) {
    return res.status(400).json({ error: '한국 범위의 lat, lon이 필요해요' });
  }
  try {
    const { errors, ...out } = await getSpot(lon, lat, process.env);
    out.partial = errors.length > 0;
    if (!errors.length) res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    else console.error('spot 일부 실패', errors.join(' / '));
    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '조회 중 오류가 났어요. 잠시 후 다시 시도해 주세요.' });
  }
}
