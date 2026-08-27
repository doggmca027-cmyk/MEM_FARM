# 🚀 Meme Farm TMA — Deployment Guide

Ship order: **Supabase (DB + Edge Function) → Vercel (frontend) → BotFather (Mini App)**.

Everything runs on mock data until `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
are set, so you can deploy the frontend first and wire the backend after.

---

## 0. Prerequisites

| Tool | Why |
| ---- | --- |
| [Supabase account](https://supabase.com) + project | database, auth, Edge Functions |
| [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase`) | migrations + function deploy |
| [Vercel account](https://vercel.com) | static hosting for the SPA |
| Telegram + [@BotFather](https://t.me/BotFather) | bot + Mini App registration |
| Node 18+ | build |

```bash
supabase login
supabase link --project-ref <your-project-ref>   # ref is in the Supabase dashboard URL
```

---

## 1. Apply the SQL migrations (in order)

Six files in [`supabase/migrations/`](supabase/migrations/), each additive:

| # | File | Adds |
| - | ---- | ---- |
| 1 | `20260828_init_schema.sql` | 9 core tables, RLS, `claim_farm_income`, `handle_new_user` |
| 2 | `20260829_gram_tiers.sql` | TON→GRAM, `tier_states`, `roll_tier_character`, 30-card seed |
| 3 | `20260830_withdrawals.sql` | `request_withdrawal` (min / fee / 24h cooldown) |
| 4 | `20260831_merge_study.sql` | `current_power`, `study_upgrade_character`, `merge_user_characters` |
| 5 | `20260901_quests_pvp.sql` | `user_quests`, `pvp_profiles`, `claim_daily_streak`, `execute_pvp_battle` |
| 6 | `20260902_referrals_multitier.sql` | `referral_code`, `bind_referrer`, `process_referral_commission`, `claim_referral_rewards` |

**Option A — CLI (recommended):**

```bash
supabase db push
```

**Option B — Dashboard:** open **SQL Editor**, paste each file's contents **in numeric
order**, run one at a time. Do not skip or reorder — later files `alter` earlier objects.

Verify: **Table Editor** shows `profiles`, `balances`, `tier_states`, `pvp_profiles`,
`user_quests`, `referrals`, … and `character_templates` has **30 rows**.

---

## 2. Deploy the Edge Function

```bash
supabase functions deploy telegram-auth --no-verify-jwt
```

`--no-verify-jwt` is required — the function is called **before** the user has a JWT.

---

## 3. Set the Edge Function secrets

```bash
supabase secrets set BOT_TOKEN="123456:AA...your-bot-token"
```

- `BOT_TOKEN` — from BotFather (`/newbot`, or `/token` for an existing bot).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected**
  by Supabase — do not set them manually.

Confirm: `supabase secrets list` shows `BOT_TOKEN`.

---

## 4. Frontend environment variables

From **Project Settings → API** in Supabase, copy the Project URL and the **anon**
public key. In Vercel (**Project → Settings → Environment Variables**) add:

| Key | Value |
| --- | ----- |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` (anon / public key — **not** the service role) |
| `VITE_BOT_USERNAME` | your bot username without `@`, e.g. `MemeFarmBot` |

Add them for **Production** (and Preview/Development if you want live data there too).

---

## 5. Deploy the frontend to Vercel

**Via GitHub (recommended):** push this repo, then **Vercel → Add New → Project →
Import**. Vercel auto-detects Vite:

| Setting | Value |
| ------- | ----- |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

[`vercel.json`](vercel.json) rewrites every path to `/` for SPA routing.

**Via CLI:** `npm i -g vercel && vercel --prod`.

Note the deployed URL, e.g. `https://meme-farm.vercel.app`.

---

## 6. Update `tonconnect-manifest.json` with the real domain

Edit [`public/tonconnect-manifest.json`](public/tonconnect-manifest.json) — replace
every `https://meme-farm.vercel.app` with your actual Vercel domain, then redeploy.

Also add a **192×192 PNG** at `public/icon-192.png` (the manifest and TON wallets
show it). Optionally add `public/terms` / `public/privacy` pages — with the SPA
rewrite those URLs currently just load the app, which is acceptable for launch.

TON Connect fetches this file from `https://<domain>/tonconnect-manifest.json`, so
the wallet connect button only works once the domain matches.

---

## 7. Register the Mini App in BotFather

1. **Create the bot** (skip if you have one): `/newbot` → name → username. Save the token
   (that's your `BOT_TOKEN` from step 3).
2. **Create the Mini App**: `/newapp` → pick the bot → title `Meme Farm` → short
   description → 640×360 photo → **Web App URL** = your Vercel URL → short name (used in
   `t.me/<bot>/<shortname>` deep links).
3. **Set the menu button** (opens the app from the chat): `/mybots` → your bot →
   **Bot Settings → Menu Button → Configure menu button** → paste the Vercel URL →
   button text `🧪 Farm`.
4. Referral deep links (`https://t.me/<bot>?start=ref_<code>`) work automatically —
   `start_param` is read by `captureReferrer()` on launch.

---

## 8. Post-deploy checklist

- [ ] `character_templates` has 30 rows; `SELECT * FROM pg_proc WHERE proname LIKE '%_farm%'` lists the RPCs.
- [ ] Open the Vercel URL in a **browser** → app loads on mock data, no console errors.
- [ ] Open the Mini App **inside Telegram** → after a beat the top bar balance/tiers
      reflect the DB (a fresh account starts at 0 GRAM, tiers `0/5`).
- [ ] `supabase functions logs telegram-auth` shows a `200` on first launch.
- [ ] TON Connect button opens the wallet list (manifest domain matches).
- [ ] Invite tab shows your generated `referral_code`; "Поділитися" opens the TG share sheet.

### Troubleshooting

| Symptom | Fix |
| ------- | --- |
| App stays on mock data in Telegram | `VITE_SUPABASE_*` not set at build time → set in Vercel, **redeploy**. |
| `telegram-auth` returns `401 invalid initData` | `BOT_TOKEN` secret wrong / not set, or app opened outside Telegram. |
| `telegram-auth` `500 could not create user` | migrations not applied → `handle_new_user` trigger missing. |
| RPC errors `permission denied` | migration 1 `GRANT`s didn't run; re-run migrations in order. |
| Wallet connect does nothing | `tonconnect-manifest.json` `url` ≠ deployed domain, or `icon-192.png` missing. |
| Referral not attributed | `bind_referrer` only runs on the **first** sign-in with a `ref_` deep link. |

---

## Local development against live Supabase

```bash
cp .env.example .env      # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_BOT_USERNAME
npm run dev
# expose over HTTPS for a real Telegram test:
#   cloudflared tunnel --url http://localhost:5173   (or: ngrok http 5173)
# then point the BotFather Web App URL at the tunnel URL
```

Without `.env` the app runs 100% on the seeded mock — every screen, timer and
animation works offline.
