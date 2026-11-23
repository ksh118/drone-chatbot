// 민간·민군 공항 관제권 (eAIP AD 2.2 ARP 좌표 + AD 2.17 ATS AIRSPACE)
// 기준: eAIP 2026-11-12 발효판 (https://aim.koca.go.kr/eaipPub/)
// 전부 "ARP 중심 반경 5 NM" 원. 무안·울진은 확장 구역이 추가로 있음.
// 공항 기준점은 거의 바뀌지 않지만, AIP 개정 시 확인해서 고칠 것.

const RAW = [
  ['INCHEON', 'RKSI', '372745N', '1262621E'],
  ['GIMPO', 'RKSS', '373325N', '1264751E'],
  ['JEJU', 'RKPC', '333044N', '1262934E'],
  ['GIMHAE', 'RKPK', '351050N', '1285617E'],
  ['CHEONGJU', 'RKTU', '364259N', '1272957E'],
  ['YANGYANG', 'RKNY', '380341N', '1284009E'],
  ['DAEGU', 'RKTN', '355339N', '1283932E'],
  ['MUAN', 'RKJB', '345929N', '1262258E'],
  ['GWANGJU', 'RKJJ', '350735N', '1264832E'],
  ['GUNSAN', 'RKJK', '355414N', '1263657E'],
  ['YEOSU', 'RKJY', '345032N', '1273702E'],
  ['WONJU', 'RKNW', '372617N', '1275737E'],
  ['SACHEON', 'RKPS', '350519N', '1280414E'],
  ['ULSAN', 'RKPU', '353536N', '1292108E'],
  ['SEOUL', 'RKSM', '372645N', '1270651E'],
  ['POHANG', 'RKTH', '355916N', '1292507E'],
  ['ULJIN', 'RKTL', '364637N', '1292742E'],
  ['JEONGSEOK', 'RKPD', '332354N', '1264247E'],
];

// 확장 구역 (꼭짓점 목록)
const EXT = [
  ['MUAN', ['350409N 1262045E', '350601N 1262044E', '350602N 1262507E', '350410N 1262508E']],
  ['MUAN', ['345449N 1262511E', '345255N 1262512E', '345254N 1262050E', '345448N 1262049E']],
  ['ULJIN', ['365024N 1292338E', '365136N 1292823E', '365354N 1292730E', '365243N 1292244E']],
  ['ULJIN', ['364250N 1293147E', '364139N 1292702E', '363920N 1292755E', '364031N 1293240E']],
];

// 원자력시설 비행금지구역 P61~P65 (드론 기준 반경 18.5km = 10 NM)
// eAIP에는 원전 주변이 2 NM 위험구역(D)으로만 있어서 여기서 따로 넣음.
// 중심: 원전 4곳은 eAIP ENR 5.1 D1·D2·D7·D8 중심, 대전은 한국원자력연구원 위치(근사)
const NUCLEAR_SITES = [
  ['P61', '고리 원전', '351929N', '1291807E'],
  ['P62', '월성 원전', '354304N', '1292834E'],
  ['P63', '한빛 원전', '352441N', '1262510E'],
  ['P64', '한울 원전', '370600N', '1292300E'],
  ['P65', '대전 원자력연구원', '362536N', '1272200E'],
];

export function civilCtrs(parseCoord) {
  const out = RAW.map(([name, icao, lat, lon]) => ({
    id: `${name} CTR`, name: `${name}(${icao})`, kind: '관제권', level: 'red',
    shape: { type: 'circle', center: { lat: parseCoord(lat), lon: parseCoord(lon) }, radiusM: 5 * 1852 },
  }));
  for (const [name, pts] of EXT) {
    out.push({
      id: `${name} CTR`, name, kind: '관제권', level: 'red',
      shape: { type: 'polygon', points: pts.map(s => { const [a, b] = s.split(' '); return { lat: parseCoord(a), lon: parseCoord(b) }; }) },
    });
  }
  for (const [id, name, lat, lon] of NUCLEAR_SITES) {
    out.push({
      id: `RK ${id}`, name, kind: '비행금지구역(원전)', level: 'red', vertical: '드론 비행금지 (반경 18.5km)',
      shape: { type: 'circle', center: { lat: parseCoord(lat), lon: parseCoord(lon) }, radiusM: 18500 },
    });
  }
  return out;
}
