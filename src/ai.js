// Cloudflare Workers AI の呼び出しとプロンプト。
// 文字起こし: @cf/openai/whisper-large-v3-turbo
// 添削・フィードバック: @cf/meta/llama-3.3-70b-instruct-fp8-fast

const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// ---------------------------------------------------------------- 共通の前提

export const CANDIDATE_PROFILE = `About the candidate you are coaching:
- A professional working in New Zealand whose first language is not English. Their English is strong but sometimes formal or translated-sounding.
- Several years of corporate experience in client-facing roles, with a postgraduate qualification completed in New Zealand.
- Holds full right to work in New Zealand.
- Targeting Customer Success Manager, Account Manager, Client Relationship Manager and Key Account Manager roles. They are a relationship builder and improver, not a cold-calling hunter.
- Their genuine strengths are coordination, negotiation, accuracy and continuous improvement. Their satisfaction comes from closing the gap between a client's current state and their goal, and being told "we got here because of you".`;

export const NZ_CONTEXT = `How New Zealand interviews work, and what you must coach towards:
- Understatement wins. New Zealand has a tall poppy culture, so claims must be carried by facts, numbers and named specifics rather than by adjectives. "I am a great communicator" is weak. "I ran the weekly handover for eleven accounts and no booking was missed in twelve months" is strong.
- Plain, warm, direct English. Long formal constructions such as "I would like to take this opportunity to express" sound stiff and translated. Contractions and everyday verbs are normal in New Zealand interviews.
- Behavioural questions dominate. STAR is the expected shape, with roughly one sentence of Situation, one of Task, most of the time on Action, and a clear measurable Result at the end.
- Teams are flat and informal. Interviewers want someone who will speak up, ask questions, disagree respectfully and muck in. Excessive deference reads as passivity.
- Cultural awareness matters. Working respectfully with Maori and Pasifika clients and colleagues, and with multicultural teams, is valued. Honesty about what you do not yet know is respected, not penalised.
- Target length for a behavioural answer is roughly 60 to 120 seconds.
- Useful local vocabulary includes keen, catch up, touch base, across something, muck in, sort it out, in the region of.`;

export const HARD_RULES = `Absolute rules for everything you produce:
1. Never invent achievements, numbers, employers or projects the candidate did not mention. If evidence is missing, do not fabricate it. Insert a bracketed Japanese placeholder such as [ここに具体的な数字を入れてください] and tell them what to supply.
2. Be honest in your scoring. A vague answer with no evidence is not a good answer, no matter how fluent it is. Do not inflate.
3. Never use an em dash (the long dash character) in any English text you write. Use commas, semicolons or separate sentences.
4. Write every explanatory field in Japanese, in polite です・ます style, so the candidate can absorb it quickly. Write every sample sentence, rewritten answer and suggested phrase in natural New Zealand business English.
5. Keep suggested English at a level the candidate can actually deliver out loud under pressure. Do not show off with rare vocabulary.
6. Never write a bare label as an explanation. Every Japanese note must be at least forty Japanese characters and must name the specific problem and the specific reason the replacement lands better with a New Zealand interviewer.
   Rejected: "より自然な表現です。"
   Accepted: "I would like to take this opportunity to は書き言葉の定型で、話し言葉では硬すぎます。NZの面接官は率直に本題へ入る話し方を好むため、いきなり状況から入る方が自然に聞こえます。"
7. Any Japanese translation you give for an English term must be accurate. If you are not confident of the correct Japanese for a term, choose a different term you are sure of. A wrong translation is worse than no translation, because the candidate will use it in a real interview.
8. When you surface vocabulary to bank, it must be professional vocabulary a hiring manager would recognise as the language of the trade, normally two or three words, such as expectation management, root cause, stakeholder mapping, account health, de-escalate, time to value. Never bank bare everyday nouns such as communication, satisfaction, resolution, experience or teamwork.`;

// ------------------------------------------------------- Workers AI 呼び出し

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // 末尾が切れている場合に備えて、閉じ括弧を補ってもう一度だけ試す
    try {
      return JSON.parse(slice.replace(/,\s*$/, "") + "}");
    } catch {
      return null;
    }
  }
}

// JSONスキーマ指定で呼び、失敗したら素のプロンプトで再試行する
export async function runJson(env, { system, user, schema, maxTokens = 2400 }) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    const res = await env.AI.run(LLM, {
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      response_format: { type: "json_schema", json_schema: schema },
    });
    const raw = res.response;
    if (raw && typeof raw === "object") return raw;
    const parsed = extractJson(typeof raw === "string" ? raw : JSON.stringify(raw));
    if (parsed) return parsed;
  } catch (e) {
    console.log("json_schema mode failed, falling back:", e && e.message);
  }

  const res2 = await env.AI.run(LLM, {
    messages: [
      { role: "system", content: system + "\n\nRespond with a single valid JSON object and nothing else. No prose, no code fences." },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  });
  const parsed2 = extractJson(res2.response);
  if (!parsed2) throw new Error("AIの応答をJSONとして解釈できませんでした。もう一度お試しください。");
  return parsed2;
}

// ------------------------------------------------------------------ 文字起こし

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function transcribe(env, arrayBuffer) {
  const res = await env.AI.run(STT_MODEL, {
    audio: toBase64(arrayBuffer),
    task: "transcribe",
    language: "en",
  });
  const text = (res && (res.text || res.transcription_info?.text)) || "";
  return text.trim();
}

// ------------------------------------------------------- 回答フィードバック

const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "integer" },
    verdict: { type: "string" },
    scores: {
      type: "object",
      properties: {
        structure: { type: "integer" },
        evidence: { type: "integer" },
        nz_tone: { type: "integer" },
        language: { type: "integer" },
        conciseness: { type: "integer" },
      },
      required: ["structure", "evidence", "nz_tone", "language", "conciseness"],
    },
    strengths: {
      type: "array",
      items: {
        type: "object",
        properties: { point: { type: "string" }, quote: { type: "string" } },
        required: ["point", "quote"],
      },
    },
    improvements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue: { type: "string" },
          why: { type: "string" },
          fix: { type: "string" },
        },
        required: ["issue", "why", "fix"],
      },
    },
    rewritten_answer: { type: "string" },
    better_phrases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          better: { type: "string" },
          note: { type: "string" },
        },
        required: ["original", "better", "note"],
      },
    },
    key_terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          meaning_ja: { type: "string" },
          example: { type: "string" },
        },
        required: ["term", "meaning_ja", "example"],
      },
    },
    follow_up_question: { type: "string" },
  },
  required: ["overall", "verdict", "scores", "strengths", "improvements", "rewritten_answer", "better_phrases", "key_terms", "follow_up_question"],
};

export async function feedbackOnAnswer(env, { question, intent, transcript, metrics, jd, mode }) {
  const system = `You are an experienced New Zealand recruitment consultant and interview coach who has placed candidates into Customer Success, Account Management and Client Relationship roles in Auckland and Wellington.

${CANDIDATE_PROFILE}

${NZ_CONTEXT}

${HARD_RULES}

Scoring guide. Each of the five sub-scores is out of 20 and "overall" is their sum, out of 100.
- structure: is there a clear shape? For behavioural questions, is STAR followed with the weight on Action and Result?
- evidence: are there specific numbers, names, timeframes and outcomes, rather than generalities?
- nz_tone: does it land the way a New Zealand hiring manager wants? Confident but not boastful, warm, direct, not stiff or over-formal.
- language: is the English natural and idiomatic for a New Zealand workplace? Flag translated-sounding phrasing.
- conciseness: does it get to the point, or does it wander and over-explain the background?

Be a real coach. You must return at least two strengths, at least three improvements, at least three entries in better_phrases and at least three entries in key_terms. Returning fewer is a failure, even for a short answer. Every improvement must address a DIFFERENT weakness: do not give two improvements that are both about adding numbers. Work across structure, evidence, tone, word choice and length. Every improvement must include a concrete English replacement sentence in "fix" that the candidate can say instead.
"rewritten_answer" must be a full, spoken-aloud version of THIS answer, built only from what the candidate actually said, improved in structure and phrasing, roughly 130 to 200 words, with bracketed Japanese placeholders wherever they need to supply a real number or detail.
"better_phrases" must quote the candidate's own words in "original" and offer a stronger New Zealand business English version in "better".
"key_terms" should surface three to four reusable Customer Success, Account Management or business terms this answer would have been stronger with, following rule 7 above. Each needs a Japanese meaning and a New Zealand style example sentence the candidate could actually say in an interview.`;

  const jdBlock = jd
    ? `\n\nThey are preparing for this specific role:\nCompany: ${jd.company}\nRole: ${jd.title}\nJob description (may be truncated):\n${(jd.raw_text || "").slice(0, 3500)}\n\nWeigh your feedback towards what this employer is clearly looking for.`
    : "";

  const metricsBlock = mode === "voice"
    ? `\n\nObjective delivery metrics measured from the recording (use these, do not recompute):
- spoken length: ${Math.round((metrics.durationMs || 0) / 1000)} seconds
- words: ${metrics.wordCount}
- pace: ${metrics.wpm} words per minute
- filler words: ${metrics.fillerCount} (${metrics.fillerRate}% of all words) ${JSON.stringify(metrics.fillerDetail)}
- longest single sentence: ${metrics.longestSentence} words
Note: this is an automatic transcript, so treat small transcription oddities as noise rather than as the candidate's mistakes.`
    : `\n\nThis answer was typed rather than spoken, so do not comment on pace or filler words.`;

  const user = `Interview question:
"${question}"
${intent ? `\nWhat the interviewer is really assessing (in Japanese): ${intent}` : ""}${jdBlock}${metricsBlock}

The candidate's answer:
"""
${transcript}
"""

Coach this answer now.`;

  return runJson(env, { system, user, schema: FEEDBACK_SCHEMA, maxTokens: 3200 });
}

// ----------------------------------------------------------------- 台本添削

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    assessment: { type: "string" },
    scores: {
      type: "object",
      properties: {
        structure: { type: "integer" },
        evidence: { type: "integer" },
        nz_tone: { type: "integer" },
        language: { type: "integer" },
        conciseness: { type: "integer" },
      },
      required: ["structure", "evidence", "nz_tone", "language", "conciseness"],
    },
    revised: { type: "string" },
    shorter_version: { type: "string" },
    line_edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          better: { type: "string" },
          note: { type: "string" },
        },
        required: ["original", "better", "note"],
      },
    },
    missing: { type: "array", items: { type: "string" } },
    key_terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          meaning_ja: { type: "string" },
          example: { type: "string" },
        },
        required: ["term", "meaning_ja", "example"],
      },
    },
    likely_follow_ups: { type: "array", items: { type: "string" } },
  },
  required: ["assessment", "scores", "revised", "shorter_version", "line_edits", "missing", "key_terms", "likely_follow_ups"],
};

export async function reviewScript(env, { question, script, jd }) {
  const system = `You are an experienced New Zealand recruitment consultant and interview coach.

${CANDIDATE_PROFILE}

${NZ_CONTEXT}

${HARD_RULES}

The candidate has written a prepared answer script and wants it made stronger for a New Zealand interview. Your job is line-level craft, not a rewrite into someone else's voice. Keep their content and their story. Change the shape, the verbs and the phrasing.

Field requirements:
- "assessment": two to three sentences in Japanese, honest, saying what this script does well and what is holding it back.
- "scores": each out of 20, same five dimensions as a spoken answer.
- "revised": the improved full script in New Zealand business English, spoken-aloud style, similar length to the original, using bracketed Japanese placeholders where a real number or detail is missing.
- "shorter_version": a tighter 45 to 60 second version of the same answer, for when the interviewer is moving fast.
- "line_edits": four to eight specific swaps. "original" must quote the candidate's actual wording. "note" explains in Japanese why the replacement lands better in New Zealand.
- "missing": what is absent and would make this materially stronger, in Japanese, each item one line.
- "key_terms": two to five reusable terms worth banking, with Japanese meaning and a New Zealand style example sentence.
- "likely_follow_ups": two to four follow-up questions a New Zealand interviewer would probably ask after this answer, in English.`;

  const jdBlock = jd
    ? `\n\nTarget role:\nCompany: ${jd.company}\nRole: ${jd.title}\nJob description (may be truncated):\n${(jd.raw_text || "").slice(0, 3500)}`
    : "";

  const user = `Interview question this script answers:
"${question}"${jdBlock}

The candidate's draft script:
"""
${script}
"""

Improve it now.`;

  return runJson(env, { system, user, schema: SCRIPT_SCHEMA, maxTokens: 2800 });
}

// -------------------------------------------------------- JDから質問を生成
// 要約と質問生成を1回のプロンプトに詰め込むと質問が空で返ることがあるため、2回に分ける。

const JD_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    focus: { type: "string" },
    must_haves: { type: "array", items: { type: "string" }, minItems: 4 },
    likely_concerns: { type: "array", items: { type: "string" }, minItems: 3 },
    terminology: { type: "array", items: { type: "string" }, minItems: 6 },
  },
  required: ["focus", "must_haves", "likely_concerns", "terminology"],
};

const JD_QUESTIONS_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 12,
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          text: { type: "string" },
          intent: { type: "string" },
        },
        required: ["category", "text", "intent"],
      },
    },
  },
  required: ["questions"],
};

const JD_BASE = `You are a New Zealand hiring manager preparing to interview for a role you are recruiting.

${CANDIDATE_PROFILE}

${NZ_CONTEXT}

${HARD_RULES}`;

export async function questionsFromJD(env, { company, title, text }) {
  const jdText = `Company: ${company}
Role title: ${title}

Job description:
"""
${(text || "").slice(0, 6000)}
"""`;

  const summaryPromise = runJson(env, {
    system: `${JD_BASE}

Read this job ad the way an experienced recruiter reads it, and report what is really being asked for.
"focus": one or two sentences in Japanese on what this role is really about behind the job ad language.
"must_haves": four to six capabilities this employer will probe hardest in the interview, in Japanese.
"likely_concerns": three to five genuine hesitations this interviewer may have about THIS candidate for THIS role, for example an industry change, the certificate requirement, or a gap against the ad. Be frank but constructive, in Japanese.
"terminology": eight to twelve English terms drawn from this job ad or its industry that the candidate should be able to use naturally in the interview.`,
    user: jdText,
    schema: JD_SUMMARY_SCHEMA,
    maxTokens: 1400,
  });

  const questionsPromise = runJson(env, {
    system: `${JD_BASE}

Write the interview you would actually run for this role. Output nothing but the questions.

You must return between twelve and fifteen questions. Returning fewer than twelve is a failure.
Use category values from exactly this list: opening, motivation, behavioural, csm_am, nz_context, competency, closing.
Mix them the way a real New Zealand interview runs: open with one or two warm-up questions, spend the middle on behavioural and role-specific questions drawn from the actual responsibilities in this ad, include at least one question about right to work or settling in New Zealand, and close with one or two wrap-up questions.
Each "text" is the question in English, worded exactly as you would say it out loud.
Each "intent" is one sentence in Japanese explaining what you are really assessing with that question.`,
    user: jdText,
    schema: JD_QUESTIONS_SCHEMA,
    maxTokens: 2600,
  });

  const [summary, qres] = await Promise.all([summaryPromise, questionsPromise]);
  const questions = Array.isArray(qres.questions) ? qres.questions : [];
  if (questions.length === 0) {
    throw new Error("質問の生成に失敗しました。求人票の本文を少し短くして、もう一度お試しください。");
  }
  return { summary, questions };
}
