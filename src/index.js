// NZ Interview Coach : Cloudflare Worker 本体（APIルーター）
// 静的ファイルは assets バインディングが先に処理し、/api/* だけがここに来る。

import { analyseTranscript, pacingNote, looksHallucinated, cleanTranscript } from "./metrics.js";
import { transcribe, feedbackOnAnswer, reviewScript, questionsFromJD } from "./ai.js";
import {
  checkPassword, createToken, sessionCookie, clearCookie, isAuthed,
} from "./auth.js";

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB（約3分の録音に十分）

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
}

const asJson = (v) => (v == null ? null : JSON.stringify(v));
const parseJson = (v) => {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
};

// 練習・添削で出てきた用語を、表現ライブラリに自動で貯めていく
async function bankTerms(db, terms, source) {
  if (!Array.isArray(terms) || terms.length === 0) return;
  const stmts = [];
  for (const t of terms.slice(0, 8)) {
    const term = (t.term || "").trim();
    if (!term || term.length > 120) continue;
    stmts.push(
      db.prepare(
        `INSERT INTO phrases (term, meaning_ja, example, category, source)
         VALUES (?, ?, ?, 'collected', ?)
         ON CONFLICT(term) DO UPDATE SET use_count = use_count + 1`
      ).bind(term, (t.meaning_ja || "").slice(0, 500), (t.example || "").slice(0, 500), source)
    );
  }
  if (stmts.length) await db.batch(stmts);
}

async function getJd(db, jdId) {
  if (!jdId) return null;
  return db.prepare("SELECT * FROM jds WHERE id = ?").bind(jdId).first();
}

// --------------------------------------------------------------- ルーティング

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;

  // --- 認証まわり（ログインのみ未認証で通す）
  if (path === "/api/login" && method === "POST") {
    if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
      return bad("サーバー側の合い言葉が未設定です。README の手順で APP_PASSWORD と SESSION_SECRET を設定してください。", 503);
    }
    const body = await request.json().catch(() => ({}));
    if (!(await checkPassword(env, body.password || ""))) {
      return bad("合い言葉が違います。", 401);
    }
    const token = await createToken(env.SESSION_SECRET);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (path === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  const authed = await isAuthed(request, env);

  if (path === "/api/me") {
    return json({ authed, configured: Boolean(env.APP_PASSWORD && env.SESSION_SECRET) });
  }

  if (!authed) return bad("ログインが必要です。", 401);

  // --- 質問バンク
  if (path === "/api/questions" && method === "GET") {
    const category = url.searchParams.get("category");
    const jdId = url.searchParams.get("jd_id");
    let sql = "SELECT id, category, text, intent, source, jd_id FROM questions WHERE archived = 0";
    const args = [];
    if (jdId) { sql += " AND jd_id = ?"; args.push(Number(jdId)); }
    else { sql += " AND jd_id IS NULL"; }
    if (category && category !== "all") { sql += " AND category = ?"; args.push(category); }
    sql += " ORDER BY id";
    const { results } = await db.prepare(sql).bind(...args).all();

    // 各質問の練習回数も返す（未着手が分かるように）
    const { results: counts } = await db.prepare(
      "SELECT question_id, COUNT(*) AS n, MAX(overall_score) AS best FROM answers WHERE question_id IS NOT NULL GROUP BY question_id"
    ).all();
    const map = new Map(counts.map((c) => [c.question_id, c]));
    for (const q of results) {
      const c = map.get(q.id);
      q.practice_count = c ? c.n : 0;
      q.best_score = c ? c.best : null;
    }
    return json({ questions: results });
  }

  if (path === "/api/questions" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.text) return bad("質問文が空です。");
    const r = await db.prepare(
      "INSERT INTO questions (category, text, intent, source, jd_id) VALUES (?, ?, ?, 'user', ?) RETURNING id"
    ).bind(b.category || "competency", b.text, b.intent || null, b.jd_id || null).first();
    return json({ id: r.id });
  }

  const qDel = path.match(/^\/api\/questions\/(\d+)$/);
  if (qDel && method === "DELETE") {
    await db.prepare("UPDATE questions SET archived = 1 WHERE id = ?").bind(Number(qDel[1])).run();
    return json({ ok: true });
  }

  // --- JD（求人票）
  if (path === "/api/jds" && method === "GET") {
    const { results } = await db.prepare(
      `SELECT j.id, j.company, j.title, j.summary, j.created_at,
              (SELECT COUNT(*) FROM questions q WHERE q.jd_id = j.id AND q.archived = 0) AS question_count
       FROM jds j ORDER BY j.created_at DESC`
    ).all();
    for (const j of results) j.summary = parseJson(j.summary);
    return json({ jds: results });
  }

  if (path === "/api/jds" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.text || b.text.trim().length < 80) return bad("求人票の本文が短すぎます。80文字以上を貼り付けてください。");
    if (!b.company || !b.title) return bad("会社名と職種名を入力してください。");

    const ai = await questionsFromJD(env, { company: b.company, title: b.title, text: b.text });

    const jd = await db.prepare(
      "INSERT INTO jds (company, title, raw_text, summary) VALUES (?, ?, ?, ?) RETURNING id"
    ).bind(b.company.slice(0, 200), b.title.slice(0, 200), b.text.slice(0, 20000), asJson(ai.summary)).first();

    const qs = Array.isArray(ai.questions) ? ai.questions.slice(0, 20) : [];
    if (qs.length) {
      await db.batch(qs.map((q) => db.prepare(
        "INSERT INTO questions (category, text, intent, source, jd_id) VALUES (?, ?, ?, 'jd', ?)"
      ).bind(q.category || "competency", String(q.text).slice(0, 600), (q.intent || "").slice(0, 600), jd.id)));
    }
    return json({ id: jd.id, summary: ai.summary, question_count: qs.length });
  }

  const jdDel = path.match(/^\/api\/jds\/(\d+)$/);
  if (jdDel && method === "DELETE") {
    await db.prepare("DELETE FROM jds WHERE id = ?").bind(Number(jdDel[1])).run();
    return json({ ok: true });
  }

  // --- 練習（音声）
  if (path === "/api/practice/voice" && method === "POST") {
    const form = await request.formData();
    const file = form.get("audio");
    if (!file || typeof file === "string") return bad("音声データが見つかりません。");

    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) return bad("録音が空でした。マイクの許可を確認してください。");
    if (buf.byteLength > MAX_AUDIO_BYTES) return bad("録音が長すぎます。3分以内に収めてください。");

    const heard = await transcribeSafely(env, buf);
    const cleaned = cleanTranscript(heard);
    const transcript = cleaned.text;
    if (!transcript || transcript.length < 12) {
      return bad("うまく聞き取れませんでした。静かな場所で、マイクに近づいてもう一度お試しください。");
    }
    if (looksHallucinated(transcript)) {
      return bad("音声を正しく聞き取れませんでした。同じ語句の繰り返しとして認識されています。マイクの入力レベルを確認して、もう一度お試しください。");
    }
    return finishPractice(env, db, form, transcript, "voice", cleaned.removed);
  }

  // --- 練習（タイピング）
  if (path === "/api/practice/text" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.transcript || b.transcript.trim().length < 20) return bad("回答が短すぎます。");
    const form = new Map(Object.entries(b));
    return finishPractice(env, db, form, b.transcript.trim(), "text");
  }

  // --- 履歴
  if (path === "/api/history" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const { results } = await db.prepare(
      `SELECT id, question_text, category, mode, overall_score, wpm, filler_rate,
              duration_ms, word_count, created_at
       FROM answers ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all();
    return json({ answers: results });
  }

  const ansOne = path.match(/^\/api\/answers\/(\d+)$/);
  if (ansOne && method === "GET") {
    const row = await db.prepare("SELECT * FROM answers WHERE id = ?").bind(Number(ansOne[1])).first();
    if (!row) return bad("見つかりません。", 404);
    row.feedback = parseJson(row.feedback);
    row.score_detail = parseJson(row.score_detail);
    row.filler_detail = parseJson(row.filler_detail);
    return json({ answer: row });
  }
  if (ansOne && method === "DELETE") {
    await db.prepare("DELETE FROM answers WHERE id = ?").bind(Number(ansOne[1])).run();
    return json({ ok: true });
  }

  // --- 台本添削
  if (path === "/api/scripts" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.script || b.script.trim().length < 40) return bad("台本が短すぎます。40文字以上入力してください。");
    if (!b.question) return bad("どの質問に対する台本かを入力してください。");

    const jd = await getJd(db, b.jd_id ? Number(b.jd_id) : null);
    const ai = await reviewScript(env, { question: b.question, script: b.script, jd });

    const row = await db.prepare(
      "INSERT INTO scripts (question_text, original, revised, notes, jd_id) VALUES (?, ?, ?, ?, ?) RETURNING id"
    ).bind(
      b.question.slice(0, 600), b.script.slice(0, 12000),
      (ai.revised || "").slice(0, 12000), asJson(ai), b.jd_id ? Number(b.jd_id) : null
    ).first();

    await bankTerms(db, ai.key_terms, "script");
    return json({ id: row.id, result: ai });
  }

  if (path === "/api/scripts" && method === "GET") {
    const { results } = await db.prepare(
      "SELECT id, question_text, original, revised, notes, created_at FROM scripts ORDER BY created_at DESC LIMIT 100"
    ).all();
    for (const s of results) s.notes = parseJson(s.notes);
    return json({ scripts: results });
  }

  const scDel = path.match(/^\/api\/scripts\/(\d+)$/);
  if (scDel && method === "DELETE") {
    await db.prepare("DELETE FROM scripts WHERE id = ?").bind(Number(scDel[1])).run();
    return json({ ok: true });
  }

  // --- 表現・用語ライブラリ
  if (path === "/api/phrases" && method === "GET") {
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q");
    let sql = "SELECT * FROM phrases WHERE 1 = 1";
    const args = [];
    if (category && category !== "all") { sql += " AND category = ?"; args.push(category); }
    if (q) { sql += " AND (term LIKE ? OR meaning_ja LIKE ? OR example LIKE ?)"; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += " ORDER BY starred DESC, category, term";
    const { results } = await db.prepare(sql).bind(...args).all();
    const { results: cats } = await db.prepare("SELECT category, COUNT(*) AS n FROM phrases GROUP BY category ORDER BY category").all();
    return json({ phrases: results, categories: cats });
  }

  if (path === "/api/phrases" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.term || !b.meaning_ja) return bad("用語と意味の両方を入力してください。");
    await db.prepare(
      `INSERT INTO phrases (term, meaning_ja, example, category, source) VALUES (?, ?, ?, ?, 'user')
       ON CONFLICT(term) DO UPDATE SET meaning_ja = excluded.meaning_ja, example = excluded.example, category = excluded.category`
    ).bind(b.term.slice(0, 120), b.meaning_ja.slice(0, 500), (b.example || "").slice(0, 500), b.category || "general").run();
    return json({ ok: true });
  }

  const phId = path.match(/^\/api\/phrases\/(\d+)$/);
  if (phId && method === "PATCH") {
    const b = await request.json().catch(() => ({}));
    await db.prepare("UPDATE phrases SET starred = ? WHERE id = ?").bind(b.starred ? 1 : 0, Number(phId[1])).run();
    return json({ ok: true });
  }
  if (phId && method === "DELETE") {
    await db.prepare("DELETE FROM phrases WHERE id = ?").bind(Number(phId[1])).run();
    return json({ ok: true });
  }

  // --- 進捗ダッシュボード
  if (path === "/api/stats" && method === "GET") {
    const totals = await db.prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(duration_ms), 0) AS total_ms,
              ROUND(AVG(overall_score), 1) AS avg_score,
              ROUND(AVG(NULLIF(wpm, 0)), 1) AS avg_wpm,
              ROUND(AVG(filler_rate), 2) AS avg_filler
       FROM answers`
    ).first();

    const { results: daily } = await db.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n,
              ROUND(AVG(overall_score), 1) AS avg_score,
              ROUND(AVG(NULLIF(wpm, 0)), 1) AS avg_wpm,
              ROUND(AVG(filler_rate), 2) AS avg_filler
       FROM answers GROUP BY day ORDER BY day`
    ).all();

    const { results: byCategory } = await db.prepare(
      `SELECT COALESCE(category, 'other') AS category, COUNT(*) AS n,
              ROUND(AVG(overall_score), 1) AS avg_score
       FROM answers GROUP BY category ORDER BY n DESC`
    ).all();

    const { results: recent } = await db.prepare(
      `SELECT id, question_text, overall_score, created_at FROM answers
       ORDER BY created_at DESC LIMIT 10`
    ).all();

    const { results: dims } = await db.prepare(
      "SELECT score_detail FROM answers WHERE score_detail IS NOT NULL ORDER BY created_at DESC LIMIT 20"
    ).all();
    const dimAvg = {};
    for (const r of dims) {
      const s = parseJson(r.score_detail);
      if (!s) continue;
      for (const [k, v] of Object.entries(s)) {
        if (typeof v !== "number") continue;
        dimAvg[k] = dimAvg[k] || { sum: 0, n: 0 };
        dimAvg[k].sum += v;
        dimAvg[k].n += 1;
      }
    }
    const dimensions = Object.fromEntries(
      Object.entries(dimAvg).map(([k, v]) => [k, Math.round((v.sum / v.n) * 10) / 10])
    );

    const phraseCount = await db.prepare("SELECT COUNT(*) AS n FROM phrases").first();
    const scriptCount = await db.prepare("SELECT COUNT(*) AS n FROM scripts").first();

    return json({
      totals, daily, byCategory, recent, dimensions,
      phrase_count: phraseCount.n, script_count: scriptCount.n,
    });
  }

  return bad("そのAPIはありません。", 404);
}

// 文字起こしは失敗しやすいので、原因が分かるメッセージに変換する
async function transcribeSafely(env, buf) {
  try {
    return await transcribe(env, buf);
  } catch (e) {
    console.log("transcribe failed:", e && e.message);
    throw new Error("音声の文字起こしに失敗しました。録音が短すぎるか、形式が対応外の可能性があります。");
  }
}

// 音声・タイピング共通の後処理（採点 → 保存 → 用語の蓄積）
async function finishPractice(env, db, form, transcript, mode, trimmedTail = 0) {
  const get = (k) => (form.get ? form.get(k) : undefined);
  const questionId = Number(get("question_id")) || null;
  const questionText = String(get("question_text") || "").trim();
  const category = String(get("category") || "") || null;
  const jdId = Number(get("jd_id")) || null;
  const durationMs = Math.max(0, Number(get("duration_ms")) || 0);

  if (!questionText) throw new Error("質問が指定されていません。");

  const m = analyseTranscript(transcript, durationMs);
  m.durationMs = durationMs;

  let intent = null;
  if (questionId) {
    const q = await db.prepare("SELECT intent FROM questions WHERE id = ?").bind(questionId).first();
    intent = q ? q.intent : null;
  }
  const jd = await getJd(db, jdId);

  const ai = await feedbackOnAnswer(env, {
    question: questionText, intent, transcript, metrics: m, jd, mode,
  });

  const scores = ai.scores || {};
  const overall = Number.isFinite(ai.overall)
    ? Math.max(0, Math.min(100, Math.round(ai.overall)))
    : Math.round(Object.values(scores).reduce((a, b) => a + (Number(b) || 0), 0));

  const row = await db.prepare(
    `INSERT INTO answers
      (question_id, question_text, category, jd_id, mode, transcript, duration_ms,
       word_count, wpm, filler_count, filler_rate, filler_detail, overall_score, score_detail, feedback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(
    questionId, questionText.slice(0, 600), category, jdId, mode,
    transcript.slice(0, 20000), durationMs,
    m.wordCount, m.wpm, m.fillerCount, m.fillerRate, asJson(m.fillerDetail),
    overall, asJson(scores), asJson(ai)
  ).first();

  await bankTerms(db, ai.key_terms, "practice");

  return json({
    id: row.id,
    transcript,
    metrics: m,
    pacing: mode === "voice"
      ? pacingNote(m, durationMs).concat(
          trimmedTail >= 2
            ? ["録音末尾の無音を、文字起こしが定型句として誤って拾っていたため取り除きました。回答自体には影響していません。"]
            : []
        )
      : [],
    overall,
    feedback: ai,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        console.log("API error:", e && e.stack);
        return bad(e && e.message ? e.message : "サーバー内部でエラーが発生しました。", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
