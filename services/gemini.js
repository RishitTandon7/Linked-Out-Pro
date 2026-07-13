// services/gemini.js — Gemini Vision AI service
// Rotates across multiple MODELS and multiple KEYS for maximum throughput
const axios = require('axios');
const fs    = require('fs');

// ---- Key Pool ----
const API_KEYS = Object.keys(process.env)
  .filter(key => key.startsWith('GEMINI_API_KEY'))
  .map(key => process.env[key])
  .filter(Boolean);

if (API_KEYS.length === 0) {
  console.warn('⚠️  No Gemini API keys configured. Set GEMINI_API_KEY_1/2/3 etc. in .env');
}

// ---- Model Pool — all models available in this account ----
// Ordered best-quality first; the rotation falls back to faster/cheaper
// models automatically on 429 / 503 / 404 errors.
//
// Tier 1 — Stable GA (most reliable, billing-enabled)
//   gemini-2.5-pro          → most capable, low RPM
//   gemini-2.5-flash        → best price/perf balance
//   gemini-2.5-flash-lite   → fastest stable GA
//
// Tier 2 — Preview (frontier quality, may have tighter limits)
//   gemini-3.1-pro-preview       → newest, highest intelligence
//   gemini-3-flash-preview       → frontier class, great throughput
//   gemini-3.1-flash-lite-preview → frontier, lowest latency preview
//
// Tier 3 — Deprecated (still live, high RPM, great fallbacks)
//   gemini-2.0-flash        → 15 RPM/key, solid quality
//   gemini-2.0-flash-lite   → 30 RPM/key, fastest fallback
const MODELS = [
  // — Tier 1: Stable GA —
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  // — Tier 2: Preview —
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  // — Tier 3: Deprecated fallbacks —
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
];

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Build a flat pool of [model, key] combinations so we try every combo
function buildPool() {
  const pool = [];
  for (const model of MODELS) {
    for (const key of API_KEYS) {
      pool.push({ model, key });
    }
  }
  return pool;
}

const POOL = buildPool();
let _poolIndex = 0;

/**
 * Call Gemini with automatic failover across ALL model×key combos.
 * Moves to the next combo on 429 or 404, throws on hard errors.
 */
async function callGemini(body, timeoutMs = 30000) {
  if (POOL.length === 0) throw new Error('No Gemini API keys configured');

  const start = _poolIndex;
  let lastError;

  for (let attempt = 0; attempt < POOL.length; attempt++) {
    const idx   = (start + attempt) % POOL.length;
    const { model, key } = POOL[idx];
    const url = `${BASE}/${model}:generateContent?key=${key}`;

    try {
      console.log(`🔮 Gemini [${model}] key #${(API_KEYS.indexOf(key) + 1)}`);
      const res = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: timeoutMs
      });
      _poolIndex = (idx + 1) % POOL.length;
      return res;
    } catch (e) {
      const status = e.response?.status;
      if (status === 429 || status === 503 || status === 404) {
        console.warn(`⚡ [${model}] key #${(API_KEYS.indexOf(key)+1)} → ${status}, trying next`);
        lastError = e;
      } else {
        throw e;
      }
    }
  }

  throw lastError || new Error('All Gemini model+key combos exhausted');
}

// ---- Image Helper ----
function fileToGeminiPart(filePath, mimetype) {
  const data = fs.readFileSync(filePath);
  return {
    inline_data: {
      mime_type: mimetype || 'application/octet-stream',
      data:      data.toString('base64')
    }
  };
}

// ---- Intent / Tone Maps ----
const toneMap = {
  professional: 'Professional + Authoritative',
  casual: 'Casual + Conversational',
  bold: 'Bold + Provocative',
  humble: 'Humble + Reflective',
  inspirational: 'Inspirational + Motivational'
};

const intentMap = {
  achievement: 'Achievement with Insight',
  announcement: 'Announcement with Story',
  storytelling: 'Storytelling + Lesson',
  motivation: 'Motivation + Challenge',
  showcase: 'Showcase with Proof'
};

/**
 * Analyze images and generate a LinkedIn post
 * @param {Array<{path, mimetype}>} imageFiles
 */
async function generateLinkedInPost(mediaFiles, context, intent, tone, currentDate) {
  const today = currentDate || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const imageAnalysisInstruction = mediaFiles.length === 0
    ? 'Generate a post based solely on the context provided below.'
    : mediaFiles.length === 1 && mediaFiles[0]?.mimetype?.startsWith('video/')
      ? 'The user has shared a video. You cannot see the video directly, but craft a post for sharing this video on LinkedIn.'
      : mediaFiles.length === 1
        ? 'Analyze the provided image carefully (such as a certificate, document, award, or photo) and use it as the basis for the post.'
        : `Analyze all ${mediaFiles.filter(f => !f.mimetype?.startsWith('video/')).length} provided event/related photos carefully as a set.`;

  const toneString = toneMap[tone] || 'Authentic + Direct';
  const intentString = intentMap[intent] || 'Achievement with Insight';

  const prompt = `You are an expert LinkedIn viral content strategist and personal branding specialist.
You don't just write posts — you engineer content that stops scrolls, triggers emotions, 
and drives massive engagement.

Today's date is: ${today}

${imageAnalysisInstruction}
${context ? `\nAdditional context from the user: "${context}"` : ''}

---

CORE MISSION:
Write a LinkedIn post so compelling that it gets shared, saved, and commented on at scale.
Every single line must earn its place. Cut anything that doesn't serve the hook, the story, 
or the payoff.

---

VIRAL ARCHITECTURE — structure the post exactly like this:

LINE 1 — THE HOOK (most important line you will write):
- Must create a pattern interrupt — say something unexpected, counterintuitive, or bold
- Use one of these proven hook formulas:
  → Contradiction: "Everyone told me [X]. They were wrong."
  → Curiosity gap: "I did [X] for [time period]. Here's what nobody tells you."
  → Vulnerable truth: "I failed at [X]. Here's exactly what happened."
  → Hot take: "[Widely held belief] is actually holding you back."
  → Numbers: "[Specific number] lessons from [experience] that changed how I work."
  → Confession: "I used to think [X]. Then [Y] happened."
- Never open with "I", "We", your name, or the company name
- Never use a question as your hook (questions are weak openers on LinkedIn)

LINE 2 — THE PULL (keep them reading):
- One short sentence (under 10 words) that deepens the curiosity from line 1
- This is what shows in the "...see more" preview — make it impossible to ignore

PARAGRAPH 2 — THE STORY (make them feel it):
- Set the scene. Specific details beat vague claims every time.
- Use "I" not "we" — personal stories outperform team stories on LinkedIn
- Include one moment of tension, struggle, or surprise
- 2–3 sentences max

PARAGRAPH 3 — THE INSIGHT (the real value):
- The lesson, realization, or shift in thinking
- Be specific and non-obvious — avoid lessons anyone could have predicted
- This is what people screenshot and share
- 2–3 sentences

PARAGRAPH 4 — THE PROOF / EXPAND (optional but powerful):
- Back the insight with a result, stat, or follow-up observation
- Or zoom out: why does this matter beyond just you?
- 2–3 sentences

FINAL LINE — THE CTA (engineered for comments):
- Do NOT ask "what do you think?" — it's weak and overused
- Ask a question that creates a DIVISION of opinion, or invites a one-word/one-sentence answer
- Examples of strong CTAs:
  → "Which matters more to you — speed or perfection? Drop your answer below."
  → "Has anyone else experienced this, or was it just me?"
  → "What's the one thing you'd go back and tell yourself before starting?"
  → "Tag someone who needs to hear this today."

---

PSYCHOLOGICAL LEVERS — embed at least 2 of these:
- FOMO: imply the reader is missing something by not knowing this
- Relatability: say the thing everyone feels but nobody says out loud
- Specificity: use exact numbers, dates, durations — vague claims get ignored
- Surprise: subvert what the reader expects to hear
- Stakes: make clear why this actually matters

---

FORMAT RULES:
- Every paragraph separated by a blank line (LinkedIn line-break formatting)
- Short paragraphs: 1–3 sentences each. Never write a wall of text.
- Emojis: 1–3 max, placed where they add emphasis — never decorative, never at the end in a dump
- Tone: ${toneString}
- Intent: ${intentString}
- Hashtags: NEVER inside the post body — output separately

BANNED PHRASES — instant rejection, never use:
- "I am happy/excited/thrilled/proud to share/announce"
- "In today's world / In today's fast-paced world"
- "Game-changer / Synergy / Leverage / Circle back"
- "I wanted to share this because..."
- "Let that sink in." (overused to death)
- Any variation of the above

---

RETROSPECTIVE / THROWBACK LOGIC:

STEP 1 — Detect any dates from the image or user context.
STEP 2 — Compare to ${today}.
STEP 3 — If the achievement is MORE THAN 2 MONTHS old → retrospective framing.
          If recent or no date detected → standard framing.

RETROSPECTIVE HOOKS (use only if applicable):
- "Back in [Year], I made a decision that [consequence]..."
- "[X years] later, here's what I wish I'd known going in..."
- "This [certificate/win/project] is from [Year]. Here's what it actually taught me."

NO HALLUCINATION RULE — CRITICAL:
Never mention a specific project, product, or company name unless:
(a) the user explicitly named it in their context, OR
(b) it is clearly and unambiguously visible in the uploaded image.
If neither, refer generically: "the project", "what we built", "our solution".

---

CONFLICT PRIORITY (if instructions conflict, follow this order):
1. No hallucination rule
2. Banned phrases
3. Hook formula — never compromise on the hook
4. Retrospective vs standard framing
5. Format rules

---

OUTPUT — EXACTLY this format, nothing else:

POST:
[Full LinkedIn post — complete, untruncated, engineered for virality]

HASHTAGS:
[#tag1 #tag2 #tag3 #tag4 #tag5 — mix of broad reach + niche relevance]

HOOK SCORE:
[Rate the hook 1–10 and explain in one sentence why it will or won't stop a scroll]`;

  // Separate images (can be sent inline) from videos (not supported inline in REST API)
  const imageFiles = mediaFiles.filter(f => !f.mimetype || !f.mimetype.startsWith('video/'));
  const videoFiles = mediaFiles.filter(f => f.mimetype && f.mimetype.startsWith('video/'));

  const imageParts = imageFiles.map(f => fileToGeminiPart(f.path, f.mimetype));

  // Build a supplementary note for videos so Gemini knows one was provided
  let videoNote = '';
  if (videoFiles.length > 0) {
    videoNote = `\n\nNote: The user has also attached ${videoFiles.length} video file(s). You cannot see the video content directly, but treat this as a video post and write content appropriate for sharing a video on LinkedIn (e.g., "Check out this video", "I'm sharing a short clip...").`;
  }

  const promptWithVideo = prompt + videoNote;

  const body = {
    contents: [{ parts: [{ text: promptWithVideo }, ...imageParts] }],
    generationConfig: { temperature: 0.85, maxOutputTokens: 4096 }
  };

  const response = await callGemini(body);
  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Empty response from Gemini');

  return parseGeminiResponse(text);
}

/**
 * Ask Gemini to suggest a smart posting schedule
 */
async function suggestSchedule(imageDescriptions, postsPerWeek, currentDate) {
  if (API_KEYS.length === 0) return null;

  const prompt = `You are a LinkedIn content strategist.

A user has ${imageDescriptions.length} posts to schedule. They want to post ${postsPerWeek} times per week.
Today is ${currentDate}.

Posts to schedule:
${imageDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Suggest the best order and timing based on:
- Natural content flow and storytelling
- Engagement patterns (best days: Tue, Wed, Thu morning)
- Variety and spacing

Return ONLY a valid JSON array (no extra text):
[
  { "postIndex": 0, "suggestedDate": "YYYY-MM-DD", "reason": "short reason" }
]`;

  try {
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
    };
    const res = await callGemini(body, 15000);
    const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn('Schedule suggestion failed:', e.message);
  }
  return null;
}

// ---- Parser ----
function parseGeminiResponse(raw) {
  // Parse POST: section
  const postMatch     = raw.match(/POST:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
  // Parse HASHTAGS: section
  const hashMatch     = raw.match(/HASHTAGS:\s*([\s\S]*?)(?=HOOK SCORE:|$)/i);
  // Parse HOOK SCORE: section
  const hookScoreMatch = raw.match(/HOOK SCORE:\s*([\s\S]*?)$/i);

  let postText = postMatch     ? postMatch[1].trim()     : raw.trim();
  let hashtags = hashMatch     ? hashMatch[1].trim()     : '';
  
  // Parse HOOK SCORE: section -> map to analysis field
  // Map HOOK SCORE to the analysis field to avoid database schema migrations.
  // If HOOK SCORE is missing from response, default to null - don't throw.
  let analysis = hookScoreMatch ? hookScoreMatch[1].trim() : null;

  if (hashtags && !hashtags.includes('#')) {
    hashtags = hashtags.split(/\s+/).map(h => `#${h}`).join(' ');
  }

  return { postText, hashtags, analysis };
}

async function generateResumeStrategy(mediaFile, currentHeadline) {
  const filePart = fileToGeminiPart(mediaFile.path, mediaFile.mimetype);
  
  const prompt = `You are a premium LinkedIn Ghostwriter and Strategist.
The user has attached their Resume/CV/Experience document below. Their current LinkedIn Headline is: "${currentHeadline || 'None'}".

Your task is to analyze their experience and generate:
1. 3 highly optimized LinkedIn Headlines (focus on value proposition and authority).
2. 3-4 specific Profile Enhancements (e.g. what to add to their About section, Experience, or Skills to stand out).
3. 3-5 Content Ideas (draft posts) based entirely on their real work experience.

Each post draft should have a scroll-stopping hook, short punchy paragraphs, 2-4 emojis, and a clear takeaway or call-to-action. Do not use cliché phrases.

Return ONLY a valid JSON object strictly matching this schema (do not include markdown code block formatting):
{
  "headlines": ["Headline 1", "Headline 2", "Headline 3"],
  "profileTips": [
    {
      "section": "About / Experience / Skills",
      "advice": "Specific advice on what to add or change"
    }
  ],
  "contentIdeas": [
    {
      "topic": "Topic summary",
      "draft": "Full LinkedIn post text (3-5 paragraphs, formatted, with hook)"
    }
  ]
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }, filePart] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
  };

  const response = await callGemini(body, 90000); // 90s timeout for large generation
  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Empty response from Gemini');
  
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('Failed to parse Gemini JSON output');
}

module.exports = { generateLinkedInPost, suggestSchedule, generateResumeStrategy };
