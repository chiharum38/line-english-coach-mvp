# LINE AI English Speaking Coach — MVP

3-question AI English speaking quiz inside LINE.
Voice answers. Instant feedback. ~3 minutes.

---

## Setup

### 1. Copy env file
```bash
cp .env.example .env
```
Fill in your 4 API keys (LINE, OpenAI, Anthropic).
Leave Supabase blank for MVP.

### 2. Install
```bash
npm install
```

### 3. Start locally
```bash
npm start
```

### 4. Expose to the internet (for LINE webhook)
Use [ngrok](https://ngrok.com) for local testing:
```bash
ngrok http 3000
```
Copy the `https://` URL.

### 5. Set LINE webhook
- Go to LINE Developers → your channel → Messaging API
- Webhook URL: `https://YOUR_NGROK_URL/webhook`
- Enable "Use webhook"

### 6. Deploy to production
Recommended: [Vercel](https://vercel.com) (free)
```bash
npm install -g vercel
vercel
```
Set environment variables in Vercel dashboard.

---

## Quiz Flow

```
User adds bot
    ↓
Welcome message (Japanese)
    ↓
User types "start"
    ↓
Round 1 — Situation (project delay)
User sends voice message
    ↓ AI feedback
User types "next"
    ↓
Round 2 — Paraphrase ("I don't understand.")
User sends voice message
    ↓ AI feedback
User types "next"
    ↓
Round 3 — Speed Drill (確認してからご連絡します)
User sends voice message
    ↓ AI feedback + Final summary
```

---

## Fixed Quiz (MVP)

| Round | Type | Content |
|-------|------|---------|
| 1 | Situation | Project is 2 days late |
| 2 | Paraphrase | "I don't understand." |
| 3 | Speed Drill | 確認してからご連絡します |

---

## Test Checklist

- [ ] `.env` created with all keys
- [ ] `npm install` completed
- [ ] `npm start` runs without errors
- [ ] Webhook URL set in LINE Developers
- [ ] `follow` event → welcome message received
- [ ] Type `start` → Round 1 question appears
- [ ] Send voice message → "チェック中です..." appears
- [ ] Feedback received within ~10 seconds
- [ ] Type `next` → Round 2 question appears
- [ ] Voice message → feedback received
- [ ] Type `next` → Round 3 question appears
- [ ] Voice message → feedback + final summary received

---

## Supabase (optional — skip for Day 1)

To add later:
```sql
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id TEXT UNIQUE NOT NULL,
  display_name TEXT,
  sessions_total INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Files

```
line-english-coach/
├── bot_server.js          ← main bot
├── content_bank_mvp.json  ← 8 quiz prompts
├── package.json
├── .env                   ← your API keys (never commit this)
└── README.md
```
