# RugCanary

Paste a Solana mint address, get a plain-English risk report in seconds:
mint and freeze authority, top-holder concentration, liquidity, market cap,
and token age — scored 0–100 with every point explained.

Built for the **Colosseum Eternal** sprint (Week 1, Nov 2026). Free, open
source, read-only. No wallet connection, no sign-up, no backend, nothing
stored. It runs entirely in the browser.

## Why this name

The working name was RugRadar, but a web check on 24 Nov 2026 found it
already in use by several live Solana tools (rugradar.dev, a hosted API and
MCP server, and a Vercel app). MemeScope, RugLens, MintGuard, and MemeSentry
were all taken too. **RugCanary** — a canary that sings before the rug pulls —
had no live collision.

## Run it

No build step, no dependencies. Open `index.html` in a browser, or serve the
folder with any static server. GitHub Pages ready: push and enable Pages.

## What it checks

| Check | Source |
| --- | --- |
| Mint authority (revoked or active) | Solana RPC `getAccountInfo` |
| Freeze authority (revoked or active) | Solana RPC `getAccountInfo` |
| Supply and decimals | Solana RPC `getAccountInfo` |
| Top 10 holders' share of supply | Solana RPC `getTokenLargestAccounts`, RugCheck fallback |
| Liquidity (best pair, USD) | DexScreener API |
| Market cap, price, 24h volume | DexScreener API |
| Token age (first pair) | DexScreener API |

## Risk score

The score starts at 0 (higher = riskier) and adds a penalty for each red
flag, capped at 100. Verdicts: **0–29 Low risk, 30–59 Medium risk, 60–100
High risk.**

| Signal | Points |
| --- | --- |
| Mint authority active | +30 |
| Freeze authority active | +20 |
| Top 10 holders own > 50% of supply | +20 |
| Top 10 holders own 30–50% | +10 |
| Largest single holder > 20% | +10 |
| Liquidity below $10,000 | +15 |
| Liquidity $10,000–$50,000 | +5 |
| Liquidity cannot be measured | +15 |
| No trading pair found | +15 |
| Market cap below $10,000 | +10 |
| Market cap $10,000–$100,000 | +5 |
| 24h volume below $1,000 | +5 |
| Token younger than 24h | +5 |
| Holder data unavailable | +5 |

Thresholds follow the screens of the author's Solana memecoin paper desk
(mint/freeze must be revoked, top-10 concentration and liquidity floors).
The desk's opportunity scoring (momentum, buy pressure) was deliberately not
reused — this tool scores risk, not upside.

## Data notes

- **Holder data fallback.** `getTokenLargestAccounts` is heavily
  rate-limited on the public Solana RPC, so when it fails the scanner falls
  back to the free RugCheck report API (no key) for the top-holder list
  only. Authority and supply data always come from the RPC. The report
  shows which source the holder data came from.
- **Known issuers.** USDC and USDT have active mint/freeze authorities by
  design (Circle and Tether mint and redeem). On those two mints the
  authorities are shown as information, not penalised. The authority state
  is still displayed truthfully.
- **Burned tokens** (sent to `1111…1111`) are excluded from concentration
  math. Top accounts can include liquidity pool and exchange wallets; the
  report says so, and when one account holds over 50% it notes that this is
  usually the launchpad bonding curve or the pool for a new token.
- **Quote pairs.** DexScreener returns pairs where the token is the quote
  side too; only pairs where the scanned token is the base token are used
  (a bug here once showed USDC with another token's price — caught in live
  testing, see TESTED.md).
- A low score means no major red flags were found at scan time. It is not a
  guarantee, and not financial advice.

## Files

- `index.html` — the page (markup + styles).
- `app.js` — all logic: fetching, scoring, rendering. Zero dependencies.
  Also exports its pure functions for Node (`require("./app.js")`).
- `scripts/live-test.js` — runs the real app code against live APIs and
  prints full scan reports. No mocked data. Run: `node scripts/live-test.js`.
- `TESTED.md` — live test results.
- `video-outline-week1.md` — the Week 1 update video script.

## Roadmap

- **Week 2:** creator history (who launched the token, what happened to
  their previous coins) and a holder graph (who funded the top wallets).
- **Week 3:** watchlist with alerts when a watched token's risk changes.

## License

MIT. See `LICENSE`.
