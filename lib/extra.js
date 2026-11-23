// 추가 레이어: eAIP에 없고 브이월드에만 있는 구역들 (드론 원스톱 지도와 같은 레이어)
// VWORLD_KEY 환경변수가 있을 때만 동작. 실패해도 핵심 판정(eAIP)에는 영향 없음.

export const EXTRA_LAYERS = [
  { id: 'lt_c_aistemp',       name: '임시비행금지구역',      level: 'red' },
  { id: 'lt_c_aisobls',       name: '장애물공역',            level: 'orange' },
  { id: 'lt_c_aisatzc',       name: '비행장교통구역',        level: 'orange' },
  { id: 'lt_c_aisaltc',       name: '경계구역',              level: 'orange' },
  { id: 'lt_c_aispca',        name: '사전협의구역',          level: 'orange' },
  { id: 'lt_c_aisfldc',       name: '경량항공기 이착륙장',   level: 'orange' },
  { id: 'lt_c_aisuac',        name: '초경량비행장치공역(UA)', level: 'green' },
  { id: 'lt_c_aisdronezone',  name: '드론시범사업구역',      level: 'green' },
  { id: 'lt_c_wgisnpgug',     name: '국립공원',              level: 'note' },
  { id: 'lt_c_uo301',         name: '국가유산(문화재) 구역', level: 'note' },
  { id: 'lt_c_aisport',       name: '항만',                  level: 'note' },
];

const TIMEOUT_MS = 2500;

function pickLabel(props = {}) {
  const keys = Object.keys(props);
  const k = keys.find(k => /(nam|lbl|label|name|title)/i.test(k) && typeof props[k] === 'string' && props[k].trim());
  if (k) return props[k].trim();
  const any = keys.find(k => typeof props[k] === 'string' && /[가-힣]/.test(props[k]) && props[k].length < 40);
  return any ? props[any].trim() : '';
}

async function queryLayer(layer, lon, lat, env, timeoutMs) {
  const p = new URLSearchParams({
    service: 'data', request: 'GetFeature', version: '2.0', data: layer.id.toUpperCase(),
    key: env.VWORLD_KEY, geomFilter: `POINT(${lon} ${lat})`, geometry: 'false', attribute: 'true',
    crs: 'EPSG:4326', format: 'json', errorformat: 'json', size: '5',
  });
  if (env.VWORLD_DOMAIN) p.set('domain', env.VWORLD_DOMAIN);
  const res = await fetch(`https://api.vworld.kr/req/data?${p}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const status = data.response?.status;
  if (status === 'NOT_FOUND') return [];
  if (status !== 'OK') throw new Error(data.response?.error?.text || `status ${status}`);
  const feats = data.response?.result?.featureCollection?.features || [];
  return [...new Set(feats.map(f => pickLabel(f.properties)))];
}

// 결과: { hits:[{layer, labels}], failed:[{id,name,error}] }
export async function checkExtra(lon, lat, env = process.env, timeoutMs = TIMEOUT_MS) {
  if (!env.VWORLD_KEY) return { hits: [], failed: [], skipped: true };
  const t = Math.max(600, Math.min(TIMEOUT_MS, timeoutMs));
  const results = await Promise.allSettled(EXTRA_LAYERS.map(l => queryLayer(l, lon, lat, env, t)));
  const hits = [], failed = [];
  results.forEach((r, i) => {
    const layer = EXTRA_LAYERS[i];
    if (r.status === 'rejected') failed.push({ id: layer.id, name: layer.name, error: r.reason?.message });
    else if (r.value.length) hits.push({ layer: { name: layer.name, level: layer.level }, labels: r.value.filter(Boolean) });
  });
  if (failed.length) console.error('추가 레이어 실패:', failed.map(f => `${f.id}(${f.error})`).join(', '));
  return { hits, failed };
}

// eAIP 결과 + 추가 레이어 결과 합치기
export function mergeResults(core, extra) {
  const hits = [...core.hits, ...extra.hits.filter(h => h.layer.level === 'red' || h.layer.level === 'orange')];
  const greens = extra.hits.filter(h => h.layer.level === 'green');
  const notes = extra.hits.filter(h => h.layer.level === 'note');
  let verdict = core.verdict;
  if (verdict !== 'red' && hits.some(h => h.layer.level === 'red')) verdict = 'red';
  else if (verdict === 'green' && hits.some(h => h.layer.level === 'orange')) verdict = 'orange';
  return { ...core, hits, greens, notes, extraFailed: extra.failed, verdict };
}
