// RugCanary — client-side Solana memecoin risk scanner.
// Zero dependencies. Data: public Solana RPC + DexScreener public API.
// No wallet connection, no backend, nothing is sent anywhere except the
// public read-only APIs below.
//
// Holder data: getTokenLargestAccounts on the public RPC is heavily
// rate-limited, so when it fails the scanner falls back to the free
// RugCheck report API (api.rugcheck.xyz, no key) for the top-holder list
// only. Mint/freeze authority and supply always come from the Solana RPC.
// The holder-data source is shown in the report.

"use strict";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_ENDPOINTS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/";

// The well-known burn address (the system program id). Tokens sent here are
// gone for good, so it is excluded from holder-concentration math.
const BURN_ADDRESSES = new Set(["11111111111111111111111111111111"]);

// Regulated stablecoin issuers. Their mint/freeze authorities are active by
// design (Circle mints and redeems USDC; Tether does the same for USDT), so
// an active authority on these mints is reported as information, not as a
// risk penalty. The authority state is still shown truthfully.
const KNOWN_ISSUERS = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "Circle (USDC issuer)",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "Tether (USDT issuer)",
};

// Example mints shown under the search box. The risky one was verified live
// on 2026-11-24 (see TESTED.md).
const EXAMPLES = [
  { label: "USDC (safe)", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { label: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { label: "Risky example", mint: "HotWn4D2ahG4oQ9QFDmpNbeyYUBK6Sz2kT3m8KoxrDQn" },
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
//
// Risk score 0-100. Higher is riskier. Penalties are added up and capped
// at 100. Verdicts: 0-29 Low risk, 30-59 Medium risk, 60-100 High risk.
//
//   Mint authority active .......... +30  (more supply can be printed)
//   Freeze authority active ........ +20  (balances can be frozen)
//   Top 10 holders own > 50% ....... +20
//   Top 10 holders own 30-50% ...... +10
//   Largest single holder > 20% .... +10
//   Liquidity below $10,000 ........ +15
//   Liquidity $10,000-$50,000 ...... +5
//   Liquidity cannot be measured ... +15  (no figure for the best pair)
//   No trading pair found .......... +15  (market cannot be verified)
//   Market cap below $10,000 ....... +10  (micro-cap)
//   Market cap $10,000-$100,000 .... +5
//   24h volume below $1,000 ........ +5
//   Token younger than 24h ......... +5
//   Holder data unavailable ........ +5
//
// Thresholds follow the screens of the author's Solana paper desk
// (mint/freeze must be revoked, top-10 share and liquidity floors).

const PENALTIES = {
  MINT_AUTHORITY: 30,
  FREEZE_AUTHORITY: 20,
  TOP10_HIGH: 20,
  TOP10_MID: 10,
  LARGEST_HIGH: 10,
  LIQ_LOW: 15,
  LIQ_MID: 5,
  LIQ_UNKNOWN: 15,
  NO_PAIR: 15,
  MCAP_MICRO: 10,
  MCAP_SMALL: 5,
  VOL_LOW: 5,
  AGE_FRESH: 5,
  HOLDERS_UNKNOWN: 5,
};

function verdictFor(score) {
  if (score >= 60) return "High risk";
  if (score >= 30) return "Medium risk";
  return "Low risk";
}

// Pure scoring: takes fetched data, returns { score, verdict, checks }.
// Each check: { id, label, status, detail, points } where status is one of
// "pass" | "warn" | "fail" | "info" | "unknown".
function scoreReport(mint, onchain, market) {
  const checks = [];
  let score = 0;
  const add = (check, points) => {
    check.points = points || 0;
    score += check.points;
    checks.push(check);
  };
  const knownIssuer = KNOWN_ISSUERS[mint] || null;

  // --- Mint authority ---
  if (onchain.mintAuthority === null) {
    add({
      id: "mint",
      label: "Mint authority",
      status: "pass",
      detail: "Revoked. No one can print more tokens.",
    });
  } else if (onchain.mintAuthority) {
    if (knownIssuer) {
      add({
        id: "mint",
        label: "Mint authority",
        status: "info",
        detail: `Active, held by ${knownIssuer}. Expected for a regulated stablecoin.`,
      });
    } else {
      add(
        {
          id: "mint",
          label: "Mint authority",
          status: "fail",
          detail: `Active (${shortAddr(onchain.mintAuthority)}). The owner can print more supply at any time.`,
        },
        PENALTIES.MINT_AUTHORITY
      );
    }
  } else {
    add({
      id: "mint",
      label: "Mint authority",
      status: "unknown",
      detail: "Could not be read from the chain.",
    });
  }

  // --- Freeze authority ---
  if (onchain.freezeAuthority === null) {
    add({
      id: "freeze",
      label: "Freeze authority",
      status: "pass",
      detail: "Revoked. No one can freeze your balance.",
    });
  } else if (onchain.freezeAuthority) {
    if (knownIssuer) {
      add({
        id: "freeze",
        label: "Freeze authority",
        status: "info",
        detail: `Active, held by ${knownIssuer}. Expected for a regulated stablecoin.`,
      });
    } else {
      add(
        {
          id: "freeze",
          label: "Freeze authority",
          status: "fail",
          detail: `Active (${shortAddr(onchain.freezeAuthority)}). The owner can freeze any wallet holding this token.`,
        },
        PENALTIES.FREEZE_AUTHORITY
      );
    }
  } else {
    add({
      id: "freeze",
      label: "Freeze authority",
      status: "unknown",
      detail: "Could not be read from the chain.",
    });
  }

  // --- Supply / decimals (informational) ---
  add({
    id: "supply",
    label: "Supply",
    status: "info",
    detail: `${formatNumber(onchain.supplyUi)} tokens, ${onchain.decimals} decimals.`,
  });

  // --- Holder concentration ---
  if (onchain.top10Pct !== null) {
    const top10 = onchain.top10Pct;
    const largest = onchain.largestPct;
    let status = "pass";
    let points = 0;
    let detail = `Top 10 holders own ${top10.toFixed(1)}% of supply.`;
    if (top10 > 50) {
      status = "fail";
      points += PENALTIES.TOP10_HIGH;
      detail += " A small group controls most of the supply.";
    } else if (top10 > 30) {
      status = "warn";
      points += PENALTIES.TOP10_MID;
      detail += " Ownership is fairly concentrated.";
    } else {
      detail += " Ownership is spread out.";
    }
    if (largest !== null && largest > 20) {
      status = "fail";
      points += PENALTIES.LARGEST_HIGH;
      if (largest > 50) {
        detail += ` One account alone holds ${largest.toFixed(1)}% — for a new token this is usually the launchpad bonding curve or the liquidity pool, not a single trader.`;
      } else {
        detail += ` One wallet alone holds ${largest.toFixed(1)}%.`;
      }
    }
    detail += " (Pool accounts count as holders; see note below.)";
    add({ id: "holders", label: "Top holders", status, detail }, points);
  } else {
    add(
      {
        id: "holders",
        label: "Top holders",
        status: "unknown",
        detail: "Holder data could not be loaded.",
      },
      PENALTIES.HOLDERS_UNKNOWN
    );
  }

  // --- Liquidity / market ---
  if (!market) {
    add(
      {
        id: "liquidity",
        label: "Liquidity",
        status: "fail",
        detail: "No trading pair found on DexScreener. The market cannot be verified.",
      },
      PENALTIES.NO_PAIR
    );
  } else {
    const liq = market.liqUsd;
    if (liq === null || liq === undefined) {
      add(
        {
          id: "liquidity",
          label: "Liquidity",
          status: "fail",
          detail:
            "Liquidity could not be measured for the best pair (common for bonding-curve tokens). There is no confirmed market depth.",
        },
        PENALTIES.LIQ_UNKNOWN
      );
    } else if (liq < 10000) {
      add(
        {
          id: "liquidity",
          label: "Liquidity",
          status: "fail",
          detail: `Only ${formatUsd(liq)} in the best pool. A small sell can crash the price.`,
        },
        PENALTIES.LIQ_LOW
      );
    } else if (liq < 50000) {
      add(
        {
          id: "liquidity",
          label: "Liquidity",
          status: "warn",
          detail: `${formatUsd(liq)} in the best pool. Thin for larger trades.`,
        },
        PENALTIES.LIQ_MID
      );
    } else {
      add({
        id: "liquidity",
        label: "Liquidity",
        status: "pass",
        detail: `${formatUsd(liq)} in the best pool (${market.dex}).`,
      });
    }

    if (market.mcap !== null && market.mcap !== undefined) {
      if (market.mcap < 10000) {
        add(
          {
            id: "mcap",
            label: "Market cap",
            status: "fail",
            detail: `Micro-cap at ${formatUsd(market.mcap)}. Tiny markets can be moved by a single trade.`,
          },
          PENALTIES.MCAP_MICRO
        );
      } else if (market.mcap < 100000) {
        add(
          {
            id: "mcap",
            label: "Market cap",
            status: "warn",
            detail: `Small market at ${formatUsd(market.mcap)}. Expect sharp price swings.`,
          },
          PENALTIES.MCAP_SMALL
        );
      } else {
        add({
          id: "mcap",
          label: "Market cap",
          status: "pass",
          detail: `${formatUsd(market.mcap)}.`,
        });
      }
    }

    if (market.vol24h !== null && market.vol24h !== undefined) {
      if (market.vol24h < 1000) {
        add(
          {
            id: "volume",
            label: "24h volume",
            status: "warn",
            detail: `Only ${formatUsd(market.vol24h)} traded in 24h. Almost no one is trading it.`,
          },
          PENALTIES.VOL_LOW
        );
      } else {
        add({
          id: "volume",
          label: "24h volume",
          status: "pass",
          detail: `${formatUsd(market.vol24h)} traded in 24h.`,
        });
      }
    }

    if (market.pairCreatedAt) {
      const ageMs = Date.now() - market.pairCreatedAt;
      const ageHours = ageMs / 3600000;
      if (ageHours < 24) {
        add(
          {
            id: "age",
            label: "Token age",
            status: "warn",
            detail: `First pair appeared ${formatAge(ageMs)} ago. Very new tokens have no track record.`,
          },
          PENALTIES.AGE_FRESH
        );
      } else {
        add({
          id: "age",
          label: "Token age",
          status: "pass",
          detail: `First pair appeared ${formatAge(ageMs)} ago.`,
        });
      }
    }
  }

  score = Math.min(100, score);
  return { score, verdict: verdictFor(score), checks };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let lastError = null;
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || "RPC error");
      return json.result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("RPC request failed");
}

async function fetchOnchain(mint) {
  const info = await rpcCall("getAccountInfo", [
    mint,
    { encoding: "jsonParsed" },
  ]);
  const dataObj = info && info.value && info.value.data;
  const parsed = dataObj && dataObj.parsed;
  if (
    !dataObj ||
    !parsed ||
    parsed.type !== "mint" ||
    (dataObj.program !== "spl-token" && dataObj.program !== "spl-token-2022")
  ) {
    throw new Error("Address is not an SPL token mint.");
  }
  const data = parsed.info;
  const supply = BigInt(data.supply);
  const decimals = data.decimals;

  // Holder list: RPC first, RugCheck report as fallback.
  let holders = null;
  let holderSource = null;
  try {
    const largest = await rpcCall("getTokenLargestAccounts", [mint]);
    holders = (largest && largest.value ? largest.value : [])
      .filter((a) => !BURN_ADDRESSES.has(a.address))
      .slice(0, 10)
      .map((a) => ({
        address: a.address,
        amount: a.amount,
        pct:
          supply > 0n ? Number((BigInt(a.amount) * 10000n) / supply) / 100 : 0,
      }));
    holderSource = "Solana RPC";
  } catch (err) {
    console.warn("getTokenLargestAccounts failed, trying RugCheck:", err);
    holders = await fetchHoldersFromRugCheck(mint);
    if (holders) holderSource = "RugCheck";
  }

  const top10Pct =
    holders && holders.length > 0
      ? holders.reduce((sum, h) => sum + h.pct, 0)
      : null;
  return {
    supply: data.supply,
    supplyUi: supply > 0n ? Number(supply) / 10 ** decimals : 0,
    decimals,
    mintAuthority: data.mintAuthority === undefined ? null : data.mintAuthority,
    freezeAuthority:
      data.freezeAuthority === undefined ? null : data.freezeAuthority,
    holders,
    holderSource,
    top10Pct,
    largestPct: holders && holders.length > 0 ? holders[0].pct : null,
  };
}

// Fallback for the top-holder list when the public RPC rate-limits
// getTokenLargestAccounts. Free, no key. Returns null on any failure.
async function fetchHoldersFromRugCheck(mint) {
  try {
    const res = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const top = (json.topHolders || []).slice(0, 10);
    if (top.length === 0) return null;
    return top
      .filter((h) => !BURN_ADDRESSES.has(h.address))
      .map((h) => ({ address: h.address, amount: null, pct: h.pct }));
  } catch (err) {
    console.warn("RugCheck fallback failed:", err);
    return null;
  }
}

async function fetchMarket(mint) {
  const res = await fetch(DEXSCREENER_API + encodeURIComponent(mint));
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const json = await res.json();
  // Only pairs where this token is the BASE token. DexScreener also returns
  // pairs where the token is the quote side (e.g. every USDC pair), which
  // would attach another token's price and liquidity to this mint.
  const pairs = (json.pairs || []).filter(
    (p) => p.chainId === "solana" && p.baseToken.address === mint
  );
  if (pairs.length === 0) return null;
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const p = pairs[0];
  return {
    name: p.baseToken.name,
    symbol: p.baseToken.symbol,
    priceUsd: p.priceUsd ? parseFloat(p.priceUsd) : null,
    mcap: p.marketCap || p.fdv || null,
    liqUsd: p.liquidity ? p.liquidity.usd : null,
    vol24h: p.volume ? p.volume.h24 : null,
    dex: p.dexId,
    pairCreatedAt: p.pairCreatedAt || null,
    url: p.url,
    pairCount: pairs.length,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function shortAddr(addr) {
  return addr ? addr.slice(0, 4) + "..." + addr.slice(-4) : "";
}

function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatUsd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  if (n >= 1) return "$" + n.toFixed(0);
  return "$" + n.toFixed(4);
}

function formatPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  if (n >= 1) return "$" + n.toFixed(4);
  if (n >= 0.0001) return "$" + n.toFixed(6);
  return "$" + n.toExponential(2);
}

function formatAge(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ${hours % 24}h`;
  const months = Math.floor(days / 30);
  return `${months}mo ${days % 30}d`;
}

function isPlausibleMint(s) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

// ---------------------------------------------------------------------------
// UI (browser only)
// ---------------------------------------------------------------------------

const STATUS_META = {
  pass: { icon: "✓", label: "PASS", cls: "pass" },
  warn: { icon: "!", label: "WARN", cls: "warn" },
  fail: { icon: "✕", label: "FAIL", cls: "fail" },
  info: { icon: "i", label: "INFO", cls: "info" },
  unknown: { icon: "?", label: "UNKNOWN", cls: "unknown" },
};

function el(id) {
  return document.getElementById(id);
}

function renderExamples() {
  const box = el("examples");
  box.innerHTML = "";
  EXAMPLES.forEach((ex) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "example-btn";
    b.textContent = ex.label;
    b.addEventListener("click", () => {
      el("mint-input").value = ex.mint;
      runScan(ex.mint);
    });
    box.appendChild(b);
  });
}

function setStatus(text, kind) {
  const s = el("status");
  s.textContent = text;
  s.className = "status " + (kind || "");
  s.hidden = !text;
}

function renderReport(mint, onchain, market, report) {
  const out = el("results");
  const title = market
    ? `${market.name} (${market.symbol})`
    : "Unknown token";
  const verdictCls =
    report.verdict === "High risk"
      ? "fail"
      : report.verdict === "Medium risk"
        ? "warn"
        : "pass";

  const checksHtml = report.checks
    .map((c) => {
      const m = STATUS_META[c.status];
      const pts = c.points > 0 ? `<span class="pts">+${c.points} risk</span>` : "";
      return `<div class="check ${m.cls}">
        <span class="check-badge">${m.icon}</span>
        <div class="check-body">
          <div class="check-head"><span class="check-label">${c.label}</span>${pts}</div>
          <div class="check-detail">${c.detail}</div>
        </div>
      </div>`;
    })
    .join("");

  const holdersHtml =
    onchain.holders && onchain.holders.length > 0
      ? `<table class="holders">
          <thead><tr><th>#</th><th>Account</th><th>Share</th><th></th></tr></thead>
          <tbody>
          ${onchain.holders
            .map(
              (h, i) => `<tr>
                <td>${i + 1}</td>
                <td class="mono">${shortAddr(h.address)}</td>
                <td>${h.pct.toFixed(2)}%</td>
                <td><div class="bar"><div class="bar-fill" style="width:${Math.min(100, h.pct * 2)}%"></div></div></td>
              </tr>`
            )
            .join("")}
          </tbody>
        </table>
        <p class="note">Top accounts can include liquidity pool and exchange
        wallets. A large pool holding is normal; a large unknown wallet is not.
        Burned tokens (sent to 1111…1111) are excluded. Holder data source:
        ${onchain.holderSource || "unavailable"}.</p>`
      : `<p class="note">No holder data available for this mint.</p>`;

  out.innerHTML = `
    <div class="report-head">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p class="mono muted">${mint}</p>
      </div>
      <div class="score-box ${verdictCls}">
        <div class="score-num">${report.score}<span>/100</span></div>
        <div class="score-verdict">${report.verdict}</div>
        <div class="score-sub">risk score</div>
      </div>
    </div>

    <div class="facts">
      <div class="fact"><span>Price</span><strong>${market ? formatPrice(market.priceUsd) : "-"}</strong></div>
      <div class="fact"><span>Market cap</span><strong>${market && market.mcap ? formatUsd(market.mcap) : "-"}</strong></div>
      <div class="fact"><span>Liquidity</span><strong>${market && market.liqUsd !== null ? formatUsd(market.liqUsd) : "-"}</strong></div>
      <div class="fact"><span>24h volume</span><strong>${market && market.vol24h !== null ? formatUsd(market.vol24h) : "-"}</strong></div>
      <div class="fact"><span>Supply</span><strong>${formatNumber(onchain.supplyUi)}</strong></div>
      <div class="fact"><span>Decimals</span><strong>${onchain.decimals}</strong></div>
    </div>

    <h3>Checks</h3>
    <div class="checks">${checksHtml}</div>

    <h3>Top holders</h3>
    ${holdersHtml}

    <p class="links">
      ${market && market.url ? `<a href="${market.url}" target="_blank" rel="noopener">DexScreener ↗</a>` : ""}
      <a href="https://solscan.io/token/${mint}" target="_blank" rel="noopener">Solscan ↗</a>
    </p>`;
  out.hidden = false;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let scanning = false;

async function runScan(mint) {
  mint = (mint || "").trim();
  if (!isPlausibleMint(mint)) {
    setStatus("That does not look like a Solana mint address (base58, 32-44 characters).", "error");
    el("results").hidden = true;
    return;
  }
  if (scanning) return;
  scanning = true;
  el("scan-btn").disabled = true;
  el("scan-btn").textContent = "Scanning…";
  el("results").hidden = true;
  setStatus("Reading mint data from Solana RPC and market data from DexScreener…", "loading");

  try {
    const [onchain, market] = await Promise.all([
      fetchOnchain(mint),
      fetchMarket(mint).catch((err) => {
        console.warn("DexScreener failed:", err);
        return null;
      }),
    ]);
    const report = scoreReport(mint, onchain, market);
    renderReport(mint, onchain, market, report);
    setStatus("", "");
    if (market === null) {
      setStatus("Market data unavailable (DexScreener returned nothing). On-chain checks still ran.", "warn");
    }
    try {
      history.replaceState(null, "", "#" + mint);
    } catch (_) {
      /* ignore */
    }
  } catch (err) {
    console.error(err);
    setStatus(
      "Scan failed: " + err.message + " Check the address and try again.",
      "error"
    );
  } finally {
    scanning = false;
    el("scan-btn").disabled = false;
    el("scan-btn").textContent = "Scan";
  }
}

function init() {
  renderExamples();
  el("scan-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runScan(el("mint-input").value);
  });
  const hash = (location.hash || "").replace(/^#/, "").trim();
  if (isPlausibleMint(hash)) {
    el("mint-input").value = hash;
    runScan(hash);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

// Node export for the live test harness (scripts/live-test.mjs).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    scoreReport,
    verdictFor,
    fetchOnchain,
    fetchMarket,
    EXAMPLES,
    KNOWN_ISSUERS,
    PENALTIES,
  };
}
