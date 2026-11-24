// Live test harness for RugCanary. Runs the REAL app code (app.js) against
// live APIs and prints full scan reports. No mocked data.
//
// Usage: node scripts/live-test.js
// Run from the project root.

const { fetchOnchain, fetchMarket, scoreReport } = require("../app.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
// Fresh pump.fun tokens verified live 2026-11-24 (see TESTED.md).
const SHRIMP = "HotWn4D2ahG4oQ9QFDmpNbeyYUBK6Sz2kT3m8KoxrDQn";
const RWASH = "FzjDzFNwCHW9nnQymbfqYpxVYGCeBdo91ra7UcEXpump";

async function fullScan(mint, label) {
  console.log(`\n===== ${label} | ${mint} =====`);
  try {
    const onchain = await fetchOnchain(mint);
    await sleep(800);
    const market = await fetchMarket(mint).catch((e) => {
      console.log("DexScreener failed:", e.message);
      return null;
    });
    const report = scoreReport(mint, onchain, market);
    console.log(
      `SCORE ${report.score}/100 — ${report.verdict} | holder source: ${onchain.holderSource}`
    );
    console.log(
      `mintAuth=${onchain.mintAuthority ? "ACTIVE" : "revoked"} freezeAuth=${onchain.freezeAuthority ? "ACTIVE" : "revoked"} supply=${onchain.supplyUi} decimals=${onchain.decimals}`
    );
    console.log(
      `top10=${onchain.top10Pct !== null ? onchain.top10Pct.toFixed(2) + "%" : "n/a"} largest=${onchain.largestPct !== null ? onchain.largestPct.toFixed(2) + "%" : "n/a"}`
    );
    if (market) {
      console.log(
        `market: ${market.name} (${market.symbol}) price=${market.priceUsd} mcap=${market.mcap} liq=$${market.liqUsd} vol24h=$${market.vol24h} dex=${market.dex} pairAge=${market.pairCreatedAt ? new Date(market.pairCreatedAt).toISOString() : "n/a"}`
      );
    } else {
      console.log("market: no DexScreener pair");
    }
    for (const c of report.checks) {
      console.log(`  [${c.status.toUpperCase()}] ${c.label} (+${c.points}): ${c.detail}`);
    }
    return { mint, label, onchain, market, report };
  } catch (e) {
    console.log(`SCAN FAILED: ${e.message}`);
    return { mint, label, error: e.message };
  }
}

async function freshTokenStats() {
  console.log("\n===== Fresh Solana tokens (DexScreener latest profiles) =====");
  const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
  const j = await res.json();
  const sol = j.filter((t) => t.chainId === "solana").slice(0, 12);
  console.log(`fresh solana tokens found: ${sol.length}`);
  let checked = 0;
  let mintActive = 0;
  let freezeActive = 0;
  const risky = [];
  for (const t of sol) {
    try {
      const oc = await fetchOnchain(t.tokenAddress);
      checked++;
      if (oc.mintAuthority) mintActive++;
      if (oc.freezeAuthority) freezeActive++;
      console.log(
        `${t.tokenAddress} mint=${oc.mintAuthority ? "ACTIVE" : "revoked"} freeze=${oc.freezeAuthority ? "ACTIVE" : "revoked"} top10=${oc.top10Pct !== null ? oc.top10Pct.toFixed(1) + "%" : "n/a"} src=${oc.holderSource}`
      );
      if (oc.mintAuthority || oc.freezeAuthority) {
        risky.push({ mint: t.tokenAddress, oc });
      }
    } catch (e) {
      console.log(`${t.tokenAddress} ERROR: ${e.message}`);
    }
    await sleep(1500);
  }
  console.log(
    `\nFRESH STATS: checked=${checked} mintAuthorityActive=${mintActive} freezeAuthorityActive=${freezeActive}`
  );
  return risky;
}

(async () => {
  await fullScan(USDC, "USDC (safe example)");
  await sleep(1500);
  await fullScan(BONK, "BONK");
  await sleep(1500);
  await fullScan(SHRIMP, "SHRIMP (risky example)");
  await sleep(1500);
  await fullScan(RWASH, "RWASH (risky example 2)");
  await sleep(1500);
  await freshTokenStats();
  console.log("\nDone.");
})();
