// 실제 키로 내 컴퓨터에서 바로 시험해보기
// 사용법: VWORLD_KEY=내키 VWORLD_DOMAIN=등록한주소 node test/try-real.mjs "여의도 한강공원"
import { handle } from '../api/skill.js';

const q = process.argv.slice(2).join(' ') || '여의도 한강공원 드론 날려도 돼?';
const r = await handle({ userRequest: { utterance: q }, action: { params: {} } });
const o = r.template.outputs[0];
console.log(o.textCard?.description || o.simpleText?.text);
