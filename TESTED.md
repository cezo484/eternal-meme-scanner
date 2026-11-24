# Live test results

Tested 24 Nov 2026 (~19:30 TRT) with `node scripts/live-test.js`, which runs
the real `app.js` code against live APIs. No mocked data anywhere in the
demo path.

## Full scans

| Token | Mint | Score | Verdict | Key figures |
| --- | --- | --- | --- | --- |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 5/100 | Low risk | Mint/freeze active (Circle, known issuer, 0 pts). Holders unavailable (+5). Liquidity $2.24M, mcap $68.93B, 24h vol $10.11M. |
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 10/100 | Low risk | Authorities revoked. Top 10 hold 36.2% (+10). Liquidity $207.5K, mcap $185.1M, age ~47 months. |
| SHRIMP (The Shrimp) | `HotWn4D2ahG4oQ9QFDmpNbeyYUBK6Sz2kT3m8KoxrDQn` | 60/100 | High risk | Authorities revoked. Top 10 hold 97.6%, largest 91.5% (+30). Liquidity $1,886 (+15). Mcap $1,964 (+10). Age 23 min (+5). |
| RWASH (Rings Wash) | `FzjDzFNwCHW9nnQymbfqYpxVYGCeBdo91ra7UcEXpump` | 60/100 | High risk | Authorities revoked. Top 10 hold 99.9%, largest 96.1% (+30). Liquidity unmeasurable (+15). Mcap $2,084 (+10). Age 29 min (+5). |

SHRIMP is the "Risky example" button in the app. RWASH is a second verified
high-risk case.

## Fresh-launch batch

Twelve fresh Solana tokens from DexScreener's latest token profiles,
checked twice on 24 Nov 2026 (two batches, 24 authority checks total):

- **Mint authority active: 0 of 12** in each batch. Same for freeze
  authority. Pump.fun revokes both by default, so "authorities revoked" no
  longer separates safe from risky on fresh launches.
- **Top-10 concentration (second batch):** 72.9%, 37.3%, 56.8%, 99.9%,
  97.7%, 99.5%, 97.6%, 37.4%, 6.5%, 90.5%, 36.9%, 0.1%. Five of the twelve
  had the top 10 holders owning more than 85% of supply.
- The very high readings (90–99%) are mostly the launchpad bonding curve
  still holding the unsold supply minutes after launch. The app says so in
  the check detail when one account holds over 50%.

## Bugs found and fixed during testing

1. **Wrong market data for USDC.** DexScreener returns pairs where the token
   is the quote side; the first version picked the highest-liquidity pair
   regardless, and USDC briefly showed another token's price and market cap.
   Fixed: only pairs where the scanned token is the base token are used.
2. **Parsed mint layout.** `getAccountInfo` returns the program id at
   `value.data.program` and the mint fields at
   `value.data.parsed.info` — the first version read the wrong level and
   rejected every mint. Fixed and re-verified.
3. **WIF mint dropped.** The dogwifhat mint address from memory
   (`EKpQGSJtjMFq2sXu5dbsj1yBzE9nLtr2vEUtq9qTjM6`) returns no account on
   chain, so it was dropped from the test set rather than guessed at. BONK
   covers the established-memecoin case.

## Known limitations (observed live)

- `getTokenLargestAccounts` on the public RPC returned 403/429 from this
  test environment on every attempt (shared-IP rate limiting), so all holder
  data in these runs came from the RugCheck fallback. The RPC path is still
  tried first in the app and may succeed from a normal browser IP.
- RugCheck publishes no holder data for USDC (`topHolders: null`), so
  USDC's holder check shows UNKNOWN (+5) when the RPC path also fails. The
  score stays Low either way.
- One fresh token (`33xKs5zTHW4pppqvUKjvHuC8cHjSUb1JzVbzxYFHpump`) reported a
  top-10 share of 0.1% in both batches, which is not credible for a live
  token — its RugCheck holder data looks stale or broken. The app shows the
  holder-data source on every report so a bad source is visible.
- DexScreener does not report USD liquidity for pump.fun bonding-curve
  pairs; those score as "liquidity cannot be measured" (+15).
