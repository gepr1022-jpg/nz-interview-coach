// 文字起こしテキストから、話し方の客観指標を計算する。
// AIの主観評価とは分けて、毎回同じ基準で比較できる数値をここで出す。

const FILLERS = [
  { key: "um", re: /\b(um+|umm+)\b/gi },
  { key: "uh", re: /\b(uh+|er+|erm+|ah+)\b/gi },
  { key: "you know", re: /\byou know\b/gi },
  { key: "I mean", re: /\bi mean\b/gi },
  { key: "sort of", re: /\bsort of\b/gi },
  { key: "kind of", re: /\bkind of\b/gi },
  { key: "basically", re: /\bbasically\b/gi },
  { key: "actually", re: /\bactually\b/gi },
  { key: "literally", re: /\bliterally\b/gi },
  { key: "obviously", re: /\bobviously\b/gi },
  { key: "just", re: /\bjust\b/gi },
  { key: "like", re: /\b(?:,\s*)?like(?=\s*,|\s+(?:i|we|it|he|she|they|you|a|the|really|very))\b/gi },
];

// STARの型がどれくらい踏めているかの簡易判定（AI評価の補助）
const STAR_HINTS = {
  situation: /\b(at the time|when i was|we were|the situation|back in|in my (?:current |previous |last )?role|the client had|i was working|there was|we had a)\b/i,
  task: /\b(my task|i was responsible|i needed to|my job was|i had to|i was asked to|the goal was|my role was|what i needed)\b/i,
  action: /(\bi (?:called|rang|contacted|arranged|set up|proposed|built|ran|decided|introduced|created|organis|organiz|reviewed|escalated|checked|offered|found|spoke|met|sent|put|pulled|walked|sat down|flagged|did)|\bfirst,|\bthen i\b|\bso i\b|\bwhat i did\b)/i,
  result: /\b(as a result|which meant|the outcome|we ended up|it led to|they stayed|rebooked|renewed|signed|reduced|increased|improved|saved|grew|retained|went on to|by \d+ ?%|\d+ ?percent)\b/i,
};

// 数字は「3」だけでなく "three options" のような英単語でも語られる
const DIGIT_RE = /\b\d[\d,.]*/;
const WORD_NUM_RE = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|double|triple|half)\b/i;

export function analyseTranscript(transcript, durationMs) {
  const text = (transcript || "").trim();
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const minutes = durationMs > 0 ? durationMs / 60000 : 0;
  const wpm = minutes > 0 ? wordCount / minutes : 0;

  const detail = {};
  let fillerCount = 0;
  for (const f of FILLERS) {
    const m = text.match(f.re);
    if (m && m.length) {
      detail[f.key] = m.length;
      fillerCount += m.length;
    }
  }

  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const longestSentence = sentences.reduce(
    (max, s) => Math.max(max, s.split(/\s+/).filter(Boolean).length), 0
  );

  const star = {};
  for (const [k, re] of Object.entries(STAR_HINTS)) star[k] = re.test(text);

  const hasNumbers = DIGIT_RE.test(text) || WORD_NUM_RE.test(text);

  return {
    wordCount,
    wpm: Math.round(wpm * 10) / 10,
    fillerCount,
    fillerRate: wordCount > 0 ? Math.round((fillerCount / wordCount) * 1000) / 10 : 0,
    fillerDetail: detail,
    sentenceCount: sentences.length,
    avgSentenceWords: sentences.length ? Math.round((wordCount / sentences.length) * 10) / 10 : 0,
    longestSentence,
    star,
    hasNumbers,
  };
}

// 面接での目安（NZの一般的な行動面接を想定）
export function pacingNote(m, durationMs) {
  const notes = [];
  const secs = Math.round(durationMs / 1000);
  if (m.wpm && m.wpm < 110) notes.push("話す速さがやや遅めです。緊張で間が空いていないか確認しましょう。");
  else if (m.wpm > 170) notes.push("話す速さが速めです。第二言語で早口になると聞き手が置いていかれます。");
  if (m.fillerRate > 5) notes.push("フィラー（um, like など）が多めです。詰まったら黙って一拍おく方が落ち着いて聞こえます。");
  if (secs > 0 && secs < 45) notes.push("回答が短めです。行動面接では60〜120秒が目安です。");
  if (secs > 150) notes.push("回答が長めです。要点を先に言い切る形に組み替えましょう。");
  if (m.longestSentence > 45) notes.push("一文が長すぎる箇所があります。文を切ると格段に伝わりやすくなります。");
  if (!m.hasNumbers) notes.push("数字が出てきていません。規模や成果を一つでも数値で入れると説得力が上がります。");
  return notes;
}

// 無音や壊れた音声を渡されたとき、文字起こしは実在しない短い語句を
// 延々と繰り返した結果を返すことがある。それを採点に回さないための判定。
export function looksHallucinated(text) {
  const words = String(text || "").toLowerCase().replace(/[^a-z' ]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;
  if (new Set(words).size <= 3) return true;

  const bigrams = {};
  for (let i = 0; i < words.length - 1; i++) {
    const b = words[i] + " " + words[i + 1];
    bigrams[b] = (bigrams[b] || 0) + 1;
  }
  let top = 0;
  for (const n of Object.values(bigrams)) top = Math.max(top, n);
  return top / (words.length - 1) > 0.5;
}

// 無音区間で文字起こしが差し込みがちな定型句。動画字幕の学習データに由来する。
const TAIL_NOISE = /\s*\b(thank you(?: very much)?|thanks(?: for watching)?|bye(?:-bye)?|goodbye|please subscribe|subscribe to my channel|see you next time|you)\b[.!?…]*\s*$/i;

// 末尾の定型句が繰り返されている場合のみ取り除く。
// 1回だけなら本人が実際にそう締めくくった可能性があるので残す。
export function cleanTranscript(text) {
  const original = String(text || "").trim();
  let out = original;
  let removed = 0;
  while (removed < 20) {
    const m = out.match(TAIL_NOISE);
    if (!m || m.index === 0) break;
    out = out.slice(0, m.index).trim();
    removed++;
  }
  if (removed >= 2 && out.length >= 20) {
    return { text: out, removed };
  }
  return { text: original, removed: 0 };
}
