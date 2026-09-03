/* NZ Interview Coach : ブラウザ側 */
"use strict";

const CAT_LABEL = {
  opening: "導入", motivation: "志望動機", behavioural: "行動面接",
  csm_am: "CSM/AM専門", nz_context: "NZ特有", competency: "能力",
  closing: "締め", other: "その他",
};
const PCAT_LABEL = {
  csm_am: "CSM/AM専門", nz_workplace: "NZ職場", hedging: "柔らげる表現",
  attitude: "姿勢", improvement: "改善・数値", influence: "巻き込み",
  interview_technique: "面接テクニック", logistics: "条件・手続き",
  problem_solving: "課題解決", general: "一般",
  collected: "練習から追加", user: "自分で追加",
};
const pcat = (c) => PCAT_LABEL[c] || c;
const DIM_LABEL = {
  structure: "構成", evidence: "根拠・数字", nz_tone: "NZらしさ",
  language: "英語の自然さ", conciseness: "簡潔さ",
};

const state = {
  questions: [], jds: [], currentJd: "", currentCategory: "all",
  question: null, phraseCat: "all",
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const nl2br = (s) => esc(s).replace(/\n/g, "<br>");

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  let data = null;
  try { data = await res.json(); } catch { /* 空応答 */ }
  if (!res.ok) throw new Error((data && data.error) || `通信に失敗しました (${res.status})`);
  return data;
}

function loading(msg) {
  return `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;
}
function errBox(msg) { return `<div class="error">${esc(msg)}</div>`; }

/* ============================================================== ログイン */

async function boot() {
  const me = await api("/api/me").catch(() => ({ authed: false, configured: true }));
  if (!me.configured) {
    $("loginHint").textContent = "まだ合い言葉がサーバーに設定されていません。READMEの「合い言葉を決める」手順を実行してください。";
  }
  if (me.authed) return enterApp();
  $("password").focus();
}

async function doLogin() {
  const pw = $("password").value;
  if (!pw) return;
  $("loginBtn").disabled = true;
  $("loginError").innerHTML = "";
  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    enterApp();
  } catch (e) {
    $("loginError").innerHTML = errBox(e.message);
    $("loginBtn").disabled = false;
  }
}

function enterApp() {
  $("login").style.display = "none";
  $("app").classList.add("ready");
  loadJds();
  loadQuestions();
}

/* ================================================================ タブ */

const TAB_TITLE = {
  practice: "面接練習", script: "台本の添削", library: "表現・用語",
  progress: "記録と進捗", jd: "応募先の求人",
};

function switchTab(name) {
  document.querySelectorAll("section.tab").forEach((s) => s.classList.remove("active"));
  $("tab-" + name).classList.add("active");
  document.querySelectorAll("nav.bottom button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  $("tabTitle").textContent = TAB_TITLE[name];
  window.scrollTo(0, 0);
  if (name === "library") loadPhrases();
  if (name === "progress") { loadStats(); loadHistory(); }
  if (name === "jd") loadJds();
  if (name === "script") loadScripts();
}

/* ============================================================ 質問セット */

async function loadJds() {
  const { jds } = await api("/api/jds");
  state.jds = jds;

  const opts = ['<option value="">定番セット（NZ向け56問）</option>']
    .concat(jds.map((j) => `<option value="${j.id}">${esc(j.company)} / ${esc(j.title)}（${j.question_count}問）</option>`));
  $("setSelect").innerHTML = opts.join("");
  $("setSelect").value = state.currentJd;
  $("scriptJd").innerHTML = ['<option value="">指定なし</option>']
    .concat(jds.map((j) => `<option value="${j.id}">${esc(j.company)} / ${esc(j.title)}</option>`)).join("");

  $("jdList").innerHTML = jds.length ? jds.map((j) => {
    const s = j.summary || {};
    return `<div class="card">
      <div class="row"><b class="grow">${esc(j.company)}</b>
        <button class="btn danger sm" data-del-jd="${j.id}">削除</button></div>
      <div class="small muted">${esc(j.title)} ・ ${j.question_count}問 ・ ${esc(j.created_at)}</div>
      ${s.focus ? `<h3>この求人の本質</h3><div class="small">${nl2br(s.focus)}</div>` : ""}
      ${arr(s.must_haves).length ? `<h3>特に問われる力</h3><ul class="small">${arr(s.must_haves).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${arr(s.likely_concerns).length ? `<h3>面接官が抱きそうな懸念</h3><ul class="small">${arr(s.likely_concerns).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${arr(s.terminology).length ? `<h3>使えるようにしたい用語</h3><div class="row">${arr(s.terminology).map((x) => `<span class="pill">${esc(x)}</span>`).join(" ")}</div>` : ""}
    </div>`;
  }).join("") : `<div class="card center muted small">まだ登録された求人はありません。</div>`;
}

const arr = (x) => (Array.isArray(x) ? x : []);

async function loadQuestions() {
  const params = new URLSearchParams();
  if (state.currentJd) params.set("jd_id", state.currentJd);
  if (state.currentCategory !== "all") params.set("category", state.currentCategory);
  const { questions } = await api("/api/questions?" + params.toString());
  state.questions = questions;

  const cats = [...new Set(questions.map((q) => q.category))];
  const all = ["all", ...cats];
  $("categoryChips").innerHTML = all.map((c) =>
    `<span class="chip ${state.currentCategory === c ? "active" : ""}" data-cat="${esc(c)}">${c === "all" ? "すべて" : esc(CAT_LABEL[c] || c)}</span>`).join("");

  $("jdBadge").textContent = state.currentJd
    ? (state.jds.find((j) => String(j.id) === String(state.currentJd)) || {}).company || "求人セット"
    : "定番セット";

  renderQuestionList();
}

function renderQuestionList() {
  const list = $("questionList");
  if (!state.questions.length) {
    list.innerHTML = `<div class="card center muted small">この条件の質問がありません。</div>`;
    return;
  }
  list.innerHTML = state.questions.map((q) => `
    <div class="list-item" data-qid="${q.id}">
      <div class="t">${esc(q.text)}</div>
      <div class="m">
        <span class="pill">${esc(CAT_LABEL[q.category] || q.category)}</span>
        <span>${q.practice_count ? `練習 ${q.practice_count}回` : "未練習"}</span>
        ${q.best_score != null ? `<span class="score-tag" style="color:${scoreColor(q.best_score)}">最高 ${q.best_score}</span>` : ""}
      </div>
    </div>`).join("");
}

function scoreColor(s) {
  if (s == null) return "var(--muted)";
  if (s >= 75) return "var(--good)";
  if (s >= 55) return "var(--warn)";
  return "var(--bad)";
}

/* ================================================================ 練習 */

function startQuestion(q) {
  state.question = q;
  $("practiceSetup").style.display = "none";
  $("practiceResult").style.display = "none";
  $("practiceResult").innerHTML = "";
  $("practiceActive").style.display = "block";
  $("recorderCard").style.display = "block";
  $("typeCard").style.display = "none";
  $("activeCategory").textContent = CAT_LABEL[q.category] || q.category;
  $("activeQuestion").textContent = q.text;
  $("activeIntent").textContent = q.intent || "";
  $("recError").innerHTML = "";
  $("timer").textContent = "0:00";
  $("recBtn").textContent = "録音開始";
  $("recBtn").classList.remove("recording");
  $("recBtn").disabled = false;
  updateMicState();
  window.scrollTo(0, 0);
}

function exitPractice() {
  releaseStream();
  $("practiceActive").style.display = "none";
  $("practiceResult").style.display = "none";
  $("practiceSetup").style.display = "block";
  state.question = null;
  loadQuestions();
}

let media = null, recorder = null, chunks = [], startedAt = 0, timerId = null;
let audioCtx = null, rafId = null, wakeLock = null, meterSource = null;

/* --- マイクの許可 ---------------------------------------------------------
   録音のたびに getUserMedia を呼ぶと、スマホでは毎回許可を聞かれる。
   一度取得したマイクは練習を終えるまで保持し、許可を1回で済ませる。 */
async function ensureStream() {
  if (media && media.active && media.getAudioTracks().some((t) => t.readyState === "live")) return media;
  media = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return media;
}

function releaseStream() {
  stopMeterAndTimer();
  if (media) { media.getTracks().forEach((t) => t.stop()); media = null; }
  updateMicState();
}

function updateMicState() {
  const el = $("micState");
  if (!el) return;
  const on = Boolean(media && media.active);
  el.className = "mic-state" + (on ? "" : " off");
  el.innerHTML = `<span class="dot"></span>${on ? "マイク使用中（この質問を終えるまで許可は聞かれません）" : "マイクは未使用です"}`;
}

/* --- 画面が消えて録音が止まるのを防ぐ ------------------------------------ */
async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch { /* 非対応の端末では何もしない */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/* --- 録音データの変換 -----------------------------------------------------
   ブラウザごとに録音形式が違い（Chromeはwebm/opus、Safariはmp4）、
   webm/opus はサーバー側の文字起こしが正しく解釈できず、
   "thank you" の繰り返しのような誤認識になることがある。
   そこで、どの端末でも同じ 16kHz モノラルのWAVに変換してから送る。 */

function mixdownResample(audioBuffer, targetRate) {
  const chs = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < chs; c++) {
    const d = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / chs;
  }
  const ratio = audioBuffer.sampleRate / targetRate;
  if (ratio <= 1) return mono;
  const outLen = Math.floor(len / ratio);
  const out = new Float32Array(outLen);
  // 単純に間引くと折り返し雑音が出るため、区間平均でならしてから間引く
  for (let i = 0; i < outLen; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(len, Math.floor((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = from; j < to; j++) { sum += mono[j]; n++; }
    out[i] = n ? sum / n : mono[Math.min(from, len - 1)];
  }
  return out;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (off, t) => { for (let i = 0; i < t.length; i++) view.setUint8(off + i, t.charCodeAt(i)); };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

// 話し終えてから停止を押すまでの無音が残っていると、文字起こしが
// そこに "Thank you." のような実在しない語句を差し込むことがある。
// 送る前に前後の無音を落としておく。
function trimSilence(samples, sampleRate) {
  const win = Math.max(1, Math.floor(sampleRate * 0.02)); // 20msごとに評価
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return samples;
  const thresh = Math.max(0.006, peak * 0.04);

  const loud = (from) => {
    let sum = 0;
    const to = Math.min(samples.length, from + win);
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, to - from)) > thresh;
  };

  let first = 0, last = samples.length - win;
  while (first < last && !loud(first)) first += win;
  while (last > first && !loud(last)) last -= win;
  if (last <= first) return samples;

  // 語頭・語尾が切れないよう前後に0.25秒だけ残す
  const pad = Math.floor(sampleRate * 0.25);
  const from = Math.max(0, first - pad);
  const to = Math.min(samples.length, last + win + pad);
  return samples.subarray(from, to);
}

async function convertToWav(blob) {
  const bytes = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } finally {
    ctx.close().catch(() => {});
  }
  const samples = trimSilence(mixdownResample(decoded, 16000), 16000);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  // 無音を除いた実際に話していた長さ。話す速さの計算もこちらに合わせる。
  return { wav: encodeWav(samples, 16000), rms, seconds: samples.length / 16000 };
}

/* --- 録音 ---------------------------------------------------------------- */

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function toggleRecording() {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
    return;
  }
  $("recError").innerHTML = "";
  try {
    await ensureStream();
  } catch (e) {
    $("recError").innerHTML = errBox("マイクを使えませんでした。ブラウザの設定でマイクの使用を許可してください。（" + e.name + "）");
    return;
  }
  updateMicState();
  await acquireWakeLock();

  const mimeType = pickMimeType();
  chunks = [];
  try {
    recorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
  } catch {
    recorder = new MediaRecorder(media);
  }
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = onRecordingStopped;
  // 1秒ごとに小分けで受け取っておくと、画面が消えるなど不意の中断でも直前までが残る
  recorder.start(1000);
  startedAt = Date.now();

  $("recBtn").textContent = "停止";
  $("recBtn").classList.add("recording");
  timerId = setInterval(tick, 200);
  startLevelMeter();
}

function tick() {
  const ms = Date.now() - startedAt;
  const s = Math.floor(ms / 1000);
  $("timer").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (ms >= 180000 && recorder && recorder.state === "recording") recorder.stop();
}

function startLevelMeter() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    meterSource = audioCtx.createMediaStreamSource(media);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    meterSource.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      $("levelBar").style.width = Math.min(100, (peak / 70) * 100) + "%";
      rafId = requestAnimationFrame(draw);
    };
    draw();
  } catch { /* レベルメーターは無くても録音自体は成立する */ }
}

function stopMeterAndTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (meterSource) { try { meterSource.disconnect(); } catch {} meterSource = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  const bar = $("levelBar");
  if (bar) bar.style.width = "0%";
  releaseWakeLock();
}

function resetRecBtn(msg) {
  $("recBtn").textContent = "録音開始";
  $("recBtn").classList.remove("recording");
  $("recBtn").disabled = false;
  if (msg) $("recError").innerHTML = errBox(msg);
}

async function onRecordingStopped() {
  const durationMs = Date.now() - startedAt;
  stopMeterAndTimer();
  $("recBtn").classList.remove("recording");
  $("recBtn").disabled = true;

  const raw = new Blob(chunks, { type: (recorder && recorder.mimeType) || "audio/webm" });
  if (durationMs < 3000 || raw.size < 2000) {
    resetRecBtn("録音が短すぎます。もう一度お試しください。");
    return;
  }

  let wav, rms, seconds;
  try {
    ({ wav, rms, seconds } = await convertToWav(raw));
  } catch (e) {
    resetRecBtn("録音データを変換できませんでした。もう一度お試しください。");
    return;
  }

  // 無音のまま送ると、文字起こしが意味のない言葉を繰り返す結果になる
  if (rms < 0.004) {
    resetRecBtn("音がほとんど入っていませんでした。マイクがミュートになっていないか、正しい入力機器が選ばれているかを確認してください。");
    return;
  }
  if (seconds < 3) {
    resetRecBtn("録音が短すぎます。もう一度お試しください。");
    return;
  }

  const fd = new FormData();
  fd.append("audio", wav, "answer.wav");
  fd.append("question_id", state.question.id || "");
  fd.append("question_text", state.question.text);
  fd.append("category", state.question.category || "");
  fd.append("duration_ms", String(Math.round(seconds * 1000) || durationMs));
  if (state.currentJd) fd.append("jd_id", state.currentJd);

  showAnalysing();
  try {
    const result = await api("/api/practice/voice", { method: "POST", body: fd });
    renderResult(result);
  } catch (e) {
    $("practiceResult").innerHTML = errBox(e.message) +
      `<div class="card center"><button class="btn ghost" id="retryBtn">やり直す</button></div>`;
    $("retryBtn").onclick = () => startQuestion(state.question);
  }
}

function showAnalysing() {
  $("practiceActive").style.display = "none";
  $("practiceResult").style.display = "block";
  $("practiceResult").innerHTML =
    `<div class="question-box"><div class="q-en">${esc(state.question.text)}</div></div>` +
    `<div class="card">${loading("文字起こしと採点をしています。20〜40秒ほどかかります。")}</div>`;
}

async function submitTyped() {
  const text = $("typedAnswer").value.trim();
  if (text.length < 20) { alert("もう少し書いてから送ってください。"); return; }
  showAnalysing();
  try {
    const result = await api("/api/practice/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: text,
        question_id: state.question.id,
        question_text: state.question.text,
        category: state.question.category,
        jd_id: state.currentJd || null,
        duration_ms: 0,
      }),
    });
    renderResult(result);
  } catch (e) {
    $("practiceResult").innerHTML = errBox(e.message);
  }
}

function ring(score) {
  const r = 32, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score || 0)) / 100;
  return `<svg class="ring" viewBox="0 0 76 76">
    <circle cx="38" cy="38" r="${r}" stroke="var(--surface-2)" stroke-width="7" fill="none"/>
    <circle cx="38" cy="38" r="${r}" stroke="${scoreColor(score)}" stroke-width="7" fill="none"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"
      transform="rotate(-90 38 38)"/>
    <text x="38" y="45" text-anchor="middle">${score == null ? "-" : score}</text>
  </svg>`;
}

function scoreBars(scores) {
  return `<div class="bars">` + Object.entries(scores || {}).map(([k, v]) => {
    const pct = Math.max(0, Math.min(100, (Number(v) || 0) / 20 * 100));
    return `<div class="bar-row"><span class="muted">${esc(DIM_LABEL[k] || k)}</span>
      <div class="bar"><div style="width:${pct}%;background:${scoreColor(pct)}"></div></div>
      <span style="text-align:right">${Number(v) || 0}</span></div>`;
  }).join("") + `</div>`;
}

function renderResult(r) {
  const f = r.feedback || {};
  const m = r.metrics || {};
  const isVoice = (m.durationMs || 0) > 0;

  const metricsHtml = isVoice ? `<div class="metrics">
    <div class="metric"><b>${Math.round((m.durationMs || 0) / 1000)}秒</b><span>長さ</span></div>
    <div class="metric"><b>${m.wpm || 0}</b><span>語/分</span></div>
    <div class="metric"><b>${m.wordCount || 0}</b><span>語数</span></div>
    <div class="metric"><b>${m.fillerCount || 0}</b><span>フィラー</span></div>
    <div class="metric"><b>${m.longestSentence || 0}</b><span>最長の一文</span></div>
  </div>` : "";

  const pacing = arr(r.pacing).length
    ? `<div class="notice"><b>話し方について</b><ul style="margin:6px 0 0;padding-left:18px">${arr(r.pacing).map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : "";

  $("practiceResult").innerHTML = `
    <div class="question-box"><div class="q-en">${esc(r.question_text || (state.question && state.question.text) || "")}</div></div>

    <div class="card">
      <div class="score-head">${ring(r.overall)}<div><b style="font-size:15px">総合 ${r.overall} / 100</b>
        <div class="small muted" style="margin-top:2px">${nl2br(f.verdict || "")}</div></div></div>
      ${scoreBars(f.scores)}
      ${metricsHtml}
      ${pacing}
    </div>

    <div class="card">
      <h2>あなたが話した内容</h2>
      <pre class="answer">${esc(r.transcript || "")}</pre>
      <p class="small muted" style="margin-bottom:0">自動文字起こしのため、固有名詞などは実際と異なる場合があります。</p>
    </div>

    ${arr(f.strengths).length ? `<div class="card"><h2>良かった点</h2>
      ${arr(f.strengths).map((s) => `<div class="item good"><b>${esc(s.point)}</b>
        ${s.quote ? `<div class="en">"${esc(s.quote)}"</div>` : ""}</div>`).join("")}</div>` : ""}

    ${arr(f.improvements).length ? `<div class="card"><h2>次に直すところ</h2>
      ${arr(f.improvements).map((s) => `<div class="item fix"><b>${esc(s.issue)}</b>
        <div class="small muted">${nl2br(s.why)}</div>
        ${s.fix ? `<div class="en">${esc(s.fix)}</div>` : ""}</div>`).join("")}</div>` : ""}

    ${f.rewritten_answer ? `<div class="card"><h2>こう言うともっと伝わります</h2>
      <pre class="answer">${esc(f.rewritten_answer)}</pre>
      <button class="btn ghost sm" style="margin-top:10px" data-copy="${esc(f.rewritten_answer)}">コピー</button></div>` : ""}

    ${arr(f.better_phrases).length ? `<div class="card"><h2>言い換えの候補</h2>
      ${arr(f.better_phrases).map((p) => `<div class="swap">
        <div class="from">${esc(p.original)}</div>
        <div class="to">${esc(p.better)}</div>
        <div class="note">${nl2br(p.note)}</div></div>`).join("")}</div>` : ""}

    ${arr(f.key_terms).length ? `<div class="card"><h2>ライブラリに追加した用語</h2>
      ${arr(f.key_terms).map((t) => `<div class="item"><b>${esc(t.term)}</b>
        <div class="small muted">${esc(t.meaning_ja)}</div>
        ${t.example ? `<div class="en">${esc(t.example)}</div>` : ""}</div>`).join("")}</div>` : ""}

    ${f.follow_up_question ? `<div class="card"><h2>想定される次の質問</h2>
      <div class="q-en" style="font-size:15px">${esc(f.follow_up_question)}</div>
      <button class="btn ghost sm" id="practiceFollowUp">この質問で続けて練習する</button></div>` : ""}

    <div class="card row">
      <button class="btn grow" id="againBtn">同じ質問をもう一度</button>
      <button class="btn ghost grow" id="nextBtn">次の質問へ</button>
    </div>`;

  const again = $("againBtn"), next = $("nextBtn"), fu = $("practiceFollowUp");
  if (again) again.onclick = () => startQuestion(state.question);
  if (next) next.onclick = () => { exitPractice(); setTimeout(startRandom, 100); };
  if (fu) fu.onclick = () => startQuestion({
    id: null, text: f.follow_up_question,
    category: state.question ? state.question.category : "competency",
    intent: "直前の回答から自然につながる深掘りの質問です。",
  });
}

function startRandom() {
  const pool = state.questions.filter((q) => !q.practice_count);
  const list = pool.length ? pool : state.questions;
  if (!list.length) { alert("質問がありません。"); return; }
  startQuestion(list[Math.floor(Math.random() * list.length)]);
}

/* ============================================================== 台本添削 */

async function reviewScript() {
  const question = $("scriptQuestion").value.trim();
  const script = $("scriptBody").value.trim();
  if (!question || script.length < 40) { alert("質問と台本の両方を入力してください。"); return; }
  $("scriptResult").innerHTML = `<div class="card">${loading("台本を読んでいます。20〜40秒ほどかかります。")}</div>`;
  try {
    const { result } = await api("/api/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, script, jd_id: $("scriptJd").value || null }),
    });
    $("scriptResult").innerHTML = renderScriptResult(result);
    loadScripts();
  } catch (e) {
    $("scriptResult").innerHTML = errBox(e.message);
  }
}

function renderScriptResult(r) {
  const total = Object.values(r.scores || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  return `
    <div class="card">
      <div class="score-head">${ring(total)}<div><b style="font-size:15px">総合 ${total} / 100</b>
        <div class="small muted" style="margin-top:2px">${nl2br(r.assessment)}</div></div></div>
      ${scoreBars(r.scores)}
    </div>
    ${r.revised ? `<div class="card"><h2>直した台本</h2><pre class="answer">${esc(r.revised)}</pre>
      <button class="btn ghost sm" style="margin-top:10px" data-copy="${esc(r.revised)}">コピー</button></div>` : ""}
    ${r.shorter_version ? `<div class="card"><h2>短縮版（45〜60秒）</h2><pre class="answer">${esc(r.shorter_version)}</pre>
      <button class="btn ghost sm" style="margin-top:10px" data-copy="${esc(r.shorter_version)}">コピー</button></div>` : ""}
    ${arr(r.line_edits).length ? `<div class="card"><h2>一文ずつの言い換え</h2>
      ${arr(r.line_edits).map((p) => `<div class="swap"><div class="from">${esc(p.original)}</div>
        <div class="to">${esc(p.better)}</div><div class="note">${nl2br(p.note)}</div></div>`).join("")}</div>` : ""}
    ${arr(r.missing).length ? `<div class="card"><h2>足りていない要素</h2>
      <ul class="small" style="padding-left:18px;margin:0">${arr(r.missing).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${arr(r.key_terms).length ? `<div class="card"><h2>ライブラリに追加した用語</h2>
      ${arr(r.key_terms).map((t) => `<div class="item"><b>${esc(t.term)}</b>
        <div class="small muted">${esc(t.meaning_ja)}</div>
        ${t.example ? `<div class="en">${esc(t.example)}</div>` : ""}</div>`).join("")}</div>` : ""}
    ${arr(r.likely_follow_ups).length ? `<div class="card"><h2>想定される深掘り質問</h2>
      ${arr(r.likely_follow_ups).map((q) => `<div class="item">${esc(q)}</div>`).join("")}</div>` : ""}`;
}

async function loadScripts() {
  const { scripts } = await api("/api/scripts");
  $("scriptHistory").innerHTML = scripts.length ? scripts.map((s) => `
    <div class="list-item" data-script="${s.id}">
      <div class="t">${esc(s.question_text)}</div>
      <div class="m"><span>${esc(s.created_at)}</span></div>
    </div>`).join("") : `<div class="muted small center">まだ添削の記録はありません。</div>`;
  window.__scripts = scripts;
}

/* ============================================================== ライブラリ */

async function loadPhrases() {
  const params = new URLSearchParams();
  if (state.phraseCat !== "all") params.set("category", state.phraseCat);
  const q = $("phraseSearch").value.trim();
  if (q) params.set("q", q);
  const { phrases, categories } = await api("/api/phrases?" + params.toString());

  $("phraseCats").innerHTML = [{ category: "all", n: "" }].concat(categories).map((c) =>
    `<span class="chip ${state.phraseCat === c.category ? "active" : ""}" data-pcat="${esc(c.category)}">${c.category === "all" ? "すべて" : esc(pcat(c.category))}${c.n ? ` ${c.n}` : ""}</span>`).join("");

  $("phraseList").innerHTML = phrases.length ? phrases.map((p) => `
    <div class="card" style="margin-bottom:9px">
      <div class="row"><b class="grow">${esc(p.term)}</b>
        <button class="btn ghost sm" data-star="${p.id}" data-on="${p.starred}">${p.starred ? "★" : "☆"}</button>
        <button class="btn danger sm" data-del-phrase="${p.id}">削除</button></div>
      <div class="small muted">${esc(p.meaning_ja)}</div>
      ${p.example ? `<div class="item" style="margin:8px 0 0"><div class="en">${esc(p.example)}</div></div>` : ""}
      <div class="small muted" style="margin-top:6px"><span class="pill">${esc(pcat(p.category))}</span></div>
    </div>`).join("") : `<div class="card center muted small">該当する用語がありません。</div>`;
}

/* ================================================================ 進捗 */

function lineChart(daily, key, label, color) {
  const pts = daily.filter((d) => d[key] != null);
  if (pts.length < 2) return `<p class="small muted">${esc(label)}は、あと ${2 - pts.length} 回練習するとグラフになります。</p>`;
  const w = 340, h = 150, pad = 30;
  const vals = pts.map((p) => Number(p[key]));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (w - pad - 8);
  const y = (v) => h - pad - ((v - min) / span) * (h - pad - 12);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(p[key])).toFixed(1)}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}">
    <line class="grid-line" x1="${pad}" y1="${h - pad}" x2="${w - 8}" y2="${h - pad}"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(Number(p[key])).toFixed(1)}" r="3" fill="${color}"/>`).join("")}
    <text class="lbl" x="2" y="14">${max}</text>
    <text class="lbl" x="2" y="${h - pad}">${min}</text>
    <text class="lbl" x="${pad}" y="${h - 8}">${esc(pts[0].day)}</text>
    <text class="lbl" x="${w - 8}" y="${h - 8}" text-anchor="end">${esc(pts[pts.length - 1].day)}</text>
  </svg>`;
}

async function loadStats() {
  const s = await api("/api/stats");
  const t = s.totals || {};
  const mins = Math.round((t.total_ms || 0) / 60000);
  $("statsBox").innerHTML = `
    <div class="card">
      <h2>これまでの積み上げ</h2>
      <div class="stat-grid">
        <div class="stat"><b>${t.sessions || 0}</b><span>練習した回数</span></div>
        <div class="stat"><b>${mins}</b><span>話した分数</span></div>
        <div class="stat"><b>${t.avg_score ?? "-"}</b><span>平均スコア</span></div>
        <div class="stat"><b>${t.avg_wpm ?? "-"}</b><span>平均 語/分</span></div>
        <div class="stat"><b>${t.avg_filler ?? "-"}%</b><span>フィラー率</span></div>
        <div class="stat"><b>${s.phrase_count || 0}</b><span>ライブラリの用語</span></div>
      </div>
    </div>
    ${Object.keys(s.dimensions || {}).length ? `<div class="card"><h2>直近20回の観点別平均</h2>${scoreBars(s.dimensions)}</div>` : ""}
    <div class="card"><h2>スコアの推移</h2>${lineChart(s.daily, "avg_score", "スコアの推移", "var(--accent)")}</div>
    <div class="card"><h2>話す速さの推移（語/分）</h2>${lineChart(s.daily, "avg_wpm", "話す速さ", "var(--good)")}</div>
    <div class="card"><h2>フィラー率の推移（%）</h2>${lineChart(s.daily, "avg_filler", "フィラー率", "var(--warn)")}</div>
    ${arr(s.byCategory).length ? `<div class="card"><h2>分野ごとの状況</h2>
      ${s.byCategory.map((c) => `<div class="bar-row" style="grid-template-columns:100px 1fr 54px">
        <span class="muted">${esc(CAT_LABEL[c.category] || c.category)}</span>
        <div class="bar"><div style="width:${Math.min(100, c.avg_score || 0)}%;background:${scoreColor(c.avg_score)}"></div></div>
        <span style="text-align:right" class="small">${c.avg_score ?? "-"}／${c.n}回</span></div>`).join("")}</div>` : ""}`;
}

async function loadHistory() {
  const { answers } = await api("/api/history?limit=100");
  $("historyList").innerHTML = answers.length ? answers.map((a) => `
    <div class="list-item" data-ans="${a.id}">
      <div class="t">${esc(a.question_text)}</div>
      <div class="m">
        <span class="score-tag" style="color:${scoreColor(a.overall_score)}">${a.overall_score ?? "-"}</span>
        <span>${esc(a.created_at)}</span>
        <span>${a.mode === "voice" ? `${Math.round(a.duration_ms / 1000)}秒・${a.wpm}語/分` : "文字入力"}</span>
      </div>
    </div>`).join("") : `<div class="muted small center">まだ練習の記録はありません。</div>`;
}

async function openAnswer(id) {
  openModal(loading("読み込んでいます"));
  const { answer } = await api(`/api/answers/${id}`);
  const f = answer.feedback || {};
  openModal(`
    <div class="row"><b class="grow">${esc(answer.created_at)}</b>
      <button class="btn danger sm" data-del-ans="${answer.id}">削除</button>
      <button class="btn ghost sm" data-close-modal>閉じる</button></div>
    <div class="question-box" style="margin-top:12px"><div class="q-en">${esc(answer.question_text)}</div></div>
    <div class="card">
      <div class="score-head">${ring(answer.overall_score)}<div class="small muted">${nl2br(f.verdict || "")}</div></div>
      ${scoreBars(answer.score_detail)}
    </div>
    <div class="card"><h2>話した内容</h2><pre class="answer">${esc(answer.transcript)}</pre></div>
    ${f.rewritten_answer ? `<div class="card"><h2>改善版</h2><pre class="answer">${esc(f.rewritten_answer)}</pre></div>` : ""}
    ${arr(f.improvements).length ? `<div class="card"><h2>指摘</h2>${arr(f.improvements).map((s) =>
      `<div class="item fix"><b>${esc(s.issue)}</b><div class="small muted">${nl2br(s.why)}</div>
      ${s.fix ? `<div class="en">${esc(s.fix)}</div>` : ""}</div>`).join("")}</div>` : ""}`);
}

/* =============================================================== モーダル */

function openModal(html) {
  $("modalBody").innerHTML = html;
  $("modal").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("modal").classList.remove("open");
  document.body.style.overflow = "";
}

/* ================================================================ 求人 */

async function createJd() {
  const company = $("jdCompany").value.trim();
  const title = $("jdTitle").value.trim();
  const text = $("jdText").value.trim();
  if (!company || !title || text.length < 80) { alert("会社名・職種名・求人票の本文をすべて入力してください。"); return; }
  const btn = $("createJd");
  btn.disabled = true;
  btn.textContent = "作成中… 30秒ほどかかります";
  try {
    await api("/api/jds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, title, text }),
    });
    $("jdCompany").value = ""; $("jdTitle").value = ""; $("jdText").value = "";
    await loadJds();
    alert("この求人専用の質問を作成しました。「練習」タブの質問セットから選べます。");
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "質問を作る";
  }
}

/* ============================================================ イベント登録 */

document.addEventListener("DOMContentLoaded", () => {
  $("loginBtn").onclick = doLogin;
  $("password").onkeydown = (e) => { if (e.key === "Enter") doLogin(); };

  document.querySelectorAll("nav.bottom button").forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  $("setSelect").onchange = (e) => { state.currentJd = e.target.value; state.currentCategory = "all"; loadQuestions(); };
  $("startRandom").onclick = startRandom;
  $("browseQuestions").onclick = () => $("questionList").scrollIntoView({ behavior: "smooth" });
  $("recBtn").onclick = toggleRecording;
  $("cancelPractice").onclick = exitPractice;
  $("typeInstead").onclick = () => { $("recorderCard").style.display = "none"; $("typeCard").style.display = "block"; $("typedAnswer").focus(); };
  $("backToRec").onclick = () => { $("recorderCard").style.display = "block"; $("typeCard").style.display = "none"; };
  $("submitTyped").onclick = submitTyped;
  $("reviewScriptBtn").onclick = reviewScript;
  $("createJd").onclick = createJd;
  $("phraseSearch").oninput = debounce(loadPhrases, 300);
  $("addPhraseBtn").onclick = addPhrase;
  $("modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };

  document.body.addEventListener("click", onBodyClick);

  // 画面が消える・別アプリに切り替わると録音は続けられないため、
  // その時点までの内容を確定させて解析に回す（黙って失われるのを防ぐ）
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && recorder && recorder.state === "recording") {
      recorder.stop();
    } else if (!document.hidden && wakeLock === null && recorder && recorder.state === "recording") {
      acquireWakeLock();
    }
  });
  window.addEventListener("pagehide", releaseStream);

  boot();

  if ("serviceWorker" in navigator) {
    // 起動のたびに更新を確認する。これがないと、修正しても
    // 端末に残った古い画面が表示され続けることがある。
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  }
});

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function addPhrase() {
  const term = prompt("英語の表現・用語");
  if (!term) return;
  const meaning = prompt("日本語での意味");
  if (!meaning) return;
  const example = prompt("例文（任意）") || "";
  await api("/api/phrases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, meaning_ja: meaning, example, category: "user" }),
  });
  loadPhrases();
}

async function onBodyClick(e) {
  const t = e.target.closest("[data-qid], [data-cat], [data-pcat], [data-copy], [data-star], [data-del-phrase], [data-del-jd], [data-ans], [data-del-ans], [data-script], [data-close-modal]");
  if (!t) return;

  if (t.dataset.qid) {
    const q = state.questions.find((x) => String(x.id) === t.dataset.qid);
    if (q) startQuestion(q);
  } else if (t.dataset.cat) {
    state.currentCategory = t.dataset.cat;
    loadQuestions();
  } else if (t.dataset.pcat) {
    state.phraseCat = t.dataset.pcat;
    loadPhrases();
  } else if (t.dataset.copy != null) {
    try {
      await navigator.clipboard.writeText(t.dataset.copy);
      const old = t.textContent;
      t.textContent = "コピーしました";
      setTimeout(() => { t.textContent = old; }, 1400);
    } catch { alert("コピーできませんでした。長押しで選択してください。"); }
  } else if (t.dataset.star) {
    await api(`/api/phrases/${t.dataset.star}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: t.dataset.on !== "1" }),
    });
    loadPhrases();
  } else if (t.dataset.delPhrase) {
    if (!confirm("この用語を削除しますか？")) return;
    await api(`/api/phrases/${t.dataset.delPhrase}`, { method: "DELETE" });
    loadPhrases();
  } else if (t.dataset.delJd) {
    if (!confirm("この求人と、そこから作った質問をすべて削除しますか？")) return;
    await api(`/api/jds/${t.dataset.delJd}`, { method: "DELETE" });
    state.currentJd = "";
    loadJds(); loadQuestions();
  } else if (t.dataset.ans) {
    openAnswer(t.dataset.ans);
  } else if (t.dataset.delAns) {
    if (!confirm("この練習記録を削除しますか？")) return;
    await api(`/api/answers/${t.dataset.delAns}`, { method: "DELETE" });
    closeModal(); loadHistory(); loadStats();
  } else if (t.dataset.script) {
    const s = (window.__scripts || []).find((x) => String(x.id) === t.dataset.script);
    if (s) openModal(`<div class="row"><b class="grow">${esc(s.question_text)}</b>
      <button class="btn ghost sm" data-close-modal>閉じる</button></div>` + renderScriptResult(s.notes || {}));
  } else if (t.hasAttribute("data-close-modal")) {
    closeModal();
  }
}
