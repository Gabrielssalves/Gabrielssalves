// scripts/lib/session-svg.mjs
//
// Renders the whole profile as ONE looping terminal session: a single window,
// starship-style prompts typed out with a caret (SVG clip-path typewriter),
// each command's output "printed" as a block once typing finishes, and a
// blinking cursor that parks at the end of the session. Pure SMIL animation
// (<animate>/<animateTransform>) — no JS, no external renderer.
//
// Two-pass build: pass 1 walks the content top-to-bottom accumulating both a
// `y` cursor (pixel layout) and a `t` cursor (seconds, for the animation
// timeline); pass 2 knows the grand total duration, so it converts every
// absolute time into a 0..1 keyTime fraction and emits markup.

export const palette = {
  bg: "#1a1b26",
  surface: "#1f2335",
  surface2: "#24283b",
  surface3: "#2f334d",
  border: "#292e42",
  text: "#c0caf5",
  textMuted: "#9aa5ce",
  textFaint: "#565f89",
  blue: "#7aa2f7",
  cyan: "#7dcfff",
  purple: "#bb9af7",
  green: "#9ece6a",
  yellow: "#e0af68",
  orange: "#ff9e64",
  red: "#f7768e",
};
const p = palette;

const W = 720;
const PAD_X = 24;
const TITLEBAR_H = 40;
const BODY_TOP = 24;
const BODY_BOTTOM = 28;
const CONTENT_W = W - PAD_X * 2;

const FONT = 13.5;
const CHAR_W = FONT * 0.6;
const PROMPT_ROW_H = 24;
const PROMPT_GAP = 12;

const SMALL_FONT = 12.5;
const SMALL_CHAR_W = SMALL_FONT * 0.62;
const KV_ROW_H = 19;

const CODE_FONT = 13;
const CODE_CHAR_W = CODE_FONT * 0.6;
const CODE_ROW_H = 20;
const GUTTER_W = 30;

const TEXT_ROW_H = 20;
const CAPTION_FONT = 11.5;

const BADGE_H = 24;
const BADGE_ROW_H = 32;
const BADGE_FONT = 11;
const BADGE_CHAR_W = BADGE_FONT * 0.66;
const BADGE_PAD_X = 10;
const BADGE_GAP = 7;

const BLOCK_GAP = 26;

const TYPE_CPS = 8;
const CHAR_JITTER_MIN = 0.6;
const CHAR_JITTER_MAX = 1.8;
const HESITATION_CHANCE = 0.08;
const HESITATION_MIN = 0.15;
const HESITATION_MAX = 0.4;
const MIN_TYPE = 0.6;
const PAUSE_AFTER_TYPE = 0.4;
const RAMP = 0.15;
const DWELL_BEFORE_TYPE = 0.6;
const HOLD_AT_END = 14.0;
const BLINK_PERIOD = "0.9s";
const EPS = 0.0006;

// Cumulative per-character reveal times (seconds, relative to typing start)
// with randomized jitter and occasional hesitations, so typing reads like a
// human at a keyboard rather than a constant-speed machine sweep.
function buildCharTimeline(command, cps) {
  const base = 1 / cps;
  let t = 0;
  const times = [];
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    let interval = base * (CHAR_JITTER_MIN + Math.random() * (CHAR_JITTER_MAX - CHAR_JITTER_MIN));
    if (ch === " ") interval *= 1.3;
    if (Math.random() < HESITATION_CHANCE) interval += HESITATION_MIN + Math.random() * (HESITATION_MAX - HESITATION_MIN);
    t += Math.max(interval, 0.02);
    times.push(t);
  }
  let typeDur = times.length ? times[times.length - 1] : 0;
  if (typeDur < MIN_TYPE) {
    const scale = typeDur > 0 ? MIN_TYPE / typeDur : 1;
    for (let i = 0; i < times.length; i++) times[i] *= scale;
    typeDur = MIN_TYPE;
  }
  return { times, typeDur };
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function seg(text, color) {
  return { t: text, c: color };
}

function segsWidth(segments, charW) {
  return segments.reduce((n, s) => n + s.t.length, 0) * charW;
}

function tspans(segments) {
  return segments.map((s) => `<tspan fill="${s.c}">${esc(s.t)}</tspan>`).join("");
}

// ---------- pass 1: layout + timeline ----------

function layoutBadgeRows(labels) {
  const rows = [];
  let row = [];
  let x = 0;
  for (const label of labels) {
    const w = label.text.length * BADGE_CHAR_W + BADGE_PAD_X * 2;
    if (x + w > CONTENT_W && row.length) {
      rows.push(row);
      row = [];
      x = 0;
    }
    row.push({ ...label, w, x });
    x += w + BADGE_GAP;
  }
  if (row.length) rows.push(row);
  return rows;
}

function buildPlan(stats) {
  let y = TITLEBAR_H + BODY_TOP;
  let t = 0.2;
  const stages = [];

  function addStage({ path, command, contentHeight, render, topPad = 0 }) {
    const promptY = y + PROMPT_ROW_H - 6;
    const prefix = [seg("gabriel@arch", p.blue), seg(" ", p.text), seg(path, p.purple), seg(" ", p.text), seg("❯ ", p.green)];
    const prefixWidth = segsWidth(prefix, CHAR_W);
    const promptX = PAD_X + prefixWidth;
    const cmdWidth = command.length * CHAR_W + 5;

    // The prompt line itself appears the instant the previous stage's
    // output is done rendering (real terminals don't delay this); only the
    // typing is held back a beat, as if the user paused before typing.
    const tPromptShow = t;
    const { times: charOffsets, typeDur } = buildCharTimeline(command, TYPE_CPS);
    const tStart = tPromptShow + DWELL_BEFORE_TYPE;
    const tTypeEnd = tStart + typeDur;
    const tOutput = tTypeEnd + PAUSE_AFTER_TYPE;
    const charTimes = charOffsets.map((off) => tStart + off);

    const contentY = y + PROMPT_ROW_H + PROMPT_GAP + topPad;
    stages.push({
      kind: "stage",
      promptX,
      promptY,
      prefix,
      command,
      cmdWidth,
      charTimes,
      tPromptShow,
      tStart,
      tTypeEnd,
      tOutput,
      contentY,
      contentHeight,
      render,
    });

    y = contentY + contentHeight + BLOCK_GAP;
    t = tOutput;
  }

  // fastfetch
  {
    const kv = [
      ["os", "Backend Developer"],
      ["host", "C# · .NET · Node.js"],
      ["kernel", "TypeScript 5.x"],
      ["shell", "REST APIs & Clean Architecture"],
      ["editor", "neovim"],
      ["term", "kitty"],
    ];
    const swatchColors = [p.bg, p.red, p.green, p.yellow, p.blue, p.purple, p.cyan, p.text];
    const kvHeight = kv.length * KV_ROW_H;
    const swatchGap = 14;
    const contentHeight = kvHeight + swatchGap + 16;

    addStage({
      path: "~",
      command: "fastfetch",
      contentHeight,
      render: (x, cy) => {
        let out = "";
        // 4x4 logo grid to the left
        const cell = 11, gap = 3;
        const gridColors = [
          p.blue, p.purple, p.surface2, p.green,
          p.purple, p.text, p.blue, p.surface2,
          p.surface2, p.blue, p.text, p.purple,
          p.green, p.surface2, p.purple, p.blue,
        ];
        for (let i = 0; i < 16; i++) {
          const col = i % 4, row = Math.floor(i / 4);
          out += `<rect x="${x + col * (cell + gap)}" y="${cy + row * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${gridColors[i]}"/>`;
        }
        const infoX = x + 4 * (cell + gap) + 18;
        kv.forEach(([k, v], i) => {
          const ky = cy + 10 + i * KV_ROW_H;
          out += `<text x="${infoX}" y="${ky}" font-size="${SMALL_FONT}"><tspan fill="${p.purple}">${esc(k.padEnd(7))}</tspan><tspan fill="${p.textFaint}">: </tspan><tspan fill="${p.textMuted}">${esc(v)}</tspan></text>`;
        });
        const swY = cy + kvHeight + swatchGap;
        swatchColors.forEach((c, i) => {
          out += `<rect x="${x + i * 20}" y="${swY}" width="15" height="15" rx="3" fill="${c}" stroke="${p.border}"/>`;
        });
        return out;
      },
    });
  }

  // nvim about.cs
  {
    const codeLines = [
      [seg("public", p.purple), seg(" class ", p.purple), seg("Gabriel", p.cyan), seg(" : ", p.textFaint), seg("BackendDeveloper", p.cyan)],
      [seg("{", p.textFaint)],
      [seg("    public", p.purple), seg(" string", p.purple), seg(" Role", p.textMuted), seg(" => ", p.textFaint), seg('"Backend Developer"', p.green), seg(";", p.textFaint)],
      [seg("    public", p.purple), seg(" string", p.purple), seg("[] CoreStack", p.textMuted), seg(" => ", p.textFaint), seg("new", p.purple), seg("[] { ", p.textFaint), seg('"C#", ', p.green), seg('".NET", ', p.green), seg('"Node.js", ', p.green), seg('"TypeScript"', p.green), seg(" };", p.textFaint)],
      [seg("    public", p.purple), seg(" string", p.purple), seg(" Focus", p.textMuted), seg(" => ", p.textFaint), seg('"Scalable APIs, code that survives review"', p.green), seg(";", p.textFaint)],
      [],
      [seg("    public", p.purple), seg(" void", p.purple), seg(" SayHi", p.textMuted), seg("() => ", p.textFaint), seg("Console", p.cyan), seg(".WriteLine(", p.textFaint), seg('"Welcome 👋"', p.green), seg(");", p.textFaint)],
      [seg("}", p.textFaint)],
    ];
    const codeHeight = codeLines.length * CODE_ROW_H;
    const statusGapTop = 10;
    const contentHeight = codeHeight + statusGapTop + BADGE_H;

    addStage({
      path: "~/profile",
      command: "nvim about.cs",
      contentHeight,
      topPad: 14,
      render: (x, cy) => {
        let out = `<rect x="${x - 10}" y="${cy - 14}" width="${CONTENT_W + 20}" height="${codeHeight + 10}" rx="6" fill="${p.surface2}"/>`;
        codeLines.forEach((segments, i) => {
          const ly = cy + i * CODE_ROW_H;
          out += `<text x="${x}" y="${ly}" font-size="${SMALL_FONT}" text-anchor="end" fill="${p.textFaint}">${i + 1}</text>`;
          out += `<text x="${x + GUTTER_W}" y="${ly}" font-size="${CODE_FONT}">${tspans(segments)}</text>`;
        });
        const sy = cy + codeHeight + statusGapTop;
        out += `<rect x="${x - 10}" y="${sy - 15}" width="${CONTENT_W + 20}" height="${BADGE_H}" fill="${p.surface3}"/>`;
        out += `<rect x="${x + GUTTER_W}" y="${sy - 14}" width="52" height="16" rx="3" fill="${p.green}"/>`;
        out += `<text x="${x + GUTTER_W + 26}" y="${sy - 2}" font-size="10.5" font-weight="700" text-anchor="middle" fill="${p.bg}">NORMAL</text>`;
        out += `<text x="${x + GUTTER_W + 88}" y="${sy - 2}" font-size="11" fill="${p.textMuted}">about.cs [+]</text>`;
        out += `<text x="${x + CONTENT_W - 10}" y="${sy - 2}" font-size="11" text-anchor="end"><tspan fill="${p.textFaint}">utf-8[unix] · 1,1 · </tspan><tspan fill="${p.yellow}">main</tspan></text>`;
        return out;
      },
    });
  }

  // stack.config.js badges
  {
    const badges = [
      ["C#", "#239120"], [".NET", "#512bd4"], ["ASP.NET Core", "#512bd4"], ["Node.js", "#339933"],
      ["Express", "#000000"], ["TypeScript", "#3178c6"], ["PostgreSQL", "#4169e1"], ["SQL Server", "#cc2927"],
      ["MongoDB", "#47a248"], ["Docker", "#2496ed"], ["Git", "#f05032"],
    ].map(([text, color]) => ({ text, color }));
    const rows = layoutBadgeRows(badges);
    const contentHeight = rows.length * BADGE_ROW_H;

    addStage({
      path: "~/profile",
      command: "npm run stack",
      contentHeight,
      render: (x, cy) => {
        let out = "";
        rows.forEach((row, ri) => {
          const ry = cy + ri * BADGE_ROW_H;
          for (const b of row) {
            out += `<rect x="${x + b.x}" y="${ry}" width="${b.w}" height="${BADGE_H}" rx="4" fill="${b.color}"${b.color === "#000000" ? ` stroke="${p.border}"` : ""}/>`;
            out += `<text x="${x + b.x + b.w / 2}" y="${ry + BADGE_H / 2 + 4}" font-size="${BADGE_FONT}" font-weight="700" text-anchor="middle" fill="#ffffff" letter-spacing="0.02em">${esc(b.text.toUpperCase())}</text>`;
          }
        });
        return out;
      },
    });
  }

  // status.log
  {
    const rows = [
      ["🔭  working on   : ", "[seu projeto atual]"],
      ["🌱  learning     : ", "[ex. hexagonal architecture]"],
      ["💬  ask me about : ", "C#, .NET, Node.js, REST APIs"],
      ["📫  reach me     : ", "seu@email.com"],
    ];
    const contentHeight = rows.length * TEXT_ROW_H;
    addStage({
      path: "~/profile",
      command: "cat status.log",
      contentHeight,
      render: (x, cy) => {
        let out = "";
        rows.forEach(([label, value], i) => {
          const ly = cy + i * TEXT_ROW_H;
          out += `<text x="${x}" y="${ly}" font-size="${CODE_FONT}"><tspan fill="${p.textMuted}">${esc(label)}</tspan><tspan fill="${p.text}" font-weight="600">${esc(value)}</tspan></text>`;
        });
        return out;
      },
    });
  }

  // profile/stats.log (dynamic)
  {
    const rows = [
      ["stars      : ", String(stats.stars)],
      ["last year  : ", `${stats.lastYear} contributions`],
      ["streak     : ", `${stats.streak} day${stats.streak === 1 ? "" : "s"}`],
      ["top langs  : ", stats.topLangs],
    ];
    const contentHeight = rows.length * TEXT_ROW_H + 24;
    addStage({
      path: "~/profile",
      command: "cat profile/stats.log",
      contentHeight,
      render: (x, cy) => {
        let out = "";
        rows.forEach(([label, value], i) => {
          const ly = cy + i * TEXT_ROW_H;
          out += `<text x="${x}" y="${ly}" font-size="${CODE_FONT}"><tspan fill="${p.textMuted}">${esc(label)}</tspan><tspan fill="${p.text}" font-weight="600">${esc(value)}</tspan></text>`;
        });
        const capY = cy + rows.length * TEXT_ROW_H + 14;
        return out;
      },
    });
  }

  // final empty prompt with resting cursor
  const finalPromptY = y + PROMPT_ROW_H - 6;
  const finalPrefix = [seg("gabriel@arch", p.blue), seg(" ", p.text), seg("~/profile", p.purple), seg(" ", p.text), seg("❯ ", p.green)];
  const finalX = PAD_X + segsWidth(finalPrefix, CHAR_W);
  const finalStart = t;
  y = y + PROMPT_ROW_H + BODY_BOTTOM;
  const total = finalStart + HOLD_AT_END;

  return { stages, finalPromptY, finalPrefix, finalX, finalStart, total, height: y };
}

// ---------- pass 2: render with fractions ----------

function frac(tSec, total) {
  const f = Math.max(0, Math.min(1, tSec / total));
  return f;
}

function kt(list) {
  // ensure strictly increasing keyTimes
  const out = [];
  let prev = -1;
  for (let v of list) {
    v = Math.max(0, Math.min(1, v));
    if (v <= prev) v = Math.min(1, prev + EPS);
    out.push(v);
    prev = v;
  }
  return out.map((v) => v.toFixed(4)).join(";");
}

function revealGroup(inner, startFrac, total, ramp = RAMP) {
  const r = ramp / total;
  const times = kt([0, startFrac - EPS, startFrac + r, 1]);
  return `<g><animate attributeName="opacity" values="0;0;1;1" keyTimes="${times}" dur="${total.toFixed(3)}s" begin="0s" repeatCount="indefinite"/>${inner}</g>`;
}

function typedCommand(stage, total) {
  const { promptX, promptY, command, cmdWidth, tStart, charTimes } = stage;
  const s0 = frac(tStart, total);
  const clipId = `clip-${Math.round(promptX)}-${Math.round(promptY)}`;
  const n = command.length;
  const keyTimesArr = [0, s0 - EPS];
  const valuesArr = [0, 0];
  for (let i = 0; i < n; i++) {
    keyTimesArr.push(frac(charTimes[i], total));
    valuesArr.push(i === n - 1 ? cmdWidth : (i + 1) * CHAR_W);
  }
  keyTimesArr.push(1);
  valuesArr.push(n ? cmdWidth : 0);
  const widthTimes = kt(keyTimesArr);
  const widthValues = valuesArr.map((v) => v.toFixed(2)).join(";");
  return `
    <clipPath id="${clipId}">
      <rect x="${promptX}" y="${promptY - FONT}" height="${FONT + 6}" width="0">
        <animate attributeName="width" calcMode="discrete" values="${widthValues}" keyTimes="${widthTimes}" dur="${total.toFixed(3)}s" begin="0s" repeatCount="indefinite"/>
      </rect>
    </clipPath>
    <text x="${promptX}" y="${promptY}" font-size="${FONT}" fill="${p.text}" clip-path="url(#${clipId})">${esc(command)}</text>`;
}

function typingCursor(stage, total) {
  const { promptX, promptY, cmdWidth, command, tPromptShow, tOutput, charTimes } = stage;
  const sShow = frac(tPromptShow, total);
  const s2 = frac(tOutput, total);
  const n = command.length;

  const xKeyTimes = [0, sShow - EPS];
  const xValues = [promptX, promptX];
  for (let i = 0; i < n; i++) {
    xKeyTimes.push(frac(charTimes[i], total));
    xValues.push(promptX + (i === n - 1 ? cmdWidth : (i + 1) * CHAR_W));
  }
  xKeyTimes.push(s2);
  xValues.push(promptX + cmdWidth);
  xKeyTimes.push(1);
  xValues.push(promptX);

  const xTimes = kt(xKeyTimes);
  const xVals = xValues.map((v) => v.toFixed(1)).join(";");
  const yVals = xValues.map(() => promptY.toFixed(1)).join(";");
  const visTimes = kt([0, sShow - EPS, sShow, s2, s2 + EPS, 1]);
  return `
    <g>
      <animate attributeName="x" calcMode="discrete" values="${xVals}" keyTimes="${xTimes}" dur="${total.toFixed(3)}s" begin="0s" repeatCount="indefinite"/>
      <animate attributeName="y" values="${yVals}" keyTimes="${xTimes}" dur="${total.toFixed(3)}s" begin="0s" repeatCount="indefinite"/>
      <g>
        <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="${visTimes}" dur="${total.toFixed(3)}s" begin="0s" repeatCount="indefinite"/>
        <rect width="7" height="15" y="-13" fill="${p.green}"/>
      </g>
    </g>`;
}

export function renderSession(stats) {
  const plan = buildPlan(stats);
  const { stages, total, height, finalPromptY, finalPrefix, finalX, finalStart } = plan;

  let body = "";
  for (const stage of stages) {
    const prefixText = `<text x="${PAD_X}" y="${stage.promptY}" font-size="${FONT}" font-weight="600">${tspans(stage.prefix)}</text>`;
    body += revealGroup(prefixText, frac(stage.tPromptShow, total), total, 0.02);
    body += typedCommand(stage, total);
    body += typingCursor(stage, total);
    const outputInner = stage.render(PAD_X, stage.contentY);
    body += revealGroup(outputInner, frac(stage.tOutput, total), total);
  }

  // final resting prompt + cursor — revealed together, same as every other stage
  const finalInner = `
      <text x="${PAD_X}" y="${finalPromptY}" font-size="${FONT}" font-weight="600">${tspans(finalPrefix)}</text>
      <rect x="${finalX}" y="${finalPromptY - 13}" width="7" height="15" fill="${p.green}">
        <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.55;1" dur="${BLINK_PERIOD}" begin="0s" repeatCount="indefinite"/>
      </rect>`;
  body += revealGroup(finalInner, frac(finalStart, total), total, 0.02);

  const H = height;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="'JetBrains Mono','Fira Code',Menlo,Consolas,'Liberation Mono',monospace" xml:space="preserve">
  <defs>
    <clipPath id="win-round"><rect x="0" y="0" width="${W}" height="${H}" rx="12"/></clipPath>
  </defs>
  <g clip-path="url(#win-round)">
    <rect x="0" y="0" width="${W}" height="${H}" fill="${p.bg}"/>
    <rect x="0" y="0" width="${W}" height="${TITLEBAR_H}" fill="${p.surface2}"/>
    <rect x="20" y="${TITLEBAR_H / 2 - 8}" width="3" height="16" rx="1.5" fill="${p.blue}"/>
    <text x="34" y="${TITLEBAR_H / 2 + 4}" font-size="12" fill="${p.textMuted}">~/profile</text>
    <text x="${W - 20}" y="${TITLEBAR_H / 2 + 4}" font-size="11.5" text-anchor="end" fill="${p.textFaint}">zsh</text>
    ${body}
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${p.border}"/>
</svg>
`;
}
