# Maldivian AI Video App (Higgsfield powered): Product and Pricing Plan

Status: planning only, no code yet
Exchange rate used everywhere: **1 USD = 26 MVR**
Higgsfield prices below were pulled live from Higgsfield on 13 Oct 2026 using cost quotes (`get_cost`), which return a price without generating anything. Re-check them before launch, because AI pricing changes often.

---

## 1. The idea in one paragraph

A mobile app, in Dhivehi and English, where Maldivians make TikTok-ready AI videos (mainly **Higgsfield Genjutsu** and viral effects) from a selfie or a short clip, and **pay in MVR** using local options (BML, MIB, wallet apps, or the app stores). The app never exposes your Higgsfield key. Users buy **Coins**, every template shows its Coin price up front, and your backend pays Higgsfield in credits.

Why people would pay you instead of going to Higgsfield directly:

1. **No USD card needed.** Higgsfield's cheapest plan is USD 39 to 49 a month on a foreign currency card. Many Maldivians have tight USD card limits. You sell small MVR amounts.
2. **Pay per video**, not a monthly subscription.
3. **Dhivehi UI** (Thaana, right to left) and local templates (boduberu, dhoni rides, Eid outfits, Hulhumalé beach, wedding dances).
4. **Simple.** Pick a template, add a selfie, get a video. No prompts or settings to learn.

---

## 2. Feature menu (what users can make)

| # | Feature (UI name) | Higgsfield engine | User provides | Notes |
|---|---|---|---|---|
| 1 | **Genjutsu Trending** (motion transfer) | `hf_mult_motion_control` | 1 selfie / full body photo | Your face and body perform a trending clip. This is the main product. |
| 2 | **Genjutsu Swap** (object/outfit/character swap) | `hf_mult_replace_object` | Their own video + 1 to several reference photos | e.g. swap the bag, car, outfit or person in their clip |
| 3 | **Genjutsu Styles** | Genjutsu Styles presets | Their own video (4 to 30 s) | Redraw their video as toy CGI, knitted yarn, 2D anime, etc. |
| 4 | **Viral Effects** | Higgsfield Viral Hub presets | 1 photo | Vanish, Clones, Infinite Clones, Eyes In, Selfception, Street Colossus, Monster Dab, Floating Fall, World Morphing |
| 5 | **Quick Animate** (cheap starter) | `kling3_0` image to video, 5 s | 1 photo + optional prompt | Very cheap, good free trial item |
| 6 | **Cinematic** | `seedance_2_5`, 5 s | Photo + prompt | Higher quality general video |
| 7 | **Local Packs** (your secret weapon) | `hf_mult_motion_control` with **your own driving videos** | 1 photo | Film 10 to 20 short local clips (boduberu, bodu mas fishing pose, dhoni, Eid greeting, Malé traffic scooter, wedding). Nobody else has these. |

Trending Genjutsu templates seen in the live catalog right now, for reference: Unboxed Item Swap, Rug Transition Swap, Night Fuel Drive, Supercar Showreel Spin, Urban Style Rotation, Ceiling Fan Transition, Arcade Identity Swap, Orbital Room Sweep, Coastal Tower Assembly, Studio Duo Exchange, Luxury Bag Swap, Boutique Terrace Dance, Convertible Head Bob, Influencer Rhythm Recap. The catalog refreshes, so the app should sync it from your backend rather than hard-coding it.

---

## 3. How it works (architecture)

```
 ┌──────────────┐  HTTPS (JWT)  ┌──────────────────────────┐   API key (server only)  ┌─────────────┐
 │ Flutter app  │ ────────────▶ │ Your backend             │ ───────────────────────▶ │ Higgsfield  │
 │ (dv / en,    │ ◀──────────── │ - Auth (phone OTP +960)  │ ◀─────────────────────── │ API         │
 │  RTL / LTR)  │  push (FCM)   │ - Coin wallet + ledger   │   job status / result    └─────────────┘
 └──────────────┘               │ - Job queue + worker     │
        │                       │ - Template catalog sync  │      ┌──────────────────────┐
        │ upload selfie/video   │ - Pricing engine         │ ◀──▶ │ Payments: BML / MIB  │
        └──────────────────────▶│ - Storage (results 30d)  │      │ gateway, app stores  │
                                │ - Moderation             │      └──────────────────────┘
                                └──────────────────────────┘
```

### 3.1 The life of one video

1. User opens a template (e.g. "Boutique Terrace Dance") and sees the **price in Coins** and a preview.
2. User uploads a selfie. The app compresses it and uploads it straight to your storage via a signed URL.
3. Backend runs **moderation** on the photo (face present, no nudity, no minors in swap features, no public-figure faces).
4. Backend asks Higgsfield for a **live cost quote** (`get_cost: true`). If the credit cost is higher than what the template's Coin price covers (for example, Higgsfield raised prices), the job is blocked and you get an alert, so you never sell at a loss.
5. Backend places a **hold** on the user's Coins (not a charge yet) and submits the job.
6. A worker polls Higgsfield (or receives a webhook) until the job finishes, then copies the video to your storage.
7. On success the hold becomes a charge. **On failure the Coins are automatically released.** Users never pay for failed jobs.
8. Push notification: "Your video is ready". User previews, saves to their gallery, or shares to TikTok.
9. Results are kept for 30 days, then deleted (saves storage cost and protects privacy).

### 3.2 Recommended tech stack

| Layer | Choice | Why |
|---|---|---|
| Mobile | **Flutter** | Best runtime RTL switching (Dhivehi to English without restarting), one codebase for Android and iOS |
| Backend | **Supabase** (Postgres, Auth, Storage, Edge Functions) + one small worker service on **Railway** (Node or Python) | Cheap, fast to build, and you already have both connected |
| Auth | Phone OTP for +960 numbers (Dhiraagu / Ooredoo) | Everyone has a phone number. It also stops free-trial abuse. |
| Push | Firebase Cloud Messaging | Free |
| Storage / CDN | Supabase Storage or Cloudflare R2 | R2 has no egress fees, which helps with video downloads |
| Prompt translation | A small LLM call (e.g. Claude Haiku) | Turns a Dhivehi prompt into an English prompt for the video models |
| Analytics / crashes | Firebase Analytics + Crashlytics or Sentry | Free tiers are enough |

### 3.3 Core database tables

- `users` (id, phone, display_name, locale `dv`/`en`, created_at)
- `wallets` (user_id, balance_coins, held_coins)
- `ledger` (id, user_id, type `topup|hold|charge|release|refund|bonus`, coins, ref, created_at). This is append-only and your source of truth for money.
- `topups` (id, user_id, channel `bml|mib|wallet|apple|google`, amount_mvr, coins, status, gateway_ref)
- `templates` (id, feature, higgsfield_ref, title_en, title_dv, preview_url, duration_s, resolution, credit_cost, coin_price, active, sort)
- `jobs` (id, user_id, template_id, status, credits_quoted, coins_held, higgsfield_job_id, result_url, error, created_at)
- `moderation_events`

Security rule that matters most: **the Higgsfield API key lives only on the server.** It never goes inside the app, because anyone can extract keys from an APK.

---

## 4. Dhivehi language support

### 4.1 What "Dhivehi support" really means technically

1. **Right-to-left layout.** The entire layout mirrors (back arrows, sliders, progress bars, navigation). Flutter does this automatically through `Directionality` once the locale is `dv`.
2. **Thaana font.** Bundle **Noto Sans Thaana** (Google, free, OFL licence) so the text looks the same on every phone. Do not rely on the phone's system font, because many Android phones render Thaana badly.
3. **Locale gap.** Flutter's built-in Material and Cupertino translations do **not** include Dhivehi (`dv`). You need a small custom `LocalizationsDelegate` that falls back to English for system widgets (date pickers etc.) while your own strings come from `app_dv.arb`.
4. **Numbers and prices.** Dhivehi normally uses Western digits. Wrap mixed text like "129 ކޮއިން" or "MVR 129" with Unicode bidi isolation (Flutter's `BidiFormatter` / `⁨ … ⁩`) so numbers do not jump to the wrong side.
5. **Language switch** on first launch (ދިވެހި / English), changeable later in Settings. Default to Dhivehi if the phone is set to `dv`.
6. **Template titles** are stored in both languages in the database, so you can add or translate templates without an app update.
7. **Prompts.** Users may type in Dhivehi. The backend translates them to English before sending them to the video models.

### 4.2 Starter UI strings (draft, get a native speaker to review before launch)

| Key | English | Dhivehi (draft) |
|---|---|---|
| home | Home | ފުރަތަމަ ޞަފްޙާ |
| create | Create | ހަދާ |
| trending | Trending | މަޝްހޫރު |
| my_videos | My videos | އަހަރުގެ ވީޑިއޯތައް |
| wallet | Wallet | ވޮލެޓް |
| buy_coins | Buy coins | ކޮއިން ގަތުން |
| upload_photo | Upload a photo | ފޮޓޯއެއް އަޕްލޯޑް ކުރޭ |
| generate | Make video | ވީޑިއޯ ހަދާ |
| processing | Making your video… | ވީޑިއޯ ތައްޔާރުކުރަނީ… |
| ready | Your video is ready! | ވީޑިއޯ ތައްޔާރު! |
| save | Save | ސޭވް ކުރޭ |
| share_tiktok | Share to TikTok | ޓިކްޓޮކަށް ޝެއަރ ކުރޭ |
| try_again | Try again | އަލުން މަސައްކަތް ކުރޭ |
| refunded | Something went wrong. Your coins were returned. | މައްސަލައެއް ދިމާވެއްޖެ. ކޮއިން އަނބުރާ ދީފިން. |
| language | Language | ބަސް |
| settings | Settings | ސެޓިންގްސް |

---

## 5. Higgsfield costs (live quotes, 13 Oct 2026)

### 5.1 Credit cost per generation

Genjutsu is billed **per second of output, rounded up**. A 6.79 s driving clip was quoted as 7 seconds:

| Engine | Resolution | Credits per second | 7 s clip | 10 s clip | 15 s clip |
|---|---|---|---|---|---|
| Genjutsu (motion transfer or swap) | 480p | 3 | 21 | 30 | 45 |
| Genjutsu | 720p | 7 | 49 | 70 | 105 |
| Genjutsu | 1080p | 11 | 77 | 110 | 165 |
| Kling 3.0 image to video | 5 s, 9:16 | n/a | 8.75 for 5 s | | |
| Seedance 2.5 | 5 s, 9:16 | n/a | 35 for 5 s | | |

Motion transfer and object swap cost the same (49 credits for 7 s at 720p in both cases). Viral Effects and Genjutsu Styles did not return a quote without real user media, so their prices must be set from a live quote during setup (the pricing engine does this automatically).

### 5.2 What a credit costs you

| Source | USD | Price per credit | MVR per credit |
|---|---|---|---|
| Ultra plan, annual | 99 / month for 3,000 cr | $0.0330 | 0.858 |
| Plus plan, annual | 39 / month for 1,000 cr | $0.0390 | 1.014 |
| Top-up / auto-refill | 18 credits per $1 | $0.0556 | 1.444 |
| **Planning rate used in this document** | | **$0.050** | **1.300** |

Why plan at $0.05: once you sell more than about 60 HD videos a month, you will be past your plan's credits and buying top-ups at $0.0556. The planning rate sits between the plan rates and the top-up rate, so the prices hold up at scale. Top-up credits expire after **90 days**, so do not over-buy.

### 5.3 Your cost per video in MVR (at the 26 rate)

| Product | Credits | Best case (Ultra annual) | Planning rate | Worst case (top-up) |
|---|---|---|---|---|
| Quick Animate (Kling, 5 s) | 8.75 | MVR 7.5 | MVR 11.4 | MVR 12.6 |
| Genjutsu Lite 480p, 7 s | 21 | MVR 18.0 | MVR 27.3 | MVR 30.3 |
| Genjutsu HD 720p, 7 s | 49 | MVR 42.0 | MVR 63.7 | MVR 70.8 |
| Genjutsu Full HD 1080p, 7 s | 77 | MVR 66.1 | MVR 100.1 | MVR 111.2 |
| Genjutsu HD 720p, 10 s | 70 | MVR 60.1 | MVR 91.0 | MVR 101.1 |
| Genjutsu HD 720p, 15 s | 105 | MVR 90.1 | MVR 136.5 | MVR 151.7 |
| Cinematic (Seedance 2.5, 5 s) | 35 | MVR 30.0 | MVR 45.5 | MVR 50.6 |

### 5.4 Important: confirm you are allowed to resell

The quotes above come from Higgsfield's regular credit system. Before launch:

- Read Higgsfield's **API / developer terms** and confirm that using their API to serve **your own paying customers** is allowed. Consumer plans are often personal use only.
- Check whether the **API dashboard has its own per-call pricing** (it may be different from the consumer plan credits used here) and whether volume discounts are available. Email their sales team. At a few thousand videos a month you have leverage.
- Ask about **webhooks**, **rate limits** and **concurrency** (consumer plans run 6 to 8 videos at a time, which is too few at peak times like the night before Eid).

---

## 6. Pricing model for your users

### 6.1 Coins

- **1 Coin = MVR 1** on the base pack. That makes it easy for users to understand.
- Bigger packs give bonus coins.
- Each template shows a fixed Coin price, worked out automatically by the backend:
  `coin_price ≈ credit_cost × MVR 1.30 × 2.0, rounded to a friendly number ending in 9`
  The ×2.0 markup covers payment fees, failed or retried jobs (about 8%), the free trial and bonus coins, and still leaves roughly **40 to 55% gross margin**. The backend refuses to run a job whose live quote would push margin below 35%, so you are protected if Higgsfield raises prices.

### 6.2 Coin packs

**Web / local payment** (BML, MIB, wallet apps). These are the cheapest for users and the best margin for you:

| Pack | Price | Coins | Bonus |
|---|---|---|---|
| Starter | MVR 100 | 100 | |
| Popular | MVR 250 | 270 | +8% |
| Creator | MVR 500 | 575 | +15% |
| Pro | MVR 1,000 | 1,200 | +20% |

**In-app purchase** (Apple / Google, USD price tiers). These are priced about 30% higher because the stores take 15% (Small Business Program) to 30%:

| Pack | Store price | ≈ MVR | Coins |
|---|---|---|---|
| Starter | $4.99 | 130 | 100 |
| Popular | $11.99 | 312 | 270 |
| Creator | $22.99 | 598 | 575 |
| Pro | $44.99 | 1,170 | 1,200 |

### 6.3 Recommended MVR price list (every feature)

1 Coin = MVR 1, so the Coin price **is** the MVR price on the base web pack. "Your cost" uses the planning rate (MVR 1.30 per credit). Margin is shown for the base web pack.

**A. Genjutsu Trending and Local Packs** (selfie → you perform the clip). Fixed price per template, based on its clip length:

| Clip length | Lite 480p | HD 720p | Full HD 1080p |
|---|---|---|---|
| up to 7 s | **MVR 59** (cost 27.3, 54%) | **MVR 129** (cost 63.7, 51%) | **MVR 199** (cost 100.1, 50%) |
| up to 10 s | **MVR 79** (cost 39.0, 51%) | **MVR 179** (cost 91.0, 49%) | **MVR 289** (cost 143.0, 51%) |
| up to 15 s | **MVR 119** (cost 58.5, 51%) | **MVR 279** (cost 136.5, 51%) | **MVR 429** (cost 214.5, 50%) |

**B. Genjutsu Swap** (swap an object, outfit or person in *your* video). Same engine and cost as Trending, so the same table as A applies. Because the user brings their own video, the app shows the price after upload using the per-second rates below (minimum 4 s, maximum 15 s).

**C. Genjutsu Styles** (restyle *your* video as toy CGI, anime, knitted yarn, etc.). Priced per second of the user's video, minimum 4 s, maximum 30 s:

| Quality | Price per second | 5 s video | 10 s video | 15 s video |
|---|---|---|---|---|
| Lite 480p | **MVR 8 / s** | MVR 40 | MVR 80 | MVR 120 |
| HD 720p | **MVR 18 / s** | MVR 90 | MVR 180 | MVR 270 |
| Full HD 1080p | **MVR 29 / s** | MVR 145 | MVR 290 | MVR 435 |

(Estimate: Higgsfield did not return a Styles quote without a real user video. These rates assume Styles bills like Genjutsu (3 / 7 / 11 credits per second). Confirm with one live quote during Phase 0, and the backend's 35% margin guard covers you in the meantime.)

**D. Viral Effects** (Vanish, Clones, Eyes In, Selfception, Street Colossus, Monster Dab, etc.; photo → video):

| Quality | Price | Assumed cost |
|---|---|---|
| HD 720p | **MVR 99** | up to 35 credits (MVR 45.5), 54% margin |
| Full HD 1080p | **MVR 149** | up to 52 credits (MVR 67.6), 55% margin |

(Estimate: each effect is a chain of an image step plus a video step, and Higgsfield only quotes it with a real photo. Any effect whose live quote is above these limits automatically moves up a price tier.)

**E. Other generators**

| Product | Price | Your cost | Margin |
|---|---|---|---|
| Quick Animate 5 s (Kling 3.0) | **MVR 29** | MVR 11.4 | 61% |
| Cinematic 5 s (Seedance 2.5) | **MVR 99** | MVR 45.5 | 54% |
| "Remake in HD" (after a Lite result) | HD price minus MVR 20 loyalty discount, e.g. **MVR 109** for 7 s | MVR 63.7 | 42% |

**F. Wallet products** (from 6.2 and 6.5): Coin packs **MVR 100 / 250 / 500 / 1,000** on the web, **≈ MVR 130 / 312 / 598 / 1,170** in-app, and **Creator Pass MVR 499 / month**.

Margins on the biggest bonus pack (where 1 Coin is worth about MVR 0.83) drop about 10 points, to roughly 39 to 46%. In-app purchases end up slightly *better* than web after the store's cut, because the IAP packs are priced higher.

Positioning: **Genjutsu Lite at 59** is the "impulse buy" for TikTok trends. HD and Full HD are upsells for people who want sharper results. A good UX pattern is to generate in Lite, and if the user loves it, offer "Remake in HD" (a new generation, charged at the HD price).

### 6.4 Free trial and promotions

- **On signup (phone verified):** 1 free Quick Animate (costs you about MVR 11) with a small watermark. Avoid giving a free Genjutsu HD (MVR 64 each). That gets expensive quickly with fake accounts.
- **Referral:** both people get 30 Coins after the friend's first top-up (not just signup).
- **Seasonal packs:** Eid al-Fitr, Eid al-Adha, Independence Day (26 July), school holidays. Launch new Local Pack templates for each.
- **Watermark:** free and trial outputs carry a small "made with [App]" mark (free marketing on TikTok). Paid outputs are clean.

### 6.5 Optional subscription (Phase 3)

**Creator Pass: MVR 499 / month** = 600 Coins + no watermark + priority queue + early access to new Local Packs. At planning cost, a fully used pass still leaves roughly 45% margin, and many subscribers will not use all of it.

---

## 7. Monthly profit scenarios

Assumed mix: 45% Lite, 30% HD, 15% Quick Animate, 5% Full HD, 5% Cinematic. Average revenue of MVR 0.90 per Coin (bonus packs), an 8% failure and retry buffer on API cost, 3% payment fees, and **MVR 4,000 a month in fixed costs** (Supabase, Railway, storage, SMS OTP, Apple developer fee spread monthly, domain).

| Videos / month | Revenue | Higgsfield cost | Fees | Fixed | **Profit before tax** | Credits needed |
|---|---|---|---|---|---|---|
| 500 | MVR 38,025 | MVR 21,806 | MVR 1,141 | MVR 4,000 | **MVR 11,078** | ~16,800 |
| 2,000 | MVR 152,100 | MVR 87,224 | MVR 4,563 | MVR 4,000 | **MVR 56,313** | ~67,100 |
| 5,000 | MVR 380,250 | MVR 218,059 | MVR 11,408 | MVR 4,000 | **MVR 146,784** | ~167,700 |

Break-even on fixed costs is only about **70 HD videos a month**. The real risks are not costs but (a) Higgsfield raising prices (the pricing engine protects you) and (b) user acquisition. Development cost (your time or a freelancer) and GST are not included above.

---

## 8. Payments in the Maldives

| Channel | Use for | Notes |
|---|---|---|
| **BML Connect** payment gateway | Web top-up page | Needs a registered business. Takes local cards. |
| **MIB** payment gateway | Web top-up page | Second option, and Shariah-compliant banking |
| Mobile wallets (e.g. Dhiraagu Pay, Ooredoo m-Faisaa) | Web top-up | Check each one's merchant API availability |
| Bank transfer + slip upload | Early days only | Manual approval in an admin panel. Simple to start with but does not scale. |
| **Google Play Billing / Apple IAP** | In-app top-up | Required by store rules for digital goods bought inside the app |

**App store rule to respect:** inside the iOS app (and generally on Google Play) you must use their billing for Coins and **must not link or point users** to your cheaper web page. You *can* run a separate website where people top up their account, and Coins bought there appear in the app (same phone number login). Promote the website through TikTok, Instagram and Viber, not inside the app.

**Business and tax checklist (confirm with the authorities, rules change):**
- Register the business (business portal of the Ministry of Economic Development).
- Register with **MIRA** for tax. GST registration becomes mandatory above the turnover threshold (MVR 1 million over 12 months at the time of writing). General GST is 8%. Decide whether your Coin prices are GST-inclusive. Recommended: yes, keep prices simple.
- Your Higgsfield bill is in USD. Plan how you pay it (business USD card or account), because this is exactly the USD problem your users have.

---

## 9. Safety, moderation and values

Face-swap and motion-transfer apps get misused quickly. Build these in from day one:

1. **Consent:** users confirm the photo is of themselves or someone who agreed. Block known faces of politicians and public figures (deepfakes of them can cause real legal trouble under Maldivian defamation and election rules).
2. **No minors** in Swap and face features. Use an age-estimate check on the uploaded photo and block when in doubt.
3. **No nudity or sexual content.** Run image moderation on both the input and the output. Higgsfield has its own filters, but add your own layer too.
4. **Modesty-aware templates:** curate the trending list instead of syncing everything automatically. Some trending clips will not suit a Maldivian Muslim audience. Add a "family-friendly" flag per template and a "no music" export option, since scholars differ on music and some users will want it.
5. **Report button** on every result, plus an admin panel to disable a template instantly.
6. **Privacy:** delete uploaded selfies after the job finishes, delete results after 30 days, and state this clearly in a Dhivehi privacy policy.
7. **Naming:** avoid branding the app around "magic" or sorcery words (for example *fanditha*). That is sensitive locally. "Genjutsu" is fine as a feature name since it is Higgsfield's product name.

A note on running the business itself: Islam puts real weight on honest trade. The Prophet ﷺ said: *"The buyer and the seller have the option (to cancel) as long as they have not parted. If they are truthful and make things clear, their transaction will be blessed. If they lie and conceal, the blessing of their transaction will be wiped out"* (Sahih al-Bukhari 2079, Sahih Muslim 1532). He ﷺ also said, *"Whoever cheats us is not one of us"* (Sahih Muslim 102). In practice: show the exact price before every generation, refund failures automatically, no hidden fees, no loot-box style "random" rewards, and make bonus terms clear. That is good ethics and good business, because it builds trust.

---

## 10. Roadmap

| Phase | Weeks | Deliverables |
|---|---|---|
| **0. Validate** | 1 to 2 | Confirm Higgsfield reseller/API terms and pricing. Register business, apply to BML/MIB gateways. Run 30 test generations on Maldivian faces and skin tones (about 1,500 credits ≈ $75 ≈ MVR 1,950) to check quality. Pick a launch set of 20 templates. Film 10 local driving clips. |
| **1. MVP (Android first)** | 3 to 8 | Flutter app with Dhivehi/English and RTL, phone OTP login, Genjutsu Trending + Lite/HD, Quick Animate, wallet + web top-up (BML), job queue with auto refunds, push notifications, save/share, moderation v1, admin panel (templates, refunds, users). Closed beta with 50 to 100 TikTok creators. |
| **2. Launch** | 9 to 12 | iOS app with Apple IAP, Google Play Billing, Genjutsu Swap and Styles, Viral Effects, Local Packs, referral system, watermark logic. Launch campaign with local TikTokers. |
| **3. Grow** | 13+ | Creator Pass subscription, direct TikTok posting (TikTok Content Posting API, needs their app review), B2B packs for shops and resorts (product videos, ads), seasonal Eid/Ramadan packs, volume pricing deal with Higgsfield. |

### Launch cost estimate (excluding developer time)

| Item | USD | MVR |
|---|---|---|
| Apple Developer Program (yearly) | 99 | 2,574 |
| Google Play (one time) | 25 | 650 |
| Test credits (Phase 0) | 75 | 1,950 |
| Starting credit float (Ultra annual month) | 99 | 2,574 |
| Backend + storage, first 3 months | ~150 | ~3,900 |
| Business registration, gateway setup | varies | varies |
| **Approximate total** | **~450** | **~11,650** |

---

## 11. Key metrics to watch

- Cost per video vs. price per video (alert if margin drops below 35%)
- Failure rate per template (disable templates that fail often, since they cost you retries)
- Free trial to first top-up conversion (target 8 to 15%)
- Average top-up size, and repeat purchase within 30 days
- Share rate to TikTok (your free marketing)
- Peak-hour queue time (to decide when to add concurrency)

---

## 12. Open decisions for you

1. **App name.** Ideas: *Vidhaa* (ވިދާ, "sparkle"), *ReelDhoni*, *BoduReel*.
2. Launch Android-only first (faster, most Maldivian phones) or both platforms together?
3. Which payment gateway to apply to first: BML or MIB?
4. Do you film your own Local Pack driving videos, or partner with local TikTokers (revenue share per use)?
5. Your Higgsfield API plan: confirm the exact per-call pricing and terms so the tables in section 5 can be updated with the real API numbers.
