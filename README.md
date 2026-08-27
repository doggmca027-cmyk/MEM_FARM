# 🧪 Meme Farm — Telegram Mini App

GameFi idle-farm TMA on TON in the viral "Meme Farm / Brainrot Meta" style
(Capybara, Pepe, Doge, Gigachad). React + TypeScript + Tailwind + Framer Motion,
Zustand state, TON Connect and Telegram WebApp (haptics + safe-area) wired in.

## Run

```bash
npm install
cp .env.example .env   # optional — leave blank to run on mock data
npm run dev            # http://localhost:5173
npm run build          # tsc + production bundle -> dist/
npm run preview
```

## Backend — Supabase

Migrations (apply in order via `supabase db push` or the SQL editor):

1. [`20260828_init_schema.sql`](supabase/migrations/20260828_init_schema.sql) — base schema, RLS, `claim_farm_income`.
2. [`20260829_gram_tiers.sql`](supabase/migrations/20260829_gram_tiers.sql) — TON→GRAM column renames, `TIER_ROLL` type, `tier_states` table, `roll_tier_character` RPC, 30-card seed.
3. [`20260830_withdrawals.sql`](supabase/migrations/20260830_withdrawals.sql) — `request_withdrawal` RPC (min 0.30, fee `max(0.01, 2%)`, 24h cooldown, PENDING WITHDRAW).
4. [`20260831_merge_study.sql`](supabase/migrations/20260831_merge_study.sql) — `user_characters.current_power`, `study_upgrade_character` + `merge_user_characters` RPCs (STUDY_FEE / MERGE_FEE ledger, row locks).
5. [`20260901_quests_pvp.sql`](supabase/migrations/20260901_quests_pvp.sql) — `user_quests` + `pvp_profiles` tables, `claim_daily_streak` + `execute_pvp_battle` RPCs, STREAK_REWARD / QUEST_REWARD types.
6. [`20260902_referrals_multitier.sql`](supabase/migrations/20260902_referrals_multitier.sql) — `profiles.referral_code` (auto 6-char), `referrals.unclaimed_gram`, `bind_referrer` / `process_referral_commission` (5/2/1%) / `claim_referral_rewards` RPCs.

| Concern            | Where                                                        |
| ------------------ | ----------------------------------------------------------- |
| Tables             | `profiles`, `balances` (`available_gram`…), `character_templates` (`tier`,`card_slot`,`drop_weight`), `user_characters`, `tier_states`, `farm_states`, `ledger_entries`, `transactions`, `referrals` |
| Provisioning       | `handle_new_user()` trigger on `auth.users` → profile + balance + farm state + 6 `tier_states` rows |
| Claim flow         | `claim_farm_income(p_user_id)` — locks `farm_states FOR UPDATE`, checks `next_claim_at`, credits `balances.available_gram`, CREDIT `ledger_entries` + `transactions`, rolls the 8 h window |
| Tier roll          | `roll_tier_character(p_user_id, p_tier)` — checks + debits `2^(n-1)` GRAM, weighted `1..100` roll → card slot, inserts `user_characters`, upserts `tier_states.discovered`, DEBIT `TIER_ROLL` ledger + transaction |
| Withdrawal         | `request_withdrawal(p_user_id, p_amount, p_address)` — min 0.30, fee `max(0.01, amount·2%)`, 24h cooldown, locks `available_gram`, DEBIT `WITHDRAW` ledger + PENDING transaction |
| Study / Merge      | `study_upgrade_character` (GRAM fee, income ×2, power ×1.5) · `merge_user_characters(template_id, level)` (2 dupes → 1 at level+1, `income = base · 1.75^level`, MERGE_FEE fee) |
| Streak / PvP       | `claim_daily_streak(p_user_id)` — 7-day ladder, gap-resets, STREAK_REWARD credit / tickets / day-7 buff · `execute_pvp_battle(p_user_id, p_opponent_power)` — refills tickets, spends 1, `random() < power/(power+opp)`, rating ± |
| Referrals          | `bind_referrer(p_user_id, p_code)` (once, post sign-in) · `process_referral_commission(p_user_id, p_fee)` splits `5/2/1%` up the chain into `referrals.unclaimed_gram` · `claim_referral_rewards(p_user_id)` sweeps it to `available_gram` + REFERRAL_REWARD tx. Wire `process_referral_commission` into each fee-taking RPC (see migration 6 footer). |
| RLS                | enabled on every table; `select` limited to `auth.uid() = user_id`; **no** client `insert`/`update` on `balances` / `ledger_entries` / `transactions` — only the `SECURITY DEFINER` RPCs write them |

### Auth — Telegram `initData` → Supabase session

Edge Function [`supabase/functions/telegram-auth/index.ts`](supabase/functions/telegram-auth/index.ts):

1. `POST { initData, referrer_code? }` — verifies the HMAC-SHA256 signature with `BOT_TOKEN`, checks `auth_date` freshness.
2. Extracts `telegram_id` / `username` / `first_name`; finds the Auth user via `profiles.telegram_id` or `auth.admin.createUser` (the `handle_new_user` trigger then provisions profile / balances / tiers / pvp).
3. Calls `bind_referrer(user_id, referrer_code)` when a code came in.
4. Mints a session with deterministic (server-only) credentials and returns `{ access_token, refresh_token }`.

```bash
supabase secrets set BOT_TOKEN=123456:ABC...
supabase functions deploy telegram-auth --no-verify-jwt
```

Client bridge [`src/services/auth.ts`](src/services/auth.ts) `authenticateWithTelegram()` — reads
`WebApp.initData` + `getReferrerCode()`, calls the function, installs the session via
`supabase.auth.setSession(...)`. Wired into `App.tsx` before `hydrate()`. Outside Telegram
(or with blank env) it no-ops and the store stays on mock data.

### Client wiring

- [`src/lib/supabase.ts`](src/lib/supabase.ts) — singleton client; `isSupabaseConfigured` is
  `false` when the env vars are blank and `supabase` is `null`.
- [`src/services/auth.ts`](src/services/auth.ts) — `authenticateWithTelegram()` session bridge.
- [`src/services/api.ts`](src/services/api.ts) — `fetchUserProfile`, `fetchFarmData`,
  `claimIncomeRPC`, `rollTierRPC`, `requestWithdrawalRPC`, `studyUpgradeRPC`,
  `mergeCharactersRPC`, `fetchReferralData`, `claimReferralRewardsRPC`, `fetchTransactions`.
- [`src/store/useGameStore.ts`](src/store/useGameStore.ts) — `hydrate()` (called from `App.tsx`)
  loads live data when configured, else settles on the seeded mock. `mode: 'live' | 'mock'`
  drives whether `claim` / `rollTier` / `requestWithdrawal` hit the RPCs or mutate local state.
  Deposits stay client-optimistic (PENDING until on-chain confirmation).

Vite `manualChunks` splits `@tonconnect/ui-react`, `framer-motion` and
`@supabase/supabase-js` into their own chunks — main app bundle ~275 kB.

Test inside Telegram: expose the dev server over HTTPS (`ngrok http 5173` /
`cloudflared tunnel`), then set that URL as the Mini App URL in @BotFather.

## Deploy

- **Frontend → Vercel.** [`vercel.json`](vercel.json) rewrites all paths to `/` for
  SPA routing. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BOT_USERNAME`
  as project env vars. Build command `npm run build`, output `dist/`.
- **Backend → Supabase.** `supabase db push` (migrations 1→6), then
  `supabase functions deploy telegram-auth --no-verify-jwt` with `BOT_TOKEN` set.
- Point the @BotFather Mini App URL at the Vercel deployment.

## Structure

```
src/
├─ App.tsx                       TonConnect provider + Telegram bootstrap + store.hydrate()
├─ components/layout/
│  ├─ AppLayout.tsx              safe-area shell, Framer Motion tab transitions
│  ├─ TopBar.tsx                 GRAM balance + XP + income chip + TonConnectButton
│  └─ BottomNav.tsx              5 tabs, badges, sliding active pill (layoutId), haptics
├─ screens/
│  ├─ FarmHubScreen.tsx 🔑  segmented Ферма ⇄ Колекція (the key tab)
│  ├─ FarmScreen.tsx        8h claim header + 6 collapsible tier rows
│  ├─ CollectionScreen.tsx  stats header, tier/rarity filters, card grid, Картки/Спорядження subtab
│  ├─ QuestsScreen.tsx  📅  7-day streak calendar + daily quests + bonus chest
│  ├─ RaidScreen.tsx    ⚔️  fighter header (power / ⚡tickets / rating), matchmaking, Arena/Leaders subtab
│  ├─ components/raid/BattleModal.tsx   VS clash + shake → victory/defeat panel
│  ├─ InviteScreen.tsx  ✉️  deep-link + share, unclaimed earnings, 3-tier dashboard, friends list
│  └─ WalletScreen.tsx  🐷  TON Connect header, Available/Pending/Earned, 2 history tabs
├─ components/collection/
│  ├─ CollectionCard.tsx        rarity-glow art · Lv./xN badges · income+power · fragments bar · Вивчити/Злити
│  ├─ MergeModal.tsx            2 cards collide → flash → upgraded card (before/after, fee, confetti)
│  └─ HatInventory.tsx          hats + T1..T6 quick-equip grid
├─ components/wallet/
│  ├─ DepositModal.tsx          quick 1/4/8/16/32 + manual · tonConnectUI.sendTransaction (comment payload)
│  └─ WithdrawModal.tsx         address prefill · MAX · fee/net breakdown · 24h cooldown
├─ components/farm/
│  ├─ TierSlotRow.tsx            collapsible: boost slot · 5 gacha cells · "Крутити за X GRAM"
│  ├─ GachaRevealModal.tsx       card flip, rarity flash, jackpot shake + storm
│  ├─ StudyModal.tsx             XP level-up (doubles income)
│  ├─ HatEquipModal.tsx          +10%…+30% tier boost
│  └─ CollectionStrip.tsx        grouped owned memes (x1/x2), horizontal scroll
├─ components/ui/  GameButton · ProgressBar · Chip · Modal (bottom sheet)
├─ components/icons/  Icons.tsx (GRAM crystal / coin / bolt) · NavIcons.tsx
├─ store/useGameStore.ts         Zustand: GRAM balance, farm, 6 tiers, hats, reveal, actions
├─ data/tiers.ts                 6-tier gacha pools + weighted `rollCardSlot` (1..100)
├─ types/  game.ts · finance.ts
├─ hooks/useCountdown.ts
├─ lib/   format.ts (fmtGram, fmtHMS, fmtDateTime, shortAddress) · meme.ts · confetti.ts · haptics.ts · ton.ts (comment-payload BoC, no deps)
└─ telegram/telegram.ts          ready/expand, header color, safe-area -> CSS vars,
                                 captureReferrer() (reads start_param `ref_<code>`) + openTelegramShare()
```

## Gacha economy (currency: **GRAM** 💎)

Six tiers, roll price `2^(n-1)` GRAM → **1 / 2 / 4 / 8 / 16 / 32**. Each tier has a
fixed 5-card pool. One weighted roll per purchase (`data/tiers.ts`):

| Card | Rarity | Flash | Roll 1..100 | Chance | Yield (Tier n) |
| ---- | ------ | ----- | ----------- | ------ | -------------- |
| 1 | Common | grey | 1–60 | 60% | `0.025 · 2^(n-1)` GRAM/day |
| 2 | Uncommon | green | 61–85 | 25% | `0.035 · 2^(n-1)` |
| 3 | Rare | blue | 86–94 | 9% | `0.050 · 2^(n-1)` |
| 4 | Epic | purple | 95–98 | 4% | `0.075 · 2^(n-1)` |
| 5 | Legendary Jackpot | gold | 99–100 | 2% | `0.120 · 2^(n-1)` |

A roll deducts GRAM, writes a `TIER_ROLL` ledger + transaction, adds the character
to the farm, bumps the tier counter (`discovered/5`), recomputes daily income, and
pops `GachaRevealModal`. Slot 5 → gold glow, screen shake, `notify('success')` +
`impact('heavy')`, golden confetti storm.

**Progression.** *Study* (`upgradeCharacter`) spends XP → +level, income ×2, power ×1.5.
*Merge* (`mergeCharacters(name, level)`) combines 2 same-name **same-level** cards into
one at level+1 with `income = baseIncome · 1.75^(newLevel-1)`, power ×1.75, minus a
small GRAM `MERGE_FEE` sink. Both recompute farm income instantly; live mode routes
through `study_upgrade_character` / `merge_user_characters` then re-hydrates.

## State (`useGameStore`) — seeded mock data

| Field              | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| `balanceGram`      | `12.5`                                                 |
| `xp`               | `1250` (Study level-ups)                                |
| `incomePerDay`     | sum of tier incomes × hat boost                         |
| `farm.nextClaimAt` | now + ~`07:29:12` (8h cycle, seeded near top)           |
| `tiers`            | 6 rows; Tier 1 pre-rolled `[c1×2, c2]`, Tier 2 `[c1]`   |
| `hats`             | Pixel +10% · Magic +15% · Cursed +25% · Gold Crown +30% |

Actions: `accrue` (1 s tick), `tickDaily` (ticket refill + UTC quest rollover),
`claim`, `rollTier`, `dismissReveal`, `upgradeCharacter`, `mergeCharacters`,
`equipHat`, `deposit`, `requestWithdrawal`, `claimDailyCheckIn`,
`claimQuestReward`, `claimDailyChest`, `startRaidBattle`, `dismissBattle`.
`mode: 'live' | 'mock'` picks RPC vs local; every money action writes a `Transaction`.
Quest progress auto-bumps inside `claim` / `rollTier` / `upgradeCharacter` / raid wins;
day-7 streak grants a `+10% income for 24h` buff (`dailyBuffUntil`, folded into `accrue`).

## Theme

- Background `#120924` / `#1E1035`, gradient `from-purple-700 via-pink-600 to-indigo-900`
- Accents: lime `#84CC16`, yellow `#FACC15`, cyan `#06B6D4` (`neon.*` in `tailwind.config.js`)
- 3D buttons: `rounded-2xl border-2 border-black border-b-4 border-b-black/40 active:translate-y-1 active:border-b-0`
- `.bg-stripes` — diagonal candy stripes on card/slot underlays

## TON Connect manifest

`public/tonconnect-manifest.json` has placeholder URLs — swap `url` / `iconUrl`
for your hosted domain before going live (wallets fetch and display it).

---

## 🎨 AI art prompts

`characterArtPrompt(name, memeType, rarity)` in `src/lib/meme.ts` builds a
per-card prompt from the meme family + a rarity flair (grey → green → blue →
purple → radiant gold jackpot). The full string is surfaced in-app as the `title`
tooltip on every tier cell, collection card and the Study modal.

The 30 gacha cards follow a `<Family>-<Epithet>` naming grid — capybara / doge /
pepe / gigachad across slots 1–5, e.g. Tier 1 `Capy-Baby · Doge-Noob · Pepe-Clown
· Chad-Ghost · King-Boo`; Tier 6 `Capy-Genesis … Omega-Boo`. Generate PNGs, drop
in `src/assets/`, then set `image_url` on the matching `character_templates` row
(the card falls back to the emoji until then).

Base template (from `characterArtPrompt`):
> 2D vector game asset sticker of a {family} meme character named {Name}, {rarity flair}, cute meme cartoon sticker style, thick bold black outline, flat vibrant colors, isolated on pure white background, mobile game UI asset, Pop-Art Meme aesthetic --no background, shadows

**Omega-Boo — Gigachad** (Tier 6, Legendary Jackpot)
> 2D vector game asset sticker of a gigachad statue-faced buff meme character named Omega-Boo, god-tier regalia, radiant golden aura, floating crown, jackpot vibes, cute meme cartoon sticker style, thick bold black outline, flat vibrant colors, isolated on pure white background, mobile game UI asset, Pop-Art Meme aesthetic --no background, shadows

### Hats / equipment

Drop into the tier boost slot for a tier-wide income boost (+10% … +30%).

**Pixel Cap** (+10%, uncommon)
> 2D vector game asset sticker of a blocky 8-bit pixel-art baseball cap, lime green, cute meme cartoon sticker style, thick bold black outline, flat vibrant colors, isolated on pure white background, mobile game UI asset, Pop-Art Meme aesthetic --no background, shadows

**Magic Hat** (+15%, rare)
> 2D vector game asset sticker of a pointed wizard hat with stars and a crescent moon, deep purple, cute meme cartoon sticker style, thick bold black outline, flat vibrant colors, isolated on pure white background, mobile game UI asset, Pop-Art Meme aesthetic --no background, shadows

**Gold Crown** (+30%, legendary)
> 2D vector game asset sticker of a chunky royal gold crown with glowing gems, yellow, cute meme cartoon sticker style, thick bold black outline, flat vibrant colors, isolated on pure white background, mobile game UI asset, Pop-Art Meme aesthetic --no background, shadows

**Cursed Cap** (+25%, epic)
> 2D vector game asset sticker of a tattered dark military cap wrapped in purple cursed flames, cute meme cartoon sticker style, thick bold black outline, flat vibrant colors, isolated on pure white background, mobile game UI asset, Pop-Art Meme aesthetic --no background, shadows
