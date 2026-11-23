// 우리 공역 API: 전체 구역을 GeoJSON으로 돌려줌 (지도 확인용)
// GET /api/zones
import { loadAirspace } from '../lib/aip.js';

const R = 6371000;
const k = Math.PI / 180;

// 중심에서 거리 d(m), 방위 b(도)만큼 간 점
function offset(c, d, b) {
  const lat1 = c.lat * k, lon1 = c.lon * k, br = b * k, ad = d / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ad) + Math.cos(lat1) * Math.sin(ad) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(lat1), Math.cos(ad) - Math.sin(lat1) * Math.sin(lat2));
  return [lon2 / k, lat2 / k];
}

function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * k) * Math.cos(b.lat * k);
  const x = Math.cos(a.lat * k) * Math.sin(b.lat * k) - Math.sin(a.lat * k) * Math.cos(b.lat * k) * Math.cos((b.lon - a.lon) * k);
  return Math.atan2(y, x) / k;
}

export function toRing(shape) {
  if (shape.type === 'circle') {
    const ring = [];
    for (let b = 0; b <= 360; b += 7.5) ring.push(offset(shape.center, shape.radiusM, b));
    return ring;
  }
  if (shape.type === 'capsule') {
    // 두 원과 그 사이를 감싸는 모양
    const br = bearing(shape.a, shape.b), ring = [];
    for (let t = 90; t <= 270; t += 10) ring.push(offset(shape.a, shape.radiusM, br + t));
    for (let t = -90; t <= 90; t += 10) ring.push(offset(shape.b, shape.radiusM, br + t));
    ring.push(ring[0]);
    return ring;
  }
  const ring = shape.points.map(p => [p.lon, p.lat]);
  ring.push(ring[0]);
  return ring;
}

export function toGeoJSON(areas) {
  return {
    type: 'FeatureCollection',
    features: areas.map(a => ({
      type: 'Feature',
      properties: { id: a.id, name: a.name, kind: a.kind, level: a.level, vertical: a.vertical || '', shape: a.shape.type },
      geometry: { type: 'Polygon', coordinates: [toRing(a.shape)] },
    })),
  };
}

export default async function handler(req, res) {
  try {
    const { pkg, areas } = await loadAirspace();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
    res.status(200).json({ pkg, count: areas.length, ...toGeoJSON(areas) });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'eAIP를 읽지 못했어요', detail: e.message });
  }
}
