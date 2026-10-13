# Maldivian AI Video App (Higgsfield powered): Product and Pricing Plan

Status: planning only, no code yet
Exchange rate used everywhere: **1 USD = 26 MVR**
Costs below are **Higgsfield API (developer) prices**, from [open.higgsfield.ai/pricing](https://open.higgsfield.ai/pricing) and the model pages on 13 Oct 2026. They are not the consumer web app's credit prices. Re-check them before launch, because the API currently shows a 50% discount with no stated end date.

---

## 1. The idea in one paragraph

A mobile app, in Dhivehi and English, where Maldivians make TikTok-ready AI videos (mainly **Higgsfield Genjutsu** and viral effects) from a selfie or a short clip, and **pay in MVR** using local options (BML, MIB, wallet apps, or the app stores). The app never exposes your Higgsfield key. Users buy **Coins**, every template shows its Coin price up front, and your backend pays Higgsfield's pay-as-you-go API in USD.

Why people would pay you instead of going to Higgsfield directly:

1. **No USD card needed.** Higgsfield's cheapest plan is USD 39 to 49 a month on a foreign currency card. Many Maldivians have tight USD card limits. You sell small MVR amounts.
2. **Pay per video**, not a monthly subscription.
3. **Dhivehi UI** (Thaana, right to left) and local templates (boduberu, dhoni rides, Eid outfits, Hulhumalé beach, wedding dances).
4. **Simple.** Pick a template, add a selfie, get a video. No prompts or settings to learn.

---

## 2. Feature menu (what users can make)

| # | Feature (UI name) | Higgsfield engine | User provides | Notes |
|---|---|---|---|---|
| 1 | **Genjutsu Trending** (motion transfer) | `POST /higgsfield/genjutsu/motion-transfer/v1.0` | 1 selfie / full body photo | Your face and body perform a trending clip. This is the main product. The API needs a driving video of **at least 4 s**. |
| 2 | **Genjutsu Swap** (object/outfit/character swap) | `POST /higgsfield/genjutsu/object-swap/v1.0` | Their own video + 1 to several reference photos | e.g. swap the bag, car, outfit or person in their clip |
| 3 | **Genjutsu Styles** | `POST /higgsfield/genjutsu/restyle/v1.0` | Their own video (4 to 30 s) | Redraw their video as toy CGI, knitted yarn, 2D anime, etc. |
| 4 | **Viral Effects** | **Not on the API.** Higgsfield's Viral Hub presets are web-app only. Rebuild them as your own prompt recipes on Kling 3.0 / Seedance 2.5 image-to-video. | 1 photo | Vanish, Clones, Eyes In, Giant, Monster reveal, etc. Your own recipes, tested until they look good |
| 5 | **Quick Animate** (cheap starter) | `POST /kling-video/v3.0/std/image-to-video`, 5 s | 1 photo + optional prompt | Very cheap, good free trial item |
| 6 | **Cinematic** | Seedance 2.5 image to video, 720p, 5 s | Photo + prompt | Higher quality general video |
| 7 | **Local Packs** (your secret weapon) | Genjutsu motion transfer with **your own driving videos** | 1 photo | Film 10 to 20 short local clips (boduberu, bodu mas fishing pose, dhoni, Eid greeting, Malé traffic scooter, wedding). Nobody else has these. |

Trending Genjutsu templates seen in the live catalog right now, for reference: Unboxed Item Swap, Rug Transition Swap, Night Fuel Drive, Supercar Showreel Spin, Urban Style Rotation, Ceiling Fan Transition, Arcade Identity Swap, Orbital Room Sweep, Coastal Tower Assembly, Studio Duo Exchange, Luxury Bag Swap, Boutique Terrace Dance, Convertible Head Bob, Influencer Rhythm Recap. **API note:** the web app's Trending gallery is not part of the API. With the API you supply the driving video yourself, so your "Trending" tab is clips you film or license (for example, local TikTokers recreating the trends, paid per clip or by revenue share). Do not reuse other creators' clips from Higgsfield's community gallery without permission. Store templates in your own database so you can add them without an app update.

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
4. Backend computes the **exact API cost**: input video seconds (rounded up) × the per-second rate for that resolution, read from a `rates` table you update when Higgsfield changes prices. If the margin would fall below 35% (for example, because the launch discount ended), the job is blocked and you get an alert, so you never sell at a loss.
5. Backend places a **hold** on the user's Coins (not a charge yet) and submits the job.
6. Higgsfield calls your **webhook** when the job finishes (polling is the fallback). The worker copies the video to your storage straight away, because Higgsfield only keeps outputs for 7 days.
7. On success the hold becomes a charge. **On failure the Coins are automatically released.** Users never pay for failed jobs, and neither do you: the API does not charge for failed, timed-out or NSFW-blocked requests.
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
- `rates` (endpoint, resolution, usd_per_second, valid_from). One row per Higgsfield price; update it when Higgsfield changes prices and every template's cost updates with it.
- `templates` (id, feature, endpoint, driving_video_url, title_en, title_dv, preview_url, duration_s, resolution, coin_price, coin_price_plan_b, active, sort)
- `jobs` (id, user_id, template_id, status, api_cost_usd, coins_held, higgsfield_request_id, result_url, error, created_at)
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

## 5. Higgsfield API costs (13 Oct 2026)

The API is **pay-as-you-go in USD**: you top up a balance, each generation deducts its cost, and spending stops at zero. There is no subscription. Sources: [pricing page](https://open.higgsfield.ai/pricing), [Genjutsu motion transfer](https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0), [object swap](https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0), [restyle](https://open.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0), [Kling 3.0 Standard](https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video), [Seedance 2.5](https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video), [API FAQ](https://docs.higgsfield.ai/docs/help/faq.md), [Higgsfield API blog](https://higgsfield.ai/blog/higgsfield-api).

### 5.1 Genjutsu: per second of the INPUT video, rounded up

Motion transfer, object swap and restyle all cost the same. The pricing page currently shows **50% off** ("from $0.159/s"), with no stated conditions or end date. Treat it as a launch offer that can end any day.

| Resolution | List price | Current price (50% off) | Current, in MVR | List, in MVR |
|---|---|---|---|---|
| 480p | $0.318 / s | $0.159 / s | **MVR 4.13 / s** | MVR 8.27 / s |
| 720p | $0.681 / s | $0.3405 / s | **MVR 8.85 / s** | MVR 17.71 / s |
| 1080p | $1.632 / s | $0.816 / s | **MVR 21.22 / s** | MVR 42.43 / s |

### 5.2 Your cost per video in MVR

| Product | Current API cost | If the discount ends (list) |
|---|---|---|
| Genjutsu 480p, 7 s | MVR 28.9 | MVR 57.9 |
| Genjutsu 720p, 7 s | MVR 62.0 | MVR 123.9 |
| Genjutsu 1080p, 7 s | MVR 148.5 | MVR 297.0 |
| Genjutsu 720p, 10 s | MVR 88.5 | MVR 177.1 |
| Genjutsu 720p, 15 s | MVR 132.8 | MVR 265.6 |
| Quick Animate: Kling 3.0 Standard, 5 s ($0.042 to $0.063 / s now, $0.084 to $0.126 / s list) | MVR 5.5 to 8.2 | MVR 10.9 to 16.4 |
| Cinematic: Seedance 2.5, 720p, 5 s (about $0.32 / s now, $0.46 / s list) | MVR 42.1 | MVR 60.1 |

### 5.3 How this compares with the web app credits I checked first

| Genjutsu 720p, 7 s | Cost |
|---|---|
| Web app, Ultra plan credits (49 credits × $0.033) | $1.62 = MVR 42 |
| **API today (50% off)** | **$2.38 = MVR 62** |
| API at list price | $4.77 = MVR 124 |

The API costs more than the web app's credits, and 1080p on the API costs about 2.7 times as much. But the API is the right way to build a product: it is built for apps, explicitly allows **commercial use** of outputs, refunds failures, has webhooks, and scales. A consumer subscription is for one person's own use, so do not build the app on it.

### 5.4 Other API facts that matter for the plan

- **Concurrency** (how many videos render at once) depends on how much you topped up in the last 28 days: 2 by default, **10 at $25+, 20 at $100+, 40 at $1,000+**, higher by contacting sales. The night before Eid you will want at least 20.
- **Top-up funds expire 1 year** after they are added (much better than the web app's 90 days).
- **Failed, timed-out and NSFW-blocked requests are not charged.**
- **Outputs are only kept 7 days**, so copy them to your own storage.
- **Not available on the API:** the Viral Hub effects and the web app's Trending gallery. You build those yourself (see section 2).
- **Committed-use contracts** with invoice billing are available through [sales](https://open.higgsfield.ai/contact-sales). Ask them to **lock in the current 50%-off rate** for a volume commitment. That is the single biggest lever on your margins.
- **Reselling:** commercial use of outputs is allowed, but the pages do not explicitly address building a consumer app that resells generations. Confirm by email before launch.

---

## 6. Pricing model for your users

### 6.1 Coins

- **1 Coin = MVR 1** on the base pack. That makes it easy for users to understand.
- Bigger packs give bonus coins.
- Each template shows a fixed Coin price, worked out by the backend from the rates table:
  `coin_price ≈ API cost in MVR × 2.0, rounded to a friendly number ending in 9`
  The ×2.0 markup covers payment fees, bonus coins and the free trial, and leaves about **50% gross margin** (around 40% on the biggest bonus pack). Failed jobs cost you nothing on the API, so no retry buffer is needed beyond about 3% for user "remakes".
- **The discount trap:** 2 × today's discounted cost is exactly Higgsfield's list price. If the discount ends and you have not changed your prices, **your margin drops to about zero**. So keep two price lists ready (6.3) and let the backend's 35% margin guard switch to Plan B automatically if the rates table changes.

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

1 Coin = MVR 1, so the Coin price **is** the MVR price on the base web pack.

**A. Genjutsu Trending and Local Packs** (selfie → you perform the clip). Fixed price per template, based on its clip length. The API needs at least 4 s, so the shortest tier is "up to 5 s".

Launch prices (while the 50% API discount lasts), about 50% margin:

| Clip length | Lite 480p | HD 720p | Full HD 1080p |
|---|---|---|---|
| up to 5 s | **MVR 49** | **MVR 89** | **MVR 219** |
| up to 7 s | **MVR 59** | **MVR 129** | **MVR 299** |
| up to 10 s | **MVR 89** | **MVR 179** | **MVR 429** |
| up to 15 s | **MVR 129** | **MVR 269** | **MVR 639** |

Plan B prices (if the discount ends), about 38% margin at list price:

| Clip length | Lite 480p | HD 720p | Full HD 1080p |
|---|---|---|---|
| up to 5 s | MVR 69 | MVR 149 | MVR 349 |
| up to 7 s | MVR 99 | MVR 199 | MVR 479 |
| up to 10 s | MVR 139 | MVR 289 | MVR 679 |
| up to 15 s | MVR 199 | MVR 429 | MVR 1,019 |

Recommendation: launch with **Lite and HD only**, and keep templates **5 to 7 seconds** (that is TikTok's sweet spot anyway). 1080p is very expensive on the API, so offer it later as a "Pro" option, or only after you have a volume deal.

**B. Genjutsu Swap and C. Genjutsu Styles** (the user brings their own video). Same engine price as A, charged per second of the user's video (minimum 4 s, maximum 15 s for Swap and 30 s for Styles). The app shows the price right after upload.

| Quality | Launch, per second | e.g. 10 s | Plan B, per second |
|---|---|---|---|
| Lite 480p | **MVR 9 / s** | MVR 90 | MVR 14 / s |
| HD 720p | **MVR 18 / s** | MVR 180 | MVR 29 / s |
| Full HD 1080p | **MVR 43 / s** | MVR 430 | MVR 69 / s |

**D. Viral Effects** (your own effect recipes on Kling 3.0 / Seedance, since the Viral Hub is not on the API):

| Version | Price | Your cost now | Cost at list |
|---|---|---|---|
| Effect on Kling 3.0, 5 s | **MVR 49** | about MVR 8 to 15 | about MVR 16 to 30 |
| Premium effect on Seedance 2.5 720p, 5 s | **MVR 129** | MVR 42.1 | MVR 60.1 |

These prices hold even if the discount ends (40%+ margin at list).

**E. Other generators** (these prices also hold at list price)

| Product | Price | Your cost now | Cost at list |
|---|---|---|---|
| Quick Animate, Kling 3.0 Standard 5 s | **MVR 29** | MVR 5.5 to 8.2 | MVR 10.9 to 16.4 |
| Cinematic, Seedance 2.5 720p 5 s | **MVR 99** | MVR 42.1 | MVR 60.1 |
| "Remake in HD" after a Lite result (7 s) | **MVR 109** | MVR 62.0 | MVR 123.9 (move to MVR 179 under Plan B) |

**F. Wallet products:** Coin packs **MVR 100 / 250 / 500 / 1,000** on the web, **≈ MVR 130 / 312 / 598 / 1,170** in-app, and **Creator Pass MVR 499 / month** (6.5).

Margins on the biggest bonus pack (where 1 Coin is worth about MVR 0.83) are about 10 points lower. In-app purchases end up slightly *better* than web after the store's cut, because the IAP packs are priced higher.

Positioning: **Genjutsu Lite at 59** is the "impulse buy" for TikTok trends. HD is the upsell for people who want sharper results. A good UX pattern is to generate in Lite, and if the user loves it, offer "Remake in HD" (a new generation at a small discount).

### 6.4 Free trial and promotions

- **On signup (phone verified):** 1 free Quick Animate (costs you about MVR 8) with a small watermark. Avoid giving a free Genjutsu HD (MVR 62 each). That gets expensive quickly with fake accounts.
- **Referral:** both people get 30 Coins after the friend's first top-up (not just signup).
- **Seasonal packs:** Eid al-Fitr, Eid al-Adha, Independence Day (26 July), school holidays. Launch new Local Pack templates for each.
- **Watermark:** free and trial outputs carry a small "made with [App]" mark (free marketing on TikTok). Paid outputs are clean.

### 6.5 Optional subscription (Phase 3)

**Creator Pass: MVR 499 / month** = 600 Coins + no watermark + priority queue + early access to new Local Packs. Only launch it once you know whether the API discount is staying, because the pass locks in a price for a month at a time.

---

## 7. Monthly profit scenarios (API pricing)

Assumed mix: 45% Lite 7 s, 30% HD 7 s, 15% Quick Animate, 5% Full HD 7 s, 5% Cinematic. Average revenue of MVR 0.90 per Coin (bonus packs), 3% remake buffer, 3% payment fees, and **MVR 4,000 a month in fixed costs**.

| Videos / month | Scenario | Revenue | Higgsfield API | Fees | Fixed | **Profit before tax** | API top-up needed |
|---|---|---|---|---|---|---|---|
| 500 | Launch prices, discount on | MVR 40,275 | MVR 21,818 | MVR 1,208 | MVR 4,000 | **MVR 13,249** | ~$840 |
| 500 | Plan B prices, discount ended | MVR 61,875 | MVR 43,023 | MVR 1,856 | MVR 4,000 | **MVR 12,996** | ~$1,655 |
| 2,000 | Launch prices, discount on | MVR 161,100 | MVR 87,272 | MVR 4,833 | MVR 4,000 | **MVR 64,995** | ~$3,360 |
| 2,000 | Plan B prices, discount ended | MVR 247,500 | MVR 172,092 | MVR 7,425 | MVR 4,000 | **MVR 63,983** | ~$6,620 |
| 5,000 | Launch prices, discount on | MVR 402,750 | MVR 218,180 | MVR 12,082 | MVR 4,000 | **MVR 168,488** | ~$8,390 |
| 5,000 | Plan B prices, discount ended | MVR 618,750 | MVR 430,231 | MVR 18,562 | MVR 4,000 | **MVR 165,956** | ~$16,550 |

Plan B assumes the same number of videos at higher prices, which is optimistic, since some users will buy less. Two real risks follow. First, **cash flow**: you prepay Higgsfield in USD before users pay you, so at 2,000 videos a month you need about $3,400 to $6,600 of float. Second, **the discount ending**: lock it in with a committed-use deal if you can. Development cost and GST are not included above.

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
| **0. Validate** | 1 to 2 | Confirm Higgsfield reseller/API terms and pricing. Register business, apply to BML/MIB gateways. Run 30 test generations on Maldivian faces and skin tones (30 × Genjutsu 720p 7 s at $2.38 ≈ $72 ≈ MVR 1,860) to check quality. Pick a launch set of 20 templates. Film 10 local driving clips. |
| **1. MVP (Android first)** | 3 to 8 | Flutter app with Dhivehi/English and RTL, phone OTP login, Genjutsu Trending + Lite/HD, Quick Animate, wallet + web top-up (BML), job queue with auto refunds, push notifications, save/share, moderation v1, admin panel (templates, refunds, users). Closed beta with 50 to 100 TikTok creators. |
| **2. Launch** | 9 to 12 | iOS app with Apple IAP, Google Play Billing, Genjutsu Swap and Styles, Viral Effects, Local Packs, referral system, watermark logic. Launch campaign with local TikTokers. |
| **3. Grow** | 13+ | Creator Pass subscription, direct TikTok posting (TikTok Content Posting API, needs their app review), B2B packs for shops and resorts (product videos, ads), seasonal Eid/Ramadan packs, volume pricing deal with Higgsfield. |

### Launch cost estimate (excluding developer time)

| Item | USD | MVR |
|---|---|---|
| Apple Developer Program (yearly) | 99 | 2,574 |
| Google Play (one time) | 25 | 650 |
| API test generations (Phase 0) | 75 | 1,950 |
| First API top-up ($100 also unlocks 20 concurrent videos) | 100 | 2,600 |
| Backend + storage, first 3 months | ~150 | ~3,900 |
| Business registration, gateway setup | varies | varies |
| **Approximate total** | **~450** | **~11,700** |

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
5. Email Higgsfield sales: (a) confirm a consumer app reselling Genjutsu generations is allowed, (b) ask how long the 50% discount lasts, and (c) ask for a committed-use deal that locks it in.
6. Viral Effects: build your own Kling/Seedance recipes for launch, or skip them until Higgsfield exposes effects on the API?
