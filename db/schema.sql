-- NZ Interview Coach : D1 schema
-- 音声そのものは保存しない。文字起こしテキストと解析結果のみを保持する。

DROP TABLE IF EXISTS answers;
DROP TABLE IF EXISTS scripts;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS jds;
DROP TABLE IF EXISTS phrases;

-- 応募先の求人票（JD）
CREATE TABLE jds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company     TEXT NOT NULL,
  title       TEXT NOT NULL,
  raw_text    TEXT NOT NULL,
  summary     TEXT,              -- AIが抽出した要点(JSON)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 質問バンク（source: 'seed' = 定番集 / 'jd' = JDから生成 / 'user' = 手動追加）
CREATE TABLE questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  text        TEXT NOT NULL,
  intent      TEXT,              -- 面接官が何を見ているか（日本語）
  source      TEXT NOT NULL DEFAULT 'seed',
  jd_id       INTEGER REFERENCES jds(id) ON DELETE CASCADE,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_questions_category ON questions(category, archived);
CREATE INDEX idx_questions_jd ON questions(jd_id);

-- 練習1回分の記録（会話履歴）
CREATE TABLE answers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id    INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  question_text  TEXT NOT NULL,
  category       TEXT,
  jd_id          INTEGER REFERENCES jds(id) ON DELETE SET NULL,
  mode           TEXT NOT NULL DEFAULT 'voice',   -- 'voice' | 'text'
  transcript     TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  word_count     INTEGER NOT NULL DEFAULT 0,
  wpm            REAL NOT NULL DEFAULT 0,
  filler_count   INTEGER NOT NULL DEFAULT 0,
  filler_rate    REAL NOT NULL DEFAULT 0,
  filler_detail  TEXT,                            -- JSON: {"um":3,"like":2}
  overall_score  INTEGER,
  score_detail   TEXT,                            -- JSON: 観点別スコア
  feedback       TEXT,                            -- JSON: AIフィードバック全体
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_answers_created ON answers(created_at DESC);
CREATE INDEX idx_answers_question ON answers(question_id);

-- 台本の添削記録
CREATE TABLE scripts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_text TEXT NOT NULL,
  original      TEXT NOT NULL,
  revised       TEXT,
  notes         TEXT,                             -- JSON: 指摘・言い換え候補
  jd_id         INTEGER REFERENCES jds(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_scripts_created ON scripts(created_at DESC);

-- 表現・用語ライブラリ
CREATE TABLE phrases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  term        TEXT NOT NULL,
  meaning_ja  TEXT NOT NULL,
  example     TEXT,
  category    TEXT NOT NULL DEFAULT 'general',
  source      TEXT NOT NULL DEFAULT 'seed',       -- 'seed' | 'practice' | 'script' | 'user'
  starred     INTEGER NOT NULL DEFAULT 0,
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_phrases_term ON phrases(term);
CREATE INDEX idx_phrases_category ON phrases(category);
