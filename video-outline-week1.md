# Week 1 video outline — RugCanary (60 seconds)

Colosseum Eternal, Week 1 update. Due Thu 26 Nov 2026, 18:34 TRT.
Format: screen recording of the live scanner + voiceover. Upload to YouTube
(unlisted is fine), then paste the link in the Colosseum weekly-update form.
Only the team and the Colosseum team can see the video.

## Script (aim for ~55 seconds spoken)

**[0:00–0:06] Hook**
"Thousands of memecoins launch on Solana every day, and most of them are
traps. I built RugCanary to tell you in seconds, before you buy."

**[0:06–0:28] What was built**
"Paste any mint address and you get a plain-English risk report: can someone
still print more tokens, can they freeze your balance, how much of the supply
the top ten wallets own, and whether there is real liquidity behind it. It all
runs in the browser — live data from the Solana RPC and DexScreener, no
wallet, no sign-up."
(On screen: scan USDC — low risk — then scan SHRIMP, a fresh token — high
risk. Show the score and the check list.)

**[0:28–0:45] What I learned**
"I tested twelve fresh launches, and every single one had its mint and freeze
authority revoked — pump.fun does that by default now. So 'authorities
revoked' doesn't mean safe anymore. The real signal moved to holder
concentration: five of the twelve had the top ten wallets owning more than
85% of the supply."

**[0:45–0:56] What's next**
"Week two: creator history — who launched the token, what happened to their
last coins — and a holder graph showing who funded the top wallets. Week
three: a watchlist with alerts when a token's risk changes."

**[0:56–1:00] Close**
"RugCanary. Free, open source, and it never touches your wallet."

## Production notes

- Record the screen at 1280x720 or higher. Show two real scans: USDC
  (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) and SHRIMP
  (HotWn4D2ahG4oQ9QFDmpNbeyYUBK6Sz2kT3m8KoxrDQn).
- Keep it under 60 seconds; Colosseum asks for a 1-minute update.
- Voiceover: the founder's own voice, or Piper TTS if recording is not
  possible. No background music needed.
- Do not show any wallet, seed phrase, or private key anywhere in the video.
- Numbers quoted in the script are from live testing on 24 Nov 2026
  (see TESTED.md).
