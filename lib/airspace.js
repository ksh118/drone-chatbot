// 좌표가 어떤 공역 안에 있는지 브이월드 2D 데이터 API로 조회

export const LAYERS = [
  { id: 'LT_C_AISPRHC', name: '비행금지구역',       level: 'red' },
  { id: 'LT_C_AISCTRC', name: '관제권',             level: 'red' },
  { id: 'LT_C_AISRESC', name: '비행제한구역',       level: 'orange' },
  { id: 'LT_C_AISDNGC', name: '위험구역',           level: 'orange' },
  { id: 'LT_C_AISUAC',  name: '초경량비행장치공역', level: 'green' },
];

const TIMEOUT_MS = 3000;

// 속성 중에서 구역 이름처럼 보이는 값을 고름 (레이어마다 필드명이 달라서)
function pickLabel(props = {}) {
  const keys = Object.keys(props);
  const prefer = keys.find(k => /(nam|lbl|label|name)/i.test(k) && typeof props[k] === 'string' && props[k].trim());
  if (prefer) return props[prefer].trim();
  const anyStr = keys.find(k => typeof props[k] === 'string' && /[가-힣A-Za-z]/.test(props[k]) && props[k].length < 60);
  return anyStr ? props[anyStr].trim() : '';
}

async function queryLayer(layer, x, y, env) {
  const p = new URLSearchParams({
    service: 'data', request: 'GetFeature', version: '2.0',
    data: layer.id, key: env.VWORLD_KEY,
    geomFilter: `POINT(${x} ${y})`,
    geometry: 'false', attribute: 'true',
    crs: 'EPSG:4326', format: 'json', errorformat: 'json', size: '10',
  });
  if (env.VWORLD_DOMAIN) p.set('domain', env.VWORLD_DOMAIN);

  const res = await fetch(`https://api.vworld.kr/req/data?${p}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const status = data.response?.status;
  if (status === 'NOT_FOUND') return [];
  if (status !== 'OK') throw new Error(data.response?.error?.text || `status ${status}`);
  const features = data.response?.result?.featureCollection?.features || [];
  return features.map(f => pickLabel(f.properties)).filter((v, i, a) => a.indexOf(v) === i);
}

// 결과: { hits: [{layer, labels}], failed: [layer], verdict: 'red'|'orange'|'green'|'unknown' }
export async function checkAirspace(x, y, env = process.env) {
  const results = await Promise.allSettled(LAYERS.map(l => queryLayer(l, x, y, env)));
  const hits = [];
  const failed = [];
  results.forEach((r, i) => {
    const layer = LAYERS[i];
    if (r.status === 'rejected') {
      console.error(`${layer.id} 조회 실패:`, r.reason?.message);
      failed.push(layer);
    } else if (r.value.length > 0) {
      hits.push({ layer, labels: r.value });
    }
  });

  let verdict = 'green';
  if (hits.some(h => h.layer.level === 'red')) verdict = 'red';
  else if (hits.some(h => h.layer.level === 'orange')) verdict = 'orange';
  // 금지/제한 레이어 중 하나라도 확인 못 했으면 "가능"이라고 단정하지 않음
  else if (failed.some(l => l.level !== 'green')) verdict = 'unknown';

  return { hits, failed, verdict };
}
