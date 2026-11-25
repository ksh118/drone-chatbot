// 카카오 i 오픈빌더 스킬 서버 (Vercel 서버리스 함수)
// 주소: https://<내프로젝트>.vercel.app/api/skill

import { geocode } from '../lib/geocode.js';
import { checkAirspace } from '../lib/aip.js';
import { checkExtra, mergeResults } from '../lib/extra.js';
import { extractPlace, kakaoText, menuAnswer, welcome, verdictReply, noticeCard } from '../lib/message.js';

const HELP = '확인할 장소 이름을 보내 주세요.\n\n예) 여의도한강공원\n예) 부산 광안리\n예) 서울 마포구 상암동';

export async function handle(body, env = process.env) {
  const start = Date.now();
  // 오픈빌더에서 'place' 파라미터를 설정했다면 그걸 우선 사용
  const param = body?.action?.params?.place;
  const utterance = body?.userRequest?.utterance || '';
  // 웰컴 블록(채팅방 처음 들어올 때)이나 메뉴 버튼이면 안내 답변
  const blockName = body?.intent?.name || body?.userRequest?.block?.name || '';
  if (/웰컴|welcome/i.test(blockName)) return welcome();
  const menu = !param && menuAnswer(utterance);
  if (menu) return menu;
  const query = (param || extractPlace(utterance)).trim();

  if (!query || query.length < 2) return kakaoText(HELP);

  // 공역 데이터는 장소 검색과 동시에 미리 읽어 둠 (응답 시간 단축)
  const [place] = await Promise.all([geocode(query, env), checkAirspace(127, 37).catch(() => null)]);
  if (!place) return noticeCard('장소를 찾지 못했어요', `"${query.slice(0, 30)}"에 해당하는 장소가 없어요.\n동네 이름이나 주소로 다시 보내 주세요.\n\n예) 여의도한강공원, 서울 마포구 상암동`);

  // 추가 레이어는 남은 시간 안에서만 조회 (카카오 5초 제한)
  const left = 4300 - (Date.now() - start);
  const [core, extra] = await Promise.all([checkAirspace(place.x, place.y), checkExtra(place.x, place.y, env, left)]);
  return verdictReply(place, mergeResults(core, extra));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('드론 챗봇 스킬 서버 작동 중 ✅ (POST로 호출하세요)');
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    res.status(200).json(await handle(body));
  } catch (e) {
    console.error(e);
    res.status(200).json(noticeCard('일시적인 오류가 발생했어요', '잠시 후 다시 시도해 주세요.\n계속 안 되면 드론 원스톱에서 직접 확인해 주세요.'));
  }
}
