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
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const store = {get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const addDays = n => ymd(new Date(today().getTime() + n*DAY));
const dayDiff = s => Math.round((new Date(s+"T00:00:00") - today()) / DAY);
const ago = n => n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
const fmtM = a => a >= 1 ? `$${+a.toFixed(1)}m` : a ? `$${Math.round(a*1000)}k` : "Undisclosed";

// ---------- theme ----------
let theme = store.get("bdr-theme", null); if (theme) document.documentElement.dataset.theme = theme;
$("theme").onclick = () => { const cur = document.documentElement.dataset.theme; const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; theme = dark ? "light" : "dark"; document.documentElement.dataset.theme = theme; store.set("bdr-theme", theme); };

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
let DATA, list = [], S = store.get("bdr-v3", {}), CANDS = store.get("bdr-cands", []);
CANDS.forEach(k => { if (k.disc && k.disc.length) k.skills = [...new Set([...k.disc.filter(d => d !== "Leadership" && d !== "Software").map(d => d.toLowerCase().replace("data & ai", "data")), ...k.skills])]; delete k.disc; });
const save = () => store.set("bdr-v3", S);
const saveC = () => store.set("bdr-cands", CANDS);
const st = c => S[c.name] || {};
function stage(c) { const s = st(c); if (s.stage === "pass" && s.passSig && s.passSig !== c.sig) return ""; return s.stage || ""; }
const snoozed = c => { const s = st(c); return !stage(c) && s.snooze && dayDiff(s.snooze) > 0; };
const untriaged = c => !stage(c) && !snoozed(c);
const nextOf = c => ACTIVE.includes(stage(c)) ? st(c).next || "" : "";
const isDue = c => { const n = nextOf(c); return n && dayDiff(n) <= 0; };
function setState(c, patch) { S[c.name] = Object.assign({}, S[c.name], patch); save(); refresh(); }
function setStage(c, s) {
  const p = { stage: s };
  if (s === "contacted" && !st(c).next) p.next = addDays(3);
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
function matchesFor(c) {
  return CANDS.map(k => {
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
const what = c => c.roles.length ? c.roles.map(r => r.title).join(", ") : c.funding ? `${fmtM(c.funding.amountM)}, ${c.funding.round}` : (c.social[0] && c.social[0].text) || "";
const contactLine = c => c.contact && c.contact.name ? `${c.contact.name}, ${c.contact.title || ""}` : "CTO or Head of Engineering";
function tags(c) {
  return `${c.isNew ? '<span class="tag t-ok">New</span>' : ""}${c.roles.length ? '<span class="tag t-hire">Hiring</span>' : ""}${c.funding ? '<span class="tag t-fund">Raised</span>' : ""}${c.social.length ? '<span class="tag t-social">Social</span>' : ""}${c.stale ? '<span class="tag t-stale">Stale</span>' : ""}${c.matches.length ? `<span class="tag t-match">${c.matches.length} match${c.matches.length > 1 ? "es" : ""}</span>` : ""}`;
}

// ---------- start ----------
function start(d) {
  DATA = d;
  list = d.companies.map(c => Object.assign(c, {
    color: COLORS[[...c.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length],
    sig: `r${c.roles.length}f${c.funding ? c.funding.date : ""}s${c.social.length}`,
    mtext: [c.name, c.vertical, c.roles.map(r => r.title).join(" "), c.disc.map(x => DSYN[x] || "").join(" "), c.funding && c.funding.headline, c.social.map(s => s.text).join(" ")].join(" ").toLowerCase()
  }));
  $("lock").remove();
  document.querySelector(".app").hidden = false;
  const hr = new Date().getHours();
  $("greet").textContent = (hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening") + ", Mo";
  const gen = new Date(d.generatedAt);
  const fresh = (Date.now() - gen) / DAY < 1.5;
  $("rail-foot").innerHTML = `<b><span class="dot ${fresh ? "live" : ""}"></span>${fresh ? "Live" : "Refresh overdue"}</b>Updated ${gen.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} at ${gen.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Refreshes every morning.`;
  setupFilters();
  renderSources();
  refresh();
}

// ---------- overview ----------
function renderOverview() {
  const tri = list.filter(untriaged).length, due = list.filter(isDue).length, stale = list.filter(c => c.stale).length, mt = list.filter(c => c.matches.length).length, hot = list.filter(c => c.tier === "hot").length, nw = list.filter(c => c.isNew).length;
  $("subline").textContent = `${list.length} companies on the radar, ${nw} new today. ${hot} hot, ${tri} waiting to be triaged and ${due} follow up${due === 1 ? "" : "s"} due.`;
  const max = Math.max(...TIERS.map(t => list.filter(c => c.tier === t[0]).length), 1);
  $("tiers").innerHTML = TIERS.map(([k, l, sub]) => {
    const cs = list.filter(c => c.tier === k);
    const h = cs.filter(c => c.roles.length && !c.funding).length, f = cs.filter(c => c.funding && !c.roles.length).length, b = cs.filter(c => c.roles.length && c.funding).length, s = cs.length - h - f - b;
    const w = n => `${n / max * 100}%`;
    return `<div class="tier"><div class="nm"><b>${l}</b><span>${sub}</span></div><div class="stack" title="${h} hiring, ${f} raised, ${b} both${s ? ", " + s + " social only" : ""}">${h ? `<i class="seg-h" style="width:${w(h)}"></i>` : ""}${b ? `<i class="seg-b" style="width:${w(b)}"></i>` : ""}${f ? `<i class="seg-f" style="width:${w(f)}"></i>` : ""}${s ? `<i class="seg-s" style="width:${w(s)}"></i>` : ""}</div><div class="ct">${cs.length}</div></div>`;
  }).join("");
  $("tiles").innerHTML = [["triage", tri, "To triage"], ["due", due, "Follow ups due", due > 0], ["stale", stale, "Stale roles"], ["match", mt, CANDS.length ? "Candidate matches" : "Add candidates"]]
    .map(([k, n, l, al]) => `<button class="tile ${al ? "alert" : ""}" data-go="${k}"><b>${CANDS.length || k !== "match" ? n : "+"}</b><span>${l}</span></button>`).join("");
  $("c-radar").textContent = tri || "";
  $("c-pipe").textContent = list.filter(c => ACTIVE.includes(stage(c))).length || "";
  $("c-cand").textContent = CANDS.length || "";
}
$("tiles").addEventListener("click", e => { const t = e.target.closest("[data-go]"); if (!t) return; if (t.dataset.go === "match" && !CANDS.length) { go("candidates"); return; } setSig(t.dataset.go); document.querySelector(".bar-filters").scrollIntoView({ behavior: "smooth", block: "start" }); });

// ---------- today queue ----------
let tab = "triage";
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b)); renderQueue(); });
function renderQueue() {
  const tri = list.filter(untriaged).sort((a, b) => (b.isNew - a.isNew) || b.score - a.score || b.matches.length - a.matches.length);
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
  $("vert").innerHTML = verts.map(v => `<option>${v === "All" ? "All verticals" : esc(v)}</option>`).join("");
  $("vert").onchange = () => { vert = verts[$("vert").selectedIndex]; render(); };
  DISC = ["All", ...DISCS.filter(d => list.some(c => c.disc.includes(d)))];
  $("disc").innerHTML = DISC.map(d => `<option>${d === "All" ? "All disciplines" : d === "Software" ? "General software" : d}</option>`).join("");
  $("disc").onchange = () => { dsc = DISC[$("disc").selectedIndex]; render(); };
}
function setSig(s) { sig = s; document.querySelectorAll("[data-sig]").forEach(x => x.setAttribute("aria-pressed", x.dataset.sig === s)); render(); }
document.querySelectorAll("[data-sig]").forEach(b => b.onclick = () => setSig(b.dataset.sig));
$("min").oninput = () => { minS = +$("min").value; $("minv").textContent = minS; render(); };
$("q").oninput = e => { q = e.target.value.toLowerCase(); if (!$("v-radar").classList.contains("on")) go("radar"); render(); };
document.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { sortKey = b.dataset.sort; render(); });
const EMPTY = { social: "No social signals today. Hiring posts from Telegram, Farcaster and X land here.", match: "No matches yet. Add candidates and every lead gets checked against them.", due: "No follow ups due today.", triage: "Everything's triaged. Nice.", stale: "No stale roles right now.", new: "Nothing new today yet." };
function render() {
  if (!DATA) return;
  const order = Object.fromEntries([["", -1], ...STAGES.map((s, i) => [s[0], i])]);
  let r = list.filter(c => {
    if (sig === "triage" && !untriaged(c)) return false; if (sig === "hot" && c.tier !== "hot") return false;
    if (sig === "new" && !c.isNew) return false;
    if (sig === "hiring" && !c.roles.length) return false; if (sig === "funding" && !c.funding) return false;
    if (sig === "social" && !c.social.length) return false; if (sig === "stale" && !c.stale) return false;
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
    <td><div class="role" title="${esc(what(c))}" style="color:var(--ink)">${esc(what(c))}</div><div class="role" style="font-size:12px">${c.disc.length ? esc(c.disc.join(" · ")) : c.funding ? "Roles not live yet" : "From social"}</div></td>
    <td><div class="role" style="max-width:220px">${c.contact && c.contact.name ? '<span class="tag t-ok" style="margin-right:6px">Apollo</span>' : ""}${esc(contactLine(c))}</div></td>
    <td><select class="status stagesel" data-s="${stage(c)}" data-id="${c.id}" aria-label="Stage for ${esc(c.name)}"><option value="" ${!stage(c) ? "selected" : ""}>Not triaged</option>${STAGES.map(s => `<option value="${s[0]}" ${stage(c) === s[0] ? "selected" : ""}>${s[1]}</option>`).join("")}</select></td>
    <td><span class="due ${dueCls(nextOf(c))}">${nextOf(c) ? dueLabel(nextOf(c)) : (snoozed(c) ? "Snoozed" : "")}</span></td></tr>`).join("")
    + (r.length > 300 ? `<tr><td colspan="7"><div class="empty">Showing the top 300 of ${r.length}. Narrow the filters to see the rest.</div></td></tr>` : "")
    : `<tr><td colspan="7"><div class="empty">${EMPTY[sig] || "No companies match these filters. Lower the minimum score or clear the search."}</div></td></tr>`;
}
document.addEventListener("change", e => { if (e.target.classList.contains("stagesel")) { const c = list.find(x => x.id === e.target.dataset.id); setStage(c, e.target.value); } });
$("rows").addEventListener("click", e => { if (e.target.closest(".stagesel")) return; const tr = e.target.closest("tr[data-id]"); if (tr) openC(tr.dataset.id); });
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
  if (c.roles.length) sigs.push(`<div class="sig"><div class="ico t-hire">${I.hire}</div><div style="min-width:0"><b>${c.roles.length} open engineering role${c.roles.length > 1 ? "s" : ""}${c.newRoles ? ` · ${c.newRoles} new today` : ""}</b>${c.roles.slice(0, 12).map(r => `<span style="display:block;margin-top:3px"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a> · ${esc(r.location || "Location not listed")} · first seen ${ago(r.age)}${r.age >= 30 ? ' <span class="tag t-stale">Stale</span>' : ""}</span>`).join("")}${c.roles.length > 12 ? `<span>and ${c.roles.length - 12} more</span>` : ""}</div></div>`);
  if (F) sigs.push(`<div class="sig"><div class="ico t-fund">${I.fund}</div><div><b>Raised ${fmtM(F.amountM)} · ${esc(F.round)}</b><span>${esc(F.date)}. ${F.url ? `<a href="${esc(F.url)}" target="_blank" rel="noopener">${esc(F.headline)}</a>` : esc(F.headline)}${F.investors && F.investors.length ? `<br>Investors: ${esc(F.investors.join(", "))}` : ""}</span></div></div>`);
  c.social.forEach(p => sigs.push(`<div class="sig"><div class="ico t-social">${I.chat}</div><div><b>${esc(p.platform)} · ${esc(p.date)}</b><span><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.text)}</a></span></div></div>`));
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
       <div class="contact"><div class="pic">${I.person}</div><div style="flex:1;min-width:0"><b>${esc(K && K.name ? K.name : "CTO or Head of Engineering")}</b><span>${K && K.name ? esc([K.title, K.email].filter(Boolean).join(" · ")) : "No name yet. Apollo looks up Hot leads automatically once connected."}</span></div>${K && K.linkedin ? `<a class="tag t-ok" href="${esc(K.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ""}</div>
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
    return `<div class="lane" data-lane="${k}"><h3>${l}<span>${cs.length}</span></h3>${cs.map(c => `<div class="card" draggable="true" data-id="${c.id}">${av(c)}<div style="min-width:0;flex:1"><b>${esc(c.name)}</b><span>${c.score}/20 · ${esc(c.vertical)}</span>${nextOf(c) ? `<span class="due ${dueCls(nextOf(c))}">Follow up ${dueLabel(nextOf(c)).toLowerCase()}</span>` : ""}<select class="stagesel mini" data-id="${c.id}" aria-label="Move ${esc(c.name)}">${STAGES.map(s => `<option value="${s[0]}" ${k === s[0] ? "selected" : ""}>${s[0] === k ? "Move to…" : s[1]}</option>`).join("")}<option value="">Back to triage</option></select></div></div>`).join("") || `<div class="qempty" style="padding:18px 6px">${k === "todo" ? "Hit Chase on a lead to add it here." : "Nothing here yet."}</div>`}</div>`;
  }).join("");
}
const board = $("board");
board.addEventListener("dragstart", e => { const c = e.target.closest(".card"); if (c) { e.dataTransfer.setData("text/plain", c.dataset.id); c.classList.add("dragging"); } });
board.addEventListener("dragend", e => { const c = e.target.closest(".card"); if (c) c.classList.remove("dragging"); board.querySelectorAll(".lane").forEach(x => x.classList.remove("over")); });
board.addEventListener("dragover", e => { const l = e.target.closest(".lane"); if (l) { e.preventDefault(); board.querySelectorAll(".lane").forEach(x => x.classList.toggle("over", x === l)); } });
board.addEventListener("drop", e => { const l = e.target.closest(".lane"); if (!l) return; e.preventDefault(); const c = list.find(x => x.id === e.dataTransfer.getData("text/plain")); if (c && stage(c) !== l.dataset.lane) setStage(c, l.dataset.lane); });
board.addEventListener("click", e => { if (e.target.closest(".stagesel")) return; const c = e.target.closest(".card"); if (c) openC(c.dataset.id); });

// ---------- candidates ----------
const parseSkills = s => [...new Set(s.split(",").map(x => x.trim().toLowerCase().replace(/\.js$/, "")).filter(Boolean))];
$("f-save").onclick = () => {
  const name = $("f-name").value.trim(); if (!name) { $("f-name").focus(); return; }
  CANDS.push({ id: "k" + Date.now(), name, role: $("f-role").value.trim(), skills: parseSkills($("f-skills").value), loc: $("f-loc").value.trim(), sen: $("f-sen").value });
  saveC(); ["f-name", "f-role", "f-skills", "f-loc"].forEach(i => $(i).value = ""); refresh();
};
$("f-sample").onclick = () => {
  const t = Date.now();
  CANDS.push(
    { id: "k" + t + 1, name: "Example: exchange backend", role: "Senior Backend Engineer", skills: ["backend", "node", "typescript", "postgres", "kafka", "aws"], loc: "London", sen: "Senior" },
    { id: "k" + t + 2, name: "Example: payments full stack", role: "Full Stack Engineer", skills: ["full stack", "frontend", "react", "typescript", "node", "payments"], loc: "Remote EU", sen: "Senior" },
    { id: "k" + t + 3, name: "Example: DeFi protocol", role: "Blockchain Engineer", skills: ["blockchain", "solidity", "evm", "typescript", "rust", "defi"], loc: "London", sen: "Staff / Lead" });
  saveC(); refresh();
};
function renderCands() {
  $("clist").innerHTML = CANDS.length ? CANDS.map(k => {
    const ms = list.filter(c => c.matches.some(m => m.k.id === k.id)).sort((a, b) => b.score - a.score);
    return `<div class="cand"><div style="display:flex;align-items:flex-start;gap:8px"><div><h3>${esc(k.name)}</h3><p>${esc([k.role, k.sen, k.loc].filter(Boolean).join(" · "))}</p></div><button class="x" data-del="${k.id}">Remove</button></div>
    <div class="tags" style="flex-wrap:wrap">${k.skills.map(s => `<span class="tag t-plain">${esc(s)}</span>`).join("")}</div>
    <div class="mt">${ms.length ? `Fits <b>${ms.length}</b> lead${ms.length > 1 ? "s" : ""}: ${ms.slice(0, 4).map(c => `<button data-open-c="${c.id}">${esc(c.name)}</button>`).join(", ")}${ms.length > 4 ? ` and ${ms.length - 4} more` : ""}` : "No matching leads yet"}</div></div>`;
  }).join("") : `<div class="panel"><div class="qempty">No candidates yet. Add who you're working with, or load 3 examples to see how matching works.</div></div>`;
}
$("clist").addEventListener("click", e => { const d = e.target.closest("[data-del]"); if (d) { CANDS = CANDS.filter(k => k.id !== d.dataset.del); saveC(); refresh(); return; } const o = e.target.closest("[data-open-c]"); if (o) openC(o.dataset.openC); });

// ---------- sources ----------
function renderSources() {
  const S2 = DATA.sources || {};
  const live = (k, paid) => { const s = S2[k]; if (!s) return ["Planned", "t-plain"]; if (!s.ok && paid) return ["Add key", "t-p1"]; return [`Live · ${s.count}`, "t-ok"]; };
  const cards = [
    ["Company job boards", "Greenhouse, Lever, Ashby and Workable boards for every watchlist company, plus any newly funded or social company that has one.", "Free", live("jobs"), S2.jobs],
    ["Funding rounds", "DeFiLlama raises plus raise headlines from CoinDesk, The Block, Blockworks, Decrypt and Cointelegraph.", "Free", live("funding"), S2.funding],
    ["Telegram", "Public crypto job channels, read daily for \"X is hiring Y\" posts.", "Free", live("telegram"), S2.telegram],
    ["Farcaster", "Hiring casts from crypto founders and builders.", "Free tier via Neynar, add NEYNAR_API_KEY", live("farcaster", true), S2.farcaster],
    ["X (Twitter)", "Hiring posts across crypto, matched to companies.", "About $15/mo via TwitterAPI.io, add TWITTERAPI_KEY", live("x", true), S2.x],
    ["Apollo.io", "Finds the CTO or Head of Engineering for new Hot leads, a few a day to save credits.", "Paid plan, add APOLLO_API_KEY", live("apollo", true), S2.apollo],
    ["VC portfolio job boards", "Multicoin, Polychain, Dragonfly, a16z crypto and more.", "Free, coming next", ["Planned", "t-plain"], null],
    ["GitHub activity", "Commit and contributor spikes as an early hiring tell.", "Free, coming next", ["Planned", "t-plain"], null]
  ];
  $("srcs").innerHTML = cards.map(([t, d, cost, [lab, cls], info]) => `<div class="src"><div class="src-top"><h3>${t}</h3><span class="tag ${cls}">${lab}</span></div><p>${d}</p><div class="cost">${cost}</div>${info && info.notes && info.notes.length ? `<details><summary>Last run details</summary><ul>${info.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}</div>`).join("");
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
function refresh() { computeMatches(); renderOverview(); renderQueue(); render(); renderBoard(); renderCands(); if (selected && drawer.classList.contains("on")) drawHTML(); }
boot();
