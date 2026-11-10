import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as k from "/home/gohans-linux/.gemini/config/skills/anatomy/kit/iso-kit.mjs";
import { kitScript } from "/home/gohans-linux/.gemini/config/skills/anatomy/scripts/inline-kit.mjs";

const OUT_DIR = "/home/gohans-linux/projects/slice-player/html-visual";
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 760;
const HEIGHT = 480;

// Base plate
const PLATE = { x: -145, y: -80, w: 290, d: 160, r: 8 };
const PLATE_H = 14;
const FOOT_H = 6;

// Tape Reels (Supply & Take-up)
const REEL_L = [-82, 28];
const REEL_R = [82, 28];
const REEL_R_OUTER = 34;
const REEL_R_INNER = 14;
const REEL_Z = 4;
const REEL_H = 6;

// Guide Rollers
const GUIDES = [
  [-46, -2],
  [-28, -8],
  [28, -8],
  [46, -2],
];

// Magnetic Audio Head Block
const HEAD_BOX = { x: -16, y: -20, w: 32, d: 18, r: 3 };
const HEAD_Z = 0;
const HEAD_H = 14;

// Linear Slicing Rails & Carriage
const RAIL_Y1 = -38;
const RAIL_Y2 = -54;
const RAIL_X_MIN = -90;
const RAIL_X_MAX = 90;
const RAIL_Z = 5;

const CARRIAGE = { x: -24, y: -58, w: 48, d: 26, r: 2.5 };
const CARRIAGE_Z = 3;
const CARRIAGE_H = 7;
const CARRIAGE_TOP = CARRIAGE_Z + CARRIAGE_H;

// VU Meter Box (at top center)
const VU_BOX = { x: -32, y: 36, w: 64, d: 28, r: 3 };
const VU_Z = 0;
const VU_H = 22;
const VU_TOP = VU_Z + VU_H;
const VU_NEEDLE_Z = VU_TOP + 0.2;

// Slices data model
const SLICES = [
  { id: 1, name: "01 · Intro Hook", from: "00:12.4", to: "00:35.8", x: -55, vu: 0.65 },
  { id: 2, name: "02 · Verse Build", from: "00:44.0", to: "01:08.2", x: -20, vu: 0.45 },
  { id: 3, name: "03 · Chorus Drop (Gold)", from: "01:15.6", to: "01:46.3", x: 18, vu: 0.92 },
  { id: 4, name: "04 · Outro Solo", from: "02:20.1", to: "02:54.5", x: 55, vu: 0.78 },
];
const STOPS = SLICES.map((s) => s.x);
const REACH = [RAIL_X_MIN + 18, RAIL_X_MAX - 18];

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    [REEL_L[0] - REEL_R_OUTER, REEL_L[1] + REEL_R_OUTER, REEL_Z + REEL_H + 4],
    [REEL_R[0] + REEL_R_OUTER, REEL_R[1] + REEL_R_OUTER, REEL_Z + REEL_H + 4],
    [VU_BOX.x, VU_BOX.y + VU_BOX.d, VU_TOP + 4],
  ],
  WIDTH,
  HEIGHT,
  { pad: 36, azimuth: 42, elevation: 30 }
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  // Damping feet
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 9, -PLATE_H - FOOT_H, 2.5, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H + 2.5, FOOT_H - 2.5, P, 28), { tone: "mid" }));
  }
  // Heavy main deck slab
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));

  // Corner hex screws
  const screws = k.corners(PLATE, 12);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.8, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.6 }));

  // Millimeter time-ruler strip at bottom
  const strip = { x: -120, y: PLATE.y + 12, w: 240, d: 8, r: 1.2 };
  out.push(S(k.slabOf(strip, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 6, strip.x + strip.w - 6, 4, 5, strip.y + 1.2, 0.8, [2, 4], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 3, strip.y + 4, 0.8]), at([strip.x + strip.w - 3, strip.y + 4, 0.8])], { size: 0.5 }));

  // Vintage Brass engraved badge: SLICE PLAYER
  const badge = { x: -130, y: 44, w: 32, d: 18, r: 1.5 };
  out.push(S(k.slabOf(badge, 0, 1.2, P, 3), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(badge, 1.8), 1.2, P), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([badge.x + 16, badge.y + 9], 1.2, P, "x"), "SLICE MK-I", { size: 2.2, tone: "hi", anchor: "middle" }));

  return out.join("");
}

function reel(center) {
  const [x, y] = center;
  const out = [];
  // Spool spindle pedestal
  out.push(S(k.cylinder(x, y, REEL_R_INNER + 4, 0, REEL_Z, P, 32), { tone: "lo" }));
  // Tape cake (wound magnetic tape)
  out.push(S(k.cylinder(x, y, REEL_R_OUTER - 4, REEL_Z, REEL_H - 1, P, 40), { tone: "lo", crease: "lo" }));
  // Reel bottom flange
  out.push(S(k.cylinder(x, y, REEL_R_OUTER, REEL_Z, 0.8, P, 48), { tone: "mid" }));
  // Reel top flange
  out.push(S(k.cylinder(x, y, REEL_R_OUTER, REEL_Z + REEL_H, 0.8, P, 48), { tone: "mid" }));
  out.push(L(k.ring(x, y, REEL_R_OUTER - 1.5, REEL_Z + REEL_H + 0.8, P, 48), { tone: "lo" }));
  out.push(L(k.ring(x, y, REEL_R_INNER, REEL_Z + REEL_H + 0.8, P, 32), { tone: "faint" }));

  // 3-Spoke cutouts on top flange
  for (let i = 0; i < 3; i++) {
    const ang = (i * Math.PI * 2) / 3;
    const p1 = [x + Math.cos(ang) * (REEL_R_INNER + 2), y + Math.sin(ang) * (REEL_R_INNER + 2)];
    const p2 = [x + Math.cos(ang) * (REEL_R_OUTER - 3), y + Math.sin(ang) * (REEL_R_OUTER - 3)];
    out.push(L(k.lineOnTop(p1, p2, REEL_Z + REEL_H + 0.8, P), { tone: "mid" }));
  }

  // Center hub & knurled locking cap
  out.push(S(k.cylinder(x, y, 6.5, REEL_Z + REEL_H, 5, P, 28), { tone: "hi" }));
  out.push(L(k.knurl(x, y, 6.5, REEL_Z + REEL_H + 2, REEL_Z + REEL_H + 5, 24, P, 0.3), { tone: "lo" }));
  out.push(D([at([x, y, REEL_Z + REEL_H + 5])], { size: 0.6, tone: "hi" }));
  return out.join("");
}

function tapePath() {
  const out = [];
  // Guide posts & brass rollers
  GUIDES.forEach(([x, y]) => {
    out.push(S(k.cylinder(x, y, 3.8, 0, 1.2, P, 20), { tone: "mid" }));
    out.push(S(k.cylinder(x, y, 2.6, 1.2, 8, P, 20), { tone: "hi", lit: true }));
    out.push(S(k.cylinder(x, y, 3.8, 9.2, 1.2, P, 20), { tone: "mid" }));
    out.push(D([at([x, y, 10.4])], { size: 0.45 }));
  });

  // Tape ribbon (spanning across deck from left reel through guides to right reel)
  const tapeZ = 3.5;
  const tapeH = 4.5;
  // Segment Left
  const pL1 = [REEL_L[0] + 16, REEL_L[1] - 16];
  const pL2 = [GUIDES[0][0], GUIDES[0][1]];
  out.push(S(k.extrude([pL1, pL2, [pL2[0] + 0.6, pL2[1]], [pL1[0] + 0.6, pL1[1]]], tapeZ, tapeH, P), { tone: "lo", crease: "none" }));
  // Segment Center (Through Splicing Zone)
  const pG1 = [GUIDES[0][0], GUIDES[0][1]];
  const pG4 = [GUIDES[3][0], GUIDES[3][1]];
  out.push(S(k.extrude([pG1, pG4, [pG4[0], pG4[1] + 0.8], [pG1[0], pG1[1] + 0.8]], tapeZ, tapeH, P), { tone: "lo", crease: "none" }));
  // Segment Right
  const pR1 = [GUIDES[3][0], GUIDES[3][1]];
  const pR2 = [REEL_R[0] - 16, REEL_R[1] - 16];
  out.push(S(k.extrude([pR1, pR2, [pR2[0] + 0.6, pR2[1]], [pR1[0] + 0.6, pR1[1]]], tapeZ, tapeH, P), { tone: "lo", crease: "none" }));

  return out.join("");
}

function audioHead() {
  const out = [];
  // Mu-metal shielding block
  out.push(S(k.slabOf(HEAD_BOX, HEAD_Z, HEAD_H, P, 4, 1.2), { tone: "mid", crease: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(HEAD_BOX, 2.5), HEAD_H, P), { tone: "faint" }));

  // Azimuth adjustment thumb screws
  out.push(D([at([HEAD_BOX.x + 5, HEAD_BOX.y + 4, HEAD_H]), at([HEAD_BOX.x + HEAD_BOX.w - 5, HEAD_BOX.y + 4, HEAD_H])], { size: 0.5, tone: "lo" }));

  // Magnetic core pole piece in center (where tape touches)
  const pole = { x: -3.5, y: -2.8, w: 7, d: 2.2, r: 0.5 };
  out.push(S(k.slabOf(pole, 2, 7, P, 2, 0.4), { tone: "hi", lit: true }));
  out.push(L(k.lineOnTop([0, -2.8], [0, -0.6], 9, P), { tone: "lit" }));

  return out.join("");
}

function vuMeter() {
  const out = [];
  // Meter housing box
  out.push(S(k.slabOf(VU_BOX, VU_Z, VU_H, P, 5, 1.4), { tone: "mid" }));
  // Beveled recessed meter window face
  const win = k.insetPlan(VU_BOX, 3.5);
  out.push(S(k.slabOf(win, VU_TOP - 0.4, 0.6, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(win, VU_TOP + 0.2, P), { tone: "hi" }));

  // Meter arc and level markings (-20 to +3 dB)
  const cx = VU_BOX.x + VU_BOX.w / 2;
  const cy = VU_BOX.y + 6;
  const arcR = 14;
  const arc = k.sideArc(cx, cy, arcR, VU_TOP + 0.3, P, 32);
  out.push(L(arc, { tone: "lo" }));

  // Major level ticks
  for (let i = -3; i <= 3; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 8;
    const p1 = [cx + Math.cos(a) * (arcR - 1.2), cy + Math.sin(a) * (arcR - 1.2)];
    const p2 = [cx + Math.cos(a) * (arcR + 1.6), cy + Math.sin(a) * (arcR + 1.6)];
    out.push(L(k.lineOnTop(p1, p2, VU_TOP + 0.3, P), { tone: i > 1 ? "lit" : "mid" }));
  }

  // Label: "VU / AUDIO LEVEL"
  out.push(k.faceTextSvg(k.topMatrix([cx, VU_BOX.y + VU_BOX.d - 4], VU_TOP + 0.3, P, "x"), "VU dB", { size: 1.8, tone: "lo", anchor: "middle" }));

  return out.join("");
}

const needleAt = (val) => {
  const cx = VU_BOX.x + VU_BOX.w / 2;
  const cy = VU_BOX.y + 6;
  const angle = Math.PI * 0.75 - val * Math.PI * 0.5;
  const p1 = [cx, cy];
  const p2 = [cx + Math.cos(angle) * 13, cy + Math.sin(angle) * 13];
  return k.lineOnTop(p1, p2, VU_NEEDLE_Z, P);
};

function rails() {
  const out = [];
  // Steel linear guide rails
  for (const y of [RAIL_Y1, RAIL_Y2]) {
    out.push(S(k.cylinder(RAIL_X_MIN, y, 2.2, 0, RAIL_Z, P, 16), { tone: "mid" }));
    out.push(S(k.cylinder(RAIL_X_MAX, y, 2.2, 0, RAIL_Z, P, 16), { tone: "mid" }));
    // Rail rod
    const p1 = [RAIL_X_MIN, y];
    const p2 = [RAIL_X_MAX, y];
    out.push(S(k.extrude([p1, p2, [p2[0], p2[1] + 2], [p1[0], p1[1] + 2]], RAIL_Z, 2.2, P), { tone: "hi", lit: true }));
  }
  // Rail end mounting pillow blocks
  for (const x of [RAIL_X_MIN - 4, RAIL_X_MAX]) {
    out.push(S(k.slabOf({ x, y: RAIL_Y2 - 3, w: 4, d: 22, r: 1.2 }, 0, RAIL_Z + 4, P, 3, 0.5), { tone: "mid" }));
    out.push(D([at([x + 2, RAIL_Y1 + 1, RAIL_Z + 4]), at([x + 2, RAIL_Y2 + 1, RAIL_Z + 4])], { size: 0.45 }));
  }
  return out.join("");
}

function carriage() {
  const out = [];
  // Halo under carriage
  out.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CARRIAGE, 2), CARRIAGE_Z, 0.2, P)}" style="filter:blur(4px)"/>`);

  // Sliding block body
  out.push(S(k.slabOf(CARRIAGE, CARRIAGE_Z, CARRIAGE_H, P, 4, 0.8), { tone: "mid" }));

  // Inset top styling & screws
  out.push(L(k.planOutline(k.insetPlan(CARRIAGE, 3), CARRIAGE_TOP, P), { tone: "faint" }));
  out.push(D([at([CARRIAGE.x + 4, CARRIAGE.y + 4, CARRIAGE_TOP]), at([CARRIAGE.x + CARRIAGE.w - 4, CARRIAGE.y + 4, CARRIAGE_TOP])], { size: 0.45 }));

  // Micrometer dial on carriage
  const knob = [CARRIAGE.x + 12, CARRIAGE.y + 12];
  out.push(S(k.cylinder(knob[0], knob[1], 5, CARRIAGE_TOP, 4.5, P, 24), { tone: "hi" }));
  out.push(L(k.knurl(knob[0], knob[1], 5, CARRIAGE_TOP, CARRIAGE_TOP + 4.5, 20, P), { tone: "lo" }));
  out.push(D([at([knob[0], knob[1], CARRIAGE_TOP + 4.5])], { size: 0.5, tone: "lit" }));

  // Splicer Guide Channel: Extends upwards toward tape
  const channel = { x: CARRIAGE.x + CARRIAGE.w / 2 - 2, y: CARRIAGE.y + CARRIAGE.d, w: 4, d: 20, r: 0.8 };
  out.push(S(k.slabOf(channel, CARRIAGE_Z + 1, 3.5, P, 2), { tone: "hi" }));

  // Guillotine Cutting Lever (Lit accent)
  const leverBase = [CARRIAGE.x + CARRIAGE.w - 8, CARRIAGE.y + CARRIAGE.d + 16];
  out.push(S(k.cylinder(leverBase[0], leverBase[1], 3.2, CARRIAGE_Z + 2, 4, P, 20), { tone: "hi", lit: true }));
  // Cutter blade arm
  const bladeEnd = [leverBase[0] - 18, leverBase[1] - 8];
  out.push(S(k.extrude([[leverBase[0], leverBase[1]], bladeEnd, [bladeEnd[0], bladeEnd[1] + 1.6], [leverBase[0], leverBase[1] + 1.6]], CARRIAGE_Z + 3, 6, P), { tone: "hi", lit: true }));

  // Caliper marker text
  out.push(k.faceTextSvg(k.topMatrix([CARRIAGE.x + 30, CARRIAGE.y + 7], CARRIAGE_TOP, P, "x"), "SLICE JIG", { size: 1.8, tone: "lo" }));

  return out.join("");
}

const startX = STOPS[0];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A precision reel-to-reel tape splicing console and virtual slice cutter for Slice Player. Two analog reels carry the master track tape past brass guide posts and a mu-metal audio head. A sliding guillotine slicing carriage moves along parallel linear rails to mark, trim and audition segment cuts, while an analog VU meter displays real-time signal energy.",
  body: [
    plate(),
    reel(REEL_L),
    reel(REEL_R),
    tapePath(),
    audioHead(),
    vuMeter(),
    rails(),
    `<g data-part="carriage" transform="${k.translateAlong(P, [startX, 0, 0])}">${carriage()}</g>`,
    `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(SLICES[0].vu)}" style="stroke-width:1.2"/>`,
  ],
});

const live = `
const P = ${JSON.stringify(P)};
const SLICES = ${JSON.stringify(SLICES)};
const STOPS = ${JSON.stringify(STOPS)};
const REACH = ${JSON.stringify(REACH)};
const needleAt = ${needleAt.toString().replace("k.lineOnTop", "lineOnTop")};

const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const carriage = svg.querySelector('[data-part="carriage"]');
const needle = svg.querySelector('[data-part="needle"]');
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

let currentX = ${startX};
let targetX = currentX;
let currentVu = ${SLICES[0].vu};
let targetVu = currentVu;

let frame = 0, last = 0, clock = 0, touring = true, visible = false, idleTimer = 0;

const tourAt = (t) => {
  const idx = Math.floor(t / 2.8) % STOPS.length;
  return STOPS[idx];
};

function getNearestSlice(x) {
  let best = 0;
  let dist = 9999;
  SLICES.forEach((s, idx) => {
    const d = Math.abs(s.x - x);
    if (d < dist) { dist = d; best = idx; }
  });
  return SLICES[best];
}

function draw() {
  carriage.setAttribute("transform", translateAlong(P, [currentX, 0, 0]));
  needle.setAttribute("d", needleAt(currentVu));
  const slice = getNearestSlice(currentX);
  const text = slice.name + " · " + slice.from + " ➔ " + slice.to + " · VU " + Math.round(currentVu * 100) + "%";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(slice.id));
  stage.setAttribute("aria-valuetext", text);
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;

  if (touring) {
    clock += dt;
    targetX = tourAt(clock);
  }

  currentX = calm ? targetX : currentX + (targetX - currentX) * (1 - Math.exp(-dt / 0.22));
  if (Math.abs(targetX - currentX) < 0.02) currentX = targetX;

  const activeSlice = getNearestSlice(currentX);
  const flutter = touring ? Math.sin(now * 0.015) * 0.08 : 0;
  targetVu = clamp(activeSlice.vu + flutter, 0.1, 0.98);
  currentVu = calm ? targetVu : currentVu + (targetVu - currentVu) * (1 - Math.exp(-dt / 0.12));

  draw();

  const settled = !touring && currentX === targetX && Math.abs(currentVu - targetVu) < 0.01;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}

const run = () => {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
};

const steer = (next) => {
  touring = false;
  targetX = clamp(next, REACH[0], REACH[1]);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    touring = !still.matches;
    clock = 0;
    run();
  }, 4000);
  run();
};

new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);

if (still.matches) touring = false;

stage.addEventListener("pointermove", (e) => {
  const box = svg.getBoundingClientRect();
  const share = clamp(((e.clientX - box.left) / box.width - 0.2) / 0.6, 0, 1);
  steer(REACH[0] + share * (REACH[1] - REACH[0]));
});

stage.addEventListener("pointerleave", () => steer(targetX));

stage.addEventListener("keydown", (e) => {
  const here = STOPS.reduce((best, stop, idx) => (Math.abs(stop - targetX) < Math.abs(STOPS[best] - targetX) ? idx : best), 0);
  let to = null;
  if (e.key === "ArrowRight" || e.key === "ArrowUp") to = Math.min(STOPS.length - 1, here + 1);
  if (e.key === "ArrowLeft" || e.key === "ArrowDown") to = Math.max(0, here - 1);
  if (e.key === "Home") to = 0;
  if (e.key === "End") to = STOPS.length - 1;
  if (to === null) return;
  e.preventDefault();
  steer(STOPS[to]);
});

draw();
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "Virtual Track Slicer Console",
  hint: "Hover or use arrow keys to scrub audio slices",
  readout: `${SLICES[0].name} · ${SLICES[0].from} ➔ ${SLICES[0].to} · VU 65%`,
  keys: [
    { mark: "lit", label: "Slicing carriage & guillotine blade: marks in/out cue points along track" },
    { mark: "raised", label: "Reel-to-reel tape transport with magnetic head & analog VU meter" },
  ],
  caption:
    "Anatomy of the Slice Player track cutting engine. The full song tape passes through the magnetic reading block; moving the sliding micrometer carriage sets the virtual slice boundaries, auditioning trimmed segments instantly without modifying the source audio file.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Slice Player tape splicer: arrow keys scrub slices" aria-valuemin="1" aria-valuemax="4" aria-valuenow="1">${svg}</div>`,
});

const outPath = join(OUT_DIR, theme === "light" ? "slice-tape-splicer-light.html" : "slice-tape-splicer.html");
writeFileSync(outPath, k.pageHtml({ title: "Slice Player - Tape Splicer Anatomy", theme, body, script: kitScript() + live }));
console.log("wrote", outPath);
