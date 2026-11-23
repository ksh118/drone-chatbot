// 장소 이름 → 좌표 (API 키 없이 OpenStreetMap Nominatim 사용)
// KAKAO_REST_KEY 환경변수가 있으면 카카오 검색을 먼저 씀 (장소명 검색이 더 정확)
// Nominatim 이용 정책: 초당 1회 이하, User-Agent 필수, "© OpenStreetMap" 출처 표시

const TIMEOUT_MS = 2500;
const UA = 'drone-kakao-chatbot (https://github.com/ksh118/drone-chatbot)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function kakaoKeyword(query, key) {
  const data = await fetchJson(`https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=${encodeURIComponent(query)}`,
    { Authorization: `KakaoAK ${key}` });
  const d = data.documents?.[0];
  return d ? { x: +d.x, y: +d.y, name: d.place_name, address: d.road_address_name || d.address_name } : null;
}

async function nominatim(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&accept-language=ko&q='
    + encodeURIComponent(query);
  const data = await fetchJson(url, { 'User-Agent': UA, 'Accept-Language': 'ko' });
  const d = data[0];
  if (!d) return null;
  const parts = d.display_name.split(',').map(s => s.trim());
  const address = parts.slice(1).filter(s => !/^\d+$/.test(s) && s !== '대한민국').reverse().join(' ');
  return { x: +d.lon, y: +d.lat, name: d.name || parts[0], address };
}

export async function geocode(query, env = process.env) {
  const tries = [];
  if (env.KAKAO_REST_KEY) tries.push(() => kakaoKeyword(query, env.KAKAO_REST_KEY));
  tries.push(() => nominatim(query));
  if (/\s/.test(query)) {
    const words = query.split(/\s+/);
    // "여의도 한강공원" → "여의도한강공원" (붙여 쓰기)
    tries.push(async () => { await sleep(1100); return nominatim(words.join('')); });
    // "강릉 경포해변" → "경포해변" (앞의 지역명 빼기)
    tries.push(async () => { await sleep(1100); return nominatim(words.slice(1).join(' ')); });
  }
  const start = Date.now();
  for (const t of tries) {
    // 카카오 스킬은 5초 안에 답해야 해서, 3초가 지나면 더 찾지 않음
    if (Date.now() - start > 3000) break;
    try {
      const r = await t();
      if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return r;
    } catch (e) {
      console.error('geocode error:', e.message);
    }
  }
  return null;
}
