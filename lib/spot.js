// 지도에서 누른 한 지점의 정보 (드론 원스톱 지도와 같은 방식)
// - 구역: 브이월드 WFS (원스톱과 같은 레이어)
// - 주소: 브이월드 주소 API
// - 법정동: 브이월드 데이터 API (LT_C_ADEMD_INFO)
// - 담당자(비행구역·특별비행·항공촬영): 드론 원스톱 공개 담당자 조회 (개인 이름은 빼고 기관·전화만)
// - 비고: 원스톱 지도에 나오는 안내 문구

const TIMEOUT = 4000;
const SITE = 'https://drone-chatbot.vercel.app';

export const ZONE_LAYERS = {
  lt_c_aisprhc: { name: '비행금지구역', level: 'red' },
  lt_c_aistemp: { name: '임시비행금지구역', level: 'red' },
  lt_c_aisresc: { name: '비행제한구역', level: 'orange' },
  lt_c_aisctrc: { name: '관제권', level: 'orange' },
  lt_c_aisatzc: { name: '비행장교통구역', level: 'orange' },
  lt_c_aisaltc: { name: '경계구역', level: 'orange' },
  lt_c_aisdngc: { name: '위험구역', level: 'orange' },
  lt_c_aisfldc: { name: '경량항공기 이착륙장', level: 'orange' },
  lt_c_aisport: { name: '항만', level: 'orange' },
  lt_c_aisobls: { name: '장애물공역', level: 'note' },
  lt_c_aispca: { name: '사전협의구역', level: 'note' },
  lt_c_aisuac: { name: '초경량비행장치 비행공역', level: 'green' },
  lt_c_aisdronezone: { name: '드론 특별자유화구역', level: 'green' },
  lt_c_wgisnpgug: { name: '국립공원', level: 'note' },
  lt_c_uo301: { name: '국가유산 보호구역', level: 'note' },
};
// 원스톱 기준: 이 레이어만 걸리면 비행승인 불필요
const NO_APPROVAL = new Set(['lt_c_uo301', 'lt_c_wgisnpgug', 'lt_c_aisdronezone', 'lt_c_aisuac', 'lt_c_aisobls', 'lt_c_aispca']);
const BUSAN_DNG = ['lt_c_aisdngc.17', 'lt_c_aisdngc.29', 'lt_c_aisdngc.30', 'lt_c_aisdngc.31', 'lt_c_aisdngc.32', 'lt_c_aisdngc.33'];

const vwParams = (env, o) => {
  const p = new URLSearchParams({ ...o, key: env.VWORLD_KEY });
  if (env.VWORLD_DOMAIN) p.set('domain', env.VWORLD_DOMAIN);
  return p;
};
const vwFetch = (url, env) => fetch(url, {
  headers: { Referer: env.VWORLD_DOMAIN ? `https://${env.VWORLD_DOMAIN.replace(/^https?:\/\//, '')}` : SITE },
  signal: AbortSignal.timeout(TIMEOUT),
});

function to3857(lon, lat) {
  const x = lon * 20037508.34 / 180;
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137;
  return [x, y];
}

const clean = v => (typeof v === 'string' ? v.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '');
const altText = v => v.replace(/SFC/g, '지면').replace(/(\d) (\d{3})/g, '$1,$2').replace(/\s*FT\b/g, 'ft').replace(/\s*AMSL\b/g, 'ft 해발');

// 구역 이름·고도 (예: R75 / 지면~10,000ft 해발, 경복궁 · 국가지정문화재구역)
function zoneInfo(layer, p = {}) {
  if (layer === 'lt_c_uo301') return { id: [clean(p.alias), clean(p.uname)].filter(Boolean).join(' · '), alt: '' };
  const lbl = Object.keys(p).filter(k => /_lbl_\d$/.test(k)).sort();
  if (lbl.length) {
    const [a, b, c] = lbl.map(k => clean(p[k])).map(x => (x === 'UND' ? '' : x));
    return { id: a || '', alt: b && c ? altText(`${c}~${b}`) : '' };
  }
  const skip = /(sido|sigg|sigungu|_cd$|code|num|year)/i;
  const vals = [];
  for (const k of Object.keys(p)) {
    const v = clean(p[k]);
    if (!v || skip.test(k) || !/(lbl|nam|name|label|title|alias|_nm$)/i.test(k) || vals.includes(v)) continue;
    vals.push(v);
  }
  return { id: vals.slice(0, 2).join(' · '), alt: '' };
}

function zoneList(z) {
  const list = z.map(f => ({ layer: f.layer, name: ZONE_LAYERS[f.layer].name, level: ZONE_LAYERS[f.layer].level, ...zoneInfo(f.layer, f.props) }));
  // 이름 없이 고도만 있는 조각은 같은 구역의 이름 있는 항목에 합치기
  for (const x of list.filter(x => !x.id && x.alt)) {
    const t = list.find(y => y.layer === x.layer && y.id && !y.alt);
    if (t) { t.alt = x.alt; x.drop = true; }
  }
  const seen = new Set();
  return list.filter(x => !x.drop).filter(x => { const k = x.layer + x.id + x.alt; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(({ layer, name, level, id, alt }) => ({ layer, name, level, label: [id, alt].filter(Boolean).join(' · ') }));
}

async function getZones(lon, lat, env) {
  const [x, y] = to3857(lon, lat);
  const d = 8; // 약 8m 상자 (원스톱도 클릭한 픽셀 주변 상자로 조회)
  const p = vwParams(env, {
    service: 'WFS', version: '1.1.0', request: 'GetFeature', typename: Object.keys(ZONE_LAYERS).join(','),
    output: 'application/json', srsname: 'EPSG:3857', bbox: `${x - d},${y - d},${x + d},${y + d}`,
  });
  const r = await vwFetch(`https://api.vworld.kr/req/wfs?${p}`, env);
  if (!r.ok) throw new Error(`WFS HTTP ${r.status}`);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('WFS 응답: ' + text.slice(0, 120)); }
  return (data.features || []).map(f => {
    const fid = String(f.id || '').toLowerCase();
    const layer = fid.split('.')[0];
    return { fid, layer, props: f.properties || {} };
  }).filter(f => ZONE_LAYERS[f.layer]);
}

async function getAddress(lon, lat, env) {
  const p = vwParams(env, { service: 'address', version: '2.0', request: 'GetAddress', type: 'BOTH', point: `${lon},${lat}`, format: 'json', crs: 'EPSG:4326', errorformat: 'json' });
  const r = await vwFetch(`https://api.vworld.kr/req/address?${p}`, env);
  const j = await r.json();
  if (j.response?.status !== 'OK') return '';
  const res = j.response.result || [];
  const road = res.find(a => a.type === 'road'), parcel = res.find(a => a.type === 'parcel');
  const a = road || parcel || res[0];
  return a ? (a.zipcode ? `(${a.zipcode}) ` : '') + a.text : '';
}

async function getEmd(lon, lat, env) {
  const p = vwParams(env, { service: 'data', version: '2.0', request: 'GetFeature', data: 'LT_C_ADEMD_INFO', geomFilter: `POINT(${lon} ${lat})`, geometry: 'false', attribute: 'true', crs: 'EPSG:4326', format: 'json', errorformat: 'json', size: '5' });
  const r = await vwFetch(`https://api.vworld.kr/req/data?${p}`, env);
  const j = await r.json();
  const f = j.response?.result?.featureCollection?.features?.[0];
  return f ? { cd: String(f.properties.emd_cd || ''), nm: String(f.properties.emd_kor_nm || ''), full: String(f.properties.full_nm || '') } : null;
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// "김포항공관리사무소(안전운항과) [ 홍길동 | ☎ 02-0000-0000 ]" → "김포항공관리사무소(안전운항과) ☎ 02-0000-0000"
export function cleanContact(desc) {
  const s = decode(String(desc)).replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?)\[(.*)\]\s*$/);
  if (!m) return s;
  const org = m[1].trim();
  const inner = m[2].split('|').map(x => x.trim()).filter(Boolean);
  const tel = inner.find(x => /☎|\d{2,4}-\d{3,4}/.test(x)) || inner[inner.length - 1] || '';
  return `${org} ${tel}`.trim();
}

async function getContacts(type, emdCd) {
  const url = `https://drone.onestop.go.kr/civilaffairs/affairs/getAffairsUser?PAGE_TYPE=user&APPLY_TYPE=${type}&ADDR_ID=${encodeURIComponent(emdCd)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json, text/xml', 'User-Agent': 'Mozilla/5.0 (drone-chatbot)' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`원스톱 HTTP ${r.status}`);
  const text = await r.text();
  let list = [];
  if (text.trim().startsWith('[')) list = JSON.parse(text).map(i => i.ORG_DEP_DESC).filter(Boolean);
  else list = [...text.matchAll(/<ORG_DEP_DESC>([\s\S]*?)<\/ORG_DEP_DESC>/g)].map(m => m[1]);
  return [...new Set(list.map(cleanContact))];
}

// 원스톱 지도의 비고·추가 안내 문구
export function buildNotes(zones, emd) {
  const ids = zones.map(z => z.fid);
  const labels = zones.map(z => JSON.stringify(z.props)).join(' ');
  const has = s => labels.includes(s);
  const hasId = id => ids.includes(id);
  const cd = emd?.cd || '', nm = emd?.nm || '';
  const warn = [], extra = [], flightAdd = [];

  const nuke = { P61A: 'P61A – 고리원전 ☎ 051-726-2053, 2054 / 새울원전 ☎ 052-715-2892, 2897', P62A: 'P62A – 월성원전 ☎ 054-779-3165', P63A: 'P63A – 한빛원전 ☎ 061-357-2823', P64A: 'P64A – 한울원전 ☎ 054-785-1061', P65A: 'P65A – 한국원자력연구원 ☎ 042-868-2093' };
  for (const [k, v] of Object.entries(nuke)) if (has(k)) warn.push(`드론 원스톱 신청 불가 · ${v}`);
  if (has('PYEONGTAEK CTLZ')) warn.push('드론 원스톱 신청 불가 · (평택) 원스톱 공지사항 ‘평택기지’ 확인');
  if (has('OSAN CTLZ')) warn.push('드론 원스톱 신청 불가 · (오산) 원스톱 공지사항 ‘오산’ 확인');
  if (has('GUNSAN TCA AREA A')) warn.push('드론 원스톱 신청 불가 · (군산) 원스톱 공지사항 ‘군산’ 확인');
  if (/"A2"|"A2 /.test(labels) && !has('A20T')) warn.push('드론 원스톱 신청 불가 · (천안) 원스톱 공지사항 ‘천안’ 확인');
  if (has('R155A') || has('R155B')) warn.push('드론 원스톱 신청 불가 · (김천) 원스톱 공지사항 ‘김천’ 확인');

  if (has('A20T')) {
    extra.push('A20T – 군사목적의 헬기 등 항공기 운항이 빈번하므로 주의 필요');
    if (has('SEOSAN')) extra.push('비행신청 전 원스톱 공지사항 “서산 관제권 비행신청 메뉴얼” 필독 (군사지역 포함 시 승인 불가, 항공촬영은 육군 32사단 별도 승인)');
  } else if (has('A19T')) extra.push('A19T – 군사목적의 헬기 등 항공기 운항이 빈번하므로 주의 필요');

  if (['30170113', '30170112', '30170128', '36110110', '36110107', '36110114'].includes(cd)) extra.push('정부청사(세종·대전) 드론 비행/촬영 사전허가 필요 – 원스톱 공지사항 ‘정부청사’ 확인');
  else if (cd === '26290000' || cd.startsWith('262901') || cd === '26200000' || cd.startsWith('262001') || cd === '26500000' || cd.startsWith('265001')) extra.push('부산 남구 용호동 신선대·백운포 체육공원·오륙도 일대 비행·촬영은 해군부산기지방호전대 ☎ 051-679-1842 안내');
  else if (['항동7가', '북성동1가'].includes(nm)) extra.push('인천 중구 연안부두·월미도 일대 비행·촬영은 해군 인천해역방어사령부 ☎ 032-452-4334 안내 (군사기지 무허가 비행 시 처벌)');
  else if (nm === '강정동') extra.push('서귀포 강정크루즈터미널 일대 비행·촬영은 해병9여단 ☎ 064-905-3212 안내 (군사기지 무허가 비행 시 처벌)');
  else if (nm === '고아읍') extra.push('구미시 고아읍 일대 촬영 금지시설 위치 – 비행 전 ☎ 054-482-5166 안내');
  else if (nm === '흥해읍') extra.push('포항시 흥해읍 일대 촬영 금지시설(국가 중요 시설) 위치 – 비행 전 ☎ 054-245-7617 안내');
  else if (nm === '속달동') extra.push('군포시 속달동 일대 촬영 금지시설(국가 중요 시설) 위치 – 비행 전 ☎ 070-7790-1310 안내');
  else if (cd === '41830400') extra.push('양평군 용문산 정상 일대 촬영 금지시설(국가 중요 시설) 위치 – 비행 전 ☎ 070-7790-1210 안내');
  else if (cd === '41820350') extra.push('가평군 화악리 산 228 일대 촬영 금지시설(국가 중요 시설) 위치 – 비행 전 ☎ 070-7790-1510 안내');
  else if (cd === '41830340') extra.push('양평군 용문산 정상·옥천면 용천리 일대 촬영 금지시설(국가 중요 시설) 위치 – 비행 전 ☎ 070-7790-1210 안내');

  const kiast = {
    'lt_c_aisuac.47': '(UA 62) 항공안전기술원(인천 드론비행시험센터) ☎ 032-567-5748',
    'lt_c_aisdronezone.7': '항공안전기술원(화성 드론비행시험센터) ☎ 031-356-5520(5524)',
    'lt_c_aisuac.44': '(UA 59) 항공안전기술원(고성 드론비행시험센터) ☎ 055-673-5748',
    'lt_c_aisuac.45': '(UA 60) 항공안전기술원(영월 드론비행시험센터) ☎ 033-375-5747(5748)',
    'lt_c_aisuac.46': '(UA 61) 항공안전기술원(보은 드론비행시험센터) ☎ 043-543-5747',
    'lt_c_aisdronezone.6': '항공안전기술원(의성 드론비행시험센터) ☎ 054-832-5748(1689)',
  };
  for (const [id, v] of Object.entries(kiast)) if (hasId(id)) {
    extra.push(`해당 공역에서 비행하려면 미리 항공안전기술원 드론비행시험센터에 온라인 신청·협의 – ${v}`);
    flightAdd.push(v);
  }
  if (['44825253', '44825320'].includes(cd)) flightAdd.push('비행장교통구역-태안-한서대학교 ☎ 041-671-6165~6');
  if (['43800250', '43800320', '43800350', '43800310'].includes(cd)) flightAdd.push('UA45 단양군청 체육레저과 ☎ 043-420-2963');

  const ports = zones.filter(z => z.layer === 'lt_c_aisport').map(z => z.props);
  for (const p of ports) {
    extra.push(`항만시설 별도 승인 필요 – (문의) ${p.port_opr || '-'} ${p.info_tel ? '☎ ' + p.info_tel : ''} / (관리) ${p.sup_org || '-'} ${p.mgr_tel ? '☎ ' + p.mgr_tel : ''}`.replace(/\s+/g, ' '));
  }

  const base = '사유지, 해수욕장, 국립공원, 문화재, 청와대, 교도소, 군부대, 국가중요시설, 항만 등은 소유자나 관리사무소가 있으면 반드시 미리 협의해 주세요.';
  return { warn, notes: [base, ...extra], flightAdd };
}

export function judge(zones, hasAddress) {
  const layers = [...new Set(zones.map(z => z.layer))];
  const busanDng = zones.some(z => BUSAN_DNG.includes(z.fid));
  let need = layers.some(l => !NO_APPROVAL.has(l));
  if (busanDng && !layers.some(l => !NO_APPROVAL.has(l) && l !== 'lt_c_aisdngc')) need = false;
  if (layers.includes('lt_c_aisport')) need = true;
  const red = layers.some(l => ZONE_LAYERS[l].level === 'red');
  if (!hasAddress) return { verdict: 'unknown', title: '주소 확인 필요', sub: '바다 등 주소가 없는 곳이에요. 관할기관에 확인해 주세요.' };
  if (red) return { verdict: 'red', title: '비행금지구역', sub: '비행승인 필요 · 관할기관 확인 (승인이 안 나는 곳도 있어요)' };
  if (need) return { verdict: 'orange', title: '비행승인 필요', sub: '관할기관(담당자)에 확인해 주세요' };
  return { verdict: 'green', title: '비행승인 불필요', sub: '조종사 준수사항 준수 (주간, 25kg 이하)' };
}

export async function getSpot(lon, lat, env = process.env, raw = false) {
  if (!env.VWORLD_KEY) throw new Error('VWORLD_KEY 없음');
  const errors = [];
  const keep = (name, p) => p.catch(e => { errors.push(`${name}: ${e.message}`); return null; });
  const [zones, address, emd] = await Promise.all([
    keep('구역', getZones(lon, lat, env)), keep('주소', getAddress(lon, lat, env)), keep('법정동', getEmd(lon, lat, env)),
  ]);
  let contacts = { flight: null, special: null, photo: null };
  if (emd?.cd) {
    const [f, s, p] = await Promise.all([3, 4, 5].map(t => keep(`담당자${t}`, getContacts(t, emd.cd))));
    contacts = { flight: f, special: s, photo: p };
  }
  const z = zones || [];
  const { warn, notes, flightAdd } = buildNotes(z, emd);
  if (contacts.flight) contacts.flight = [...new Set([...contacts.flight, ...flightAdd])];
  const result = zones ? judge(z, !!address) : { verdict: 'unknown', title: '확인 실패', sub: '구역 정보를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.' };
  return { lat, lon, address: address || '', emd, ...result, zones: zoneList(z), contacts, warn, notes, errors, ...(raw ? { raw: z } : {}) };
}
