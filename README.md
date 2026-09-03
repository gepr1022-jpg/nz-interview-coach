# NZ Interview Coach

A self-hosted interview practice app for the New Zealand job market. Record an answer out loud, get it transcribed, scored against how New Zealand interviews actually work, and track whether you are improving over time.

Everything runs on Cloudflare. No third-party AI service is involved.

## Why I built it

I am not an engineer. I came to New Zealand from a corporate background overseas, and I found that the hard part of interviewing here was not the content of my answers but the delivery: knowing how long to talk, how much to claim, and how to sound direct rather than translated.

Generic interview tools do not cover that. So I built the thing I actually needed, and used it to prepare for real interviews.

## What it does

| Feature | Detail |
|---|---|
| Mock interview | Answer a question out loud, get an automatic transcript, a score across five dimensions, and a rewritten version of your own answer |
| Delivery metrics | Answer length, speaking pace (words per minute), filler words (um, like) and their rate, longest sentence |
| Script review | Paste a prepared answer and get it rewritten in natural New Zealand English, with line-by-line alternatives |
| Terminology library | Customer Success and Account Management vocabulary plus New Zealand workplace idiom, added to automatically as you practise |
| Progress dashboard | Score, pace and filler trends over time, by question category |
| Job-description mode | Paste a job ad and the app generates an interview set specific to that role |

Ships with 56 questions and 67 terms.

## How it is built

- **Cloudflare Workers** for the site and API
- **Workers AI**
  - `@cf/openai/whisper-large-v3-turbo` for speech-to-text
  - `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for scoring, rewriting and question generation
- **D1** for practice history, script revisions and the terminology library (Oceania region)
- **PWA**, so it installs to a phone home screen and runs full screen

Audio files are never stored. They are discarded once transcribed; only the text and the scores are kept.

Roughly 2,400 lines across `src/` and `public/`. No framework, no build step.

## Design decisions worth noting

**The scoring prompt refuses to inflate.** An answer that is fluent but has no evidence in it scores badly, on purpose. The rules in `src/ai.js` also forbid the model from inventing achievements, numbers or employers: where something is missing it inserts a placeholder and tells the user what to supply.

**Feedback is written in Japanese, examples in English.** Explanations land faster in a first language; the sentences you will actually say need to be in the target language.

**It coaches towards New Zealand norms specifically.** Tall poppy culture means claims have to be carried by facts rather than adjectives, so the prompt penalises self-promotion that is not backed by specifics.

## Setup

Requires Node.js 20+ and a Cloudflare account (the free plan is enough).

```bash
npm install
npx wrangler login

npm run db:init    # create tables
npm run db:seed    # load the 56 questions and 67 terms
npm run deploy

npm run secret:password   # set the access passphrase
npm run secret:session    # set a random session signing string
```

`db:init` drops existing tables before recreating them. Do not run it once you have practice history.

## Files

```
src/index.js      API routing
src/ai.js         Workers AI calls and prompts (scoring criteria live here)
src/metrics.js    pace, filler and sentence-length measurement
src/auth.js       passphrase authentication
public/           front end (HTML, CSS, JavaScript)
db/schema.sql     table definitions
db/seed.sql       starter questions and terms
db/_gen_seed.py   generates seed.sql
```

To change the scoring criteria or the tone of the suggestions, edit the prompts in `src/ai.js`.

---

日本語版のREADMEは [README.ja.md](README.ja.md) にあります。
