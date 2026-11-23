// 가짜 응답으로 전체 흐름 테스트 (인터넷 없이 실행 가능)
import assert from 'node:assert';
import { handle } from '../api/skill.js';
import { extractPlace } from '../lib/message.js';
import { parseCoord, shapeFromText, contains, currentPackage, parseEnr51, parseEnr21 } from '../lib/aip.js';

// ---- 작은 부품 ----
assert.ok(Math.abs(parseCoord('373209N') - 37.5358) < 1e-3);
assert.ok(Math.abs(parseCoord('1265838E') - 126.9772) < 1e-3);
assert.ok(Math.abs(parseCoord('3713N') - 37.2167) < 1e-3);
assert.ok(Math.abs(parseCoord('373114.0N') - 37.5206) < 1e-3);

const circle = shapeFromText('A circle radius 2 NM centered on 363640N 1271328E');
assert.equal(circle.type, 'circle'); assert.equal(Math.round(circle.radiusM), 3704);
assert.ok(contains(circle, { lat: 36.611, lon: 127.224 }));
assert.ok(!contains(circle, { lat: 36.70, lon: 127.224 }));
assert.equal(shapeFromText('A Circle 4 NM in diameter centered at Namhyongje Do (3453N 12857E)').radiusM, 2 * 1852);
assert.equal(shapeFromText('Area connecting ... radius of 2 miles centered on center 1 and center 2 * Center 1 : 373209N 1265838E * Center 2 : 373232N 1265943E').type, 'capsule');
assert.equal(currentPackage('"2026-12-23-AIRAC/html/index" "2026-11-12/html/index" "2026-10-28-AIRAC/html/index"', new Date('2026-11-23T00:00:00Z')), '2026-11-12');
assert.equal(currentPackage('"2026-11-25-AIRAC/html/index" "2026-11-12/html/index"', new Date('2026-11-25T17:00:00Z')), '2026-11-25-AIRAC');

assert.equal(extractPlace('여의도 한강공원 드론 날려도 돼?'), '여의도 한강공원');
assert.equal(extractPlace('부산 광안리 비행 가능해?'), '부산 광안리');

// ---- 가짜 eAIP 페이지 ----
const row = (a, b) => `<tr><td>${a}</td><td>${b}</td><td>x</td></tr>`;
const ENR51 = '<table>' +
  row('RK P73 SEOUL Area connecting the outlines of circles with a radius of 2 miles centered on center 1 and center 2 * Center 1 : 373209N 1265838E * Center 2 : 373232N 1265943E', 'UNL/GND') +
  row('RK R75 CAPITAL 373949N 1264824E - 373752N 1264813E - 373701N 1264754E - 373530N 1264817E - 373409N 1264824E - 372653N 1265722E - 372653N 1270338E - 373233N 1270647E - 373447N 1270930E - 373656N 1270830E - 373827N 1270800E - 374033N 1270513E - 374136N 1270317E - 374200N 1270140E - 373758N 1265259E - to the beginning', '10 000 AMSL/SFC') +
  Array.from({ length: 25 }, (_, i) => row(`RK R${200 + i} TEST A circle radius 1 NM centered on 3${3 + (i % 5)}0000N 12${6 + (i % 3)}0000E`, '1 000/GND')).join('') +
  '</table>';
const ENR21 = '<p>EMERG ROKA GANGNEUNG CONTROL ZONE A circle 5 NM radius centered at 374514N 1285642E SFC - 4 000 ft AGL Class C</p>' +
  '<p>INCHEON CONTROL ZONE See part 3 AERODROMES(AD) for details. GIMPO CONTROL ZONE</p>';
const HISTORY = '"2026-11-12/html/index-en-GB.html" "2099-01-01-AIRAC/html/index-en-GB.html"';

assert.equal(parseEnr51(ENR51).length, 27);
assert.deepEqual(parseEnr21(ENR21).map(a => a.name), ['GANGNEUNG']);

let aipFails = false;
function mockFetch({ place = { lat: '37.528', lon: '126.934', name: '여의도한강공원' } } = {}) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const ok = (body, json = false) => ({ ok: true, status: 200, text: async () => body, json: async () => body });
    if (u.hostname === 'nominatim.openstreetmap.org') {
      return ok(place ? [{ ...place, display_name: `${place.name}, 여의동로, 영등포구, 서울특별시, 07332, 대한민국` }] : [], true);
    }
    if (u.hostname === 'aim.koca.go.kr') {
      if (aipFails) throw new Error('fetch failed');
      if (u.pathname.endsWith('history-en-GB.html')) return ok(HISTORY);
      if (u.pathname.endsWith('KR-ENR-5.1-en-GB.html')) return ok(ENR51);
      if (u.pathname.endsWith('KR-ENR-2.1-en-GB.html')) return ok(ENR21);
    }
    throw new Error('unexpected ' + url);
  };
}
const req = (utterance) => ({ userRequest: { utterance }, action: { params: {} } });
const textOf = (r) => r.template.outputs[0].textCard?.description || r.template.outputs[0].simpleText?.text;

// 1. 데이터 못 읽으면(첫 실행) → 가능이라고 단정하면 안 됨
aipFails = true; mockFetch();
let r = await handle(req('여의도 한강공원'), {});
assert.match(textOf(r), /⚪/);
aipFails = false;

// 2. 여의도 → 비행제한구역 R75
mockFetch();
r = await handle(req('여의도 한강공원 드론 날려도 돼?'), {});
console.log('--- 여의도 ---\n' + textOf(r) + '\n');
assert.match(textOf(r), /🟠/); assert.match(textOf(r), /R75 CAPITAL/); assert.match(textOf(r), /eAIP 2026-11-12/);

// 3. 용산 대통령실 근처 → 비행금지구역 P73
mockFetch({ place: { lat: '37.5325', lon: '126.9790', name: '용산' } });
r = await handle(req('용산'), {});
assert.match(textOf(r), /🔴/); assert.match(textOf(r), /P73/);

// 4. 김포공항 근처 → 관제권(코드에 저장된 민간공항)
mockFetch({ place: { lat: '37.558', lon: '126.79', name: '김포공항' } });
r = await handle(req('김포공항'), {});
assert.match(textOf(r), /관제권/); assert.match(textOf(r), /GIMPO\(RKSS\)/);

// 5. 강릉 → 군 관제권(eAIP에서 읽음)
mockFetch({ place: { lat: '37.800', lon: '128.905', name: '경포' } });
r = await handle(req('강릉 경포'), {});
assert.match(textOf(r), /GANGNEUNG/);

// 6. 아무 데도 안 걸림
mockFetch({ place: { lat: '37.59', lon: '127.40', name: '양평' } });
r = await handle(req('양평 서종면'), {});
console.log('--- 양평 ---\n' + textOf(r) + '\n');
assert.match(textOf(r), /🟢/);

// 7. 장소 못 찾음 / 빈 질문
mockFetch({ place: null });
r = await handle(req('ㅁㄴㅇㄹ동네'), {});
assert.match(textOf(r), /못 찾았어요/);
r = await handle(req('드론 날려도 돼?'), {});
assert.match(textOf(r), /장소를 보내주세요/);

console.log('✅ 모든 테스트 통과');
