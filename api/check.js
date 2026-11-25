// 우리 공역 API: 한 지점(또는 장소 이름)의 판정 결과
// GET /api/check?lat=37.53&lon=126.93   또는   GET /api/check?q=여의도한강공원
import { checkAirspace } from '../lib/aip.js';
import { geocode } from '../lib/geocode.js';
import { checkExtra, mergeResults } from '../lib/extra.js';
import { guard } from '../lib/guard.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'check', 30)) return;
  try {
    const { lat, lon, q } = req.query || {};
    let place = null;
    let la = parseFloat(lat), lo = parseFloat(lon);
    if (q) {
      place = await geocode(String(q).slice(0, 80));
      if (!place) return res.status(404).json({ error: '장소를 못 찾았어요' });
      la = place.y; lo = place.x;
    }
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < 32 || la > 39.5 || lo < 123 || lo > 132.5) {
      return res.status(400).json({ error: '한국 범위의 lat, lon 또는 q가 필요해요' });
    }
    const [core, extra] = await Promise.all([checkAirspace(lo, la), checkExtra(lo, la)]);
    const result = mergeResults(core, extra);
    res.status(200).json({ lat: la, lon: lo, place, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '판정 중 오류가 났어요. 잠시 후 다시 시도해 주세요.' });
  }
}
