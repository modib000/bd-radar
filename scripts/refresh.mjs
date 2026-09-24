// BD Radar daily refresh. Runs on GitHub Actions every morning.
// Pulls hiring, funding and social signals, scores every company,
// and writes an encrypted data file the dashboard unlocks with your passphrase.
// No packages needed: Node 20+.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";

const ROOT = new URL("..", import.meta.url);
const DATA_FILE = new URL("data/leads.enc.json", ROOT);
const PASS = process.env.RADAR_PASSPHRASE;
const KEYS = {
  apollo: process.env.APOLLO_API_KEY || "",
  twitter: process.env.TWITTERAPI_KEY || "",
  neynar: process.env.NEYNAR_API_KEY || ""
};
const DAY = 864e5;
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const UA = { "User-Agent": "Mozilla/5.0 (BD Radar daily refresh)", "Accept": "*/*" };

if (!PASS) {
  console.error("\nMissing RADAR_PASSPHRASE. Add it under Settings > Secrets and variables > Actions, then run again.\n");
  process.exit(1);
}

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || "").toLowerCase().replace(/\.(com|io|xyz|fi|finance|network|labs?)$/, "").replace(/[^a-z0-9]/g, "");
const daysSince = iso => iso ? Math.floor((NOW - new Date(iso)) / DAY) : null;
const strip = h => String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").trim();

async function get(url, opts = {}, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 429) { await sleep(3000); continue; }
      return r;
    } catch (e) { if (i === tries - 1) throw e; await sleep(1000); }
  }
  throw new Error("rate limited");
}
async function getJSON(url, opts) { const r = await get(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function getText(url, opts) { const r = await get(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- encryption (same as the dashboard) ----------
const b64 = b => Buffer.from(b).toString("base64");
const unb64 = s => new Uint8Array(Buffer.from(s, "base64"));
async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encrypt(obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(PASS, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}
async function decrypt(file) {
  const key = await keyFrom(PASS, unb64(file.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.iv) }, key, unb64(file.data));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---------- classification ----------
const ENG = /\b(engineer|engineering|developer|dev|sre|devops|architect|programmer|swe|cto)\b|member of technical staff/i;
const NOT_ENG = /\b(sales|solutions|support|customer|success|recruit|recruiter|talent|marketing|account|legal|counsel|compliance|finance|financial|designer|design|product manager|analyst|business|partnership|community|content|writer|operations|hr|people|office|executive assistant|intern)\b/i;
const isEng = t => ENG.test(t) && !NOT_ENG.test(t);
function discipline(role) {
  const r = role.toLowerCase(), o = [];
  if (/front[ -]?end|\bui\b|web engineer/.test(r)) o.push("Frontend");
  if (/full[ -]?stack|product engineer/.test(r)) o.push("Full stack");
  if (/back[ -]?end|integration|api engineer|server/.test(r)) o.push("Backend");
  if (/blockchain|smart contract|solidity|protocol|rust|web3|dapp|evm|solana/.test(r)) o.push("Blockchain");
  if (/platform|devops|infrastructure|\bsre\b|site reliability|cloud|security/.test(r)) o.push("Platform");
  if (/mobile|ios|android|react native/.test(r)) o.push("Mobile");
  if (/\bai\b|\bml\b|machine learning|data/.test(r)) o.push("Data & AI");
  return o.length ? o : ["Software"];
}
const SENIOR = /\b(senior|sr\.?|staff|lead|principal|head|director|vp|chief|cto)\b/i;
function vertical(s) {
  const a = String(s || "").toLowerCase();
  const rules = [["ai", "AI"], ["payment", "Payments"], ["stablecoin", "Payments"], ["remit", "Payments"], ["bank", "Payments"], ["card", "Payments"], ["exchange", "CeFi"], ["custody", "CeFi"], ["broker", "CeFi"], ["trading", "Trading"], ["perp", "Trading"], ["prediction", "Trading"], ["dex", "Trading"], ["market mak", "Trading"], ["lending", "DeFi"], ["defi", "DeFi"], ["yield", "DeFi"], ["rwa", "RWA"], ["tokeni", "RWA"], ["real world", "RWA"], ["gaming", "Gaming"], ["game", "Gaming"], ["nft", "Consumer"], ["wallet", "Consumer"], ["social", "Consumer"], ["mining", "Mining"], ["miner", "Mining"]];
  for (const [k, v] of rules) if (new RegExp("\\b" + k).test(a)) return v;
  return "Infra & data";
}

// ---------- ATS job boards ----------
const ATS = {
  greenhouse: {
    url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    parse: j => (j.jobs || []).map(x => ({ title: x.title, url: x.absolute_url, location: x.location && x.location.name, posted: x.first_published || x.updated_at }))
  },
  lever: {
    url: s => `https://api.lever.co/v0/postings/${s}?mode=json`,
    parse: j => (Array.isArray(j) ? j : []).map(x => ({ title: x.text, url: x.hostedUrl, location: x.categories && x.categories.location, posted: x.createdAt ? new Date(x.createdAt).toISOString() : null }))
  },
  ashby: {
    url: s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    parse: j => (j.jobs || []).filter(x => x.isListed !== false).map(x => ({ title: x.title, url: x.jobUrl, location: x.location, posted: x.publishedAt }))
  },
  workable: {
    url: s => `https://apply.workable.com/api/v1/widget/accounts/${s}`,
    parse: j => (j.jobs || []).map(x => ({ title: x.title, url: x.url || x.shortlink, location: [x.city, x.country].filter(Boolean).join(", "), posted: x.published_on }))
  }
};
function slugGuesses(c) {
  const n = c.name.toLowerCase();
  return [...new Set([c.slug, n.replace(/[^a-z0-9]/g, ""), n.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), n.split(/\s+/)[0].replace(/[^a-z0-9]/g, "")].filter(Boolean))];
}
async function tryBoard(type, slug) {
  try {
    const r = await get(ATS[type].url(slug), {}, 1);
    if (!r.ok) return null;
    const j = await r.json();
    const jobs = ATS[type].parse(j);
    if (type === "lever" && !Array.isArray(j)) return null;
    return jobs;
  } catch { return null; }
}
async function findBoard(c, cache) {
  const hit = cache[c.name];
  if (hit && hit.type) { const jobs = await tryBoard(hit.type, hit.slug); if (jobs) return { ...hit, jobs }; }
  if (hit && hit.none && daysSince(hit.none) < 14 && !c.slug) return null;
  let empty = null;
  for (const slug of slugGuesses(c)) for (const type of ["greenhouse", "ashby", "lever", "workable"]) {
    const jobs = await tryBoard(type, slug);
    if (jobs && jobs.length) { cache[c.name] = { type, slug }; return { type, slug, jobs }; }
    if (jobs && !empty) empty = { type, slug, jobs };
  }
  if (empty) { cache[c.name] = { type: empty.type, slug: empty.slug }; return empty; }
  cache[c.name] = { none: TODAY };
  return null;
}

// ---------- funding ----------
const RAISE = /^(.{2,70}?)\s+(?:raises|secures|closes|lands|nabs|bags|gets|announces|completes|scores)\s+(?:a\s+|an\s+|over\s+|nearly\s+|about\s+)?(?:\$|usd\s?)([\d.,]+)\s*(million|mln|m|billion|bn|b|thousand|k)?\b/i;
const DESCRIPTOR = /^(?:(?:[a-z0-9-]+\s+){0,3}(?:startup|firm|company|platform|protocol|project|provider|network|lender|exchange|issuer|developer|app|fintech|neobank|marketplace|studio|venture|operator|unicorn|player|outfit|specialist|infrastructure)\s+)/i;
function cleanName(raw) {
  let n = raw.replace(/^(exclusive|breaking|report|scoop)\s*[:|-]\s*/i, "").replace(/,.*$/, "").replace(/['’]s$/, "").trim();
  for (let i = 0; i < 2; i++) { const s = n.replace(DESCRIPTOR, "").trim(); if (s && s !== n && /^[A-Z0-9]/.test(s)) n = s; }
  return n.length > 1 && n.length < 45 && /[A-Za-z]/.test(n) && n.split(/\s+/).length <= 5 ? n : null;
}
function toMillions(num, unit) {
  const v = parseFloat(String(num).replace(/,/g, "")); const u = (unit || "m").toLowerCase();
  return u.startsWith("b") ? v * 1000 : u === "k" || u === "thousand" ? v / 1000 : v;
}
const ROUND = t => { const m = String(t).match(/pre[- ]seed|seed|series [a-f]\b|strategic|private|growth|bridge/i); return m ? m[0].replace(/\b\w/g, c => c.toUpperCase()) : "Undisclosed round"; };
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const g = tag => { const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return m ? strip(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : ""; };
    let link = g("link"); if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ""; }
    items.push({ title: g("title"), link, date: g("pubDate") || g("published") || g("updated") || g("dc:date"), desc: g("description").slice(0, 400) });
  }
  return items;
}
async function fundingFromNews(feeds, lookback, report) {
  const out = [];
  await pool(feeds, 4, async url => {
    try {
      const items = parseFeed(await getText(url));
      let n = 0;
      for (const it of items) {
        const m = it.title.match(RAISE); if (!m) continue;
        const d = it.date ? new Date(it.date) : NOW; if (isNaN(d) || (NOW - d) / DAY > lookback) continue;
        const name = cleanName(m[1]); if (!name) continue;
        out.push({ name, amountM: toMillions(m[2], m[3]), round: ROUND(it.title + " " + it.desc), date: d.toISOString().slice(0, 10), url: it.link, headline: it.title, vertical: vertical(it.title + " " + it.desc), source: new URL(url).hostname.replace(/^www\./, "") });
        n++;
      }
      report.push(`${new URL(url).hostname}: ${n} raises`);
    } catch (e) { report.push(`${url}: ${e.message}`); }
  });
  return out;
}
async function fundingFromDefiLlama(lookback, report) {
  try {
    const j = await getJSON("https://api.llama.fi/raises");
    const out = (j.raises || []).filter(r => (NOW / 1000 - r.date) / 86400 <= lookback).map(r => ({
      name: r.name, amountM: r.amount || 0, round: r.round || "Undisclosed round", date: new Date(r.date * 1000).toISOString().slice(0, 10),
      url: r.source || "", headline: `${r.name} raised ${r.amount ? "$" + r.amount + "m" : "an undisclosed amount"}${r.round ? " (" + r.round + ")" : ""}`,
      vertical: vertical([r.category, r.sector].join(" ")), investors: [...(r.leadInvestors || []), ...(r.otherInvestors || [])].slice(0, 5), source: "DeFiLlama"
    }));
    report.push(`DeFiLlama: ${out.length} raises`);
    return out;
  } catch (e) { report.push(`DeFiLlama: ${e.message} (may need a paid plan, news feeds still cover funding)`); return []; }
}

// ---------- social ----------
const HIRING = /\b(hiring|we're looking for|we are looking for|join (?:our|the) team|open role|now recruiting|job opening|come build)\b/i;
const IS_HIRING = /(?:^|[•\n·|-]\s*)([A-Z][A-Za-z0-9.&' -]{1,38}?)\s+is (?:now )?hiring(?: an?)?\s+([^\n•|]{3,90})/g;
function socialPosts(text) {
  const posts = [];
  for (const m of text.matchAll(IS_HIRING)) {
    const role = m[2].replace(/\s*(\(|apply|→|http|📍|🌍).*$/i, "").trim();
    if (isEng(role)) posts.push({ company: m[1].trim(), role });
  }
  return posts;
}
async function telegram(channels, report) {
  const out = [];
  await pool(channels, 3, async ch => {
    try {
      const html = await getText(`https://t.me/s/${ch}`);
      const chunks = html.split('class="tgme_widget_message_wrap').slice(1);
      let n = 0;
      for (const c of chunks) {
        const t = c.match(/<time[^>]*datetime="([^"]+)"/); const date = t ? t[1] : null;
        if (!date || daysSince(date) > 3) continue;
        const post = (c.match(/data-post="([^"]+)"/) || [])[1];
        const body = c.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
        const text = strip(body ? body[1] : "");
        for (const p of socialPosts(text)) { out.push({ ...p, platform: "Telegram", date: date.slice(0, 10), url: post ? `https://t.me/${post}` : `https://t.me/s/${ch}`, text: `${p.company} is hiring ${p.role}` }); n++; }
      }
      report.push(`@${ch}: ${n} hiring posts`);
    } catch (e) { report.push(`@${ch}: ${e.message}`); }
  });
  return out;
}
async function farcaster(queries, report) {
  if (!KEYS.neynar) { report.push("No NEYNAR_API_KEY secret, skipped"); return []; }
  const out = [];
  for (const q of queries) {
    try {
      const j = await getJSON(`https://api.neynar.com/v2/farcaster/cast/search?q=${encodeURIComponent(q)}&limit=50&sort_type=desc_chron`, { headers: { "x-api-key": KEYS.neynar, accept: "application/json" } });
      const casts = (j.result && j.result.casts) || j.casts || [];
      let n = 0;
      for (const c of casts) {
        if (daysSince(c.timestamp) > 3 || !HIRING.test(c.text) || !ENG.test(c.text)) continue;
        out.push({ company: null, role: "", platform: "Farcaster", date: String(c.timestamp).slice(0, 10), url: `https://warpcast.com/${c.author && c.author.username}/${String(c.hash).slice(0, 10)}`, text: c.text.slice(0, 280), author: c.author && (c.author.display_name || c.author.username) });
        n++;
      }
      report.push(`"${q}": ${n} casts`);
    } catch (e) { report.push(`"${q}": ${e.message}`); }
  }
  return out;
}
async function xSearch(queries, report) {
  if (!KEYS.twitter) { report.push("No TWITTERAPI_KEY secret, skipped"); return []; }
  const out = [];
  for (const q of queries) {
    try {
      const j = await getJSON(`https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(q + " since:" + new Date(NOW - 2 * DAY).toISOString().slice(0, 10))}`, { headers: { "X-API-Key": KEYS.twitter } });
      const tweets = j.tweets || [];
      for (const t of tweets) out.push({ company: null, role: "", platform: "X", date: new Date(t.createdAt).toISOString().slice(0, 10), url: t.url, text: String(t.text).slice(0, 280), author: t.author && (t.author.name || t.author.userName) });
      report.push(`${tweets.length} posts`);
    } catch (e) { report.push(`X: ${e.message}`); }
  }
  return out;
}

// ---------- Apollo ----------
async function apolloContact(domain, titles) {
  const r = await get("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": KEYS.apollo },
    body: JSON.stringify({ q_organization_domains_list: [domain], person_titles: titles, page: 1, per_page: 3 })
  }, 1);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const p = (j.people || j.contacts || [])[0];
  return p ? { name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "), title: p.title, linkedin: p.linkedin_url || "", email: p.email && !/not_unlocked|email_not/.test(p.email) ? p.email : "", source: "Apollo", found: TODAY } : { none: TODAY };
}

// ---------- scoring ----------
const VFIT = { Payments: 3, Trading: 3, "Infra & data": 3, DeFi: 3, CeFi: 3, RWA: 2, AI: 2 };
function score(c) {
  const parts = [], roles = c.roles;
  if (roles.length) {
    const n = roles.length;
    parts.push([n >= 6 ? 5 : n >= 3 ? 4 : n === 2 ? 3 : 2, `${n} open engineering role${n > 1 ? "s" : ""}`]);
    const newest = Math.min(...roles.map(r => r.age));
    parts.push([newest <= 2 ? 3 : newest <= 7 ? 2 : 1, newest <= 2 ? "New role in the last 2 days" : newest <= 7 ? "New role this week" : "No new roles this week"]);
    if (roles.some(r => SENIOR.test(r.title))) parts.push([2, "Senior level hiring"]);
    if (c.disc.filter(d => d !== "Software").length >= 2) parts.push([2, "Hiring across several disciplines"]);
    if (c.stale) parts.push([3, "Role open 30+ days, likely hard to fill"]);
  }
  if (c.funding) {
    const a = c.funding.amountM || 0;
    parts.push([a >= 50 ? 7 : a >= 10 ? 6 : a >= 3 ? 5 : a >= 1 ? 4 : 3, a ? `Raised $${+a.toFixed(1)}m` : "Raised, amount undisclosed"]);
    if (daysSince(c.funding.date) <= 14) parts.push([2, "Raise in the last 2 weeks"]);
  }
  if (c.social.length) parts.push([2, `Hiring posts on ${[...new Set(c.social.map(s => s.platform))].join(" and ")}`]);
  if (c.contact && c.contact.name) parts.push([2, "Decision maker found"]);
  const vf = VFIT[c.vertical] || 1;
  parts.push([vf, `${c.vertical} is ${vf === 3 ? "engineering heavy" : vf === 2 ? "moderately engineering heavy" : "lighter on engineering"}`]);
  const types = (roles.length ? 1 : 0) + (c.funding ? 1 : 0) + (c.social.length ? 1 : 0);
  if (types >= 2) parts.push([3, "Several signals at once"]);
  c.parts = parts;
  c.score = Math.min(20, parts.reduce((a, p) => a + p[0], 0));
  c.tier = c.score >= 16 ? "hot" : c.score >= 12 ? "strong" : "watch";
}
function story(c) {
  const R = c.roles, F = c.funding, bits = [];
  if (R.length) { const newest = Math.min(...R.map(r => r.age)); bits.push(`${R.length} open engineering role${R.length > 1 ? "s" : ""} (${c.disc.join(", ")}), newest posted ${newest === 0 ? "today" : newest === 1 ? "yesterday" : newest + " days ago"}.`); }
  if (F) bits.push(`Raised ${F.amountM ? "$" + (+F.amountM.toFixed(1)) + "m" : "an undisclosed amount"} (${F.round}) on ${F.date}.`);
  if (c.social.length) bits.push(`Hiring posts on ${[...new Set(c.social.map(s => s.platform))].join(" and ")}.`);
  c.why = bits.join(" ");
  const stale = R.filter(r => r.age >= 30).sort((a, b) => b.age - a.age)[0];
  if (stale) c.angle = `Their ${stale.title} role has been open ${stale.age} days. Lead with one or two candidates you could put forward this week rather than a generic pitch.`;
  else if (F && R.length) c.angle = `Fresh capital plus live engineering roles. Offer to take the hardest role off their plate and show you can cover the rest of the build out.`;
  else if (F) c.angle = `Just raised. Engineering hiring usually follows within weeks, so get in before the roles go public and help shape the first hires.`;
  else if (R.length >= 3) c.angle = `Hiring across ${c.disc.join(", ")} at once. Pitch one specialist partner for the whole engineering push instead of role by role.`;
  else if (R.length) c.angle = `Open with a relevant candidate for the ${R[0].title} role and use it to start the wider conversation.`;
  else c.angle = `Hiring chatter on social. Worth a light touch message to find out what's coming.`;
}

// ---------- main ----------
async function main() {
  const watch = JSON.parse(await readFile(new URL("config/watchlist.json", ROOT), "utf8")).companies;
  const cfg = JSON.parse(await readFile(new URL("config/sources.json", ROOT), "utf8"));
  let prev = { history: { roles: {}, companies: {}, ats: {}, apollo: {} }, companies: [] };
  try { prev = await decrypt(JSON.parse(await readFile(DATA_FILE, "utf8"))); console.log("Loaded previous data"); }
  catch (e) { console.log("No previous data (first run or passphrase changed). Starting fresh."); }
  const H = Object.assign({ roles: {}, companies: {}, ats: {}, apollo: {} }, prev.history);
  const sources = {};

  // 1. funding
  const fundRep = [];
  const raises = [...await fundingFromDefiLlama(cfg.fundingLookbackDays || 30, fundRep), ...await fundingFromNews(cfg.newsFeeds || [], cfg.fundingLookbackDays || 30, fundRep)];
  const fundBy = {};
  for (const r of raises) { const k = norm(r.name); if (!fundBy[k] || (r.amountM || 0) > (fundBy[k].amountM || 0) || r.date > fundBy[k].date) fundBy[k] = r; }
  sources.funding = { ok: true, count: Object.keys(fundBy).length, notes: fundRep };
  console.log(`Funding: ${Object.keys(fundBy).length} companies`);

  // 2. social
  const tgRep = [], fcRep = [], xRep = [];
  const social = [...await telegram(cfg.telegramChannels || [], tgRep), ...await farcaster(cfg.farcasterQueries || [], fcRep), ...await xSearch(cfg.xQueries || [], xRep)];
  sources.telegram = { ok: true, count: social.filter(s => s.platform === "Telegram").length, notes: tgRep };
  sources.farcaster = { ok: !!KEYS.neynar, count: social.filter(s => s.platform === "Farcaster").length, notes: fcRep };
  sources.x = { ok: !!KEYS.twitter, count: social.filter(s => s.platform === "X").length, notes: xRep };

  // 3. company universe: watchlist + newly funded + companies seen hiring on social
  const universe = new Map();
  const add = (name, extra = {}) => { const k = norm(name); if (!k) return null; if (!universe.has(k)) universe.set(k, { name, ...extra }); else Object.assign(universe.get(k), Object.fromEntries(Object.entries(extra).filter(([, v]) => v))); return universe.get(k); };
  watch.forEach(w => add(w.name, { ...w, watch: true }));
  Object.values(fundBy).forEach(f => add(f.name, { vertical: f.vertical }));
  social.filter(s => s.company).forEach(s => add(s.company, {}));
  // match unnamed social posts (Farcaster, X) to known companies by name in text
  const known = [...universe.values()].filter(u => u.name.length >= 4);
  social.filter(s => !s.company).forEach(s => { const hit = known.find(u => new RegExp(`\\b${u.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s.text)); if (hit) s.company = hit.name; });

  // 4. job boards
  const list = [...universe.values()];
  let boards = 0, missing = [];
  await pool(list, 8, async u => {
    const b = await findBoard(u, H.ats);
    if (!b) { if (u.watch) missing.push(u.name); u.jobs = []; return; }
    boards++; u.ats = { type: b.type, slug: b.slug };
    u.jobs = b.jobs.filter(j => j.title && isEng(j.title));
  });
  sources.jobs = { ok: true, count: boards, notes: [`${boards} company job boards read`, ...(missing.length ? [`Jobs page not found for: ${missing.sort().join(", ")}. Add a slug in config/watchlist.json if they're hiring.`] : [])] };
  console.log(`Job boards: ${boards} found, ${missing.length} watchlist companies not found`);

  // 5. build companies
  const prevByName = Object.fromEntries((prev.companies || []).map(c => [norm(c.name), c]));
  const companies = [];
  for (const u of list) {
    const k = norm(u.name);
    const roles = (u.jobs || []).map(j => {
      const id = j.url || `${u.name}|${j.title}`;
      const posted = j.posted && !isNaN(new Date(j.posted)) ? new Date(j.posted).toISOString().slice(0, 10) : null;
      if (!H.roles[id]) H.roles[id] = posted && posted <= TODAY ? posted : TODAY;
      const first = H.roles[id];
      return { title: j.title.trim(), url: j.url, location: j.location || "", firstSeen: first, age: daysSince(first), disc: discipline(j.title) };
    }).sort((a, b) => a.age - b.age);
    const funding = fundBy[k] || null;
    const soc = social.filter(s => s.company && norm(s.company) === k);
    if (!roles.length && !funding && !soc.length) continue;
    if (!H.companies[k]) H.companies[k] = TODAY;
    const c = {
      id: k, name: u.name, domain: u.domain || "", vertical: u.vertical || (funding && funding.vertical) || "Infra & data",
      locations: [...new Set(roles.map(r => r.location).filter(Boolean))].slice(0, 3),
      roles, disc: [...new Set(roles.flatMap(r => r.disc))], funding, social: soc,
      contact: (prevByName[k] && prevByName[k].contact) || null,
      firstSeen: H.companies[k], isNew: H.companies[k] === TODAY, watch: !!u.watch, ats: u.ats || null
    };
    c.stale = roles.some(r => r.age >= 30);
    c.newRoles = roles.filter(r => r.firstSeen === TODAY).length;
    score(c); companies.push(c);
  }

  // 6. Apollo contacts for top leads
  const ap = cfg.apollo || {};
  if (KEYS.apollo) {
    const targets = companies.filter(c => c.domain && c.score >= (ap.minScore || 16) && !(c.contact && c.contact.name) && !(H.apollo[c.id] && daysSince(H.apollo[c.id]) < 30)).sort((a, b) => b.score - a.score).slice(0, ap.dailyLimit || 8);
    const notes = []; let found = 0;
    for (const c of targets) {
      try { const r = await apolloContact(c.domain, ap.titles || ["CTO", "VP Engineering", "Head of Engineering"]); H.apollo[c.id] = TODAY; if (r.name) { c.contact = r; found++; score(c); } }
      catch (e) { notes.push(`${c.name}: ${e.message}`); if (/401|403/.test(e.message)) break; }
    }
    sources.apollo = { ok: !notes.some(n => /401|403/.test(n)), count: found, notes: [`Looked up ${targets.length}, found ${found}`, ...notes] };
  } else sources.apollo = { ok: false, count: 0, notes: ["No APOLLO_API_KEY secret yet"] };

  companies.forEach(story);
  companies.sort((a, b) => b.score - a.score);

  // prune history older than 120 days
  for (const [k, v] of Object.entries(H.roles)) if (daysSince(v) > 120) delete H.roles[k];

  const payload = { generatedAt: NOW.toISOString(), date: TODAY, companies, sources, history: H };
  await mkdir(new URL("data/", ROOT), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(await encrypt(payload)));
  // Public demo for your CV: same leads, contact details removed, no history.
  const demo = {
    generatedAt: payload.generatedAt, date: TODAY, demo: true,
    companies: companies.map(c => ({ ...c, contact: c.contact && c.contact.name ? { name: "", title: c.contact.title || "", hidden: true } : null })),
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { ok: v.ok, count: v.count, notes: [] }]))
  };
  await writeFile(new URL("data/demo.json", ROOT), JSON.stringify(demo));
  console.log(`Done: ${companies.length} companies, ${companies.filter(c => c.isNew).length} new today, ${companies.filter(c => c.tier === "hot").length} hot.`);
}
main().catch(e => { console.error(e); process.exit(1); });
