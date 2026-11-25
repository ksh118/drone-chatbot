// 남용 방지: 같은 사용자(IP 또는 카카오 사용자)가 짧은 시간에 너무 많이 부르면 잠시 막음
// 서버리스 인스턴스마다 따로 세기 때문에 완벽하진 않지만, 자동화된 대량 호출은 크게 줄여 줌
const buckets = new Map();

export function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-real-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

export function overLimit(id, { max = 60, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let b = buckets.get(id);
  if (!b || now - b.t > windowMs) { b = { t: now, n: 0 }; buckets.set(id, b); }
  b.n += 1;
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (now - v.t > windowMs) buckets.delete(k);
  return b.n > max ? Math.ceil((windowMs - (now - b.t)) / 1000) : 0;
}

// GET 전용 API 공통 처리. 막히면 false 반환
export function guard(req, res, name, max) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'GET만 사용할 수 있어요' });
    return false;
  }
  const wait = overLimit(`${name}:${clientIp(req)}`, { max });
  if (wait) {
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' });
    return false;
  }
  return true;
}
