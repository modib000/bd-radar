# BD Radar

A self updating BD dashboard for software engineering recruitment in crypto.
Every morning it checks job boards, funding news and social channels, scores every
company out of 20, and publishes an encrypted dashboard only you can unlock.

Dashboard: https://modib000.github.io/bd-radar/

## What's in here

| Path | What it is |
|---|---|
| `site/` | The dashboard itself |
| `scripts/refresh.mjs` | The daily job that finds and scores leads |
| `config/watchlist.json` | Companies checked every morning. Add or remove freely |
| `config/sources.json` | News feeds, Telegram channels, search terms, Apollo settings |
| `.github/workflows/daily.yml` | Runs the job at 05:00 UTC and redeploys the site |
| `data/leads.enc.json` | Today's leads, encrypted with your passphrase |

## Secrets (Settings > Secrets and variables > Actions)

| Name | Needed? | What for |
|---|---|---|
| `RADAR_PASSPHRASE` | Yes | Locks the data. Use a long phrase you'll remember |
| `APOLLO_API_KEY` | Optional | Finds the CTO or Head of Engineering for Hot leads |
| `NEYNAR_API_KEY` | Optional | Farcaster hiring posts (free tier) |
| `TWITTERAPI_KEY` | Optional | X hiring posts (TwitterAPI.io) |

## Run it now

Actions tab > Daily refresh > Run workflow. Takes a few minutes.

## Adding a company

Edit `config/watchlist.json` on GitHub (pencil icon), add a line like
`{"name":"Acme","domain":"acme.xyz","vertical":"DeFi"},` and commit.
If the Sources page says its jobs page wasn't found, add `"slug":"..."` using the
name from their jobs page link (e.g. jobs.ashbyhq.com/**acme-labs**).
