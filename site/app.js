// BD Radar dashboard. Reads the encrypted daily file, unlocks it with your passphrase,
// and keeps your stages, notes, follow ups and candidates in this browser.
const REPO = "modib000/bd-radar";
const DAY = 864e5;
const STAGES = [["todo","To contact"],["contacted","Contacted"],["replied","Replied"],["meeting","Meeting booked"],["client","Client"],["pass","Pass"]];
const ACTIVE = ["todo","contacted","replied","meeting"];
const DISCS = ["Frontend","Backend","Full stack","Blockchain","Platform","Mobile","Data & AI","Software"];
const DSYN = {"Frontend":"frontend front end front-end","Backend":"backend back end back-end","Full stack":"full stack fullstack full-stack","Blockchain":"blockchain web3 smart contracts","Platform":"platform devops infrastructure sre","Mobile":"mobile ios android","Data & AI":"data ai ml","Software":"software"};
const DWORDS = new Set(Object.values(DSYN).join(" ").split(" ").concat(["full stack","front end","back end","smart contracts"]));
const COLORS = ["#3D5AFE","#0B9483","#C77700","#D6336C","#7E57C2","#00897B","#5C6BC0","#EF6C00","#2E7D32","#AD1457"];
const TIERS = [["hot","Hot","Score 16 to 20"],["strong","Strong","Score 12 to 15"],["watch","Watch","Score 11 or under"]];
const $ = id => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has("demo");
const PFX = DEMO ? "bdr-demo-" : "bdr-";
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const store = {get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const addDays = n => ymd(new Date(today().getTime() + n*DAY));
const dayDiff = s => Math.round((new Date(s+"T00:00:00") - today()) / DAY);
const ago = n => n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
const fmtM = a => a >= 1 ? `$${+a.toFixed(1)}m` : a ? `$${Math.round(a*1000)}k` : "Undisclosed";

// ---------- theme ----------
// always dark

// ---------- unlock ----------
const u8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decryptFile(file, pass) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: u8(file.salt), iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8(file.iv) }, key, u8(file.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
let FILE = null;
async function boot() {
  if (DEMO) {
    try { const r = await fetch("data/demo.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw 0; start(await r.json()); }
    catch (e) { $("lock-msg").textContent = "The demo isn't ready yet. Check back tomorrow."; $("lock-form").style.display = "none"; }
    return;
  }
  try {
    const r = await fetch("data/leads.enc.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("missing");
    FILE = await r.json();
  } catch (e) {
    $("lock-msg").innerHTML = `No data yet. Open <a href="https://github.com/${REPO}/actions" target="_blank" rel="noopener">GitHub Actions</a>, run <b>Daily refresh</b>, then reload this page.`;
    $("lock-form").style.display = "none"; return;
  }
  const saved = store.get("bdr-pass", null);
  if (saved) { try { start(await decryptFile(FILE, saved)); return; } catch (e) { store.del("bdr-pass"); } }
  $("pass").focus();
}
$("lock-form").onsubmit = async e => {
  e.preventDefault();
  const p = $("pass").value; if (!p) return;
  $("unlock").disabled = true; $("lock-err").textContent = "";
  try { const d = await decryptFile(FILE, p); if ($("remember").checked) store.set("bdr-pass", p); start(d); }
  catch (err) { $("lock-err").textContent = "That passphrase doesn't match. Try again."; }
  if ($("unlock")) $("unlock").disabled = false;
};

// ---------- state ----------
let DATA, list = [], S = store.get(PFX + "v3", {}), CANDS = store.get(PFX + "cands", []);
CANDS.forEach(k => { if (k.disc && k.disc.length) k.skills = [...new Set([...k.disc.filter(d => d !== "Leadership" && d !== "Software").map(d => d.toLowerCase().replace("data & ai", "data")), ...k.skills])]; delete k.disc; });
const save = () => store.set(PFX + "v3", S);
const saveC = () => store.set(PFX + "cands", CANDS);
const st = c => S[c.name] || {};
function stage(c) { const s = st(c); if (s.stage === "pass" && s.passSig && s.passSig !== c.sig) return ""; return s.stage || ""; }
const snoozed = c => { const s = st(c); return !stage(c) && s.snooze && dayDiff(s.snooze) > 0; };
const untriaged = c => !stage(c) && !snoozed(c);
const nextOf = c => ACTIVE.includes(stage(c)) ? st(c).next || "" : "";
const isDue = c => { const n = nextOf(c); return n && dayDiff(n) <= 0; };
function setState(c, patch) { S[c.name] = Object.assign({}, S[c.name], patch); save(); refresh(); }
let CAD = store.get(PFX + "cad", [3, 7, 14]);
function nextAction(c) {
  const s = stage(c), t = st(c), fu = t.fu || 0;
  if (s === "todo") return ["Send first message", "var(--sky)"];
  if (s === "contacted") return fu >= 3 ? ["No reply, close or pass", "var(--muted)"] : [["Follow up 1", "Follow up 2", "Final nudge"][fu], fu >= 1 ? "var(--coral)" : "var(--amber)"];
  if (s === "replied") return ["Book a meeting", "var(--mint)"];
  if (s === "meeting") return ["Send spec or proposal", "var(--violet)"];
  if (s === "client") return ["Send candidates", "var(--mint)"];
  return null;
}
function logAction(c) {
  const s = stage(c), t = st(c), fu = t.fu || 0;
  if (s === "todo") return setState(c, { stage: "contacted", fu: 0, contacted: addDays(0), next: addDays(CAD[0]) });
  if (s === "contacted") { const n = fu + 1; return setState(c, { fu: n, next: n < 3 ? addDays(Math.max(1, CAD[n] - CAD[n - 1])) : "" }); }
  if (s === "replied") return setState(c, { stage: "meeting", next: addDays(2) });
  if (s === "meeting") return setState(c, { next: addDays(5) });
  if (s === "client") return setState(c, { next: addDays(14) });
}
function setStage(c, s) {
  const p = { stage: s };
  if (s === "contacted" && !st(c).next) { p.next = addDays(CAD[0]); p.fu = 0; }
  if (s === "todo" && !st(c).next) p.next = addDays(0);
  if (s === "pass") p.passSig = c.sig;
  if (s === "") p.next = "";
  setState(c, p);
}
const stageLabel = s => s ? STAGES.find(x => x[0] === s)[1] : "Not triaged";
function dueLabel(n) { if (!n) return ""; const d = dayDiff(n); return d < 0 ? `${-d}d overdue` : d === 0 ? "Today" : d === 1 ? "Tomorrow" : new Date(n+"T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
const dueCls = n => { if (!n) return ""; const d = dayDiff(n); return d < 0 ? "over" : d === 0 ? "today" : ""; };

// ---------- matching ----------
const skillRe = s => new RegExp("(^|[^a-z0-9])" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
function boolMatch(q, text) {
  const toks = q.match(/\(|\)|"[^"]+"|[^\s()]+/g) || []; let i = 0;
  const term = () => { const t = toks[i++]; if (t === "(") { const v = orE(); i++; return v; } if (!t) return true; const w = t.replace(/"/g, "").toLowerCase(); return skillRe(w).test(text); };
  const notE = () => { if ((toks[i] || "").toUpperCase() === "NOT") { i++; return !notE(); } return term(); };
  const andE = () => { let v = notE(); while (i < toks.length && toks[i] !== ")" && (toks[i] || "").toUpperCase() !== "OR") { if (toks[i].toUpperCase() === "AND") i++; if ((toks[i] || "").toUpperCase() === "NOT") { i++; v = !notE() && v; } else v = notE() && v; } return v; };
  const orE = () => { let v = andE(); while ((toks[i] || "").toUpperCase() === "OR") { i++; v = andE() || v; } return v; };
  try { return orE(); } catch (e) { return false; }
}
const isBool = q => /\b(AND|OR|NOT)\b|[()]/.test(q || "");
function matchesFor(c) {
  return CANDS.map(k => {
    if (isBool(k.bool)) { if (!boolMatch(k.bool, c.mtext)) return null; const s = (k.bool.match(/"[^"]+"|[A-Za-z0-9.#+-]+/g) || []).map(w => w.replace(/"/g, "").toLowerCase()).filter(w => !/^(and|or|not)$/.test(w) && skillRe(w).test(c.mtext)); return { k, s, score: s.length + 3 }; }
    const s = k.skills.filter(x => x && skillRe(x).test(c.mtext));
    const focus = s.some(x => DWORDS.has(x));
    const ok = s.length >= 3 || (s.length >= 2 && focus);
    return ok ? { k, s, score: s.length + (focus ? 2 : 0) } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}
const computeMatches = () => list.forEach(c => c.matches = matchesFor(c));

// ---------- helpers ----------
const initials = n => n.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || n[0];
const av = c => `<div class="avatar" style="background:${c.color}">${esc(initials(c.name))}</div>`;
const what = c => c.roles.length ? c.roles[0].title + (c.roles.length > 1 ? `  +${c.roles.length - 1} more` : "") : c.funding ? `${fmtM(c.funding.amountM)}${c.funding.round && c.funding.round !== "Undisclosed round" ? ", " + c.funding.round : ""}` : c.social[0] ? c.social[0].text : c.dev ? `${c.dev.contributors} active engineers on GitHub` : "";
const contactLine = c => c.contact && c.contact.name ? `${c.contact.name}, ${c.contact.title || ""}` : c.contact && c.contact.hidden ? `${c.contact.title || "Decision maker"} (hidden in demo)` : "CTO or Head of Engineering";
function tags(c) {
  return `${c.isNew ? '<span class="tag t-ok" data-tip="Discovered by the radar today. Its roles may have been posted earlier.">New</span>' : ""}${c.roles.length ? '<span class="tag t-hire">Hiring</span>' : ""}${c.funding ? '<span class="tag t-fund">Raised</span>' : ""}${c.social.length ? '<span class="tag t-social">Social</span>' : ""}${c.surge ? `<span class="tag t-surge" data-tip="Roles jumped from ${c.surge.from} to ${c.surge.to} in a week.">Surge</span>` : ""}${c.social.some(x => x.via) ? '<span class="tag t-social">Flagged on X</span>' : ""}${c.dev && c.dev.spike ? '<span class="tag t-social">GitHub</span>' : ""}${c.closing.length >= 2 ? '<span class="tag t-plain">Closing fast</span>' : ""}${c.backers && c.backers.length ? `<span class="tag t-plain" data-tip="Roles found on the ${esc(c.backers.join(", "))} portfolio job board.">VC backed</span>` : ""}${c.stale ? '<span class="tag t-stale" data-tip="A role has been open 30+ days or was reposted. They&#39;re struggling to hire, which makes them open to help.">Hard to fill</span>' : ""}${c.matches.length ? `<span class="tag t-match">${c.matches.length} match${c.matches.length > 1 ? "es" : ""}</span>` : ""}`;
}

// ---------- start ----------
function start(d) {
  DATA = d;
  list = d.companies.map(c => Object.assign(c, {
    color: COLORS[[...c.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length],
    sig: `r${c.roles.length}f${c.funding ? c.funding.date : ""}s${c.social.length}d${c.dev && c.dev.spike ? 1 : 0}`,
    backers: c.backers || [], dev: c.dev || null, sites: c.sites || [], closing: c.closing || [], closed: c.closed || [], surge: c.surge || null, loc: c.loc || "",
    mtext: [c.name, c.vertical, c.roles.map(r => r.title).join(" "), c.disc.map(x => DSYN[x] || "").join(" "), c.funding && c.funding.headline, c.social.map(s => s.text).join(" "), (c.backers || []).join(" ")].join(" ").toLowerCase()
  }));
  $("lock").remove();
  if (DEMO) {
    document.body.classList.add("demo");
    if (!store.get(PFX + "seeded2", false)) {
      const ranked = [...list].sort((a, b) => b.score - a.score), top = ranked.length > 25 ? ranked.slice(8) : ranked;
      const plan = [["todo", 0, 0], ["todo", 0, 1], ["contacted", 0, 0], ["contacted", 1, -1], ["contacted", 2, 2], ["replied", 0, 1], ["meeting", 0, 3], ["client", 0, 7], ["pass", 0, 0]];
      plan.forEach(([stg, fu, nx], i) => { const c = top[i]; if (c) S[c.name] = { stage: stg, fu, next: addDays(nx), contacted: addDays(-4 - i) }; });
      save(); store.set(PFX + "seeded2", true);
    }
    if (!store.get(PFX + "seededC", false) && !CANDS.length) {
      CANDS = [
        { id: "s1", sample: true, name: "Senior backend, ex exchange", role: "Senior Backend Engineer", bool: "backend AND (senior OR staff OR lead)", skills: [], loc: "London", sen: "Senior" },
        { id: "s2", sample: true, name: "Full stack, payments", role: "Full Stack Engineer", bool: "(frontend OR \"full stack\" OR fullstack) NOT intern", skills: [], loc: "Remote EU", sen: "Senior" },
        { id: "s3", sample: true, name: "Protocol engineer", role: "Smart Contract Engineer", bool: "(solidity OR rust OR protocol OR blockchain OR \"smart contract\")", skills: [], loc: "London", sen: "Staff / Lead" },
        { id: "s4", sample: true, name: "Platform and infra", role: "Platform Engineer", bool: "(platform OR devops OR sre OR infrastructure OR security)", skills: [], loc: "Remote UK", sen: "Senior" }
      ];
      saveC(); store.set(PFX + "seededC", true);
    }
  }
  document.querySelector(".app").hidden = false;
  const hr = new Date().getHours();
  $("brandName").textContent = DEMO ? "BD Radar (Demo)" : "BD Radar";
  document.title = DEMO ? "BD Radar (Demo)" : "BD Radar";
  $("stamp").textContent = new Date(d.generatedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  setupRanges();
  const gen = new Date(d.generatedAt);
  const fresh = (Date.now() - gen) / DAY < 1.5;
  const credit = `<div class="credit" style="margin-top:.6rem">Built by <b>Mo Dib</b></div>`;
  $("rail-foot").innerHTML = (DEMO ? `<b><span class="dot ${fresh ? "live" : ""}"></span>Demo</b>Live leads from ${gen.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. Contact details hidden. Your clicks stay in your browser.` : `<b><span class="dot ${fresh ? "live" : ""}"></span>${fresh ? "Live" : "Refresh overdue"}</b>Updated ${gen.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} at ${gen.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Refreshes every morning.`) + credit;
  setupFilters();
  renderSources();
  refresh();
}

// ---------- overview ----------
function renderOverview() {
  const tri = list.filter(untriaged).length;
  const cnt = k => list.filter(c => c.tier === k).length;
  $("leadTotal").textContent = `${list.length} on the radar`;
  $("leads").innerHTML = [["hot", "Hot", "var(--coral)", "Score 16 to 20. Strongest leads, call these first."], ["strong", "Strong", "var(--amber)", "Score 12 to 15. Worth a message this week."], ["watch", "Watch", "var(--faint)", "Score 11 or under. Early signals, keep an eye on them."]]
    .map(([k, l, col, tip]) => `<button class="lead" data-tier="${k}" style="--c:${col}" aria-pressed="${sig === k}"><i class="g"></i><div class="lt"><b>${l}</b><span>${tip}</span></div><div class="ln">${cnt(k)}</div></button>`).join("");
  const h = list.filter(c => c.roles.length && !c.funding).length, f = list.filter(c => c.funding && !c.roles.length).length, b = list.filter(c => c.roles.length && c.funding).length, o = Math.max(0, list.length - h - f - b);
  $("mix").innerHTML = [[h, "var(--mint)"], [f, "var(--amber)"], [b, "var(--coral)"], [o, "var(--violet)"]].filter(x => x[0]).map(([n, col]) => `<i style="flex:${n};background:${col}"></i>`).join("");
  $("c-radar").textContent = tri || "";
  $("c-pipe").textContent = list.filter(c => ACTIVE.includes(stage(c))).length || "";
  $("c-cand").textContent = CANDS.length || "";
}
$("leads").addEventListener("click", e => { const t = e.target.closest("[data-tier]"); if (!t) return; setSig(sig === t.dataset.tier ? "all" : t.dataset.tier); renderOverview(); document.querySelector(".bar-filters").scrollIntoView({ behavior: "smooth", block: "start" }); });

// ---------- today queue ----------
let tab = "triage";
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b)); renderQueue(); });
function renderQueue() {
  const tri = list.filter(untriaged).sort((a, b) => b.score - a.score || b.matches.length - a.matches.length);
  const due = list.filter(isDue).sort((a, b) => nextOf(a).localeCompare(nextOf(b)));
  $("t-tri").textContent = tri.length; $("t-due").textContent = due.length;
  const q = $("queue");
  if (tab === "triage") {
    q.innerHTML = tri.length ? tri.slice(0, 15).map(c => `<div class="qrow" data-id="${c.id}">${av(c)}<div class="meta" data-open><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)} <span class="tag ${c.tier === "hot" ? "t-p1" : "t-plain"}" style="margin-left:4px">${c.score}</span>${c.isNew ? ' <span class="tag t-ok">New</span>' : ""}</b><span>${esc(c.why)}</span></div><div class="qact"><button class="go" data-act="chase">Chase</button><button data-act="snooze" title="Hide for 7 days">Snooze</button><button data-act="pass">Pass</button></div></div>`).join("")
      : `<div class="qempty">Inbox zero. Tomorrow morning's refresh will bring new leads.</div>`;
  } else {
    q.innerHTML = due.length ? due.map(c => `<div class="qrow" data-id="${c.id}">${av(c)}<div class="meta" data-open><b>${esc(c.name)}</b><span>${esc(stageLabel(stage(c)))} · <span class="due ${dueCls(nextOf(c))}">${dueLabel(nextOf(c))}</span></span></div><div class="qact"><button data-act="push" title="Follow up in 3 days">+3 days</button><button class="go" data-open>Open</button></div></div>`).join("")
      : `<div class="qempty">No follow ups due. Chase a lead from Triage and it'll show up here on the day.</div>`;
  }
  $("seeall").textContent = tab === "triage" ? `See all ${tri.length} in the table` : "See all follow ups in the table";
}
$("queue").addEventListener("click", e => {
  const row = e.target.closest(".qrow"); if (!row) return; const c = list.find(x => x.id === row.dataset.id);
  const act = e.target.closest("[data-act]");
  if (act) { const a = act.dataset.act;
    if (a === "chase") setStage(c, "todo"); if (a === "snooze") setState(c, { snooze: addDays(7) });
    if (a === "pass") setStage(c, "pass"); if (a === "push") setState(c, { next: addDays(3) }); return; }
  if (e.target.closest("[data-open]")) openC(c.id);
});
$("seeall").onclick = () => { setSig(tab === "triage" ? "triage" : "due"); document.querySelector(".bar-filters").scrollIntoView({ behavior: "smooth", block: "start" }); };

// ---------- filters + table ----------
let sig = "all", vert = "All", dsc = "All", minS = 0, q = "", sortKey = "score", selected = null, verts = [], DISC = [];
function setupFilters() {
  verts = ["All", ...[...new Set(list.map(c => c.vertical))].sort()];
  $("vert").innerHTML = verts.map(v => `<option>${v === "All" ? "All sectors" : esc(v)}</option>`).join("");
  $("vert").onchange = () => { vert = verts[$("vert").selectedIndex]; render(); };
  DISC = ["All", ...DISCS.filter(d => list.some(c => c.disc.includes(d)))];
  $("disc").innerHTML = DISC.map(d => `<option>${d === "All" ? "All disciplines" : d === "Software" ? "General software" : d}</option>`).join("");
  $("disc").onchange = () => { dsc = DISC[$("disc").selectedIndex]; render(); };
}
function setSig(s) { sig = s; document.querySelectorAll("[data-sig]").forEach(x => x.setAttribute("aria-pressed", x.dataset.sig === s)); render(); }
document.querySelectorAll("[data-sig]").forEach(b => b.onclick = () => setSig(b.dataset.sig));

$("q").oninput = e => { q = e.target.value.toLowerCase(); if (!$("v-radar").classList.contains("on")) go("radar"); render(); };
document.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { sortKey = b.dataset.sort; render(); });
const EMPTY = { surge: "No hiring surges this week. They need a week of history, so they start showing after 7 days of runs.", ukeu: "No UK or European roles in the current list.", vc: "No VC portfolio roles yet. Check the VC boards card on the Sources page.", dev: "No GitHub spikes today. The check rotates through companies, so more show up over the week.", social: "No social signals today. Hiring posts from Telegram, Farcaster and X land here.", match: "No matches yet. Add candidates and every lead gets checked against them.", due: "No follow ups due today.", triage: "Everything's triaged. Nice.", stale: "No stale roles right now.", new: "Nothing new today yet." };
function render() {
  if (!DATA) return;
  const order = Object.fromEntries([["", -1], ...STAGES.map((s, i) => [s[0], i])]);
  let r = list.filter(c => {
    if (sig === "triage" && !untriaged(c)) return false; if (["hot", "strong", "watch"].includes(sig) && c.tier !== sig) return false;
    if (sig === "new" && !c.isNew) return false;
    if (sig === "hiring" && !c.roles.length) return false; if (sig === "funding" && !c.funding) return false;
    if (sig === "social" && !c.social.length) return false; if (sig === "stale" && !c.stale) return false;
    if (sig === "surge" && !c.surge) return false; if (sig === "ukeu" && !c.loc) return false;
    if (sig === "vc" && !c.backers.length) return false; if (sig === "dev" && !(c.dev && c.dev.spike)) return false;
    if (sig === "match" && !c.matches.length) return false; if (sig === "due" && !isDue(c)) return false;
    if (vert !== "All" && c.vertical !== vert) return false; if (dsc !== "All" && !c.disc.includes(dsc)) return false;
    if (c.score < minS) return false;
    if (q && !(c.mtext + " " + c.locations.join(" ")).includes(q)) return false;
    return true;
  });
  r.sort(sortKey === "name" ? (a, b) => a.name.localeCompare(b.name) : sortKey === "stage" ? (a, b) => order[stage(b)] - order[stage(a)] || b.score - a.score : sortKey === "next" ? (a, b) => (nextOf(a) || "9").localeCompare(nextOf(b) || "9") || b.score - a.score : (a, b) => b.score - a.score || b.matches.length - a.matches.length || a.name.localeCompare(b.name));
  const shown = r.slice(0, 300);
  $("rows").innerHTML = shown.length ? shown.map(c => `<tr data-id="${c.id}" class="${selected === c.id ? "sel" : ""}" tabindex="0">
    <td><div class="co">${av(c)}<div><b>${esc(c.name)}</b><span>${esc(c.vertical)}${c.locations[0] ? " · " + esc(c.locations[0]) : ""}</span></div></div></td>
    <td><div class="tags">${tags(c)}</div></td>
    <td><span class="score">${c.score}<span class="meter"><i class="${c.tier}" style="width:${c.score * 5}%"></i></span></span></td>
    <td><div class="role" title="${esc(what(c))}" style="color:var(--ink)">${esc(what(c))}</div><div class="role" style="font-size:.7rem">${c.disc.length ? esc(c.disc.join(" · ")) : c.funding ? "Roles not live yet" : c.dev && c.dev.spike ? "Team growing on GitHub" : "From social"}</div></td>
    <td>${c.contact && c.contact.name && !DEMO ? `<div class="role">${esc(contactLine(c))}</div>` : `<a class="lnk" data-stop href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} (CTO OR "VP Engineering" OR "Head of Engineering")`)}" target="_blank" rel="noopener" data-tip="Opens a LinkedIn search for their CTO or Head of Engineering.">Find CTO ↗</a>`}</td>
    <td>${(() => { const a = ACTIVE.includes(stage(c)) && nextAction(c); return a ? `<div class="due" style="color:${a[1]};margin-bottom:.25rem">${a[0]}</div>` : ""; })()}<select class="status stagesel" data-s="${stage(c)}" data-id="${c.id}" aria-label="Stage for ${esc(c.name)}"><option value="" ${!stage(c) ? "selected" : ""}>Not triaged</option>${STAGES.map(s => `<option value="${s[0]}" ${stage(c) === s[0] ? "selected" : ""}>${s[1]}</option>`).join("")}</select></td>
    <td><span class="due ${dueCls(nextOf(c))}">${nextOf(c) ? dueLabel(nextOf(c)) : (snoozed(c) ? "Snoozed" : "")}</span></td></tr>`).join("")
    + (r.length > 300 ? `<tr><td colspan="7"><div class="empty">Showing the top 300 of ${r.length}. Narrow the filters to see the rest.</div></td></tr>` : "")
    : `<tr><td colspan="7"><div class="empty">${EMPTY[sig] || "No companies match these filters. Lower the minimum score or clear the search."}</div></td></tr>`;
}
document.addEventListener("change", e => { if (e.target.classList.contains("stagesel")) { const c = list.find(x => x.id === e.target.dataset.id); setStage(c, e.target.value); } });
$("rows").addEventListener("click", e => { if (e.target.closest(".stagesel") || e.target.closest("[data-stop]")) return; const tr = e.target.closest("tr[data-id]"); if (tr) openC(tr.dataset.id); });
$("rows").addEventListener("keydown", e => { if (e.key === "Enter" && !e.target.closest(".stagesel")) { const tr = e.target.closest("tr[data-id]"); if (tr) openC(tr.dataset.id); } });

// ---------- drawer ----------
const drawer = $("drawer"), scrim = $("scrim");
const I = { hire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', fund: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>', chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>', person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>' };
function openC(id) { selected = id; drawHTML(); drawer.classList.add("on"); scrim.classList.add("on"); drawer.setAttribute("aria-hidden", "false"); $("close").focus(); render(); }
function drawHTML() {
  const c = list.find(x => x.id === selected); if (!c) return;
  const s = st(c), stg = stage(c), F = c.funding, K = c.contact;
  const tierName = { hot: "Hot account", strong: "Strong lead", watch: "Watch" }[c.tier];
  const li = encodeURIComponent(`${c.name} (CTO OR "VP Engineering" OR "Head of Engineering")`);
  const sigs = [];
  if (c.roles.length) sigs.push(`<div class="sig"><div class="ico t-hire">${I.hire}</div><div style="min-width:0"><b>${c.roles.length} open engineering role${c.roles.length > 1 ? "s" : ""}${c.newRoles ? ` · ${c.newRoles} new today` : ""}</b>${c.roles.slice(0, 12).map(r => `<span style="display:block;margin-top:3px"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a> · ${esc(r.location || "Location not listed")}${r.salary ? ` · <b style="display:inline;font-size:inherit">${esc(r.salary)}</b>` : ""} · first seen ${ago(r.age)}${r.via ? ` · via ${esc(r.via)}` : ""}${r.age >= 30 ? ' <span class="tag t-stale">Stale</span>' : ""}</span>`).join("")}${c.roles.length > 12 ? `<span>and ${c.roles.length - 12} more</span>` : ""}</div></div>`);
  if (F) sigs.push(`<div class="sig"><div class="ico t-fund">${I.fund}</div><div><b>Raised ${fmtM(F.amountM)} · ${esc(F.round)}</b><span>${esc(F.date)}. ${F.url ? `<a href="${esc(F.url)}" target="_blank" rel="noopener">${esc(F.headline)}</a>` : esc(F.headline)}${F.investors && F.investors.length ? `<br>Investors: ${esc(F.investors.join(", "))}` : ""}</span></div></div>`);
  if (c.surge) sigs.push(`<div class="sig"><div class="ico t-stale">${I.hire}</div><div><b>Hiring surge</b><span>Engineering roles went from ${c.surge.from} to ${c.surge.to} in about a week.</span></div></div>`);
  if (c.closed.length) sigs.push(`<div class="sig"><div class="ico t-plain">${I.hire}</div><div><b>${c.closed.length} role${c.closed.length > 1 ? "s" : ""} closed in the last 30 days</b>${c.closed.slice(0, 6).map(x => `<span style="display:block;margin-top:3px">${esc(x.title)} · open ${x.openDays} day${x.openDays === 1 ? "" : "s"} · closed ${esc(x.closed)}</span>`).join("")}${c.closing.length >= 2 ? `<span style="display:block;margin-top:4px">Several closed quickly. Worth asking who's filling them.</span>` : ""}</div></div>`);
  if (c.dev && c.dev.spike) sigs.push(`<div class="sig"><div class="ico t-social"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg></div><div><b>Engineering team growing on GitHub</b><span>${c.dev.contributors} people committed code in the last 30 days, up from ${c.dev.prevContributors} the month before${c.dev.newRepos ? `, and ${c.dev.newRepos} new public repos in 2 weeks` : ""}. <a href="https://github.com/${esc(c.dev.org)}" target="_blank" rel="noopener">github.com/${esc(c.dev.org)}</a></span></div></div>`);
  if (c.backers.length) sigs.push(`<div class="sig"><div class="ico t-fund">${I.fund}</div><div><b>Backed by ${esc(c.backers.join(", "))}</b><span>Roles found on ${c.backers.length > 1 ? "their" : "the"} portfolio job board${c.backers.length > 1 ? "s" : ""}.</span></div></div>`);
  c.social.forEach(p => sigs.push(`<div class="sig"><div class="ico t-social">${I.chat}</div><div><b>${p.via ? `Flagged by ${esc(p.via === "search" ? "a smart money tracker" : p.via)} on X` : esc(p.platform)} · ${esc(p.date)}</b><span><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.text)}</a></span></div></div>`));
  drawer.innerHTML = `
   <div class="dhead">${av(c)}<div style="flex:1;min-width:0"><h3>${esc(c.name)}</h3><p>${esc(c.vertical)}${c.locations.length ? " · " + esc(c.locations.join(", ")) : ""}${c.domain ? ` · <a href="https://${esc(c.domain)}" target="_blank" rel="noopener">${esc(c.domain)}</a>` : ""}</p></div><button class="iconbtn" id="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
   <div class="dbody">
     <div class="scorebox"><div class="ring" style="--v:${c.score * 5}"><div>${c.score}</div></div><div><b>${tierName}</b><span>BD score out of 20${c.isNew ? " · new today" : ` · on the radar since ${esc(c.firstSeen)}`}</span></div></div>
     <div class="sect"><h4>Why this score</h4><ul class="breakdown">${c.parts.map(p => `<li><b>+${p[0]}</b>${esc(p[1])}</li>`).join("")}</ul></div>
     <div class="sect"><h4>Stage</h4><div class="statuspick">${STAGES.map(x => `<button class="chip" data-stage="${x[0]}" aria-pressed="${stg === x[0]}">${x[1]}</button>`).join("")}</div>
       ${!stg ? `<div style="margin-top:8px"><button class="btn ghost" data-snooze style="padding:6px 14px">${snoozed(c) ? "Snoozed until " + dueLabel(s.snooze) : "Snooze 7 days"}</button></div>` : ""}</div>
     ${ACTIVE.includes(stg) ? `<div class="sect"><h4>Next follow up</h4><div class="fu"><input type="date" id="fu" value="${s.next || ""}" aria-label="Follow up date"><button class="chip" data-fu="0">Today</button><button class="chip" data-fu="1">Tomorrow</button><button class="chip" data-fu="3">3 days</button><button class="chip" data-fu="7">1 week</button><button class="chip" data-fu="x">Clear</button></div>${s.next ? `<p class="due ${dueCls(s.next)}" style="margin-top:6px">${dueLabel(s.next)}</p>` : ""}</div>` : ""}
     <div class="sect"><h4>Why now</h4><p>${esc(c.why)}</p></div>
     <div class="sect"><h4>Suggested angle</h4><p>${esc(c.angle)}</p></div>
     <div class="sect"><h4>Candidates who fit</h4>${c.matches.length ? `<div class="mlist">${c.matches.map(m => `<div class="mitem"><div><b>${esc(m.k.name)}</b><br><span>${esc(m.k.role)}</span></div><span style="text-align:right">${esc(m.s.join(", "))}</span></div>`).join("")}</div>` : `<p style="color:var(--muted);font-size:13px">${CANDS.length ? "None of your candidates fit this one yet." : "Add candidates and the ones who fit will show here."}</p>`}</div>
     <div class="sect"><h4>Signals</h4><div class="signals">${sigs.join("")}</div></div>
     <div class="sect"><h4>Who to approach</h4>
       <div class="contact"><div class="pic">${I.person}</div><div style="flex:1;min-width:0"><b>${esc(K && K.name ? K.name : K && K.hidden ? (K.title || "Decision maker") : "CTO or Head of Engineering")}</b><span>${K && K.name ? esc([K.title, K.email].filter(Boolean).join(" · ")) : K && K.hidden ? "Found by Apollo. Name and email hidden in the demo." : "No name yet. Apollo looks up Hot leads automatically once connected."}</span></div>${K && K.linkedin ? `<a class="tag t-ok" href="${esc(K.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ""}</div>
       <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><a class="btn tonal" href="https://www.linkedin.com/search/results/people/?keywords=${li}" target="_blank" rel="noopener" style="text-decoration:none">${I.person}Find on LinkedIn</a>${c.domain ? `<a class="btn ghost" href="https://app.apollo.io/#/people?qOrganizationDomains[]=${encodeURIComponent(c.domain)}" target="_blank" rel="noopener" style="text-decoration:none">Open in Apollo</a>` : ""}</div>
     </div>
     <div class="sect"><h4>Notes</h4><textarea id="note" placeholder="Call notes, who you messaged, what they said">${esc(s.note || "")}</textarea></div>
   </div>`;
  $("close").onclick = closeD;
  drawer.querySelectorAll("[data-stage]").forEach(b => b.onclick = () => setStage(c, b.dataset.stage === stg ? "" : b.dataset.stage));
  const sn = drawer.querySelector("[data-snooze]"); if (sn) sn.onclick = () => setState(c, { snooze: snoozed(c) ? "" : addDays(7) });
  const fu = $("fu"); if (fu) fu.onchange = () => setState(c, { next: fu.value });
  drawer.querySelectorAll("[data-fu]").forEach(b => b.onclick = () => setState(c, { next: b.dataset.fu === "x" ? "" : addDays(+b.dataset.fu) }));
  $("note").oninput = e => { S[c.name] = Object.assign({}, S[c.name], { note: e.target.value }); save(); };
}
function closeD() { drawer.classList.remove("on"); scrim.classList.remove("on"); drawer.setAttribute("aria-hidden", "true"); selected = null; render(); }
scrim.onclick = closeD; document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer.classList.contains("on")) closeD(); });

// ---------- pipeline ----------
function renderBoard() {
  const b = $("board"); b.style.gridTemplateColumns = `repeat(${STAGES.length},minmax(160px,1fr))`;
  b.innerHTML = STAGES.map(([k, l]) => {
    const cs = list.filter(c => stage(c) === k).sort((a, b) => (nextOf(a) || "9").localeCompare(nextOf(b) || "9") || b.score - a.score);
    return `<div class="lane" data-lane="${k}"><h3>${l}<span>${cs.length}</span></h3>${cs.map(c => `<div class="card" draggable="true" data-id="${c.id}">${av(c)}<div style="min-width:0;flex:1"><b>${esc(c.name)}</b><span>${c.score}/20 · ${esc(c.vertical)}</span>${(() => { const a = nextAction(c); if (!a) return ""; const n = nextOf(c); return `<div class="cta"><em style="color:${a[1]}">${a[0]}${n ? `<span class="due ${dueCls(n)}" style="display:block">${dueLabel(n)}</span>` : ""}</em>${k !== "pass" ? `<button data-log="${c.id}">Log</button>` : ""}</div>`; })()}<select class="stagesel mini" data-id="${c.id}" aria-label="Move ${esc(c.name)}">${STAGES.map(s => `<option value="${s[0]}" ${k === s[0] ? "selected" : ""}>${s[0] === k ? "Move to…" : s[1]}</option>`).join("")}<option value="">Back to triage</option></select></div></div>`).join("") || `<div class="qempty" style="padding:18px 6px">${k === "todo" ? "Hit Chase on a lead to add it here." : "Nothing here yet."}</div>`}</div>`;
  }).join("");
}
const board = $("board");
board.addEventListener("dragstart", e => { const c = e.target.closest(".card"); if (c) { e.dataTransfer.setData("text/plain", c.dataset.id); c.classList.add("dragging"); } });
board.addEventListener("dragend", e => { const c = e.target.closest(".card"); if (c) c.classList.remove("dragging"); board.querySelectorAll(".lane").forEach(x => x.classList.remove("over")); });
board.addEventListener("dragover", e => { const l = e.target.closest(".lane"); if (l) { e.preventDefault(); board.querySelectorAll(".lane").forEach(x => x.classList.toggle("over", x === l)); } });
board.addEventListener("drop", e => { const l = e.target.closest(".lane"); if (!l) return; e.preventDefault(); const c = list.find(x => x.id === e.dataTransfer.getData("text/plain")); if (c && stage(c) !== l.dataset.lane) setStage(c, l.dataset.lane); });
board.addEventListener("click", e => { if (e.target.closest(".stagesel")) return; const lg = e.target.closest("[data-log]"); if (lg) { logAction(list.find(x => x.id === lg.dataset.log)); return; } const c = e.target.closest(".card"); if (c) openC(c.dataset.id); });

// ---------- candidates ----------
const parseSkills = s => [...new Set(s.split(",").map(x => x.trim().toLowerCase().replace(/\.js$/, "")).filter(Boolean))];
$("f-save").onclick = () => {
  const name = $("f-name").value.trim(); if (!name) { $("f-name").focus(); return; }
  const raw = $("f-skills").value.trim();
  CANDS.push({ id: "k" + Date.now(), name, role: $("f-role").value.trim(), bool: isBool(raw) ? raw : "", skills: isBool(raw) ? [] : parseSkills(raw), loc: $("f-loc").value.trim(), sen: $("f-sen").value });
  saveC(); ["f-name", "f-role", "f-skills", "f-loc"].forEach(i => $(i).value = ""); refresh();
};
function renderCands() {
  $("clist").innerHTML = CANDS.length ? CANDS.map(k => {
    const ms = list.filter(c => c.matches.some(m => m.k.id === k.id)).sort((a, b) => b.score - a.score);
    return `<div class="cand"><div style="display:flex;align-items:flex-start;gap:8px"><div><h3>${esc(k.name)}${k.sample ? ' <span class="tag t-plain" style="vertical-align:2px">Sample</span>' : ""}</h3><p>${esc([k.role, k.sen, k.loc].filter(Boolean).join(" · "))}</p></div><button class="x" data-del="${k.id}">Remove</button></div>
    <div class="tags" style="flex-wrap:wrap">${k.bool ? `<span class="tag t-match">${esc(k.bool)}</span>` : (k.skills || []).map(s => `<span class="tag t-plain">${esc(s)}</span>`).join("")}</div>
    <div class="mt">${ms.length ? `Fits <b>${ms.length}</b> lead${ms.length > 1 ? "s" : ""}: ${ms.slice(0, 4).map(c => `<button data-open-c="${c.id}">${esc(c.name)}</button>`).join(", ")}${ms.length > 4 ? ` and ${ms.length - 4} more` : ""}` : "No matching leads yet"}</div></div>`;
  }).join("") : `<div class="panel"><div class="qempty">No candidates yet. Add who you're working with and every lead gets checked against them.</div></div>`;
}
$("clist").addEventListener("click", e => { const d = e.target.closest("[data-del]"); if (d) { CANDS = CANDS.filter(k => k.id !== d.dataset.del); saveC(); refresh(); return; } const o = e.target.closest("[data-open-c]"); if (o) openC(o.dataset.openC); });

// ---------- sources ----------
function renderSources() {
  const S2 = DATA.sources || {};
  const on = k => S2[k] && S2[k].ok && (S2[k].count || 0) > 0;
  const badge = k => on(k) ? [`Live · ${S2[k].count}`, "t-ok"] : DEMO ? ["Plug in", "t-plain"] : (S2[k] ? ["Add key", "t-p1"] : ["Planned", "t-plain"]);
  const cards = [
    ["Company job boards", "Careers pages for every watchlist company across 9 hiring systems, plus every company the radar has found before.", "", "jobs"],
    ["VC portfolio job boards", "Every engineering role across the portfolios of Dragonfly, Polychain, Multicoin, Paradigm, Pantera, Variant and more.", "", "vc"],
    ["Crypto job sites", "Cryptocurrency Jobs, CryptoJobsList and Remote3, for companies you'd never think to watch.", "", "sites"],
    ["Funding rounds", "Fresh raises from CoinDesk, The Block, Blockworks, Decrypt and Cointelegraph.", "", "funding"],
    ["Telegram", "Public crypto job channels, read daily for hiring posts.", "", "telegram"],
    ["X (Twitter)", "Hiring posts, plus projects flagged by smart money trackers before they raise.", "About $15/mo via TwitterAPI.io, add TWITTERAPI_KEY", "x"],
    ["GitHub activity", "Spots teams where more engineers are committing code than last month, often before roles go public.", "", "github"],
    ["Farcaster", "Hiring posts from crypto founders and builders.", "Free tier via Neynar, add NEYNAR_API_KEY", "farcaster"],
    ["Apollo.io", "Finds the CTO or Head of Engineering at the best leads.", "Paid plan, add APOLLO_API_KEY", "apollo"],
    ["Market data", "BD Radar's own hiring index, plus BTC, ETH, SOL, DeFi TVL, stablecoins and DEX volume from CoinGecko and DeFiLlama.", "", "market"]
  ];
  const card = ([t, d, cost, k]) => { const [lab, cls] = badge(k), info = S2[k];
    return `<div class="src"><div class="src-top"><h3>${t}</h3><span class="tag ${cls}">${lab}</span></div><p>${d}</p>${!DEMO && cost ? `<div class="cost">${cost}</div>` : ""}${!DEMO && info && info.notes && info.notes.length ? `<details><summary>Last run details</summary><ul>${info.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}</div>`; };
  const GROUPS = [["Job sources", ["Company job boards", "VC portfolio job boards", "Crypto job sites"]], ["Signals", ["Funding rounds", "Telegram", "GitHub activity", "Market data"]], ["Plug-ins", ["X (Twitter)", "Farcaster", "Apollo.io"]]];
  const pick = names => names.map(n => cards.find(c => c[0] === n)).filter(c => !DEMO || on(c[3]) || ["x", "farcaster", "apollo"].includes(c[3]));
  $("srcs").innerHTML = GROUPS.map(([g, names]) => { const cs = pick(names); return cs.length ? `<h2 class="srcgroup">${g}${g === "Plug-ins" ? ` <span style="text-transform:none;letter-spacing:0;color:var(--faint)">· optional, switch on with an API key</span>` : ""}</h2><div class="srcgrid">${cs.map(card).join("")}</div>` : ""; }).join("");
}
$("refreshbtn").href = `https://github.com/${REPO}/actions/workflows/daily.yml`;

// ---------- backup ----------
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify({ app: "bd-radar", exported: new Date().toISOString(), state: S, candidates: CANDS }, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bd-radar-backup-${ymd(new Date())}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("import").onclick = () => $("importfile").click();
$("importfile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.state) S = Object.assign({}, S, d.state);
    if (Array.isArray(d.candidates)) { const ids = new Set(CANDS.map(k => k.id)); d.candidates.forEach(k => { if (!ids.has(k.id)) CANDS.push(k); }); }
    save(); saveC(); refresh(); alert("Backup imported.");
  } catch (err) { alert("That file isn't a BD Radar backup."); }
  e.target.value = "";
};
$("forget").onclick = () => { store.del("bdr-pass"); location.reload(); };

// ---------- nav ----------
function go(v) { document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-" + v)); document.querySelectorAll(".nav").forEach(n => { if (n.dataset.view === v) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current"); }); document.querySelector("main").scrollTop = 0; }
document.querySelectorAll(".nav").forEach(n => n.onclick = () => go(n.dataset.view));
// ---------- market ----------
const RANGES = [["2W", 14], ["1M", 30], ["3M", 90], ["6M", 182], ["1Y", 365]];
let RANGE = store.get(PFX + "range", 30);
const MK = [
  ["roles", "Open eng roles", "Engineering roles live across every company on the radar today.", "BD Radar", "n"],
  ["cos", "Companies hiring", "Companies on the radar with at least one engineering role open.", "BD Radar", "n"],
  ["raised", "Capital raised / wk", "Crypto venture funding announced each week.", "DeFiLlama", "m"],
  ["tvl", "DeFi TVL", "Total value locked across DeFi. A proxy for on chain activity.", "DeFiLlama", "$"],
  ["stables", "Stablecoin supply", "Total stablecoins in circulation. Rising supply usually means fresh capital.", "DeFiLlama", "$"],
  ["dex", "DEX volume / day", "Daily trading volume on decentralised exchanges.", "DeFiLlama", "$"],
  ["btc", "Bitcoin", "BTC price in USD.", "CoinGecko", "$"],
  ["eth", "Ethereum", "ETH price in USD.", "CoinGecko", "$"],
  ["sol", "Solana", "SOL price in USD.", "CoinGecko", "$"]
];
const MKC = { roles: "var(--mint)", cos: "var(--mint)", raised: "var(--amber)", stables: "var(--amber)", btc: "var(--sky)", eth: "var(--sky)", sol: "var(--sky)", tvl: "var(--violet)", dex: "var(--violet)" };
const MKHEX = { "var(--mint)": "#5EEAD4", "var(--amber)": "#F7B955", "var(--sky)": "#7DD3FC", "var(--violet)": "#A78BFA" };
const SWITCH = [["capital", "Capital", [["raised", "Raised"], ["stables", "Stables"]], "Funding today becomes hiring in 1 to 3 months."], ["markets", "Markets", [["btc", "BTC"], ["eth", "ETH"], ["sol", "SOL"]], "Prices drive sentiment and hiring budgets."], ["chain", "On chain", [["tvl", "TVL"], ["dex", "DEX vol"]], "Real usage. Busy protocols scale their teams."]];
let SWSEL = store.get(PFX + "sw", { capital: "raised", markets: "btc", chain: "tvl" });
const fmtV = (v, u) => { if (v == null) return "n/a"; if (u === "n") return Math.round(v).toLocaleString("en-GB"); if (u === "m") return `$${v >= 1000 ? (v / 1000).toFixed(1) + "B" : Math.round(v) + "M"}`; const a = Math.abs(v); return "$" + (a >= 1e12 ? (v / 1e12).toFixed(2) + "T" : a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e4 ? Math.round(v / 1e3) + "k" : Math.round(v).toLocaleString("en-GB")); };
function slice(key) {
  const s = (DATA.market && DATA.market.series && DATA.market.series[key]) || [];
  const cut = new Date(Date.now() - RANGE * DAY).toISOString().slice(0, 10);
  return s.filter(p => p[0] >= cut).map(p => [p[0], +p[1]]);
}
function change(pts) { if (pts.length < 2 || !pts[0][1]) return null; return (pts[pts.length - 1][1] - pts[0][1]) / pts[0][1] * 100; }
function pathFor(pts, w, h, pad = 2) {
  const ys = pts.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  return pts.map((p, i) => [pad + i / Math.max(1, pts.length - 1) * (w - pad * 2), h - pad - (p[1] - lo) / span * (h - pad * 2)]);
}
function svgLine(pts, w, h, big, col = "#E8E8E9") {
  if (pts.length < 2) return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" y1="${h - 1}" x2="${w}" y2="${h - 1}" stroke="rgba(255,255,255,.12)" stroke-dasharray="2 4"/></svg>`;
  const xy = pathFor(pts, w, h), d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const id = "g" + Math.random().toString(36).slice(2, 7), last = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="${big ? .22 : .26}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${d}L${last[0]},${h}L${xy[0][0]},${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-opacity=".95" stroke-width="${big ? 1.4 : 1.2}" vector-effect="non-scaling-stroke"/>${big ? `<line class="cross" x1="0" x2="0" y1="0" y2="${h}" stroke="rgba(244,233,218,.35)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>` : ""}</svg>`;
}
function setupRanges() {
  ["rangesB"].forEach(id => { $(id).innerHTML = RANGES.map(([l, d]) => `<button data-range="${d}" aria-pressed="${d === RANGE}">${l}</button>`).join(""); });
  document.querySelectorAll("[data-range]").forEach(b => b.onclick = () => { RANGE = +b.dataset.range; store.set(PFX + "range", RANGE); document.querySelectorAll("[data-range]").forEach(x => x.setAttribute("aria-pressed", +x.dataset.range === RANGE)); renderMarket(); });
}
function renderMarket() {
  if (!DATA) return;
  const card = (k, big) => {
    const m = MK.find(x => x[0] === k), pts = slice(k), last = pts.length ? pts[pts.length - 1][1] : null, ch = change(pts);
    const chg = ch == null ? `<span class="chg">${pts.length < 2 ? "collecting" : ""}</span>` : `<span class="chg ${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}%</span>`;
    if (!big) return `<button class="mcard" data-mk="${k}" data-tip="${m[2]}"><div class="k"><span class="label">${m[1]}</span>${chg}</div><div class="v">${fmtV(last, m[4])}</div><div class="spark">${svgLine(pts, 200, 40)}</div></button>`;
    return `<div class="panel mbig" data-chart="${k}" style="--c:${MKC[k] || "var(--line2)"}"><div class="panel-head"><h2 data-tip="${m[2]}">${m[1]}</h2>${chg}</div><div class="v">${fmtV(last, m[4])}</div><div class="chart">${svgLine(pts, 600, 170, true, MKHEX[MKC[k]] || "#E8E8E9")}<div class="tip"></div></div><div class="msrc">${m[3]}${pts.length ? ` · ${pts.length} data point${pts.length === 1 ? "" : "s"}` : ""}</div></div>`;
  };
  const chgHtml = pts => { const ch = change(pts); return ch == null ? `<span class="chg">${pts.length < 2 ? "collecting" : ""}</span>` : `<span class="chg ${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}%</span>`; };
  const rp = slice("roles"), cp = slice("cos"), lv = p => p.length ? p[p.length - 1][1] : null;
  const hiring = `<div class="mcard" style="--c:var(--mint)"><div class="k"><span class="label" data-tip="Live engineering roles and companies hiring across everything on the radar. Collected by BD Radar every morning.">Hiring</span><div class="ranges" id="rangesA">${RANGES.map(([l, d]) => `<button data-range="${d}" aria-pressed="${d === RANGE}">${l}</button>`).join("")}</div></div><div class="duo"><div><div class="v">${fmtV(lv(rp), "n")}</div><small>open eng roles ${chgHtml(rp)}</small></div><div><div class="v">${fmtV(lv(cp), "n")}</div><small>companies hiring ${chgHtml(cp)}</small></div></div><div class="spark">${svgLine(rp, 300, 40, false, "#5EEAD4")}</div></div>`;
  const has = k => (((DATA.market || {}).series || {})[k] || []).length >= 3;
  const sw = SWITCH.map(([id, label, opts0, why]) => { const opts = opts0.filter(([v]) => has(v)); if (!opts.length) opts.push(opts0[0]); const k = opts.some(o => o[0] === SWSEL[id]) ? SWSEL[id] : opts[0][0], m = MK.find(x => x[0] === k), p = slice(k), col = MKC[k];
    return `<div class="mcard" style="--c:${col}"><div class="k"><span class="label" data-tip="${m[2]}">${label}</span><div class="sw">${opts.length < 2 ? "" : opts.map(([v, t]) => `<button data-sw="${id}" data-k="${v}" aria-pressed="${v === k}">${t}</button>`).join("")}</div></div><div class="v">${fmtV(lv(p), m[4])}</div>${chgHtml(p)}<div class="spark">${svgLine(p, 200, 40, false, MKHEX[col])}</div><div class="why">${({ raised: "Funding today becomes hiring in 1 to 3 months.", stables: "New money entering crypto. Budgets follow.", btc: "Prices drive sentiment and hiring budgets.", eth: "Health of the Ethereum ecosystem.", sol: "Health of the Solana ecosystem.", tvl: "Real usage. Busy protocols scale their teams.", dex: "Trading activity on decentralised exchanges." })[k] || why}</div></div>`; }).join("");
  $("mrow").innerHTML = hiring + sw;
  $("mrow").querySelectorAll("[data-sw]").forEach(b => b.onclick = () => { SWSEL[b.dataset.sw] = b.dataset.k; store.set(PFX + "sw", SWSEL); renderMarket(); });
  $("mrow").querySelectorAll("[data-range]").forEach(b => b.onclick = () => { RANGE = +b.dataset.range; store.set(PFX + "range", RANGE); setupRanges(); renderMarket(); });
  $("mgrid").innerHTML = MK.filter(m => (((DATA.market || {}).series || {})[m[0]] || []).length >= 2).map(m => card(m[0], true)).join("");
  document.querySelectorAll("[data-chart]").forEach(el => {
    const k = el.dataset.chart, m = MK.find(x => x[0] === k), pts = slice(k), box = el.querySelector(".chart"), tip = el.querySelector(".tip"), cross = el.querySelector(".cross");
    if (pts.length < 2) return;
    box.onmousemove = e => {
      const r = box.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), i = Math.round(f * (pts.length - 1));
      const x = i / (pts.length - 1) * r.width;
      tip.style.left = x + "px"; tip.textContent = `${new Date(pts[i][0] + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${fmtV(pts[i][1], m[4])}`;
      if (cross) { const vx = i / (pts.length - 1) * 600; cross.setAttribute("x1", vx); cross.setAttribute("x2", vx); cross.setAttribute("visibility", "visible"); }
      box.classList.add("hov");
    };
    box.onmouseleave = () => { box.classList.remove("hov"); if (cross) cross.setAttribute("visibility", "hidden"); };
  });
}


// ---------- settings ----------
["cad0", "cad1", "cad2"].forEach((id, i) => { $(id).value = CAD[i]; $(id).onchange = () => { const v = Math.max(1, Math.round(+$(id).value || CAD[i])); CAD[i] = v; CAD = [CAD[0], Math.max(CAD[1], CAD[0] + 1), Math.max(CAD[2], Math.max(CAD[1], CAD[0] + 1) + 1)]; store.set(PFX + "cad", CAD); ["cad0", "cad1", "cad2"].forEach((x, j) => $(x).value = CAD[j]); refresh(); }; });

function refresh() { computeMatches(); renderMarket(); renderOverview(); renderQueue(); render(); renderBoard(); renderCands(); if (selected && drawer.classList.contains("on")) drawHTML(); }
boot();
