// 가짜 API 응답으로 전체 흐름 테스트 (키 없이 실행 가능)
import assert from 'node:assert';
import { handle } from '../api/skill.js';
import { extractPlace } from '../lib/message.js';

const env = { VWORLD_KEY: 'test', VWORLD_DOMAIN: 'https://x.vercel.app' };

function mockFetch({ place = true, hitLayers = {}, failLayers = [] } = {}) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const ok = (obj) => ({ ok: true, json: async () => obj });
    if (u.pathname === '/req/search') {
      return ok({ response: { status: place ? 'OK' : 'NOT_FOUND', result: { items: place ? [{ title: '여의도한강공원', point: { x: '126.934', y: '37.528' }, address: { road: '서울 영등포구 여의동로 330' } }] : [] } } });
    }
    if (u.pathname === '/req/data') {
      const layer = u.searchParams.get('data');
      if (failLayers.includes(layer)) return { ok: false, status: 500, json: async () => ({}) };
      if (hitLayers[layer]) return ok({ response: { status: 'OK', result: { featureCollection: { features: [{ properties: hitLayers[layer] }] } } } });
      return ok({ response: { status: 'NOT_FOUND' } });
    }
    throw new Error('unexpected ' + url);
  };
}
const req = (utterance) => ({ userRequest: { utterance }, action: { params: {} } });
const textOf = (r) => r.template.outputs[0].textCard?.description || r.template.outputs[0].simpleText?.text;

// 1. 장소 추출
assert.equal(extractPlace('여의도 한강공원 드론 날려도 돼?'), '여의도 한강공원');
assert.equal(extractPlace('부산 광안리 비행 가능해?'), '부산 광안리');

// 2. 비행금지구역
mockFetch({ hitLayers: { LT_C_AISPRHC: { prh_lbl_1: 'P73A', gid: 1 } } });
let r = await handle(req('여의도 한강공원 드론 날려도 돼?'), env);
console.log('--- 금지구역 ---\n' + textOf(r) + '\n');
assert.match(textOf(r), /🔴/); assert.match(textOf(r), /P73A/);

// 3. 아무 데도 안 걸림
mockFetch();
r = await handle(req('시골 논밭'), env);
console.log('--- 가능 ---\n' + textOf(r) + '\n');
assert.match(textOf(r), /🟢/);

// 4. 제한 레이어 조회 실패 → 가능이라고 단정하면 안 됨
mockFetch({ failLayers: ['LT_C_AISRESC'] });
r = await handle(req('어딘가'), env);
assert.match(textOf(r), /⚪/);

// 5. 장소 못 찾음
mockFetch({ place: false });
r = await handle(req('ㅁㄴㅇㄹ동네'), env);
assert.match(textOf(r), /못 찾았어요/);

// 6. 빈 질문
r = await handle(req('드론 날려도 돼?'), env);
assert.match(textOf(r), /장소를 보내주세요/);

console.log('✅ 모든 테스트 통과');
