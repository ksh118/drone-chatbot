// 사용자 문장에서 장소만 뽑기 + 카카오 답변 만들기

const ONESTOP_URL = 'https://drone.onestop.go.kr';
const UBIKAIS_URL = 'https://ubikais.fois.go.kr';

// "여의도 한강공원 드론 날려도 돼?" → "여의도 한강공원"
export function extractPlace(utterance = '') {
  let s = utterance.trim();
  const drop = [
    /드론/g, /비행/g, /날려도\s*(돼|되나요|될까|되니|됨|되냐)?/g, /날릴\s*수\s*(있어|있나요|있을까|있냐)?/g,
    /날려(도)?/g, /가능(해|한가요|할까|함|하냐)?/g, /(되나요|될까요|돼요|되냐|돼|됨)/g,
    /(에서|에선|은|는|이|가)\s*(?=\s|$)/g, /어때|알려줘|확인|해줘|좀|여기/g, /[?？!.~]/g,
  ];
  for (const r of drop) s = s.replace(r, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const VERDICT_TEXT = {
  red:     '🔴 비행 불가 (승인 없이 날리면 안 돼요)',
  orange:  '🟠 비행승인이 필요한 곳이에요',
  green:   '🟢 관제권·금지·제한구역 밖이에요',
  unknown: '⚪ 일부 공역을 확인하지 못했어요',
};

export function buildAnswer(place, result) {
  const lines = [];
  lines.push(`📍 ${place.name}`);
  if (place.address && place.address !== place.name) lines.push(place.address);
  lines.push('');
  lines.push(VERDICT_TEXT[result.verdict]);

  const bad = result.hits.filter(h => h.layer.level !== 'green');
  if (bad.length) {
    lines.push('');
    for (const h of bad) {
      const label = h.labels.filter(Boolean).join(', ');
      lines.push(`• ${h.layer.name}${label ? ` (${label})` : ''}`);
    }
  }
  for (const g of result.greens || []) {
    lines.push(`✅ ${g.layer.name}${g.labels.length ? ` (${g.labels.join(', ')})` : ''} 안이에요`);
  }
  if ((result.notes || []).length) {
    lines.push('');
    lines.push('⚠️ 관리기관과 사전 협의가 필요해요');
    for (const n of result.notes) lines.push(`• ${n.layer.name}${n.labels.length ? ` (${n.labels.join(', ')})` : ''}`);
  }
  if (result.failed.length) {
    lines.push('');
    lines.push(`확인 실패: ${result.failed.map(l => l.name).join(', ')}`);
  }

  lines.push('');
  if (result.verdict === 'green') {
    lines.push('그래도 지켜야 해요: 고도 150m 미만, 낮에만, 눈으로 보이는 범위, 사람 많은 곳 위 금지.');
  } else if (result.verdict !== 'unknown') {
    lines.push('드론 원스톱에서 비행승인을 신청하세요.');
  }
  lines.push('※ 참고용이에요. 비행 당일 노탐(NOTAM)과 드론 원스톱을 꼭 확인하세요.');
  lines.push(`출처: 국토교통부 항공정보간행물(eAIP${result.pkg ? ' ' + result.pkg.slice(0, 10) : ''}) · 브이월드 · 지도 © OpenStreetMap`);
  return lines.join('\n');
}

function buttons() {
  return [
    { action: 'webLink', label: '드론 원스톱', webLinkUrl: ONESTOP_URL },
    { action: 'webLink', label: '노탐 확인 (UBIKAIS)', webLinkUrl: UBIKAIS_URL },
  ];
}

// 말풍선 아래에 뜨는 바로가기 버튼 (누르면 그 글자가 그대로 전송됨)
export const MENU = {
  help: '📖 사용법',
  rules: '📏 비행 규칙',
  approval: '📝 승인 신청 방법',
  notam: '📡 노탐이 뭐예요?',
};
const QUICK = [MENU.help, MENU.rules, MENU.approval, MENU.notam]
  .map(label => ({ action: 'message', label, messageText: label }));
const EXAMPLES = ['여의도한강공원', '광안리해수욕장', '경복궁']
  .map(label => ({ action: 'message', label: '🔎 ' + label, messageText: label }));

// 챗봇 관리자센터 블록에서 {{#webhook.키}} 로 쓰는 값들 (항상 모든 키를 채워서 보냄)
export const DATA_KEYS = ['place', 'address', 'verdict', 'status', 'statusText', 'zones', 'notes', 'advice', 'source', 'detail'];
export function emptyData(detail = '') {
  const d = Object.fromEntries(DATA_KEYS.map(k => [k, '']));
  d.verdict = 'unknown'; d.status = '⚪ 확인 실패'; d.detail = detail; d.statusText = detail;
  return d;
}

function wrap(outputs, quickReplies = QUICK, data) {
  const text = outputs.map(o => o.simpleText?.text || o.textCard?.description || '').filter(Boolean).join('\n\n');
  return { version: '2.0', template: { outputs, quickReplies }, data: data || emptyData(text) };
}

const STATUS = {
  red:     ['🔴 비행 불가', '승인 없이 날리면 안 돼요'],
  orange:  ['🟠 승인 필요', '드론 원스톱에서 비행승인을 받아야 해요'],
  green:   ['🟢 비행 가능', '관제권·금지·제한구역 밖이에요'],
  unknown: ['⚪ 확인 필요', '일부 공역을 확인하지 못했어요'],
};

export function buildData(place, result) {
  const fmt = h => `• ${h.layer.name}${h.labels.filter(Boolean).length ? ` (${h.labels.filter(Boolean).join(', ')})` : ''}`;
  const bad = result.hits.filter(h => h.layer.level !== 'green');
  const zones = [...bad.map(fmt), ...(result.greens || []).map(g => `✅ ${g.layer.name}${g.labels.length ? ` (${g.labels.join(', ')})` : ''} 안이에요`)];
  const notes = (result.notes || []).length ? ['⚠️ 관리기관과 사전 협의가 필요해요', ...result.notes.map(fmt)].join('\n') : '';
  const advice = result.verdict === 'green'
    ? '그래도 지켜야 해요: 고도 150m 미만, 낮에만, 눈으로 보이는 범위, 사람 많은 곳 위 금지.'
    : result.verdict === 'unknown' ? '' : '드론 원스톱에서 비행승인을 신청하세요.';
  const [status, statusText] = STATUS[result.verdict];
  return {
    place: place.name,
    address: place.address && place.address !== place.name ? place.address : '',
    verdict: result.verdict,
    status, statusText,
    zones: zones.length ? zones.join('\n') : '걸리는 구역 없음',
    notes,
    advice,
    source: `출처: 국토교통부 항공정보간행물(eAIP${result.pkg ? ' ' + result.pkg.slice(0, 10) : ''}) · 브이월드 · 지도 © OpenStreetMap`,
    detail: buildAnswer(place, result),
  };
}

export function kakaoCard(text, withButtons = true, data) {
  // textCard 본문은 길이 제한이 있어서, 길면 본문은 simpleText로 보내고 버튼 카드를 따로 붙임
  if (!withButtons) return kakaoText(text);
  if (text.length <= 380) return wrap([{ textCard: { description: text, buttons: buttons() } }], QUICK, data);
  return wrap([{ simpleText: { text } }, { textCard: { description: '비행 전 확인하기 👇', buttons: buttons() } }], QUICK, data);
}

export function kakaoText(text, quickReplies = QUICK) {
  return wrap([{ simpleText: { text } }], quickReplies);
}

// ---- 장소 판정 카드 (판정별 사진 + 알림톡 스타일 문구) ----
const IMG_BASE = 'https://drone-chatbot.vercel.app/img/';
const VERDICT = {
  red: {
    img: 'no_fly.png', label: '비행 불가',
    guide: '허가 없이 비행할 수 없는 구역이에요.\n비행이 꼭 필요하다면 드론 원스톱에서 승인을 신청해 주세요.',
    buttons: [['비행승인 신청', ONESTOP_URL], ['노탐 확인', UBIKAIS_URL]],
  },
  orange: {
    img: 'need_approval.png', label: '비행승인 필요',
    guide: '비행 전 드론 원스톱에서 비행승인을 받아 주세요.',
    buttons: [['비행승인 신청', ONESTOP_URL], ['노탐 확인', UBIKAIS_URL]],
  },
  green: {
    img: 'ok.png', label: '비행 가능 구역',
    guide: '비행금지·제한구역과 관제권 밖이에요.\n고도 150m 미만, 낮 시간, 눈으로 보이는 거리 안에서 비행해 주세요.',
    buttons: [['노탐 확인', UBIKAIS_URL], ['드론 원스톱', ONESTOP_URL]],
  },
  unknown: {
    img: 'unknown.png', label: '확인 필요',
    guide: '일부 공역 정보를 불러오지 못했어요.\n잠시 후 다시 시도하거나 드론 원스톱에서 확인해 주세요.',
    buttons: [['드론 원스톱', ONESTOP_URL], ['노탐 확인', UBIKAIS_URL]],
  },
};

const cardButtons = list => list.map(([label, url]) => ({ action: 'webLink', label, webLinkUrl: url }));
const zoneName = h => `${h.layer.name}${h.labels.filter(Boolean).length ? `(${h.labels.filter(Boolean).join(', ')})` : ''}`;

function joinLimited(items, max = 3) {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} 외 ${items.length - max}건`;
}

export function verdictCard(place, result) {
  const v = VERDICT[result.verdict] || VERDICT.unknown;
  const bad = result.hits.filter(h => h.layer.level !== 'green').map(zoneName);
  const greens = (result.greens || []).map(zoneName);
  const lines = [];
  if (place.address && place.address !== place.name) lines.push(place.address, '');
  lines.push(`▶ 판정: ${v.label}`);
  lines.push(`▶ 해당 구역: ${bad.length ? joinLimited(bad) : '없음'}`);
  if (greens.length) lines.push(`▶ 비행 가능 공역: ${joinLimited(greens, 2)}`);
  let desc = lines.join('\n');
  const withGuide = `${desc}\n\n${v.guide}`;
  const guideInCard = withGuide.length <= 230;
  if (guideInCard) desc = withGuide;
  if (desc.length > 230) desc = desc.slice(0, 228) + '…';

  const foot = [];
  if (!guideInCard) foot.push(v.guide, '');
  if ((result.notes || []).length) foot.push(`※ 사전 협의 필요: ${joinLimited(result.notes.map(zoneName))}`);
  if (result.failed.length) foot.push(`※ 확인하지 못한 정보: ${result.failed.map(l => l.name).join(', ')}`);
  foot.push('※ 참고용 안내예요. 비행 당일 노탐(NOTAM)도 꼭 확인해 주세요.');
  foot.push(`출처: 국토교통부 항공정보간행물${result.pkg ? `(${result.pkg.slice(0, 10)})` : ''} · 브이월드 · OpenStreetMap`);

  return [
    { basicCard: {
      title: place.name.slice(0, 50),
      description: desc,
      thumbnail: { imageUrl: IMG_BASE + v.img, fixedRatio: false },
      buttons: cardButtons(v.buttons),
    } },
    { simpleText: { text: foot.join('\n') } },
  ];
}

export function verdictReply(place, result) {
  return wrap(verdictCard(place, result), QUICK, buildData(place, result));
}

// 장소를 못 찾았거나 오류가 났을 때
export function noticeCard(title, desc) {
  return wrap([{ basicCard: {
    title, description: desc,
    thumbnail: { imageUrl: IMG_BASE + VERDICT.unknown.img, fixedRatio: false },
    buttons: cardButtons([['드론 원스톱', ONESTOP_URL]]),
  } }], QUICK, emptyData(`${title}\n${desc}`));
}

// ---- 메뉴 답변 ----
export function menuAnswer(utterance = '') {
  const u = utterance.replace(/\s+/g, '');
  if (/^(📖)?(사용법|도움말|도움|시작|처음|메뉴|안녕|안녕하세요|하이|hi|hello|help)[!~.?]*$/i.test(u)) return welcome();
  if (/비행규칙|규칙|주의사항|지켜야/.test(u)) return rules();
  if (/승인신청|신청방법|승인방법|어떻게신청/.test(u)) return approval();
  if (/노탐|notam/i.test(u)) return notam();
  return null;
}

export function welcome() {
  return wrap([
    { textCard: {
      title: '🚁 드론봇이에요',
      description: '장소 이름을 보내면 드론을 날려도 되는지 알려드려요.\n\n예) 여의도한강공원\n예) 부산 광안리 드론 돼?\n\n🔴 비행 불가 · 🟠 승인 필요 · 🟢 구역 밖\n아래 버튼으로 바로 해 보세요 👇',
      buttons: [{ action: 'message', label: '🔎 여의도한강공원 확인', messageText: '여의도한강공원' }],
    } },
  ], [...EXAMPLES, MENU.rules, MENU.approval, MENU.notam].map(q =>
    typeof q === 'string' ? { action: 'message', label: q, messageText: q } : q));
}

function rules() {
  return kakaoText([
    '📏 드론 기본 비행 규칙',
    '',
    '• 고도 150m 미만으로',
    '• 낮에만 (야간 비행은 특별비행승인 필요)',
    '• 눈으로 보이는 범위 안에서만',
    '• 사람이 많이 모인 곳 위로 비행 금지',
    '• 비행 중 물건 떨어뜨리기 금지',
    '• 술 마시고 비행 금지',
    '• 비행금지·제한구역, 관제권은 승인 필요',
    '• 사진·영상 촬영은 항공촬영 허가가 따로 필요할 수 있어요',
    '',
    '※ 요약본이에요. 정확한 내용은 드론 원스톱과 항공안전법을 확인하세요.',
  ].join('\n'));
}

function approval() {
  return wrap([
    { textCard: {
      title: '📝 비행승인 신청 방법',
      description: [
        '1. 드론 원스톱 접속 → 로그인',
        '2. 비행승인 신청 → 기체·조종자 정보 입력',
        '3. 지도에서 비행 구역·고도·날짜 지정',
        '4. 촬영할 거면 항공촬영 허가도 같이 신청',
        '5. 처리까지 며칠 걸릴 수 있어요. 미리 신청하세요!',
      ].join('\n'),
      buttons: [{ action: 'webLink', label: '드론 원스톱 열기', webLinkUrl: ONESTOP_URL }],
    } },
  ]);
}

function notam() {
  return wrap([
    { textCard: {
      title: '📡 노탐(NOTAM)이 뭐예요?',
      description: '그날그날 바뀌는 임시 비행금지·제한 공지예요. 행사, 훈련, VIP 이동 등으로 평소엔 괜찮던 곳도 갑자기 금지될 수 있어요.\n\n비행 당일 꼭 확인하세요.',
      buttons: [{ action: 'webLink', label: '노탐 확인 (UBIKAIS)', webLinkUrl: UBIKAIS_URL }],
    } },
  ]);
}
