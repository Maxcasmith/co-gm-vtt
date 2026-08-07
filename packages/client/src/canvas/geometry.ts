// Wall-aware reachable cells within `maxSteps` (8-directional, uniform cost) — exploration movement
// cap + highlight. Returns "gx,gy" keys, including the start cell.
export function bfsReachable(cells: number[][], startX: number, startY: number, maxSteps: number): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const visited = new Set<string>([key(startX, startY)]);
  const queue: { x: number; y: number; steps: number }[] = [{ x: startX, y: startY, steps: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const { x, y, steps } = queue[i]!;
    if (steps >= maxSteps) continue;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || ny >= height || nx >= width) continue;
        if (cells[ny]?.[nx] !== 1) continue;
        const k = key(nx, ny);
        if (visited.has(k)) continue;
        visited.add(k);
        queue.push({ x: nx, y: ny, steps: steps + 1 });
      }
    }
  }
  return visited;
}

// Casts one ray from (ox,oy) in direction (dirX,dirY) — a unit vector — through the grid using
// standard DDA, stopping at the exact (fractional) point it crosses into a wall or leaves bounds,
// capped at `radius`. Exact crossing points (rather than cell centers) are what let the fog
// boundary follow natural angled/diagonal lines instead of a cell-square staircase.
function castVisibilityRay(cells: number[][], ox: number, oy: number, dirX: number, dirY: number, radius: number, width: number, height: number): { x: number; y: number } {
  let mapX = Math.floor(ox), mapY = Math.floor(oy);
  const deltaDistX = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const deltaDistY = dirY === 0 ? Infinity : Math.abs(1 / dirY);
  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;
  let sideDistX = dirX < 0 ? (ox - mapX) * deltaDistX : (mapX + 1 - ox) * deltaDistX;
  let sideDistY = dirY < 0 ? (oy - mapY) * deltaDistY : (mapY + 1 - oy) * deltaDistY;
  let dist = 0;
  while (dist < radius) {
    if (sideDistX < sideDistY) {
      dist = sideDistX;
      sideDistX += deltaDistX;
      mapX += stepX;
    } else {
      dist = sideDistY;
      sideDistY += deltaDistY;
      mapY += stepY;
    }
    if (mapX < 0 || mapY < 0 || mapX >= width || mapY >= height || cells[mapY]?.[mapX] !== 1) break;
  }
  const hitDist = Math.min(dist, radius);
  return { x: ox + dirX * hitDist, y: oy + dirY * hitDist };
}

const VISIBILITY_RAYS = 240; // ~1.5° apart — smooth enough at SIGHT_RADIUS without per-frame cost

// Sweeps a full circle of rays from (ox,oy) to build the fog-of-war sight boundary as a polygon
// of exact wall-crossing points, instead of a set of whole visible/hidden cells.
export function computeVisibilityPolygon(cells: number[][], ox: number, oy: number, radius: number): { x: number; y: number }[] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < VISIBILITY_RAYS; i++) {
    const angle = (i / VISIBILITY_RAYS) * Math.PI * 2;
    points.push(castVisibilityRay(cells, ox, oy, Math.cos(angle), Math.sin(angle), radius, width, height));
  }
  return points;
}
