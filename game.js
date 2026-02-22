// ── Constants ────────────────────────────────────────────────────────
const G  = 1.0;
const DT = 0.4;
const W  = 800;
const H  = 600;
const EDGE_MARGIN   = 80;
const SPAWN_CLEAR   = 60;
const THRUST_ACCEL  = 0.8;
const MAX_SPEED     = 8.0;
const FUEL_MAX      = 200;
let   REFUEL_RATE   = 0.5;

// ── Refuel Mode ───────────────────────────────────────────────────────
let refuelMode = 'default';  // 'default' or 'infinite'

// ── Body Presets ──────────────────────────────────────────────────────
const PRESETS = [
  // 1 body — single large at center
  [
    { x: 400, y: 300, mass: 6000, radius: 45, color: '#ff6633' }
  ],
  // 2 bodies — original layout
  [
    { x: 250, y: 300, mass: 5000, radius: 40, color: '#ff6633' },
    { x: 580, y: 300, mass: 3000, radius: 30, color: '#3399ff' }
  ],
  // 3 bodies — triangle
  [
    { x: 400, y: 150, mass: 4000, radius: 35, color: '#ff6633' },
    { x: 220, y: 430, mass: 3500, radius: 32, color: '#3399ff' },
    { x: 580, y: 430, mass: 3500, radius: 32, color: '#33ff99' }
  ],
  // 4 bodies — diamond
  [
    { x: 400, y: 120, mass: 3000, radius: 30, color: '#ff6633' },
    { x: 400, y: 480, mass: 3000, radius: 30, color: '#3399ff' },
    { x: 150, y: 300, mass: 3000, radius: 30, color: '#33ff99' },
    { x: 650, y: 300, mass: 3000, radius: 30, color: '#ffcc33' }
  ],
  // 5 bodies — pentagon
  (() => {
    const cx = 400, cy = 300, r = 180;
    const colors = ['#ff6633', '#3399ff', '#33ff99', '#ffcc33', '#cc66ff'];
    return Array.from({ length: 5 }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / 5;
      return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        mass: 2500,
        radius: 26,
        color: colors[i]
      };
    });
  })()
];

// ── Input State ─────────────────────────────────────────────────────
const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
window.addEventListener('keydown', (e) => {
  if (e.key in keys) { keys[e.key] = true; e.preventDefault(); }
  // WASD bindings
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
const masses = [];
let activeBodyCount = 2;

const rocket = {
  x: 0, y: 0,
  prevX: 0, prevY: 0,
  radius: 5,
  crashed: false,
  fuel: FUEL_MAX
};

// Expose for Playwright / testing
window.rocket = rocket;
window.masses = masses;

// ── Canvas Setup ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const statusEl  = document.getElementById('status');
const respawnBtn = document.getElementById('respawn');

// ── Body Count Selector ──────────────────────────────────────────────
function setBodyCount(n) {
  n = Math.max(1, Math.min(5, n));
  activeBodyCount = n;

  // Replace masses array contents
  masses.length = 0;
  const preset = PRESETS[n - 1];
  for (const p of preset) {
    masses.push({ x: p.x, y: p.y, mass: p.mass, radius: p.radius, color: p.color });
  }

  // Update button highlights
  const buttons = document.querySelectorAll('#body-selector button');
  buttons.forEach((btn, i) => {
    btn.classList.toggle('active', i + 1 === n);
  });

  spawnRocket();
}
window.setBodyCount = setBodyCount;

// ── Infinite Fuel Toggle ─────────────────────────────────────────────
function setRefuelMode(mode) {
  refuelMode = mode;
  REFUEL_RATE = mode === 'infinite' ? 1.0 : 0.5;
}

// ── Spawn / Respawn ──────────────────────────────────────────────────
function spawnRocket() {
  for (let attempts = 0; attempts < 200; attempts++) {
    const rx = EDGE_MARGIN + Math.random() * (W - 2 * EDGE_MARGIN);
    const ry = EDGE_MARGIN + Math.random() * (H - 2 * EDGE_MARGIN);

    let tooClose = false;
    for (const m of masses) {
      const dx = rx - m.x;
      const dy = ry - m.y;
      if (Math.sqrt(dx * dx + dy * dy) < m.radius + SPAWN_CLEAR) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    rocket.x = rx;
    rocket.y = ry;

    // Small random initial velocity via Verlet prev-position offset
    const vx = (Math.random() - 0.5) * 2.0;
    const vy = (Math.random() - 0.5) * 2.0;
    rocket.prevX = rx - vx * DT;
    rocket.prevY = ry - vy * DT;

    rocket.crashed = false;
    rocket.fuel = FUEL_MAX;
    statusEl.textContent = 'Orbiting...';
    statusEl.style.color = '#ccc';
    return;
  }
  // Fallback (should never hit)
  rocket.x = W / 2;
  rocket.y = 100;
  rocket.prevX = rocket.x;
  rocket.prevY = rocket.y;
  rocket.crashed = false;
}

respawnBtn.addEventListener('click', spawnRocket);

// ── Physics (Störmer-Verlet) ─────────────────────────────────────────
function computeAcceleration(px, py) {
  let ax = 0, ay = 0;
  for (const m of masses) {
    let dx = m.x - px;
    let dy = m.y - py;
    let dist = Math.sqrt(dx * dx + dy * dy);

    // Softening: clamp distance to prevent blowup near surface
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

  let { ax, ay } = computeAcceleration(rocket.x, rocket.y);

  // Thrust
  const thrusting = (keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight) && rocket.fuel > 0;
  if (thrusting) {
    if (keys.ArrowUp)    ay -= THRUST_ACCEL;
    if (keys.ArrowDown)  ay += THRUST_ACCEL;
    if (keys.ArrowLeft)  ax -= THRUST_ACCEL;
    if (keys.ArrowRight) ax += THRUST_ACCEL;
    rocket.fuel--;
  }

  // Passive refueling when not thrusting
  if (!thrusting) {
    rocket.fuel = Math.min(FUEL_MAX, rocket.fuel + REFUEL_RATE);
  }

  // Update status text
  if (!rocket.crashed) {
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

  // Collision with masses
  for (const m of masses) {
    const cdx = rocket.x - m.x;
    const cdy = rocket.y - m.y;
    const dist = Math.sqrt(cdx * cdx + cdy * cdy);
    if (dist <= m.radius + rocket.radius) {
      // Snap to surface
      const nx = cdx / dist;
      const ny = cdy / dist;
      rocket.x = m.x + nx * (m.radius + rocket.radius);
      rocket.y = m.y + ny * (m.radius + rocket.radius);
      crash();
      return;
    }
  }

  // Off-screen bounds check
  if (rocket.x < -50 || rocket.x > W + 50 || rocket.y < -50 || rocket.y > H + 50) {
    crash();
  }
}

function crash() {
  rocket.crashed = true;
  statusEl.textContent = 'CRASHED — press Respawn';
  statusEl.style.color = '#ff0044';
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
  // Exhaust glow when thrusting
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

  // Background
  ctx.fillStyle = '#222';
  ctx.fillRect(barX, barY, barW, barH);

  // Fill
  ctx.fillStyle = fuelRatio > 0.25 ? '#00ffcc' : '#ff6633';
  ctx.fillRect(barX, barY, barW * fuelRatio, barH);

  // Outline
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  // Label
  ctx.fillStyle = '#ccc';
  ctx.font = '11px Courier New';
  ctx.fillText('FUEL', barX + barW + 6, barY + 10);
}

function render() {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  for (const m of masses) {
    drawMass(m);
  }
  drawRocket();
  drawFuelBar();
}

// ── Game Loop ────────────────────────────────────────────────────────
function loop() {
  updatePhysics();
  render();
  requestAnimationFrame(loop);
}

// ── Start ────────────────────────────────────────────────────────────
setBodyCount(2);  // Default to 2 bodies (matches original behavior)
loop();
