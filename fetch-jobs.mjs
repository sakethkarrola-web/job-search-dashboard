// fetch-jobs.mjs
// Runs on GitHub Actions (Node 20+, native fetch). Pulls Contract/C2C-leaning postings
// from Adzuna (free API, needs ADZUNA_APP_ID/ADZUNA_APP_KEY as env vars / repo secrets)
// and RemoteOK (fully public, no key). Writes data/jobs.json.
//
// Philosophy: "don't miss any opportunity" among FRESH postings - this script does NOT
// silently drop borderline results on relevance grounds. Everything that matches at least
// one mustHaveAny term and no excludeIfAny term is kept, tagged with a confidence score and
// its source, and sorted so the strongest/freshest matches float to the top.
//
// 48-hour rule: postings older than FRESHNESS_WINDOW_HOURS are dropped entirely. Every run
// (scheduled or manual) re-queries live and replaces data/jobs.json with only what's still
// within that window as of the moment it runs - so "run it manually" always yields a fresh
// list, never an accumulation of stale entries.

import fs from "node:fs/promises";

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID || "";
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY || "";
const FRESHNESS_WINDOW_HOURS = 48;

const candidatesFile = JSON.parse(await fs.readFile(new URL("./candidates.json", import.meta.url)));
const candidates = candidatesFile.candidates;

const CONTRACT_WORDS = ["contract", "c2c", "corp-to-corp", "corp to corp", "1099", "w2 contract", "temporary"];
const FULLTIME_EXCLUDE_HINTS = ["full-time only", "direct hire only", "permanent placement", "fte only"];

function scoreAndTag(text, candidate) {
  const lower = text.toLowerCase();
  const mustHits = candidate.mustHaveAny.filter((k) => lower.includes(k));
  if (mustHits.length === 0) return null;
  const excludeHits = (candidate.excludeIfAny || []).filter((k) => lower.includes(k));
  if (excludeHits.length > 0) return null; // wrong product line (e.g. CRM for a BC/NAV resume)

  const isContractish = CONTRACT_WORDS.some((w) => lower.includes(w));
  let score = 40 + mustHits.length * 15;
  if (isContractish) score += 20;
  score = Math.min(score, 95); // never auto-claim near-certainty from a keyword match alone
  return { score, isContractish, mustHits };
}

async function fetchAdzuna(query) {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    console.warn("Adzuna credentials not set - skipping Adzuna for this run.");
    return [];
  }
  // max_days_old=2 asks Adzuna to only return postings from the last 48 hours at the source -
  // we still re-check this ourselves below since "max_days_old" is advisory, not guaranteed.
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&max_days_old=2&sort_by=date&what=${encodeURIComponent(query)}&content-type=application/json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Adzuna request failed (${res.status}) for query "${query}"`);
      return [];
    }
    const data = await res.json();
    return (data.results || []).map((j) => ({
      title: j.title?.replace(/<[^>]+>/g, "") || "Untitled",
      company: j.company?.display_name || "Unknown",
      location: j.location?.display_name || "Unspecified",
      description: (j.description || "").replace(/<[^>]+>/g, ""),
      url: j.redirect_url,
      postedDate: j.created,
      source: "Adzuna (official API)",
    }));
  } catch (e) {
    console.warn(`Adzuna fetch error for "${query}":`, e.message);
    return [];
  }
}

async function fetchRemoteOK(query) {
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "job-search-tool/1.0 (internal team tool)" },
    });
    if (!res.ok) {
      console.warn(`RemoteOK request failed (${res.status})`);
      return [];
    }
    const data = await res.json();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (data || [])
      .filter((j) => j.position || j.description)
      .filter((j) => {
        const hay = `${j.position || ""} ${j.description || ""} ${(j.tags || []).join(" ")}`.toLowerCase();
        return words.some((w) => hay.includes(w));
      })
      .map((j) => ({
        title: j.position || "Untitled",
        company: j.company || "Unknown",
        location: j.location || "Remote",
        description: (j.description || "").replace(/<[^>]+>/g, "").slice(0, 2000),
        url: j.url || (j.id ? `https://remoteok.com/remote-jobs/${j.id}` : null),
        postedDate: j.date,
        source: "RemoteOK (public feed)",
      }));
  } catch (e) {
    console.warn("RemoteOK fetch error:", e.message);
    return [];
  }
}

function isWithinFreshnessWindow(postedDate) {
  if (!postedDate) return false; // no date = can't prove it's fresh, so drop it (48-hour rule)
  const posted = new Date(postedDate).getTime();
  if (Number.isNaN(posted)) return false;
  const ageHours = (Date.now() - posted) / (1000 * 60 * 60);
  return ageHours >= 0 && ageHours <= FRESHNESS_WINDOW_HOURS;
}

function dedupe(jobs) {
  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    const key = `${(j.title || "").toLowerCase().trim()}|${(j.company || "").toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

async function run() {
  const results = [];
  for (const candidate of candidates) {
    let candidateJobs = [];
    for (const q of candidate.keywordQueries) {
      const [adzuna, remoteok] = await Promise.all([fetchAdzuna(q), fetchRemoteOK(q)]);
      candidateJobs = candidateJobs.concat(adzuna, remoteok);
    }
    candidateJobs = dedupe(candidateJobs);

    for (const job of candidateJobs) {
      if (!isWithinFreshnessWindow(job.postedDate)) continue; // 48-hour rule - drop stale/undated postings

      const text = `${job.title} ${job.description}`;
      const tag = scoreAndTag(text, candidate);
      if (!tag) continue; // wrong product line or no real keyword overlap at all
      results.push({
        candidate: candidate.name,
        techStack: candidate.techStack,
        matchScore: tag.score,
        likelyContract: tag.isContractish,
        title: job.title,
        company: job.company,
        location: job.location,
        postedDate: job.postedDate,
        source: job.source,
        link: job.url,
        note: tag.isContractish
          ? "Contract/C2C language detected in listing text."
          : "Employment type not explicitly stated as contract in the listing text - verify before treating as C2C.",
      });
    }
  }

  // Freshest first, then by match strength within the same freshness tier
  results.sort((a, b) => {
    const dateDiff = new Date(b.postedDate) - new Date(a.postedDate);
    if (Math.abs(dateDiff) > 1000 * 60 * 60) return dateDiff; // >1hr apart: sort by recency
    return b.matchScore - a.matchScore; // near-simultaneous: sort by match strength
  });

  const output = {
    generatedAt: new Date().toISOString(),
    freshnessWindowHours: FRESHNESS_WINDOW_HOURS,
    totalFound: results.length,
    jobs: results,
  };

  // Every run REPLACES data/jobs.json (not appends) - running manually always yields a
  // clean, current-as-of-now list, since anything older than the freshness window was
  // already filtered out above.
  await fs.mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await fs.writeFile(new URL("./data/jobs.json", import.meta.url), JSON.stringify(output, null, 2));
  console.log(`Wrote ${results.length} jobs (within last ${FRESHNESS_WINDOW_HOURS}h) to data/jobs.json`);
}

run();
