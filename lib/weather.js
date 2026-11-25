// 비행 날씨: Open-Meteo (키 없이 쓰는 무료 날씨 API)
// 바람(m/s), 하늘 상태, 일출·일몰을 가져와서 한 줄 요약 + 경고를 만든다.

const SKY = [
  [[0], '맑음'], [[1, 2], '구름 조금'], [[3], '흐림'], [[45, 48], '안개'],
  [[51, 53, 55, 56, 57], '이슬비'], [[61, 63, 65, 66, 67], '비'], [[71, 73, 75, 77], '눈'],
  [[80, 81, 82], '소나기'], [[85, 86], '눈'], [[95, 96, 99], '뇌우'],
];
const skyName = code => (SKY.find(([codes]) => codes.includes(code)) || [null, '-'])[1];
const hm = iso => (iso || '').slice(11, 16);   // "2026-11-25T17:21" → "17:21"

export const WIND_WARN = 7;   // m/s 이상이면 강풍 안내

export async function getWeather(lat, lon, timeoutMs = 1500) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + '&current=weather_code,wind_speed_10m,wind_gusts_10m,precipitation,is_day'
    + '&daily=sunrise,sunset&wind_speed_unit=ms&timezone=Asia%2FSeoul&forecast_days=1';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(Math.max(300, timeoutMs)) });
    if (!r.ok) return null;
    const j = await r.json();
    const c = j.current || {};
    return {
      sky: skyName(c.weather_code),
      code: c.weather_code,
      wind: Math.round((c.wind_speed_10m ?? 0) * 10) / 10,
      gust: Math.round((c.wind_gusts_10m ?? 0) * 10) / 10,
      rain: (c.precipitation ?? 0) > 0,
      isDay: c.is_day === 1,
      sunrise: hm(j.daily?.sunrise?.[0]),
      sunset: hm(j.daily?.sunset?.[0]),
    };
  } catch {
    return null;
  }
}

// 카드에 넣을 한 줄: "맑음 · 바람 3.2m/s · 일몰 17:21"
export function weatherLine(w) {
  if (!w) return '';
  const parts = [w.sky, `바람 ${w.wind}m/s${w.gust >= w.wind + 3 ? `(돌풍 ${w.gust})` : ''}`];
  parts.push(w.isDay ? `일몰 ${w.sunset}` : `일출 ${w.sunrise}`);
  return parts.join(' · ');
}

// 아래 안내문에 붙일 경고들
export function weatherWarnings(w) {
  if (!w) return [];
  const out = [];
  if (!w.isDay) out.push('※ 지금은 야간이에요. 야간 비행은 특별비행승인이 필요해요.');
  if (w.wind >= WIND_WARN || w.gust >= WIND_WARN + 3) out.push(`※ 바람이 강해요(${Math.max(w.wind, w.gust)}m/s). 비행을 미루는 게 안전해요.`);
  if (w.rain || [95, 96, 99].includes(w.code)) out.push('※ 비·눈이 오고 있어요. 방수 기체가 아니라면 비행하지 마세요.');
  return out;
}
