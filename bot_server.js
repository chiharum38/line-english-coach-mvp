// ═══════════════════════════════════════════════════
//  LINE AI English Speaking Coach — MVP Bot Server
//  3 questions. Text answers. Japanese AI feedback.
// ═══════════════════════════════════════════════════

require("dotenv").config();
const express = require("express");
const { Client, middleware } = require("@line/bot-sdk");
// [CHANGE 1] OpenAI removed entirely — Anthropic only
const Anthropic = require("@anthropic-ai/sdk");

const app = express();

// ── CONFIG ──────────────────────────────────────────
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new Client(lineConfig);

// [CHANGE 1] Anthropic only — null-safe: won't crash if key is missing
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── CONTENT BANK ─────────────────────────────────────
const CONTENT = require("./content_bank_mvp.json");

// Fixed MVP quiz order:
// Round 1 → Situation:   project delay           (id 2)
// Round 2 → Paraphrase:  "The project is late."  (id 6)
// Round 3 → Speed Drill: 確認してからご連絡します  (id 10)
const MVP_QUIZ = [
  CONTENT.prompts.find(p => p.id === 2),  // R1: situation
  CONTENT.prompts.find(p => p.id === 6),  // R2: paraphrase
  CONTENT.prompts.find(p => p.id === 10), // R3: speed_drill
];

// ── SESSION STATE ─────────────────────────────────────
// Simple in-memory store. Fine for MVP. Swap for Redis/Supabase later.
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) resetSession(userId);
  return sessions.get(userId);
}

function resetSession(userId) {
  sessions.set(userId, {
    step:      "idle",   // idle → r1 → r1_done → r2 → r2_done → r3 → done
    feedbacks: [],
    completed: false,    // [CHANGE 10] one-attempt lock
  });
}

// ══════════════════════════════════════════════════════
//  MESSAGES
// ══════════════════════════════════════════════════════

// Shown when user first adds the bot as a friend
const WELCOME_JP =
  `こんにちは！👋\n` +
  `AI English Speaking Coachへようこそ。\n\n` +
  `ビジネス英語の練習ができる\n` +
  `3問スピーキングチェックです。\n\n` +
  `━━━━━━━━━━━━\n` +
  `「start」と送ってください。\n` +
  `クイズが始まります 👍`;

// [CHANGE 5] Text-first intro — shown when user types "start"
const START_INTRO =
  `✍️ 3分スピーキングチェック\n\n` +
  `3問だけ英語で答えてください。\n\n` +
  `1️⃣ 状況（Situation）を読む\n` +
  `2️⃣ 英語をテキストで入力する\n` +
  `3️⃣ AIフィードバックを受け取る\n\n` +
  `━━━━━━━━━━━━\n` +
  `今回はテキスト回答がおすすめです ✍️\n` +
  `では始めましょう！`;

// [CHANGE 6] Clearer question format: Situation / Task / Hint / Instruction
function buildQuestionText(round, prompt) {
  const icon =
    prompt.type === "situation"  ? "📋" :
    prompt.type === "paraphrase" ? "🔄" : "⚡";

  const lines = [
    `${icon} Round ${round} / 3`,
    `━━━━━━━━━━━━`,
    ``,
  ];

  if (prompt.type === "situation") {
    // Support optional `task` field in JSON; auto-generate if missing
    const task = prompt.task || `この状況に英語で対応してください。`;
    lines.push(
      `📌 Situation（状況）`,
      prompt.situation,
      ``,
      `✅ Task（やること）`,
      task,
      ``,
      `💡 ヒント`,
      prompt.jp_hint,
    );
  } else if (prompt.type === "paraphrase") {
    const task = prompt.task || `次のフレーズを、2つの違う言い方で書いてください。`;
    lines.push(
      `📌 Phrase（フレーズ）`,
      `"${prompt.prompt}"`,
      ``,
      `✅ Task（やること）`,
      task,
      ``,
      `💡 ヒント`,
      prompt.jp_hint,
    );
  } else if (prompt.type === "speed_drill") {
    const task = prompt.task || `下の日本語を英語に訳してください。`;
    lines.push(
      `📌 日本語`,
      `【 ${prompt.jp} 】`,
      ``,
      `✅ Task（やること）`,
      task,
    );
  }

  // [CHANGE 3] Text-first instruction — no mention of microphone
  lines.push(
    ``,
    `━━━━━━━━━━━━`,
    `⌨️ 英語で答えてください`,
    `テキスト入力でOKです。`,
  );

  return lines.join("\n");
}

// [CHANGE 7] Feedback: mostly Japanese, includes next_tip
function buildFeedbackText(evaluation, round) {
  const { verdict, explanation, grammar_feedback, grammar_ok, model_answer, next_tip } = evaluation;

  const verdictLine =
    verdict === "correct" ? "✅ よくできました！" :
    verdict === "partial"  ? "🟡 いい感じです！もう少しです" :
                             "📚 もう少し練習しましょう";

  let msg = `${verdictLine}\n\n`;

  msg += `━━━━━━━━━━━━\n`;
  msg += `Meaning（意味）\n`;
  if (verdict === "correct") {
    msg += `✅ 意味はしっかり伝わっています\n\n`;
  } else if (verdict === "partial") {
    msg += `🟡 だいたい伝わっていますが、もう少し明確にできます\n\n`;
  } else {
    msg += `❌ 意味がうまく伝わっていません\n\n`;
  }
  msg += `${explanation}\n\n`;

  msg += `━━━━━━━━━━━━\n`;
  msg += `Grammar（文法）\n`;
  if (grammar_ok || !grammar_feedback) {
    msg += `大きな文法ミスはありません 👍\n\n`;
  } else {
    msg += `${grammar_feedback}\n\n`;
  }

  msg += `━━━━━━━━━━━━\n`;
  msg += `Better answer（おすすめの言い方）\n\n`;
  msg += `"${model_answer}"\n\n`;

  if (next_tip) {
    msg += `━━━━━━━━━━━━\n`;
    msg += `Next tip（次のポイント）\n${next_tip}\n\n`;
  }

  if (round < 3) {
    msg += `━━━━━━━━━━━━\n「next」と送って次の問題へ 👉`;
  } else {
    msg += `━━━━━━━━━━━━\nお疲れさまでした！結果をまとめています...`;
  }

  return msg;
}

// Summary shown after Round 3
function buildSummaryText(feedbacks) {
  const correct = feedbacks.filter(f => f.verdict === "correct").length;
  const total   = feedbacks.length;

  const phrases = feedbacks
    .map(f => f.model_answer)
    .filter(Boolean)
    .map(a => a.trim());

  return (
    `🎉 お疲れさまでした！\nスピーキングチェック完了です。\n\n` +
    `━━━━━━━━━━━━\n` +
    `📊 結果\n` +
    `${correct} / ${total} 問 正解\n\n` +
    `━━━━━━━━━━━━\n` +
    `今日のフレーズまとめ\n\n` +
    phrases.map(p => `・"${p}"`).join("\n") +
    `\n\n` +
    `━━━━━━━━━━━━\n` +
    `毎日少しずつ練習することが大切です。\n` +
    `また明日も頑張りましょう 💪`
  );
}

// [CHANGE 8] Fallback when ANTHROPIC_API_KEY is not set
function buildFallbackEvaluation(promptData) {
  const modelAnswer =
    promptData.model_answer ||
    promptData.version_a    ||
    promptData.en           ||
    "（モデル回答なし）";

  return {
    verdict:          "partial",
    explanation:      "回答ありがとうございます。AIによる詳細な評価は現在利用できません。",
    grammar_feedback: "",
    grammar_ok:       true,
    model_answer:     modelAnswer,
    next_tip:         "上のおすすめの言い方を参考にして練習してみてください。",
  };
}

// ══════════════════════════════════════════════════════
//  AI EVALUATION — Anthropic only
// ══════════════════════════════════════════════════════

// [CHANGE 2] Anthropic-only, Japanese feedback, low token budget (haiku model)
async function evaluateAnswer(transcript, promptData) {
  const typeInstructions = {
    situation:
      `The student answered a workplace situation question. ` +
      `Evaluate: (1) Did they communicate the correct meaning for THIS specific situation? ` +
      `(2) Grammar errors? (3) Professionalism? ` +
      `Only evaluate based on the given situation. Do not invent facts not stated.`,
    paraphrase:
      `The student rephrased a phrase in two different ways. ` +
      `Evaluate: (1) Did they give two distinct versions? ` +
      `(2) Are they professional and natural? (3) Grammar?`,
    speed_drill:
      `The student translated a Japanese phrase into English. ` +
      `Evaluate: (1) Is the meaning correct? ` +
      `(2) Minor wording differences are fine. (3) Grammar?`,
  };

  const contextMap = {
    situation:
      `Situation: ${promptData.situation}\nIdeal answer: ${promptData.model_answer}`,
    paraphrase:
      `Phrase: "${promptData.prompt}"\n` +
      `Expected: A) ${promptData.version_a}  B) ${promptData.version_b}`,
    speed_drill:
      `Japanese: ${promptData.jp}\nExpected English: ${promptData.en}`,
  };

  const system =
    `あなたは日本人ビジネスパーソン向けの英語コーチです。B1レベルの学習者の英語回答を評価します。\n` +
    `${typeInstructions[promptData.type]}\n\n` +
    `フィードバックはほぼ日本語で書いてください。` +
    `英語はmodel_answerのみで使います。短く、LINEで読みやすいように書いてください。\n\n` +
    `Return ONLY valid JSON (no markdown fences):\n` +
    `{\n` +
    `  "verdict": "correct" | "partial" | "incorrect",\n` +
    `  "explanation": "（日本語で1〜2文）意味は伝わったか",\n` +
    `  "grammar_feedback": "（日本語で）修正点。問題なければ空文字列",\n` +
    `  "grammar_ok": true | false,\n` +
    `  "model_answer": "自然な英語の例文を1つ（英語のみ）",\n` +
    `  "next_tip": "（日本語で）次に意識するポイントを1つ短く"\n` +
    `}`;

  const userMsg = `Context:\n${contextMap[promptData.type]}\n\nStudent said: "${transcript}"`;

  console.log(`[Evaluate] Calling Anthropic claude-3-5-haiku for evaluation`);
  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-20250514", // confirmed working model
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = response.content[0].text.trim().replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

// ══════════════════════════════════════════════════════
//  SHARED ANSWER PROCESSOR
//  Called by handleText after user submits an English answer
// ══════════════════════════════════════════════════════

async function processAnswer(userId, transcript, roundIndex) {
  const session = getSession(userId);

  // [CHANGE 8] No Anthropic key → graceful fallback, quiz still works
  let evaluation;
  if (!anthropic) {
    console.log("[Evaluate] No ANTHROPIC_API_KEY — using fallback feedback");
    evaluation = buildFallbackEvaluation(MVP_QUIZ[roundIndex]);
  } else {
    try {
      evaluation = await evaluateAnswer(transcript, MVP_QUIZ[roundIndex]);
    } catch (err) {
      // [CHANGE 12] Always log the real error for debugging
      console.error("[Evaluate] Anthropic evaluation error:", err.message);
      throw err; // re-throw so handleText can send a user-facing message
    }
  }

  // Safety: ensure model_answer is always populated
  evaluation.model_answer =
    evaluation.model_answer           ||
    MVP_QUIZ[roundIndex].model_answer ||
    MVP_QUIZ[roundIndex].version_a    ||
    MVP_QUIZ[roundIndex].en           ||
    "";

  session.feedbacks.push(evaluation);

  const round = roundIndex + 1;
  await lineClient.pushMessage(userId, {
    type: "text",
    text: buildFeedbackText(evaluation, round),
  });

  // Advance session state
  if (round === 1) {
    session.step = "r1_done";
  } else if (round === 2) {
    session.step = "r2_done";
  } else if (round === 3) {
    session.step      = "done";
    session.completed = true; // [CHANGE 10]
    setTimeout(async () => {
      await lineClient.pushMessage(userId, {
        type: "text",
        text: buildSummaryText(session.feedbacks),
      });
    }, 1500);
  }
}

// ══════════════════════════════════════════════════════
//  EVENT HANDLERS
// ══════════════════════════════════════════════════════

async function handleText(event) {
  const userId  = event.source.userId;
  // [CHANGE 9] Case-insensitive: "Start", "START", "start" all work
  const text    = event.message.text.trim().toLowerCase();
  const session = getSession(userId);

  // ── RESET (testing only) ───────────────────────────
  if (text === "reset") {
    resetSession(userId);
    await lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: `🔄 セッションをリセットしました。\n「start」と送って再開できます。`,
    });
    return;
  }

  // ── START ──────────────────────────────────────────
  if (text === "start") {
    // Allow restart — just reset and go again
    resetSession(userId);
    const s = getSession(userId);
    s.step  = "r1";

    // [CHANGE 5] Send intro + Round 1 question together in one reply
    await lineClient.replyMessage(event.replyToken, [
      { type: "text", text: START_INTRO },
      { type: "text", text: buildQuestionText(1, MVP_QUIZ[0]) },
    ]);
    return;
  }

  // ── NEXT ───────────────────────────────────────────
  // [CHANGE 9] Case-insensitive: "Next", "NEXT", "next" all work
  if (text === "next") {
    if (session.step === "r1_done") {
      session.step = "r2";
      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: buildQuestionText(2, MVP_QUIZ[1]),
      });
      return;
    }
    if (session.step === "r2_done") {
      session.step = "r3";
      await lineClient.replyMessage(event.replyToken, {
        type: "text",
        text: buildQuestionText(3, MVP_QUIZ[2]),
      });
      return;
    }
    // "next" sent at the wrong time
    await lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: `「next」は問題に回答した後に送ってください 👍`,
    });
    return;
  }

  // ── TEXT ANSWER (user is in an active round) ───────
  const stepMap  = { r1: 0, r2: 1, r3: 2 };
  const roundIdx = stepMap[session.step];

  if (roundIdx !== undefined) {
    await lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: `✏️ チェック中です...`,
    });
    try {
      await processAnswer(userId, event.message.text.trim(), roundIdx);
    } catch (err) {
      // [CHANGE 12] Log with clear label
      console.error("[Text answer] Evaluation failed:", err.message);
      await lineClient.pushMessage(userId, {
        type: "text",
        text: `⚠️ 評価中にエラーが発生しました。\nもう一度英語で答えてみてください。`,
      });
    }
    return;
  }

  // ── [CHANGE 9] Smarter fallback — guide based on current state ──
  if (session.step === "r1_done" || session.step === "r2_done") {
    await lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: `「next」と送って次の問題へ進んでください 👉`,
    });
    return;
  }

  if (session.completed) {
    await lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: `クイズはすでに完了しています。\nご参加ありがとうございました 🙏`,
    });
    return;
  }

  // In an active round but sent unexpected text — nudge them to answer in English
  if (["r1", "r2", "r3"].includes(session.step)) {
    await lineClient.replyMessage(event.replyToken, {
      type: "text",
      text: `この問題には英語で答えてみてください。\nテキストで回答できます ✍️`,
    });
    return;
  }

  // Truly idle
  await lineClient.replyMessage(event.replyToken, {
    type: "text",
    text: `「start」と送るとスピーキングチェックが始まります ✍️`,
  });
}

// [CHANGE 4] Voice disabled for MVP — redirect users to text input
async function handleAudio(event) {
  const userId  = event.source.userId;
  const session = getSession(userId);

  // [CHANGE 12] Log clearly so server-side is easy to debug
  console.log(`[Voice] Audio received from ${userId} (step: ${session.step}) — voice not supported, prompting text`);

  const stepMap  = { r1: 0, r2: 1, r3: 2 };
  const inRound  = stepMap[session.step] !== undefined;

  await lineClient.replyMessage(event.replyToken, {
    type: "text",
    text: inRound
      ? `現在、音声回答は調整中です。\nお手数ですが、英語をテキストで入力してください 🙏`
      : `「start」と送ってクイズを始めてください ✍️`,
  });
}

// ══════════════════════════════════════════════════════
//  WEBHOOK
// ══════════════════════════════════════════════════════

// Raw logger — fires BEFORE LINE middleware, so we can see if requests arrive at all
app.use((req, res, next) => {
  if (req.path === "/webhook") {
    console.log(`[Webhook] Incoming ${req.method} — signature: ${req.headers["x-line-signature"] ? "present" : "MISSING"}`);
  }
  next();
});

app.post("/webhook", middleware(lineConfig), async (req, res) => {
  res.sendStatus(200); // Always respond to LINE immediately

  const events = req.body.events;
  for (const event of events) {
    try {
      if (event.type === "follow") {
        // User added the bot — send welcome
        await lineClient.pushMessage(event.source.userId, {
          type: "text",
          text: WELCOME_JP,
        });
      } else if (event.type === "message") {
        if (event.message.type === "text") {
          await handleText(event);
        } else if (event.message.type === "audio") {
          await handleAudio(event);
        }
      }
    } catch (err) {
      // [CHANGE 12] Labelled top-level error
      console.error("[Webhook] Event handler error:", err.message);
    }
  }
});

// LINE middleware error handler — catches signature failures (must be AFTER routes)
app.use((err, req, res, next) => {
  if (req.path === "/webhook") {
    console.error("[Webhook] Middleware rejected request — likely wrong LINE_CHANNEL_SECRET:", err.status, err.message);
  }
  res.sendStatus(err.status || 500);
});

// Health check — shows configuration state at a glance
app.get("/", (req, res) => {
  res.json({
    status:    "LINE English Coach MVP — running ✅",
    anthropic: anthropic ? "connected ✅" : "not configured — fallback mode ⚠️",
    voice:     "disabled — text-only mode",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`   Anthropic: ${anthropic ? "✅ connected (claude-sonnet-4-20250514)" : "⚠️  no key — fallback mode active"}`);
  console.log(`   Voice:     disabled (text-only mode)`);
  console.log(`   Webhook:   https://YOUR_DOMAIN/webhook\n`);
});
