// 우리 공역 API: 국토교통부 항공정보간행물(eAIP)을 직접 읽어서 공역 판정
// 원본: https://aim.koca.go.kr/eaipPub/  (ENR 5.1 금지·제한·위험구역, ENR 2.1 관제권)
// API 키 필요 없음. 서버 메모리에 캐시하고 6시간마다 새로 읽음.

import { civilCtrs } from './ctr-civil.js';

const BASE = 'https://aim.koca.go.kr/eaipPub/Package/';
const CACHE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;
const NM = 1852; // 1 해리 = 1852m

/* ---------- 좌표·거리 ---------- */

// "373209N" "373114.0N" "3713N" / "1265838E" "12841E" → 십진수 도
export function parseCoord(s) {
  const m = /^(\d+(?:\.\d+)?)([NSEW])$/.exec(s.trim());
  if (!m) return NaN;
  const [intPart, frac = ''] = m[1].split('.');
  const degLen = /[NS]/.test(m[2]) ? 2 : 3;
  const d = +intPart.slice(0, degLen);
  const mm = +(intPart.slice(degLen, degLen + 2) || 0);
  const ss = +((intPart.slice(degLen + 2) || '0') + (frac ? '.' + frac : ''));
  let v = d + mm / 60 + ss / 3600;
  if (m[2] === 'S' || m[2] === 'W') v = -v;
  return v;
}

const COORD_RE = /(\d{4,6}(?:\.\d+)?[NS])\s*(\d{5,7}(?:\.\d+)?[EW])/g;

export function coordsIn(text) {
  return [...text.matchAll(COORD_RE)].map(m => ({ lat: parseCoord(m[1]), lon: parseCoord(m[2]) }));
}

// 작은 범위에서 쓰는 평면 근사 (m 단위)
function toXY(p, ref) {
  const k = Math.PI / 180;
  return { x: (p.lon - ref.lon) * k * 6371000 * Math.cos(ref.lat * k), y: (p.lat - ref.lat) * k * 6371000 };
}

export function distM(a, b) {
  const k = Math.PI / 180;
  const dLat = (b.lat - a.lat) * k, dLon = (b.lon - a.lon) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) &&
        p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

function distToSegmentM(p, a, b) {
  const A = toXY(a, p), B = toXY(b, p); // p가 원점
  const dx = B.x - A.x, dy = B.y - A.y;
  const t = Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(A.x + t * dx, A.y + t * dy);
}

export function contains(shape, p) {
  if (shape.type === 'circle') return distM(p, shape.center) <= shape.radiusM;
  if (shape.type === 'capsule') return distToSegmentM(p, shape.a, shape.b) <= shape.radiusM;
  if (shape.type === 'polygon') return inPolygon(p, shape.points);
  return false;
}

/* ---------- 문장 → 도형 ---------- */

export function shapeFromText(raw) {
  // P518의 민간 회랑(CIVIL CORRIDOR) 좌표는 구역 경계가 아니므로 잘라냄
  const text = raw.split(/CIVIL CORRIDOR/i)[0];

  // 원 두 개를 잇는 구역 (P73)
  const two = /radius of ([\d.]+)\s*(?:NM|miles?).*?Center 1\s*:\s*(\S+)\s+(\S+).*?Center 2\s*:\s*(\S+)\s+(\S+)/is.exec(text);
  if (two) {
    return { type: 'capsule', radiusM: +two[1] * NM,
      a: { lat: parseCoord(two[2]), lon: parseCoord(two[3]) },
      b: { lat: parseCoord(two[4]), lon: parseCoord(two[5]) } };
  }
  // 지름으로 적힌 원
  const dia = /circle\s+([\d.]+)\s*NM\s+in\s+diameter/i.exec(text);
  // 반경으로 적힌 원 / 호(arc) — 호는 같은 반경의 원으로 넓게 잡음(안전 쪽)
  const rad = /(?:radius\s+([\d.]+)\s*NM|([\d.]+)\s*NM\s+radius|([\d.]+)\s*NM\s+arc)/i.exec(text);
  const pts = coordsIn(text);
  if ((dia || rad) && pts.length) {
    const r = dia ? +dia[1] / 2 : +(rad[1] || rad[2] || rad[3]);
    // 호 정의(시작점-호-끝점)면 중심은 "centered on" 뒤 좌표
    const c = /cent(?:er|re)d?\s+(?:on|at)\s+(\S+)\s+(\S+)/i.exec(text);
    const center = c && !isNaN(parseCoord(c[1])) ? { lat: parseCoord(c[1]), lon: parseCoord(c[2]) } : pts[pts.length - 1];
    return { type: 'circle', center, radiusM: r * NM };
  }
  if (pts.length >= 3) {
    const points = pts.slice();
    // "Demarcation(휴전선)과 아래 선 사이" → 북쪽(38.7°N)까지 덮도록 닫음
    if (/between Demarcation/i.test(text)) {
      const last = points[points.length - 1], first = points[0];
      points.push({ lat: 38.7, lon: last.lon }, { lat: 38.7, lon: first.lon });
    }
    return { type: 'polygon', points };
  }
  return null;
}

/* ---------- HTML 읽기 ---------- */

const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function htmlText(s) {
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, e => ENT[e] ?? ' ').replace(/\s+/g, ' ').trim();
}

function tableRows(html) {
  return html.split(/<tr[\s>]/i).slice(1).map(tr => {
    const body = tr.split(/<\/tr>/i)[0];
    return [...body.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => htmlText(m[1]));
  });
}

const TYPE = {
  P: { kind: '비행금지구역', level: 'red' },
  R: { kind: '비행제한구역', level: 'orange' },
  D: { kind: '위험구역', level: 'orange' },
};

// ENR 5.1 → [{id, name, kind, level, shape}]
export function parseEnr51(html) {
  const out = new Map();
  for (const cells of tableRows(html)) {
    const m = /^RK\s*([PRD])\s*(\d+[A-Z]?)\s+(.*)$/.exec(cells[0] || '');
    if (!m) continue;
    const id = `RK ${m[1]}${m[2]}`;
    if (out.has(id)) continue; // 중복 표기 제거
    const shape = shapeFromText(m[3]);
    if (!shape) continue;
    const name = (/^([A-Za-z][A-Za-z\- ()]*?)(?=\s+(?:A\s+)?(?:circle|Area|Semicircle|The area|\d{4}))/i.exec(m[3]) || [, ''])[1].trim();
    out.set(id, { id, name, ...TYPE[m[1]], shape, vertical: cells[1] || '' });
  }
  return [...out.values()];
}

// ENR 2.1 → 관제권 목록
export function parseEnr21(html) {
  const text = htmlText(html);
  const out = [];
  // 군 비행장 관제권: "OSAN CONTROL ZONE A circle 5 NM radius centered at ..."
  // (민간공항은 "See part 3 AERODROMES"라 좌표가 없음 → ctr-civil.js에서 따로 처리)
  const re = /([A-Z][A-Z\-]+) CONTROL ZONE\s+(.*?)(?=\s(?:SFC|GND)\s*-)/g;
  for (const m of text.matchAll(re)) {
    if (m[2].length > 1500 || /See part 3/i.test(m[2])) continue;
    const shape = shapeFromText(m[2]);
    if (!shape) continue;
    out.push({ id: `${m[1]} CTR`, name: m[1], kind: '관제권', level: 'red', shape });
  }
  return out;
}

/* ---------- 최신판 찾기 + 캐시 ---------- */

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'drone-kakao-chatbot' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// 목록에서 지금 발효 중인 판(날짜가 지난 것 중 가장 최근)을 고름
export function currentPackage(historyHtml, now = new Date()) {
  const folders = [...new Set([...historyHtml.matchAll(/(\d{4}-\d{2}-\d{2}(?:-AIRAC)?)\/html\/index/g)].map(m => m[1]))];
  const effective = f => new Date(f.slice(0, 10) + (f.endsWith('AIRAC') ? 'T16:00:00Z' : 'T00:00:00Z'));
  const valid = folders.filter(f => effective(f) <= now).sort((a, b) => effective(b) - effective(a));
  return valid[0] || null;
}

let cache = null; // { at, pkg, areas }

export async function loadAirspace(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const history = await get(BASE + 'history-en-GB.html');
  const pkg = currentPackage(history);
  if (!pkg) throw new Error('발효 중인 eAIP를 찾지 못함');
  const [enr51, enr21] = await Promise.all([
    get(`${BASE}${pkg}/html/eAIP/KR-ENR-5.1-en-GB.html`),
    get(`${BASE}${pkg}/html/eAIP/KR-ENR-2.1-en-GB.html`),
  ]);
  const areas = [...parseEnr51(enr51), ...parseEnr21(enr21), ...civilCtrs(parseCoord)];
  if (areas.length < 20) throw new Error(`공역 해석 결과가 너무 적음(${areas.length})`);
  cache = { at: Date.now(), pkg, areas };
  return cache;
}

// 결과: { hits:[{layer:{name,level}, labels:[]}], failed:[], verdict, pkg }
export async function checkAirspace(lon, lat) {
  let data;
  try {
    data = await loadAirspace();
  } catch (e) {
    console.error('eAIP 읽기 실패:', e.message);
    if (!cache) return { hits: [], failed: [{ name: '공역 데이터', level: 'red' }], verdict: 'unknown' };
    data = cache; // 예전 캐시라도 사용
  }
  const p = { lat, lon };
  const byKind = new Map();
  for (const a of data.areas) {
    if (!contains(a.shape, p)) continue;
    const label = a.kind === '관제권' ? a.name : `${a.id.replace(/^RK /, '')}${a.name ? ' ' + a.name : ''}`;
    if (!byKind.has(a.kind)) byKind.set(a.kind, { layer: { name: a.kind, level: a.level }, labels: [] });
    const labels = byKind.get(a.kind).labels;
    if (!labels.some(l => l.startsWith(label.split('(')[0]))) labels.push(label);
  }
  const hits = [...byKind.values()];
  let verdict = 'green';
  if (hits.some(h => h.layer.level === 'red')) verdict = 'red';
  else if (hits.some(h => h.layer.level === 'orange')) verdict = 'orange';
  return { hits, failed: [], verdict, pkg: data.pkg };
}
