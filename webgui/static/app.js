"use strict";

/* ------------------------------------------------------------------ */
/* constants                                                          */
/* ------------------------------------------------------------------ */

const ATTACK_MS = [0.2, 0.5, 1, 2, 4, 6, 8, 10, 15, 20, 25, 30, 35, 40, 45,
                   50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
const RELEASE_MS = [10, 12, 15, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65,
                    70, 75, 80, 85, 90, 95, 100, 110, 120, 130, 140, 150,
                    160, 170, 180, 190, 200, 220, 240, 260, 280, 300, 320,
                    340, 360, 380, 400, 420, 440, 460, 480, 500];
const RATIOS = ["1:1.0", "1:1.2", "1:1.5", "1:2.0", "1:2.8", "1:4.0",
                "1:8.0", "1:16", "1:INF"];
const RATIO_VALUES = [1, 1.2, 1.5, 2, 2.8, 4, 8, 16, Infinity];
const METER_NAMES = ["IN 1", "IN 2", "COMP OUT 1", "COMP OUT 2",
                     "OUTPUT L", "OUTPUT R", "GR COMP 1", "GR COMP 2"];

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (v) => typeof v === "number" && isFinite(v);
const meterVal = (st, i) => (st && st.meters && st.meters[i]) || 0;
const mixVal = (st, k) => (st && st.state && st.state.mix[k]) || 0;

window.addEventListener("error", (e) => {
  const msg = document.getElementById("statusmsg");
  if (msg) msg.textContent = "JS error: " + (e.message || e.type);
});

const sensDb = (v) => (v / 2).toFixed(1);
const gateDb = (v) => (v === 0 ? "-INF" : (v - 70) + " dB");
const thrDb = (v) => (v - 50) + " dB";
const gainDb = (v) => (v - 50 > 0 ? "+" : "") + (v - 50) + " dB";
const attackMs = (v) => ATTACK_MS[v] + " ms";
const releaseMs = (v) => RELEASE_MS[v] + " ms";
const ratioLabel = (v) => RATIOS[v];
const mixDb = (v) => (v <= 0 ? "-INF"
  : (20 * Math.log10(v / 0x200000)).toFixed(1) + " dB");

const state = {
  status: null,
  extra: { digital_in: null, autosens_mode: null, meter: null },
  mode: localStorage.getItem("qc-mode") === "adv" ? "adv" : "std",
};

/* ------------------------------------------------------------------ */
/* API + serialized writes                                            */
/* ------------------------------------------------------------------ */

async function api(path, body) {
  const opt = { signal: AbortSignal.timeout(8000) };
  if (body !== undefined) {
    opt.method = "POST";
    opt.headers = { "Content-Type": "application/json" };
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  let j;
  try { j = await r.json(); } catch (e) { throw new Error("bad reply"); }
  if (!r.ok || j.error) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}

const pendingWrites = new Map();
let writing = false;
function queueWrite(name, value) {
  pendingWrites.set(name, value);
  if (!writing) void flushWrites();
}
async function flushWrites() {
  writing = true;
  while (pendingWrites.size) {
    const [name, value] = pendingWrites.entries().next().value;
    pendingWrites.delete(name);
    try {
      await api("/api/param", { name, value });
    } catch (e) {
      setMsg("Ошибка записи: " + e.message);
    }
  }
  writing = false;
}

/* ------------------------------------------------------------------ */
/* widgets                                                            */
/* ------------------------------------------------------------------ */

const knobCtl = [];
const buttonCtl = [];
const meterCtl = [];
const curveCtl = [];

function makeKnob(o) {
  const knob = el("div", "knob" + (o.small ? " small" : ""));
  const val = el("div", "kval");
  let value = o.value ?? o.min;
  let dragging = false;
  let startY = 0;
  let startVal = 0;

  const ctl = {
    el: knob,
    val,
    get value() { return value; },
    get: o.get,
    dragging: false,
    holdUntil: 0,
    setFrom(v) {
      if (v === null || v === undefined) return;
      if (ctl.dragging || Date.now() < ctl.holdUntil) return;
      set(v, false);
    },
  };

  function render() {
    const t = o.max === o.min ? 0 : (value - o.min) / (o.max - o.min);
    knob.style.setProperty("--a", (-135 + 270 * t) + "deg");
    val.textContent = o.format ? o.format(value) : String(value);
  }
  function set(v, fire) {
    v = clamp(Math.round(v / o.step) * o.step, o.min, o.max);
    const changed = v !== value;
    value = v;
    render();
    if (fire && (changed || o.alwaysFire)) {
      ctl.holdUntil = Date.now() + 900;
      o.onChange(value);
    }
  }

  knob.addEventListener("pointerdown", (e) => {
    ctl.dragging = true;
    dragging = true;
    startY = e.clientY;
    startVal = value;
    knob.setPointerCapture(e.pointerId);
    knob.classList.add("active");
    e.preventDefault();
  });
  knob.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const span = o.max - o.min;
    const travel = o.small ? 110 : 160;
    const dv = (startY - e.clientY) * span / travel;
    set(startVal + Math.round(dv / o.step) * o.step, true);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    ctl.dragging = false;
    knob.classList.remove("active");
    o.onChange(value);
  };
  knob.addEventListener("pointerup", end);
  knob.addEventListener("pointercancel", end);
  knob.addEventListener("wheel", (e) => {
    e.preventDefault();
    set(value + (e.deltaY < 0 ? o.step : -o.step), true);
  }, { passive: false });
  knob.addEventListener("dblclick", () => {
    if (typeof o.def === "number") set(o.def, true);
  });

  render();
  knobCtl.push(ctl);
  return ctl;
}

function makeToggle(name, label, cls, isOn, writeOn = 1, writeOff = 0) {
  const b = el("button", "btn " + cls, label);
  b.addEventListener("click", () => {
    queueWrite(name, isOn(state.status) ? writeOn : writeOff);
  });
  const ctl = {
    el: b,
    update(st) { b.classList.toggle("on", !!isOn(st)); },
  };
  buttonCtl.push(ctl);
  return ctl;
}

function makeMomentary(label, cls, name, isActive) {
  const b = el("button", "btn " + cls, label);
  b.addEventListener("click", () => queueWrite(name, 1));
  const ctl = {
    el: b,
    update(st) { b.classList.toggle("on", !!isActive(st)); },
  };
  buttonCtl.push(ctl);
  return ctl;
}

function makeVMeter(o) {
  const wrap = el("div", "meterwrap");
  const meter = el("div", "vmeter" + (o.top ? " top" : ""));
  const fill = el("div", "vfill");
  meter.append(fill);
  const scale = el("div", "mscale");
  for (const s of o.scale || []) scale.append(el("div", null, s));
  wrap.append(meter, scale);

  const ctl = {
    el: wrap,
    update(st) {
      const v = o.get(st) || 0;
      const db = v > 0 ? 20 * Math.log10(v / 16383) : -Infinity;
      let pct;
      let clip = false;
      if (o.gr) {
        const red = v >= 16383 ? 0 : Math.max(0, -db);
        pct = clamp(red / 48 * 100, 0, 100);
      } else {
        pct = isFinite(db) ? clamp((db + 60) / 60 * 100, 0, 100) : 0;
        clip = db > -0.5;
      }
      fill.style.height = pct + "%";
      fill.classList.toggle("clip", clip);
    },
  };
  meterCtl.push(ctl);
  return ctl;
}

function makeHBar(o) {
  const row = el("div", "lvlrow");
  const name = el("div", "lname", o.label);
  const bar = el("div", "hbar");
  const fill = el("div", "hfill");
  bar.append(fill);
  const dbEl = el("div", "db", "—");
  row.append(name, bar, dbEl);

  const ctl = {
    el: row,
    update(st) {
      if (o.kind === "none") {
        fill.style.width = "0";
        dbEl.textContent = "—";
        return;
      }
      const v = o.get(st) || 0;
      let db;
      let pct;
      if (o.kind === "mix") {
        db = v > 0 ? 20 * Math.log10(v / 0x200000) : -Infinity;
        pct = isFinite(db) ? clamp((db + 60) / 72 * 100, 0, 100) : 0;
      } else {
        db = v > 0 ? 20 * Math.log10(v / 16383) : -Infinity;
        pct = isFinite(db) ? clamp((db + 60) / 60 * 100, 0, 100) : 0;
      }
      fill.style.width = pct + "%";
      dbEl.textContent = isFinite(db) ? db.toFixed(1) : "-INF";
      fill.classList.toggle("clip", o.kind === "meter" && db > -0.5);
    },
  };
  meterCtl.push(ctl);
  return ctl;
}

function makeCurve(ch) {
  const box = el("div", "curvebox");
  const canvas = document.createElement("canvas");
  box.append(canvas);
  let lastKey = "";
  let lastW = 0;

  function draw(st) {
    if (!st.state) return;
    const s = st.state;
    const key = s.threshold["in" + ch] + ":" + s.ratio["in" + ch] + ":" +
                s.comp["in" + ch];
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(100, Math.round(rect.width));
    if (key === lastKey && w === lastW) return;
    lastKey = key;
    lastW = w;
    const h = Math.round(w * 0.55);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = h + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 17, padR = 4, padT = 4, padB = 13;
    const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
    const px = (v) => x0 + (v + 60) / 60 * (x1 - x0);
    const py = (v) => y1 - (v + 60) / 60 * (y1 - y0);

    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    for (let v = -60; v <= 0; v += 12) {
      ctx.beginPath(); ctx.moveTo(px(v), y0); ctx.lineTo(px(v), y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, py(v)); ctx.lineTo(x1, py(v)); ctx.stroke();
    }
    ctx.fillStyle = "#777";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    for (let v = -60; v <= 0; v += 12) ctx.fillText(String(v), px(v), h - 3);
    ctx.textAlign = "right";
    for (let v = -60; v <= 0; v += 12) ctx.fillText(String(v), x0 - 2, py(v) + 2);

    ctx.strokeStyle = "#4a4a4a";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(px(-60), py(-60));
    ctx.lineTo(px(0), py(0));
    ctx.stroke();
    ctx.setLineDash([]);

    const T = s.threshold["in" + ch] - 50;
    const ratio = RATIO_VALUES[s.ratio["in" + ch]] || 1;
    const f = (x) => (x <= T ? x : T + (x - T) / ratio);

    ctx.beginPath();
    ctx.moveTo(px(T), py(T));
    for (let x = T; x <= 0; x += 0.5) ctx.lineTo(px(x), py(f(x)));
    ctx.lineTo(px(0), py(0));
    ctx.closePath();
    ctx.fillStyle = "rgba(232,163,61,.32)";
    ctx.fill();

    ctx.beginPath();
    for (let x = -60; x <= 0; x += 0.5) {
      const X = px(x), Y = py(f(x));
      if (x === -60) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = "#e8a33d";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px(T), y0);
    ctx.lineTo(px(T), y1);
    ctx.stroke();
  }

  const ctl = { el: box, draw };
  curveCtl.push(ctl);
  return ctl;
}

/* ------------------------------------------------------------------ */
/* standard view                                                      */
/* ------------------------------------------------------------------ */

function buildStandard() {
  const preamp = $("#preamp");
  for (const ch of [1, 2]) {
    const strip = el("div", "strip");
    const num = el("div", "chnum", String(ch));
    const body = el("div", "pbody");
    const ctl = el("div", "pctl");
    const btnrow = el("div", "pbtnrow");
    const lowcut = makeToggle("lowcut" + ch, "LO-CUT", "pink",
      (st) => st.state.lowcut["in" + ch]);
    const phase = makeToggle("phase" + ch, "PHASE", "pink",
      (st) => st.state.phase["in" + ch]);
    btnrow.append(lowcut.el, phase.el);

    const sens = makeKnob({
      name: "sens" + ch, min: 0, max: 108, step: 1, format: sensDb,
      get: (st) => st.state.sens["in" + ch],
      onChange: (v) => queueWrite("sens" + ch, v),
    });
    const sensrow = el("div", "sensrow");
    sensrow.append(sens.val, sens.el);
    const sensbox = el("div", "sensbox");
    sensbox.append(el("div", "klabel", "SENS"), sensrow);

    const autosens = makeMomentary("AUTO SENS", "pink", "autosens",
      (st) => st.state.autosens === 2);
    autosens.el.title = "Start / stop AUTO-SENS measurement";

    ctl.append(btnrow, sensbox, autosens.el);

    const clip = makeVMeter({
      get: (st) => meterVal(st, ch - 1),
      scale: ["-2", "-6", "-12", "-24", "-48"],
    });
    const clipwrap = el("div", "clipmeter");
    clipwrap.append(el("div", "cliplabel", "CLIP"), clip.el);

    body.append(ctl, clipwrap);
    strip.append(num, body);
    preamp.append(strip);
  }

  const comp = $("#compressor");
  const knobDefs = [
    ["gate", "GATE", 0, 50, gateDb, 0],
    ["threshold", "THRESHOLD", 0, 50, thrDb, 30],
    ["ratio", "RATIO", 0, 8, ratioLabel, 5],
    ["attack", "ATTACK", 0, 25, attackMs, 3],
    ["release", "RELEASE", 0, 45, releaseMs, 30],
    ["gain", "GAIN", 0, 74, gainDb, 50],
  ];
  for (const ch of [1, 2]) {
    const cs = el("div", "cstrip");
    const top = el("div", "ctop");

    const bypass = makeToggle("comp" + ch, "BYPASS", "yellow",
      (st) => !st.state.comp["in" + ch], 1, 0);
    const bypbox = el("div", "bypassbox");
    bypbox.append(el("div", "chmini", "CH " + ch), bypass.el);

    const gr = makeVMeter({
      get: (st) => meterVal(st, 6 + ch - 1),
      scale: ["0", "-6", "-12", "-24", "-48"],
      gr: true, top: true,
    });
    const grbox = el("div", "grbox");
    grbox.append(el("div", "cliplabel", "GR"), gr.el);

    const curve = makeCurve(ch);

    const clip = makeVMeter({
      get: (st) => meterVal(st, ch + 1),
      scale: ["-2", "-6", "-12", "-24", "-48"],
    });
    const clipbox = el("div", "clipmeter");
    clipbox.append(el("div", "cliplabel", "CLIP"), clip.el);

    top.append(bypbox, grbox, curve.el, clipbox);

    const knobs = el("div", "cknobs");
    for (const [key, label, min, max, fmt, def] of knobDefs) {
      const k = makeKnob({
        name: key + ch, min, max, step: 1, def, format: fmt, small: true,
        get: (st) => st.state[key]["in" + ch],
        onChange: (v) => queueWrite(key + ch, v),
      });
      const box = el("div", "cknob");
      box.append(el("div", "klabel", label), k.el, k.val);
      knobs.append(box);
    }

    cs.append(top, knobs);
    comp.append(cs);
  }

  const link = makeToggle("link", "LINK", "yellow", (st) => st.state.link);
  $("#btn-link").replaceWith(link.el);

  const mixer = $("#mixer");
  const out = el("div", "outblock");
  const title = el("div", "outtitle");
  title.append(el("span", null, "OUTPUT 1-2"), el("span", null, "CLIP"));
  const outmeter = makeVMeter({
    get: (st) => Math.max(meterVal(st, 4), meterVal(st, 5)),
    scale: ["-2", "-6", "-12", "-24", "-48"],
  });
  out.append(title, outmeter.el);
  mixer.append(out);

  const mixDefs = [
    ["mix1", "INPUT 1", "in1"],
    ["mix2", "INPUT 2", "in2"],
    ["mix3", "COAX (3/4)", "coax"],
  ];
  for (const [name, label, key] of mixDefs) {
    const k = makeKnob({
      name, min: 0, max: 0x7FFFFF, step: 4096, def: 0x200000,
      format: mixDb,
      get: (st) => mixVal(st, key),
      onChange: (v) => queueWrite(name, v),
    });
    const row = el("div", "mixrow");
    row.append(el("div", "klabel", label), k.el, k.val);
    mixer.append(row);
  }

  buildLevels();
}

function buildLevels() {
  const body = $("#levels-body");
  const group = (title, note, rows) => {
    const g = el("div", "lvl");
    g.append(el("h3", null, title));
    for (const r of rows) g.append(r.el);
    if (note) g.append(el("div", "lvlnote", note));
    body.append(g);
  };

  group("INPUT 1-2 (analog)", null, [
    makeHBar({ get: (st) => meterVal(st, 0), label: "IN 1", kind: "meter" }),
    makeHBar({ get: (st) => meterVal(st, 1), label: "IN 2", kind: "meter" }),
  ]);
  group("INPUT 3-4 (COAX IN)",
    "Прямого метра coax-входа у устройства нет; показан уровень в монитор-миксе.",
    [makeHBar({ get: (st) => mixVal(st, "coax"), label: "MIX", kind: "mix" })]);
  group("MAIN (LOOPBACK, capture 5-6)",
    "Loopback = сумма входов; отдельных метров нет, показаны OUTPUT 1-2.",
    [
      makeHBar({ get: (st) => meterVal(st, 4), label: "L", kind: "meter" }),
      makeHBar({ get: (st) => meterVal(st, 5), label: "R", kind: "meter" }),
    ]);
  group("OUTPUT 1-2 (monitor)",
    "Метры устройства 5/6 после микшера.",
    [
      makeHBar({ get: (st) => meterVal(st, 4), label: "L", kind: "meter" }),
      makeHBar({ get: (st) => meterVal(st, 5), label: "R", kind: "meter" }),
    ]);
  group("OUTPUT 3-4 (COAX OUT)",
    "Метра coax-выхода нет; это каналы playback 3/4 хоста (S/PDIF).",
    [makeHBar({ get: () => null, label: "S/PDIF", kind: "none" })]);
}

/* ------------------------------------------------------------------ */
/* advanced view                                                      */
/* ------------------------------------------------------------------ */

const advCtl = [];
const advMeterCtl = [];
let lastRaw = "";

function badge() {
  const b = el("span", "badge", "!");
  b.title = "Параметр недоступен в стандартной панели";
  return b;
}

function advRange(o) {
  const row = el("div", "prow");
  const name = el("div", "pname", o.label);
  if (o.badge) name.append(badge());
  const addr = el("div", "paddr", o.addr);
  const val = el("div", "pval", "—");
  const ctl = el("div", "pctl");
  const r = document.createElement("input");
  r.type = "range";
  r.min = o.min; r.max = o.max; r.step = o.step || 1;
  r.value = o.min;
  const n = document.createElement("input");
  n.type = "number";
  n.className = "num";
  n.min = o.min; n.max = o.max; n.step = o.step || 1;
  n.value = o.min;
  const unit = el("span", "unit", "");
  ctl.append(r, n, unit);
  row.append(name, addr, val, ctl);

  let holdUntil = 0;
  const show = (v) => {
    val.textContent = v;
    n.value = v;
    unit.textContent = o.unit ? o.unit(v) : "";
  };
  const commit = (v) => {
    v = clamp(Math.round(v / (o.step || 1)) * (o.step || 1), o.min, o.max);
    r.value = v;
    show(v);
    holdUntil = Date.now() + 900;
    queueWrite(o.name, v);
    if (o.after) setTimeout(o.after, 500);
  };
  r.addEventListener("input", () => commit(+r.value));
  n.addEventListener("change", () => commit(+n.value));

  const update = (st) => {
    if (Date.now() < holdUntil) return;
    if (document.activeElement === r || document.activeElement === n) return;
    const v = o.get(st);
    if (v === null || v === undefined) {
      r.disabled = true;
      n.disabled = true;
      return;
    }
    r.disabled = false;
    n.disabled = false;
    r.value = v;
    show(v);
  };
  advCtl.push(update);
  return row;
}

function advBool(o) {
  const row = el("div", "prow");
  const name = el("div", "pname", o.label);
  if (o.badge) name.append(badge());
  const addr = el("div", "paddr", o.addr);
  const val = el("div", "pval", "—");
  const ctl = el("div", "pctl");
  const b = el("button", "btn yellow", "OFF");
  b.addEventListener("click", () => {
    queueWrite(o.name, o.get(state.status) ? 0 : 1);
    if (o.after) setTimeout(o.after, 500);
  });
  ctl.append(b);
  row.append(name, addr, val, ctl);

  const update = (st) => {
    const on = !!o.get(st);
    b.textContent = on ? (o.onText || "ON") : (o.offText || "OFF");
    b.classList.toggle("on", on);
    val.textContent = on ? 1 : 0;
  };
  advCtl.push(update);
  return row;
}

function advMomentary(o) {
  const row = el("div", "prow");
  const name = el("div", "pname", o.label);
  if (o.badge) name.append(badge());
  const addr = el("div", "paddr", o.addr);
  const val = el("div", "pval", "—");
  const ctl = el("div", "pctl");
  const b = el("button", "btn pink", "START / STOP");
  b.addEventListener("click", () => queueWrite(o.name, 1));
  ctl.append(b);
  row.append(name, addr, val, ctl);

  const update = (st) => {
    const s = o.get(st);
    b.classList.toggle("on", s === 2);
    val.textContent = s === 2 ? "measuring" : s === 1 ? "done" : "off";
  };
  advCtl.push(update);
  return row;
}

function buildAdvanced() {
  const box = $("#adv-params");
  const chDefs = [
    ["lowcut", "LO-CUT", "01", "bool"],
    ["phase", "PHASE", "02", "bool"],
    ["sens", "SENS", "04", "range", 0, 108, sensDb],
    ["comp", "COMPRESSOR", "06", "bool"],
    ["gate", "GATE", "07", "range", 0, 50, gateDb],
    ["attack", "ATTACK", "08", "range", 0, 25, attackMs],
    ["release", "RELEASE", "09", "range", 0, 45, releaseMs],
    ["threshold", "THRESHOLD", "0a", "range", 0, 50, thrDb],
    ["ratio", "RATIO", "0b", "range", 0, 8, ratioLabel],
    ["gain", "GAIN", "0c", "range", 0, 74, gainDb],
  ];
  for (const ch of [1, 2]) {
    box.append(el("div", "subhead", "INPUT " + ch));
    const cbyte = ch === 1 ? "00" : "01";
    for (const d of chDefs) {
      const [key, label, ab, type] = d;
      const addr = "00 05 " + cbyte + " " + ab;
      const get = (st) => (st.state ? st.state[key]["in" + ch] : null);
      if (type === "bool") {
        box.append(advBool({ name: key + ch, label, addr, get }));
      } else {
        box.append(advRange({
          name: key + ch, label, addr, min: d[4], max: d[5],
          unit: d[6], get,
        }));
      }
    }
  }

  box.append(el("div", "subhead", "GLOBAL"));
  box.append(advBool({
    name: "link", label: "STEREO LINK", addr: "00 05 00 05",
    get: (st) => (st.state ? st.state.link : null),
  }));
  box.append(advRange({
    name: "output_select", label: "OUTPUT SELECT", addr: "00 03 00 00",
    min: 0, max: 127, unit: () => "raw", badge: true,
    get: (st) => (st.state ? st.state.output_select : null),
  }));
  box.append(advRange({
    name: "digital_in", label: "DIGITAL IN", addr: "00 02 00 04",
    min: 0, max: 127, unit: () => "raw", badge: true,
    get: () => state.extra.digital_in,
    after: refreshExtra,
  }));
  box.append(advRange({
    name: "autosens_mode", label: "AUTO-SENS MODE", addr: "00 02 01 00",
    min: 0, max: 127, unit: () => "raw", badge: true,
    get: () => state.extra.autosens_mode,
    after: refreshExtra,
  }));
  box.append(advRange({
    name: "autosens_margin", label: "AUTO-SENS MARGIN", addr: "00 02 01 01",
    min: 0, max: 127, unit: (v) => v + " dB", badge: true,
    get: (st) => (st.state ? st.state.autosens_margin : null),
  }));
  box.append(advMomentary({
    name: "autosens", label: "AUTO-SENS START/STOP", addr: "00 02 01 02",
    get: (st) => (st.state ? st.state.autosens : 0),
  }));
  box.append(advBool({
    name: "meter", label: "LEVEL METER", addr: "00 0a 00 00",
    get: () => state.extra.meter, badge: true,
    after: refreshExtra,
  }));

  box.append(el("div", "subhead", "MONITOR MIXER"));
  const mixDefs = [
    ["mix1", "INPUT 1 → OUTPUT 1-2", "00 06 00 08", "in1"],
    ["mix2", "INPUT 2 → OUTPUT 1-2", "00 06 01 08", "in2"],
    ["mix3", "COAX → OUTPUT 1-2", "00 06 02 08", "coax"],
  ];
  for (const [name, label, addr, key] of mixDefs) {
    box.append(advRange({
      name, label, addr, min: 0, max: 0x7FFFFF, step: 4096,
      unit: mixDb,
      get: (st) => (st.state ? st.state.mix[key] : null),
    }));
  }

  const meters = $("#adv-meters");
  for (let i = 0; i < 8; i++) {
    const d = el("div", "advmeter");
    const top = el("div", "mtop");
    const name = el("span", null, METER_NAMES[i]);
    const val = el("b", null, "—");
    top.append(name, val);
    const bar = el("div", "bar");
    const fill = el("div");
    bar.append(fill);
    d.append(top, bar);
    meters.append(d);
    advMeterCtl.push({ i, val, fill });
  }
}

function renderAdvanced(st) {
  const clock = st.clock || {};
  $("#adv-rate").textContent = clock.rate ? clock.rate + " Hz" : "—";
  $("#adv-source").textContent = clock.rate
    ? (clock.external ? "EXTERNAL" : "INTERNAL") : "—";
  $("#adv-locked").textContent = clock.rate
    ? (clock.locked ? "yes" : "no") : "—";

  for (const f of advCtl) f(st);

  for (const m of advMeterCtl) {
    const v = (st.meters && st.meters[m.i]) || 0;
    let pct;
    let label;
    if (m.i >= 6) {
      const db = v > 0 ? 20 * Math.log10(v / 16383) : -Infinity;
      const red = v >= 16383 ? 0 : Math.max(0, -db);
      pct = clamp(red / 48 * 100, 0, 100);
      label = v + " · GR " + (isFinite(red) ? red.toFixed(1) : "0.0") + " dB";
    } else {
      const db = v > 0 ? 20 * Math.log10(v / 16383) : -Infinity;
      pct = isFinite(db) ? clamp((db + 60) / 60 * 100, 0, 100) : 0;
      label = v + " · " + (isFinite(db) ? db.toFixed(1) : "-INF") + " dB";
    }
    m.val.textContent = label;
    m.fill.style.width = pct + "%";
  }

  const raw = st.state ? st.state.raw : "";
  if (raw !== lastRaw) {
    lastRaw = raw;
    $("#adv-state-raw").textContent = raw || "—";
    renderState(st);
  }
}

function renderState(st) {
  const box = $("#adv-state");
  if (!st.state) { box.textContent = "—"; return; }
  const s = st.state;
  const raw = s.raw.split(" ");
  const items = [
    ["bytes 0-19", raw.slice(0, 20).join(" ")],
    ["AUTO-SENS margin", s.autosens_margin + " dB"],
    ["AUTO-SENS state", s.autosens + (s.autosens === 2 ? " (measuring)"
      : s.autosens === 1 ? " (done)" : " (off)")],
    ["OUTPUT SELECT", s.output_select],
    ["LO-CUT", "IN1 " + (s.lowcut.in1 ? 1 : 0) + ", IN2 " + (s.lowcut.in2 ? 1 : 0)],
    ["PHASE", "IN1 " + (s.phase.in1 ? 1 : 0) + ", IN2 " + (s.phase.in2 ? 1 : 0)],
    ["SENS", "IN1 " + s.sens.in1 + " (" + sensDb(s.sens.in1) + " dB), IN2 " +
      s.sens.in2 + " (" + sensDb(s.sens.in2) + " dB)"],
    ["STEREO LINK", s.link ? 1 : 0],
    ["COMPRESSOR", "IN1 " + (s.comp.in1 ? 1 : 0) + ", IN2 " + (s.comp.in2 ? 1 : 0)],
    ["GATE", "IN1 " + gateDb(s.gate.in1) + ", IN2 " + gateDb(s.gate.in2)],
    ["ATTACK", "IN1 " + attackMs(s.attack.in1) + ", IN2 " + attackMs(s.attack.in2)],
    ["RELEASE", "IN1 " + releaseMs(s.release.in1) + ", IN2 " + releaseMs(s.release.in2)],
    ["THRESHOLD", "IN1 " + thrDb(s.threshold.in1) + ", IN2 " + thrDb(s.threshold.in2)],
    ["RATIO", "IN1 " + ratioLabel(s.ratio.in1) + ", IN2 " + ratioLabel(s.ratio.in2)],
    ["GAIN", "IN1 " + gainDb(s.gain.in1) + ", IN2 " + gainDb(s.gain.in2)],
    ["MIX INPUT 1", "0x" + s.mix.in1.toString(16).padStart(6, "0") +
      " · " + mixDb(s.mix.in1)],
    ["MIX INPUT 2", "0x" + s.mix.in2.toString(16).padStart(6, "0") +
      " · " + mixDb(s.mix.in2)],
    ["MIX COAX", "0x" + s.mix.coax.toString(16).padStart(6, "0") +
      " · " + mixDb(s.mix.coax)],
  ];
  box.replaceChildren(...items.map(([k, v]) => {
    const d = el("div");
    d.append(el("span", null, k), el("b", null, String(v)));
    return d;
  }));
}

/* ------------------------------------------------------------------ */
/* render loop                                                        */
/* ------------------------------------------------------------------ */

let rateBusy = false;
let msgTimer = 0;

function setMsg(text) {
  const e = $("#statusmsg");
  e.textContent = text;
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { e.textContent = ""; }, 7000);
}

function render() {
  const st = state.status;
  $("#dot").className = "dot " + (st ? "ok" : "bad");
  $("#conn").textContent = st ? "qc-daemon" : "offline";
  if (!st) return;

  const clock = st.clock || {};
  const clockEl = $("#clock");
  if (clock.rate) {
    clockEl.textContent = (clock.external ? "EXTERNAL" : "INTERNAL") +
      (clock.locked ? "" : " · UNLOCKED");
    clockEl.classList.toggle("ext", !!clock.external);
  } else {
    clockEl.textContent = "—";
  }

  if (st.state) {
    for (const b of buttonCtl) b.update(st);
    for (const k of knobCtl) if (k.get) k.setFrom(k.get(st));
  }
  for (const m of meterCtl) m.update(st);
  if (st.state) for (const c of curveCtl) c.draw(st);

  const r = $("#rate");
  const ar = $("#adv-rate-select");
  if (!rateBusy && clock.rate) {
    if (document.activeElement !== r &&
        [...r.options].some((o) => +o.value === clock.rate)) {
      r.value = String(clock.rate);
    }
    if (ar && document.activeElement !== ar) ar.value = String(clock.rate);
  }

  if (state.mode === "adv") renderAdvanced(st);
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    state.status = await api("/api/status");
    render();
  } catch (e) {
    state.status = null;
    $("#dot").className = "dot bad";
    $("#conn").textContent = "offline";
  } finally {
    polling = false;
    setTimeout(poll, document.hidden ? 1000 : 150);
  }
}

/* ------------------------------------------------------------------ */
/* extra parameters (not in the state block)                          */
/* ------------------------------------------------------------------ */

const firstByte = (hex) => {
  const parts = String(hex || "").trim().split(/\s+/);
  return parts.length ? parseInt(parts[0], 16) : null;
};

async function refreshExtra() {
  try {
    const [di, am, me] = await Promise.all([
      api("/api/read?addr=" + encodeURIComponent("00 02 00 04")),
      api("/api/read?addr=" + encodeURIComponent("00 02 01 00")),
      api("/api/read?addr=" + encodeURIComponent("00 0a 00 00")),
    ]);
    state.extra.digital_in = firstByte(di.data);
    state.extra.autosens_mode = firstByte(am.data);
    state.extra.meter = firstByte(me.data);
  } catch (e) {
    /* daemon or device may be busy; keep the old values */
  }
}

/* ------------------------------------------------------------------ */
/* wiring                                                             */
/* ------------------------------------------------------------------ */

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("qc-mode", mode);
  for (const b of $$(".modes button")) {
    b.classList.toggle("active", b.dataset.mode === mode);
  }
  $("#view-std").classList.toggle("hidden", mode !== "std");
  $("#view-adv").classList.toggle("hidden", mode !== "adv");
  if (mode === "adv") {
    refreshExtra();
    if (state.status) render();
  }
}

async function applyRate(hz) {
  if (rateBusy) return;
  rateBusy = true;
  setMsg("Смена частоты на " + (hz / 1000) + " кГц…");
  const sel = $("#rate");
  const adv = $("#adv-rate-apply");
  sel.disabled = true;
  if (adv) adv.disabled = true;
  try {
    const r = await api("/api/rate", { value: +hz });
    setMsg("Частота: " + (r.rate / 1000) + " кГц");
  } catch (e) {
    setMsg("Ошибка смены частоты: " + e.message);
  } finally {
    rateBusy = false;
    sel.disabled = false;
    if (adv) adv.disabled = false;
    try { state.status = await api("/api/status"); render(); } catch (e) { /* */ }
  }
}

function init() {
  buildStandard();
  buildAdvanced();
  const qmode = new URLSearchParams(location.search).get("mode");
  setMode(qmode === "adv" || qmode === "std" ? qmode : state.mode);
  if (window.__QC_INITIAL__) {
    state.status = window.__QC_INITIAL__;
    if (state.status.extra) Object.assign(state.extra, state.status.extra);
    render();
  }

  for (const b of $$(".modes button")) {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  }

  $("#rate").addEventListener("change", (e) => applyRate(+e.target.value));
  $("#adv-rate-apply").addEventListener("click", () => {
    applyRate(+$("#adv-rate-select").value);
  });

  $("#raw-read").addEventListener("click", async () => {
    const addr = $("#raw-addr").value.trim();
    const size = +$("#raw-size").value || 1;
    try {
      const r = await api("/api/read?addr=" + encodeURIComponent(addr) +
                          "&size=" + size);
      $("#raw-out").textContent = r.data;
    } catch (e) {
      $("#raw-out").textContent = "error: " + e.message;
    }
  });
  $("#raw-write").addEventListener("click", async () => {
    const addr = $("#raw-addr").value.trim();
    const data = $("#raw-data").value.trim();
    try {
      await api("/api/raw", { addr, data });
      $("#raw-out").textContent = "ok";
      refreshExtra();
    } catch (e) {
      $("#raw-out").textContent = "error: " + e.message;
    }
  });
  $("#btn-init").addEventListener("click", async () => {
    if (!confirm("Сбросить все настройки QUAD-CAPTURE к значениям по умолчанию?")) {
      return;
    }
    try {
      await api("/api/raw", { addr: "00 00 00 02", data: "00" });
      setMsg("Initialize отправлен");
      refreshExtra();
    } catch (e) {
      setMsg("Ошибка: " + e.message);
    }
  });

  api("/api/meter", { value: 1 }).catch(() => {});
  refreshExtra();
  setTimeout(refreshExtra, 1500);
  setInterval(() => {
    if (state.mode === "adv" && !document.hidden) refreshExtra();
  }, 5000);

  poll();
}

init();
