export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function pairForSpread(spread, direction = 'ltr') {
  const pair = [spread * 2 - 1, spread * 2];
  return direction === 'rtl' ? pair.reverse() : pair;
}

export function maxSpreadForCount(count) {
  return Math.floor(Math.max(0, count) / 2);
}

export function clipPolygon(polygon, nx, ny, k, positive) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = nx * a.x + ny * a.y - k, db = nx * b.x + ny * b.y - k;
    const insideA = positive ? da >= 0 : da <= 0;
    const insideB = positive ? db >= 0 : db <= 0;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return result;
}

export function constrainCorner(point, cornerY, width, height) {
  let p = { x: clamp(point.x, -width + .05, width - .05), y: clamp(point.y, -height * .25, height * 1.25) };
  for (let pass = 0; pass < 2; pass++) {
    for (const [cy, radius] of [[cornerY, width], [height - cornerY, Math.hypot(width, height)]]) {
      const dy = p.y - cy, distance = Math.hypot(p.x, dy);
      if (distance > radius) { p.x *= radius / distance; p.y = cy + dy * radius / distance; }
    }
  }
  return p;
}

export function foldGeometry(point, cornerY, width, height) {
  const p = constrainCorner(point, cornerY, width, height);
  const dx = width - p.x, dy = cornerY - p.y, distance = Math.hypot(dx, dy);
  if (distance < .2) return null;
  const nx = dx / distance, ny = dy / distance;
  const mx = (width + p.x) / 2, my = (cornerY + p.y) / 2, k = nx * mx + ny * my;
  const rectangle = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const front = clipPolygon(rectangle, nx, ny, k, false);
  const folded = clipPolygon(rectangle, nx, ny, k, true);
  const reflected = folded.map(q => {
    const d = nx * q.x + ny * q.y - k;
    return { x: q.x - 2 * nx * d, y: q.y - 2 * ny * d };
  });
  return { nx, ny, mx, my, k, front, folded, reflected };
}
