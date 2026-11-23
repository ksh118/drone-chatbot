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
  if (result.hits.some(h => h.layer.level === 'green')) {
    lines.push('• 초경량비행장치 전용공역 안이에요');
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
  lines.push('출처: 국토교통부 브이월드(V-World)');
  return lines.join('\n');
}

function buttons() {
  return [
    { action: 'webLink', label: '드론 원스톱', webLinkUrl: ONESTOP_URL },
    { action: 'webLink', label: '노탐 확인 (UBIKAIS)', webLinkUrl: UBIKAIS_URL },
  ];
}

export function kakaoCard(text, withButtons = true) {
  // textCard 본문은 길이 제한이 있어서 길면 simpleText로 보냄
  if (withButtons && text.length <= 380) {
    return {
      version: '2.0',
      template: { outputs: [{ textCard: { description: text, buttons: buttons() } }] },
    };
  }
  return { version: '2.0', template: { outputs: [{ simpleText: { text } }] } };
}

export function kakaoText(text) {
  return { version: '2.0', template: { outputs: [{ simpleText: { text } }] } };
}
