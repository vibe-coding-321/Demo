// ── Constants ────────────────────────────────────────────────────────
const G  = 1.0;
const DT = 0.4;
const W  = 800;
const H  = 600;
const THRUST_ACCEL  = 0.8;
const MAX_SPEED     = 25.0;
const FUEL_MAX      = 200;
const REFUEL_RATE   = 0.5;

// ── Infinite World Constants ─────────────────────────────────────────
const CHUNK_SIZE    = 400;
const ACTIVE_RADIUS = 4;
const WORLD_SEED    = 42;
const SPAWN_ZONE_R  = 200;

// ── Camera ───────────────────────────────────────────────────────────
const camera = { x: 0, y: 0 };

// ── Scoring ──────────────────────────────────────────────────────────
let maxDistFromOrigin = 0;
let highScore = 0;

// ── Input State ──────────────────────────────────────────────────────
const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
window.addEventListener('keydown', (e) => {
  if (e.key in keys) { keys[e.key] = true; e.preventDefault(); }
  if (e.key === 'w' || e.key === 'W') { keys.ArrowUp = true; }
  if (e.key === 's' || e.key === 'S') { keys.ArrowDown = true; }
  if (e.key === 'a' || e.key === 'A') { keys.ArrowLeft = true; }
  if (e.key === 'd' || e.key === 'D') { keys.ArrowRight = true; }
});
window.addEventListener('keyup', (e) => {
  if (e.key in keys) { keys[e.key] = false; }
  if (e.key === 'w' || e.key === 'W') { keys.ArrowUp = false; }
  if (e.key === 's' || e.key === 'S') { keys.ArrowDown = false; }
  if (e.key === 'a' || e.key === 'A') { keys.ArrowLeft = false; }
  if (e.key === 'd' || e.key === 'D') { keys.ArrowRight = false; }
});
window.keys = keys;

// ── Game Objects ─────────────────────────────────────────────────────
const rocket = {
  x: 0, y: 0,
  prevX: 0, prevY: 0,
  radius: 5,
  crashed: false,
  fuel: FUEL_MAX
};
window.rocket = rocket;

// ── Canvas Setup ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const statusEl  = document.getElementById('status');
const respawnBtn = document.getElementById('respawn');

// ── Seeded PRNG (Mulberry32) ─────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function chunkSeed(cx, cy) {
  // Hash combining chunk coords with world seed
  let h = WORLD_SEED;
  h = (h ^ (cx * 374761393)) & 0xFFFFFFFF;
  h = (h ^ (cy * 668265263)) & 0xFFFFFFFF;
  h = ((h ^ (h >>> 13)) * 1274126177) & 0xFFFFFFFF;
  return h;
}

// ── Chunk-Based Procedural Generation ────────────────────────────────
const chunkCache = new Map();
const BODY_COLORS = ['#ff6633', '#3399ff', '#33ff99', '#ffcc33', '#cc66ff', '#ff3399', '#33ccff'];

function generateChunkBodies(cx, cy) {
  const rng = mulberry32(chunkSeed(cx, cy));

  // Chunk center in world coords
  const chunkWorldX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const chunkWorldY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;

  // Distance from origin to chunk center
  const distFromOrigin = Math.sqrt(chunkWorldX * chunkWorldX + chunkWorldY * chunkWorldY);

  // Skip chunks within spawn safe zone
  if (distFromOrigin < SPAWN_ZONE_R) return [];

  // Progressive scaling factor
  const scaleFactor = 1.0 + distFromOrigin / 20000;

  // Base: 0-2 bodies. Slight density increase at distance
  const densityBonus = Math.min(0.3, distFromOrigin / 30000);
  const bodyCount = rng() < (0.3 + densityBonus) ? (rng() < 0.4 ? 2 : 1) : 0;

  // Dynamic margin based on max possible radius to prevent cross-chunk overlap
  const maxBaseRadius = 45; // 20 + 25
  const maxRadius = maxBaseRadius * Math.sqrt(scaleFactor) * 0.75;
  const margin = Math.max(50, maxRadius + 10);
  const bodies = [];
  const GAP = 10; // minimum gap between bodies

  for (let i = 0; i < bodyCount; i++) {
    const baseMass = 2000 + rng() * 4000;
    const mass = baseMass * scaleFactor;
    const baseRadius = 20 + rng() * 25;
    const radius = baseRadius * Math.sqrt(scaleFactor) * 0.75;
    const colorIdx = Math.floor(rng() * BODY_COLORS.length);

    // Try up to 5 placements to avoid overlap with previously placed bodies
    let placed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const localX = margin + rng() * (CHUNK_SIZE - 2 * margin);
      const localY = margin + rng() * (CHUNK_SIZE - 2 * margin);
      const worldX = cx * CHUNK_SIZE + localX;
      const worldY = cy * CHUNK_SIZE + localY;

      let overlaps = false;
      for (const existing of bodies) {
        const dx = worldX - existing.x;
        const dy = worldY - existing.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < radius + existing.radius + GAP) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        bodies.push({
          x: worldX,
          y: worldY,
          mass: mass,
          radius: radius,
          color: BODY_COLORS[colorIdx]
        });
        placed = true;
        break;
      }
    }
    // If all retries fail, skip this body
  }

  return bodies;
}

function getChunkBodies(cx, cy) {
  const key = cx + ',' + cy;
  if (chunkCache.has(key)) return chunkCache.get(key);
  const bodies = generateChunkBodies(cx, cy);
  chunkCache.set(key, bodies);
  return bodies;
}

let cachedActiveBodies = [];

function getActiveBodies() {
  // Camera center in world coords
  const centerX = camera.x + W / 2;
  const centerY = camera.y + H / 2;

  // Which chunk is the camera center in?
  const ccx = Math.floor(centerX / CHUNK_SIZE);
  const ccy = Math.floor(centerY / CHUNK_SIZE);

  const activeKeys = new Set();
  const bodies = [];

  for (let dx = -ACTIVE_RADIUS; dx <= ACTIVE_RADIUS; dx++) {
    for (let dy = -ACTIVE_RADIUS; dy <= ACTIVE_RADIUS; dy++) {
      const cx = ccx + dx;
      const cy = ccy + dy;
      const key = cx + ',' + cy;
      activeKeys.add(key);
      const chunkBodies = getChunkBodies(cx, cy);
      for (const b of chunkBodies) {
        bodies.push(b);
      }
    }
  }

  // Evict stale cache entries (keep only active + 2 chunk buffer)
  if (chunkCache.size > (ACTIVE_RADIUS * 2 + 5) * (ACTIVE_RADIUS * 2 + 5)) {
    for (const key of chunkCache.keys()) {
      if (!activeKeys.has(key)) {
        chunkCache.delete(key);
      }
    }
  }

  cachedActiveBodies = bodies;
  return bodies;
}

// ── Spawn / Respawn ──────────────────────────────────────────────────
function spawnRocket() {
  rocket.x = 0;
  rocket.y = 0;

  // Small random initial velocity via Verlet prev-position offset
  const vx = (Math.random() - 0.5) * 2.0;
  const vy = (Math.random() - 0.5) * 2.0;
  rocket.prevX = -vx * DT;
  rocket.prevY = -vy * DT;

  rocket.crashed = false;
  rocket.fuel = FUEL_MAX;
  maxDistFromOrigin = 0;

  // Reset camera to center on rocket
  camera.x = rocket.x - W / 2;
  camera.y = rocket.y - H / 2;

  statusEl.textContent = 'Orbiting...';
  statusEl.style.color = '#ccc';
}

respawnBtn.addEventListener('click', spawnRocket);

// ── Physics (Störmer-Verlet) ─────────────────────────────────────────
function computeAcceleration(px, py, activeBodies) {
  let ax = 0, ay = 0;
  for (const m of activeBodies) {
    let dx = m.x - px;
    let dy = m.y - py;
    let dist = Math.sqrt(dx * dx + dy * dy);

    const minDist = m.radius * 0.5;
    if (dist < minDist) dist = minDist;

    const force = G * m.mass / (dist * dist);
    ax += force * (dx / dist);
    ay += force * (dy / dist);
  }
  return { ax, ay };
}

function updatePhysics() {
  if (rocket.crashed) return;

  const activeBodies = getActiveBodies();

  let { ax, ay } = computeAcceleration(rocket.x, rocket.y, activeBodies);

  // Thrust
  const thrusting = (keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) && rocket.fuel > 0;
  if (thrusting) {
    if (keys.ArrowUp)    ay -= THRUST_ACCEL;
    if (keys.ArrowDown)  ay += THRUST_ACCEL;
    if (keys.ArrowLeft)  ax -= THRUST_ACCEL;
    if (keys.ArrowRight) ax += THRUST_ACCEL;
    rocket.fuel--;
  }

  // Passive refueling
  if (!thrusting) {
    rocket.fuel = Math.min(FUEL_MAX, rocket.fuel + REFUEL_RATE);
  }

  // Update status text
  const anyKeyHeld = keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight;
  if (anyKeyHeld && rocket.fuel <= 0) {
    statusEl.textContent = 'NO FUEL';
    statusEl.style.color = '#ff6633';
  } else if (thrusting) {
    statusEl.textContent = 'Thrusting...';
    statusEl.style.color = '#00ffcc';
  } else {
    statusEl.textContent = 'Orbiting...';
    statusEl.style.color = '#ccc';
  }

  // Störmer-Verlet integration
  const newX = 2 * rocket.x - rocket.prevX + ax * DT * DT;
  const newY = 2 * rocket.y - rocket.prevY + ay * DT * DT;

  rocket.prevX = rocket.x;
  rocket.prevY = rocket.y;
  rocket.x = newX;
  rocket.y = newY;

  // Speed cap
  const dx = rocket.x - rocket.prevX;
  const dy = rocket.y - rocket.prevY;
  const speed = Math.sqrt(dx * dx + dy * dy);
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed;
    rocket.x = rocket.prevX + dx * scale;
    rocket.y = rocket.prevY + dy * scale;
  }

  // Collision with active bodies
  for (const m of activeBodies) {
    const cdx = rocket.x - m.x;
    const cdy = rocket.y - m.y;
    const dist = Math.sqrt(cdx * cdx + cdy * cdy);
    if (dist <= m.radius + rocket.radius) {
      const nx = cdx / dist;
      const ny = cdy / dist;
      rocket.x = m.x + nx * (m.radius + rocket.radius);
      rocket.y = m.y + ny * (m.radius + rocket.radius);
      crash();
      return;
    }
  }

  // Update camera to keep rocket centered
  camera.x = rocket.x - W / 2;
  camera.y = rocket.y - H / 2;

  // Track distance from origin for scoring
  const distFromOrigin = Math.sqrt(rocket.x * rocket.x + rocket.y * rocket.y);
  if (distFromOrigin > maxDistFromOrigin) {
    maxDistFromOrigin = distFromOrigin;
  }
}

function crash() {
  rocket.crashed = true;
  if (maxDistFromOrigin > highScore) {
    highScore = maxDistFromOrigin;
  }
  statusEl.textContent = 'CRASHED — press Respawn';
  statusEl.style.color = '#ff0044';
}

// ── Starfield ────────────────────────────────────────────────────────
const STAR_TILE_SIZE = 512;
const STAR_DENSITY = 80;    // stars per tile
const PARALLAX = 0.3;       // stars move slower than camera for depth

function drawStarfield() {
  const offX = camera.x * PARALLAX;
  const offY = camera.y * PARALLAX;

  // Which tiles are visible?
  const startTX = Math.floor(offX / STAR_TILE_SIZE) - 1;
  const startTY = Math.floor(offY / STAR_TILE_SIZE) - 1;
  const endTX = Math.floor((offX + W) / STAR_TILE_SIZE) + 1;
  const endTY = Math.floor((offY + H) / STAR_TILE_SIZE) + 1;

  for (let tx = startTX; tx <= endTX; tx++) {
    for (let ty = startTY; ty <= endTY; ty++) {
      const rng = mulberry32(chunkSeed(tx * 7 + 1000, ty * 7 + 1000));
      for (let i = 0; i < STAR_DENSITY; i++) {
        const sx = tx * STAR_TILE_SIZE + rng() * STAR_TILE_SIZE - offX;
        const sy = ty * STAR_TILE_SIZE + rng() * STAR_TILE_SIZE - offY;
        const brightness = 0.3 + rng() * 0.7;
        const size = rng() < 0.1 ? 1.5 : 0.8;

        if (sx < -5 || sx > W + 5 || sy < -5 || sy > H + 5) continue;

        ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
        ctx.fillRect(sx, sy, size, size);
      }
    }
  }
}

// ── Minimap ──────────────────────────────────────────────────────────
const MINIMAP_SIZE = 120;
const MINIMAP_MARGIN = 10;
const MINIMAP_RANGE = 3000; // world units shown in minimap

function drawMinimap(activeBodies) {
  const mx = W - MINIMAP_SIZE - MINIMAP_MARGIN;
  const my = H - MINIMAP_SIZE - MINIMAP_MARGIN;
  const scale = MINIMAP_SIZE / (MINIMAP_RANGE * 2);

  // Background
  ctx.fillStyle = 'rgba(10, 10, 20, 0.8)';
  ctx.fillRect(mx, my, MINIMAP_SIZE, MINIMAP_SIZE);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, MINIMAP_SIZE, MINIMAP_SIZE);

  const centerMX = mx + MINIMAP_SIZE / 2;
  const centerMY = my + MINIMAP_SIZE / 2;

  // Origin marker (crosshair)
  const originDX = (0 - rocket.x) * scale;
  const originDY = (0 - rocket.y) * scale;
  const originScreenX = centerMX + originDX;
  const originScreenY = centerMY + originDY;

  if (originScreenX >= mx && originScreenX <= mx + MINIMAP_SIZE &&
      originScreenY >= my && originScreenY <= my + MINIMAP_SIZE) {
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(originScreenX - 4, originScreenY);
    ctx.lineTo(originScreenX + 4, originScreenY);
    ctx.moveTo(originScreenX, originScreenY - 4);
    ctx.lineTo(originScreenX, originScreenY + 4);
    ctx.stroke();
  } else {
    // Draw arrow pointing toward origin at minimap edge
    const angle = Math.atan2(originDY, originDX);
    const edgeX = centerMX + Math.cos(angle) * (MINIMAP_SIZE / 2 - 6);
    const edgeY = centerMY + Math.sin(angle) * (MINIMAP_SIZE / 2 - 6);
    // Clamp to minimap bounds
    const clampedX = Math.max(mx + 3, Math.min(mx + MINIMAP_SIZE - 3, edgeX));
    const clampedY = Math.max(my + 3, Math.min(my + MINIMAP_SIZE - 3, edgeY));
    ctx.fillStyle = '#ffcc33';
    ctx.beginPath();
    ctx.arc(clampedX, clampedY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw bodies as dots
  for (const b of activeBodies) {
    const bdx = (b.x - rocket.x) * scale;
    const bdy = (b.y - rocket.y) * scale;
    const bsx = centerMX + bdx;
    const bsy = centerMY + bdy;

    if (bsx >= mx && bsx <= mx + MINIMAP_SIZE &&
        bsy >= my && bsy <= my + MINIMAP_SIZE) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(bsx, bsy, Math.max(1.5, b.radius * scale * 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Rocket position (always at center)
  ctx.fillStyle = '#00ffcc';
  ctx.beginPath();
  ctx.arc(centerMX, centerMY, 2, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = '#666';
  ctx.font = '9px Courier New';
  ctx.fillText('MAP', mx + 3, my + 10);
}

// ── Score Display ────────────────────────────────────────────────────
function drawScore() {
  const dist = Math.floor(Math.sqrt(rocket.x * rocket.x + rocket.y * rocket.y));
  const best = Math.floor(maxDistFromOrigin);
  const high = Math.floor(highScore);

  ctx.fillStyle = '#888';
  ctx.font = '12px Courier New';
  ctx.textAlign = 'right';
  ctx.fillText(`Dist: ${dist}`, W - MINIMAP_SIZE - MINIMAP_MARGIN - 10, H - MINIMAP_SIZE - MINIMAP_MARGIN + 15);
  ctx.fillText(`Best: ${best}`, W - MINIMAP_SIZE - MINIMAP_MARGIN - 10, H - MINIMAP_SIZE - MINIMAP_MARGIN + 30);
  if (high > 0) {
    ctx.fillStyle = '#ffcc33';
    ctx.fillText(`High: ${high}`, W - MINIMAP_SIZE - MINIMAP_MARGIN - 10, H - MINIMAP_SIZE - MINIMAP_MARGIN + 45);
  }
  ctx.textAlign = 'left';
}

// ── Rendering ────────────────────────────────────────────────────────
function drawMass(m) {
  // Glow
  const grad = ctx.createRadialGradient(m.x, m.y, m.radius * 0.3, m.x, m.y, m.radius * 1.8);
  grad.addColorStop(0, m.color + 'aa');
  grad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.radius * 1.8, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Solid fill
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
  ctx.fillStyle = m.color;
  ctx.fill();
}

function drawRocket() {
  const thrusting = (keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) && rocket.fuel > 0 && !rocket.crashed;
  if (thrusting) {
    const exOff = 8;
    if (keys.ArrowRight) { drawExhaust(rocket.x - exOff, rocket.y); }
    if (keys.ArrowLeft)  { drawExhaust(rocket.x + exOff, rocket.y); }
    if (keys.ArrowDown)  { drawExhaust(rocket.x, rocket.y - exOff); }
    if (keys.ArrowUp)    { drawExhaust(rocket.x, rocket.y + exOff); }
  }

  ctx.beginPath();
  ctx.arc(rocket.x, rocket.y, rocket.radius, 0, Math.PI * 2);
  ctx.fillStyle = rocket.crashed ? '#ff0044' : '#00ffcc';
  ctx.fill();
}

function drawExhaust(ex, ey) {
  const grad = ctx.createRadialGradient(ex, ey, 0, ex, ey, 6);
  grad.addColorStop(0, 'rgba(255, 200, 50, 0.8)');
  grad.addColorStop(1, 'rgba(255, 100, 20, 0)');
  ctx.beginPath();
  ctx.arc(ex, ey, 6, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawFuelBar() {
  const barX = 10;
  const barY = H - 22;
  const barW = 150;
  const barH = 12;
  const fuelRatio = rocket.fuel / FUEL_MAX;

  ctx.fillStyle = '#222';
  ctx.fillRect(barX, barY, barW, barH);

  ctx.fillStyle = fuelRatio > 0.25 ? '#00ffcc' : '#ff6633';
  ctx.fillRect(barX, barY, barW * fuelRatio, barH);

  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = '#ccc';
  ctx.font = '11px Courier New';
  ctx.fillText('FUEL', barX + barW + 6, barY + 10);
}

function render() {
  // Clear screen
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  // Starfield (drawn in screen space with parallax)
  drawStarfield();

  // World-space drawing (bodies + rocket)
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  // Draw active bodies (with culling)
  const viewMargin = 100;
  for (const m of cachedActiveBodies) {
    // Cull off-screen bodies
    const screenX = m.x - camera.x;
    const screenY = m.y - camera.y;
    if (screenX < -viewMargin - m.radius * 2 || screenX > W + viewMargin + m.radius * 2 ||
        screenY < -viewMargin - m.radius * 2 || screenY > H + viewMargin + m.radius * 2) {
      continue;
    }
    drawMass(m);
  }

  drawRocket();
  ctx.restore();

  // HUD (screen-space)
  drawFuelBar();
  drawScore();
  drawMinimap(cachedActiveBodies);
}

// ── Game Loop ────────────────────────────────────────────────────────
function loop() {
  updatePhysics();
  render();
  requestAnimationFrame(loop);
}

// ── Start ────────────────────────────────────────────────────────────
spawnRocket();
loop();
