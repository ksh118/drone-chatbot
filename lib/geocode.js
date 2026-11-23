// 장소 이름 → 좌표(경도 x, 위도 y)
// 카카오 REST 키가 있으면 카카오 키워드 검색(장소명에 강함), 없으면 브이월드 검색 API 사용

const TIMEOUT_MS = 2500;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function kakaoKeyword(query, key) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { headers: { Authorization: `KakaoAK ${key}` } });
  const d = data.documents?.[0];
  if (!d) return null;
  return { x: Number(d.x), y: Number(d.y), name: d.place_name, address: d.road_address_name || d.address_name };
}

async function kakaoAddress(query, key) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?size=1&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { headers: { Authorization: `KakaoAK ${key}` } });
  const d = data.documents?.[0];
  if (!d) return null;
  return { x: Number(d.x), y: Number(d.y), name: d.address_name, address: d.address_name };
}

async function vworldSearch(query, key, domain, type, category) {
  const p = new URLSearchParams({
    service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326',
    size: '1', page: '1', query, type, format: 'json', errorformat: 'json', key,
  });
  if (category) p.set('category', category);
  if (domain) p.set('domain', domain);
  const data = await fetchJson(`https://api.vworld.kr/req/search?${p}`);
  const item = data.response?.result?.items?.[0];
  if (!item) return null;
  const name = item.title || item.address?.road || item.address?.parcel || query;
  const address = item.address?.road || item.address?.parcel || '';
  return { x: Number(item.point.x), y: Number(item.point.y), name, address };
}

export async function geocode(query, env = process.env) {
  const kakaoKey = env.KAKAO_REST_KEY;
  const vKey = env.VWORLD_KEY;
  const domain = env.VWORLD_DOMAIN;

  const tries = [];
  if (kakaoKey) {
    tries.push(() => kakaoKeyword(query, kakaoKey));
    tries.push(() => kakaoAddress(query, kakaoKey));
  }
  if (vKey) {
    tries.push(() => vworldSearch(query, vKey, domain, 'place'));
    tries.push(() => vworldSearch(query, vKey, domain, 'address', 'road'));
    tries.push(() => vworldSearch(query, vKey, domain, 'address', 'parcel'));
  }
  for (const t of tries) {
    try {
      const r = await t();
      if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return r;
    } catch (e) {
      console.error('geocode error:', e.message);
    }
  }
  return null;
}
