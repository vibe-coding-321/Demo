// ── Constants ────────────────────────────────────────────────────────
const G  = 1.0;
const DT = 0.4;
const W  = 800;
const H  = 600;
const THRUST_ACCEL  = 1.6;
const MAX_SPEED     = 20.0;
const SPEED_OF_LIGHT = 18.0;
const SPACE_DRAG    = 0.0003;
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

// ── Color Utilities ──────────────────────────────────────────────────
function hexToHSL(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToString(h, s, l) {
  return `hsl(${h | 0}, ${s | 0}%, ${l | 0}%)`;
}

function colorWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
        // Separate sub-RNG for visual properties so positions/sizes stay unchanged
        const vizRng = mulberry32(chunkSeed(cx, cy) * 31 + i * 7919);
        const planetType = Math.floor(vizRng() * 5);
        const featureSeed = (vizRng() * 0xFFFFFF) | 0;
        const ringRoll = vizRng();
        const hasRing = planetType === 3 || ringRoll < 0.15;
        const ringAngle = vizRng() * Math.PI * 0.4 - Math.PI * 0.2;
        const atmosphereOpacity = 0.06 + vizRng() * 0.09;
        bodies.push({
          x: worldX,
          y: worldY,
          mass: mass,
          radius: radius,
          color: BODY_COLORS[colorIdx],
          planetType,
          featureSeed,
          hasRing,
          ringAngle,
          atmosphereOpacity,
          cachedCanvas: null
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

  // Thrust (relativistic: Lorentz factor reduces effectiveness near c)
  const thrusting = (keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) && rocket.fuel > 0;
  if (thrusting) {
    const vxT = (rocket.x - rocket.prevX) / DT;
    const vyT = (rocket.y - rocket.prevY) / DT;
    const speed = Math.sqrt(vxT * vxT + vyT * vyT);
    const beta = Math.min(speed / SPEED_OF_LIGHT, 0.9999);
    const lorentzFactor = 1 / Math.sqrt(1 - beta * beta);
    const effectiveThrust = THRUST_ACCEL / lorentzFactor;
    if (keys.ArrowUp)    ay -= effectiveThrust;
    if (keys.ArrowDown)  ay += effectiveThrust;
    if (keys.ArrowLeft)  ax -= effectiveThrust;
    if (keys.ArrowRight) ax += effectiveThrust;
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

  // Subtle space drag
  const vdx = rocket.x - rocket.prevX;
  const vdy = rocket.y - rocket.prevY;
  rocket.x = rocket.prevX + vdx * (1 - SPACE_DRAG);
  rocket.y = rocket.prevY + vdy * (1 - SPACE_DRAG);

  // Hard speed cap (emergency safety net)
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
const PARALLAX = 0.05;      // stars drift at 5% of camera speed
const STAR_COLORS = [
  [255, 255, 255], // white (most common)
  [255, 255, 255],
  [255, 255, 255],
  [255, 255, 255],
  [255, 255, 255],
  [200, 220, 255], // blue-white
  [180, 200, 255], // blue
  [255, 255, 200], // yellow
  [255, 220, 150], // orange
  [255, 180, 150], // red-orange
];

// ── Nebula System ────────────────────────────────────────────────────
const NEBULA_TILE_SIZE = 1024;
const NEBULA_PARALLAX = 0.02;
const nebulaTileCache = new Map();
const NEBULA_COLORS = [
  [70, 40, 180],   // deep blue (brightened)
  [130, 60, 200],  // purple (brightened)
  [180, 50, 150],  // magenta (brightened)
  [50, 90, 190],   // royal blue (brightened)
  [100, 40, 130],  // dark violet (brightened)
  [180, 60, 80],   // crimson (warm)
  [60, 120, 160],  // teal (warm)
  [140, 80, 50],   // amber (warm)
];

function generateNebulaBlobs(tx, ty) {
  const rng = mulberry32(chunkSeed(tx * 13 + 5000, ty * 13 + 5000));
  const blobCount = 1 + Math.floor(rng() * 3);
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    blobs.push({
      bx: rng() * NEBULA_TILE_SIZE,
      by: rng() * NEBULA_TILE_SIZE,
      br: 250 + rng() * 400,
      nc: NEBULA_COLORS[Math.floor(rng() * NEBULA_COLORS.length)],
      opacity: 0.08 + rng() * 0.07
    });
  }
  return blobs;
}

function renderNebulaTile(tx, ty) {
  const oc = document.createElement('canvas');
  oc.width = NEBULA_TILE_SIZE;
  oc.height = NEBULA_TILE_SIZE;
  const c = oc.getContext('2d');

  // Render blobs from this tile and all 8 neighbors to eliminate seams
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ntx = tx + dx;
      const nty = ty + dy;
      const blobs = generateNebulaBlobs(ntx, nty);
      for (const blob of blobs) {
        const relX = blob.bx + dx * NEBULA_TILE_SIZE;
        const relY = blob.by + dy * NEBULA_TILE_SIZE;
        // Skip if blob doesn't overlap this tile
        if (relX + blob.br < 0 || relX - blob.br > NEBULA_TILE_SIZE ||
            relY + blob.br < 0 || relY - blob.br > NEBULA_TILE_SIZE) continue;
        const grad = c.createRadialGradient(relX, relY, 0, relX, relY, blob.br);
        grad.addColorStop(0, `rgba(${blob.nc[0]}, ${blob.nc[1]}, ${blob.nc[2]}, ${blob.opacity})`);
        grad.addColorStop(0.5, `rgba(${blob.nc[0]}, ${blob.nc[1]}, ${blob.nc[2]}, ${blob.opacity * 0.5})`);
        grad.addColorStop(1, 'transparent');
        c.beginPath();
        c.arc(relX, relY, blob.br, 0, Math.PI * 2);
        c.fillStyle = grad;
        c.fill();
      }
    }
  }

  return oc;
}

function getNebulaTile(tx, ty) {
  const key = tx + ',' + ty;
  if (nebulaTileCache.has(key)) return nebulaTileCache.get(key);
  const tile = renderNebulaTile(tx, ty);
  nebulaTileCache.set(key, tile);
  // Evict if over 25 tiles
  if (nebulaTileCache.size > 25) {
    const first = nebulaTileCache.keys().next().value;
    nebulaTileCache.delete(first);
  }
  return tile;
}

function drawNebulae() {
  const offX = camera.x * NEBULA_PARALLAX;
  const offY = camera.y * NEBULA_PARALLAX;

  const startTX = Math.floor(offX / NEBULA_TILE_SIZE) - 1;
  const startTY = Math.floor(offY / NEBULA_TILE_SIZE) - 1;
  const endTX = Math.floor((offX + W) / NEBULA_TILE_SIZE) + 1;
  const endTY = Math.floor((offY + H) / NEBULA_TILE_SIZE) + 1;

  for (let tx = startTX; tx <= endTX; tx++) {
    for (let ty = startTY; ty <= endTY; ty++) {
      const tile = getNebulaTile(tx, ty);
      const drawX = tx * NEBULA_TILE_SIZE - offX;
      const drawY = ty * NEBULA_TILE_SIZE - offY;
      ctx.drawImage(tile, drawX, drawY);
    }
  }
}

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
        const colorIdx = Math.floor(rng() * STAR_COLORS.length);

        if (sx < -5 || sx > W + 5 || sy < -5 || sy > H + 5) continue;

        const sc = STAR_COLORS[colorIdx];
        ctx.fillStyle = `rgba(${sc[0]}, ${sc[1]}, ${sc[2]}, ${brightness})`;
        ctx.fillRect(sx, sy, size, size);

        // Sparkle effect for bright stars
        if (brightness > 0.85 && size > 1) {
          ctx.globalAlpha = brightness * 0.4;
          ctx.fillRect(sx - 1.5, sy + 0.25, 0.5, 0.5);
          ctx.fillRect(sx + 1.5, sy + 0.25, 0.5, 0.5);
          ctx.fillRect(sx + 0.25, sy - 1.5, 0.5, 0.5);
          ctx.fillRect(sx + 0.25, sy + 1.5, 0.5, 0.5);
          ctx.globalAlpha = 1;
        }
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

// ── Planet Rendering & Caching ────────────────────────────────────────
function renderPlanetToCache(body) {
  const r = body.radius;
  const pad = Math.max(r * 1.0, 30); // extra space for glow + rings
  const size = Math.ceil((r + pad) * 2);
  const oc = document.createElement('canvas');
  oc.width = size;
  oc.height = size;
  const c = oc.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  const hsl = hexToHSL(body.color);
  const rng = mulberry32(body.featureSeed);

  // ── Outer glow ──
  const glowGrad = c.createRadialGradient(cx, cy, r * 0.6, cx, cy, r + pad * 0.35);
  glowGrad.addColorStop(0, colorWithAlpha(body.color, 0.10));
  glowGrad.addColorStop(1, 'transparent');
  c.beginPath();
  c.arc(cx, cy, r + pad * 0.35, 0, Math.PI * 2);
  c.fillStyle = glowGrad;
  c.fill();

  // ── 3D sphere base ──
  const lightX = cx - r * 0.35;
  const lightY = cy - r * 0.35;
  const sphereGrad = c.createRadialGradient(lightX, lightY, r * 0.05, cx, cy, r);
  sphereGrad.addColorStop(0, hslToString(hsl.h, hsl.s * 0.7, Math.min(65, hsl.l + 10)));
  sphereGrad.addColorStop(0.5, body.color);
  sphereGrad.addColorStop(1, hslToString(hsl.h, hsl.s * 0.9, Math.max(8, hsl.l - 35)));
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = sphereGrad;
  c.fill();

  // ── Surface features (clipped to planet circle) ──
  c.save();
  c.beginPath();
  c.arc(cx, cy, r - 1, 0, Math.PI * 2);
  c.clip();

  switch (body.planetType) {
    case 0: { // Banded gas giant
      const bandCount = 4 + Math.floor(rng() * 4);
      const bandH = (r * 2) / bandCount;
      for (let b = 0; b < bandCount; b++) {
        const hueShift = (rng() - 0.5) * 30;
        const lShift = (rng() - 0.5) * 15;
        c.fillStyle = hslToString(hsl.h + hueShift, hsl.s, hsl.l + lShift);
        c.globalAlpha = 0.12 + rng() * 0.10;
        c.fillRect(cx - r, cy - r + b * bandH, r * 2, bandH);
      }
      break;
    }
    case 1: { // Cratered rocky
      const craterCount = 3 + Math.floor(rng() * 6);
      for (let cr = 0; cr < craterCount; cr++) {
        const angle = rng() * Math.PI * 2;
        const dist = rng() * r * 0.75;
        const crX = cx + Math.cos(angle) * dist;
        const crY = cy + Math.sin(angle) * dist;
        const crR = r * (0.06 + rng() * 0.12);
        c.beginPath();
        c.arc(crX, crY, crR, 0, Math.PI * 2);
        c.fillStyle = hslToString(hsl.h, hsl.s * 0.5, Math.max(5, hsl.l - 20));
        c.globalAlpha = 0.20 + rng() * 0.15;
        c.fill();
        // Crater rim highlight
        c.beginPath();
        c.arc(crX - crR * 0.2, crY - crR * 0.2, crR * 0.6, 0, Math.PI * 2);
        c.fillStyle = hslToString(hsl.h, hsl.s * 0.4, hsl.l - 10);
        c.globalAlpha = 0.10;
        c.fill();
      }
      break;
    }
    case 2: { // Spotted/volcanic
      const spotCount = 2 + Math.floor(rng() * 4);
      for (let sp = 0; sp < spotCount; sp++) {
        const angle = rng() * Math.PI * 2;
        const dist = rng() * r * 0.6;
        const spX = cx + Math.cos(angle) * dist;
        const spY = cy + Math.sin(angle) * dist;
        const spR = r * (0.08 + rng() * 0.1);
        const hotGrad = c.createRadialGradient(spX, spY, 0, spX, spY, spR);
        hotGrad.addColorStop(0, 'rgba(255, 220, 160, 0.3)');
        hotGrad.addColorStop(0.4, 'rgba(255, 150, 50, 0.15)');
        hotGrad.addColorStop(1, 'rgba(255, 80, 20, 0)');
        c.globalAlpha = 0.30 + rng() * 0.15;
        c.beginPath();
        c.arc(spX, spY, spR, 0, Math.PI * 2);
        c.fillStyle = hotGrad;
        c.fill();
      }
      break;
    }
    case 3: { // Smooth ringed -- subtle bands
      const bandCount = 3 + Math.floor(rng() * 3);
      const bandH = (r * 2) / bandCount;
      for (let b = 0; b < bandCount; b++) {
        const lShift = (rng() - 0.5) * 8;
        c.fillStyle = hslToString(hsl.h, hsl.s * 0.8, hsl.l + lShift);
        c.globalAlpha = 0.08 + rng() * 0.06;
        c.fillRect(cx - r, cy - r + b * bandH, r * 2, bandH);
      }
      break;
    }
    case 4: { // Swirled/stormy
      const arcCount = 2 + Math.floor(rng() * 3);
      for (let a = 0; a < arcCount; a++) {
        const startAngle = rng() * Math.PI * 2;
        const arcLen = 0.5 + rng() * 1.5;
        const arcR = r * (0.3 + rng() * 0.5);
        const arcOffX = (rng() - 0.5) * r * 0.4;
        const arcOffY = (rng() - 0.5) * r * 0.4;
        c.beginPath();
        c.arc(cx + arcOffX, cy + arcOffY, arcR, startAngle, startAngle + arcLen);
        c.strokeStyle = hslToString(hsl.h + (rng() - 0.5) * 40, hsl.s, Math.min(85, hsl.l + 15));
        c.lineWidth = r * (0.06 + rng() * 0.08);
        c.globalAlpha = 0.15 + rng() * 0.10;
        c.stroke();
      }
      break;
    }
  }

  c.globalAlpha = 1;
  c.restore();

  // ── Atmosphere rim ──
  c.beginPath();
  c.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  c.strokeStyle = hslToString(hsl.h, hsl.s * 0.6, Math.min(90, hsl.l + 25));
  c.lineWidth = 1.5;
  c.globalAlpha = body.atmosphereOpacity;
  c.stroke();
  c.globalAlpha = 1;

  // ── Rings ──
  if (body.hasRing) {
    c.save();
    c.translate(cx, cy);
    c.rotate(body.ringAngle);
    const ringColors = [
      colorWithAlpha(body.color, 0.3),
      hslToString(hsl.h, hsl.s * 0.5, Math.min(85, hsl.l + 15)),
      colorWithAlpha(body.color, 0.2)
    ];
    for (let ri = 0; ri < 3; ri++) {
      c.beginPath();
      c.ellipse(0, 0, r * (1.4 + ri * 0.15), r * (0.3 + ri * 0.04), 0, 0, Math.PI * 2);
      c.strokeStyle = ringColors[ri];
      c.lineWidth = 1.5 + ri * 0.5;
      c.globalAlpha = 0.5 - ri * 0.1;
      c.stroke();
    }
    c.globalAlpha = 1;
    c.restore();
  }

  body.cachedCanvas = oc;
  body._cacheSize = size;
}

function drawMass(m) {
  if (!m.cachedCanvas) renderPlanetToCache(m);
  const half = m._cacheSize / 2;
  ctx.drawImage(m.cachedCanvas, m.x - half, m.y - half);
}

// ── Pre-rendered Ship Canvases ────────────────────────────────────────
let shipNormalCanvas = null;
let shipCrashedCanvas = null;

function renderShipCanvas(crashed) {
  const size = 28;
  const oc = document.createElement('canvas');
  oc.width = size;
  oc.height = size;
  const c = oc.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const r = 5;

  // Octagonal body
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8 - Math.PI / 8;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();

  // Radial gradient fill
  const grad = c.createRadialGradient(cx - 1, cy - 1, 0, cx, cy, r);
  if (crashed) {
    grad.addColorStop(0, '#ff6666');
    grad.addColorStop(1, '#990022');
  } else {
    grad.addColorStop(0, '#cceeee');
    grad.addColorStop(1, '#008877');
  }
  c.fillStyle = grad;
  c.fill();

  // Edge stroke
  c.strokeStyle = crashed ? '#ff0044' : '#009988';
  c.lineWidth = 0.8;
  c.stroke();

  // Center dot
  c.beginPath();
  c.arc(cx, cy, 1.2, 0, Math.PI * 2);
  c.fillStyle = crashed ? '#ff4444' : '#ffffff';
  c.fill();

  return oc;
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

  // Pulsing shield aura (alive only)
  if (!rocket.crashed) {
    const pulse = 0.06 + Math.sin(Date.now() * 0.004) * 0.03;
    const auraGrad = ctx.createRadialGradient(rocket.x, rocket.y, rocket.radius, rocket.x, rocket.y, rocket.radius * 2.0);
    auraGrad.addColorStop(0, `rgba(0, 255, 200, ${pulse})`);
    auraGrad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(rocket.x, rocket.y, rocket.radius * 2.0, 0, Math.PI * 2);
    ctx.fillStyle = auraGrad;
    ctx.fill();
  }

  // Draw cached ship
  if (!shipNormalCanvas) shipNormalCanvas = renderShipCanvas(false);
  if (!shipCrashedCanvas) shipCrashedCanvas = renderShipCanvas(true);
  const shipCanvas = rocket.crashed ? shipCrashedCanvas : shipNormalCanvas;
  ctx.drawImage(shipCanvas, rocket.x - shipCanvas.width / 2, rocket.y - shipCanvas.height / 2);
}

function drawExhaust(ex, ey) {
  // Outer exhaust glow
  const grad = ctx.createRadialGradient(ex, ey, 0, ex, ey, 8);
  grad.addColorStop(0, 'rgba(255, 220, 100, 0.6)');
  grad.addColorStop(0.4, 'rgba(255, 150, 40, 0.3)');
  grad.addColorStop(1, 'rgba(255, 80, 20, 0)');
  ctx.beginPath();
  ctx.arc(ex, ey, 8, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // White-hot inner core
  const coreGrad = ctx.createRadialGradient(ex, ey, 0, ex, ey, 3);
  coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
  coreGrad.addColorStop(1, 'rgba(255, 255, 200, 0)');
  ctx.beginPath();
  ctx.arc(ex, ey, 3, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
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
  // Deep space gradient background
  const hueShift = ((camera.x * 0.001 + camera.y * 0.0007) % 360 + 360) % 360;
  const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.8);
  bgGrad.addColorStop(0, hslToString(220 + hueShift * 0.3, 18, 7));
  bgGrad.addColorStop(1, hslToString(240 + hueShift * 0.15, 10, 3));
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Nebulae (behind stars, slowest parallax)
  drawNebulae();

  // Starfield (drawn in screen space with parallax)
  drawStarfield();

  // World-space drawing (bodies + rocket)
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  // Draw active bodies (with culling)
  const viewMargin = 150;
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
