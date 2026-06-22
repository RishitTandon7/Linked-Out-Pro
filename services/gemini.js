// services/gemini.js — Gemini Vision AI service
// Rotates across multiple MODELS and multiple KEYS for maximum throughput
const axios = require('axios');
const fs    = require('fs');

// ---- Key Pool ----
const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.warn('⚠️  No Gemini API keys configured. Set GEMINI_API_KEY_1/2/3 in .env');
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
function imageFileToGeminiPart(filePath, mimetype) {
  const data = fs.readFileSync(filePath);
  return {
    inline_data: {
      mime_type: mimetype || 'image/jpeg',
      data:      data.toString('base64')
    }
  };
}

// ---- Intent / Tone Maps ----
const intentMap = {
  achievement:  'Achievement (won award, completed milestone, certification)',
  announcement: 'Announcement (new role, new project, product launch)',
  storytelling: 'Storytelling (journey, lesson learned, personal experience)',
  motivation:   'Motivation (insight, advice, encouragement)',
  showcase:     'Product / Work Showcase'
};
const toneMap = {
  professional: 'Professional, confident, polished',
  casual:       'Casual and conversational, yet smart',
  bold:         'Bold, direct, high-energy',
  humble:       'Humble, grateful, grounded'
};

/**
 * Analyze images and generate a LinkedIn post
 * @param {Array<{path, mimetype}>} imageFiles
 */
async function generateLinkedInPost(imageFiles, context, intent, tone, currentDate) {
  const today = currentDate || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const prompt = `You are an expert LinkedIn content creator and personal branding strategist.

Today's date is: ${today}.

${
  imageFiles.length === 0
    ? 'Generate a post based solely on the context provided below.'
    : imageFiles.length === 1
      ? 'Analyze the provided image carefully (such as a certificate, document, award, or photo) and use it as the basis for the post.'
      : `Analyze all ${imageFiles.length} provided event/related photos carefully as a set.`
}${context ? `\n\nAdditional context from the user: "${context}"` : ''}

Create a complete, full-length LinkedIn post with these specifications:
- Intent: ${intentMap[intent] || intentMap.achievement}
- Tone: ${toneMap[tone] || toneMap.professional}
- Start with a strong, scroll-stopping hook (first line must grab attention immediately)
- Professional yet human — no corporate-speak
- Short paragraphs (2-4 sentences per paragraph), with a blank line between each
- Write the COMPLETE post — do not cut it short. Aim for 3-5 paragraphs
- 2-4 relevant emojis placed naturally (not stacked at the end)
- Adds real value: include the full story, lesson, or insight — do not summarise or truncate
- End with a clear call-to-action or reflection question to drive engagement
- NEVER use: "I am happy to share", "Excited to announce", "Thrilled to", or similar clichés
- Do NOT include hashtags inside the post body itself

DATES AND Retrospectives / Throwbacks:
1. Look closely for any dates, issue dates, graduation/completion years, or timeframe indicators printed on the uploaded image(s) (especially certificates, credentials, or diplomas).
2. Compare any detected dates (or timeframe/dates mentioned in the user's text context) to Today's date (${today}).
3. If the achievement, certificate, or milestone date is in the past (e.g., from several months or years ago), structure the post as a retrospective reflection focusing on growth and what stuck.
4. For Certificates & Credentials, use hooks like:
   - "Back in [Year], this changed how I think about [Topic]..."
   - "[Time period] later, here's what actually stuck..."
   - "[Year] taught me something I keep coming back to..."
5. For Hackathons, Competitions & Build Events, use hooks like:
   - "Back in [Year], building [Project] in 48 hours taught me..." (Only mention the project/product if the user explicitly provided it or if it is clearly visible in the image. Otherwise, focus on the building experience/hackathon theme itself).
   - "[Time period] after building at [Hackathon], here's what actually stuck about shipping fast..."
   - "The [Hackathon] in [Year] is where I first learned that [specific lesson] — and I haven't shipped the same way since."
6. No Hallucinated Projects: Do not mention or hallucinate a specific project name if the user hasn't explicitly mentioned it in their context/input and it is not clearly readable/visible on the image.
7. Fallback Behavior: If no date can be reliably detected from the image or context, default to a standard post without retrospective/throwback framing.
8. Acknowledge that the credential/achievement was obtained in the past, sharing what you've learned since then, how you've applied the knowledge, or the long-term impact of that milestone. Avoid exact anniversary wording like "today".
9. If the certificate is brand new (e.g. dated this month/recently) or contains no date indicating it is old, frame it as a recent achievement.

OUTPUT — use EXACTLY this format, nothing else:

POST:
[Your complete LinkedIn post here — write the full text, do not truncate]

HASHTAGS:
[#tag1 #tag2 #tag3 #tag4 #tag5]

ANALYSIS:
[1-2 sentence image description]`;

  const imageParts = imageFiles.map(f => imageFileToGeminiPart(f.path, f.mimetype));

  const body = {
    contents: [{ parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { temperature: 0.95, maxOutputTokens: 4096 }
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
  const postMatch     = raw.match(/POST:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
  const hashMatch     = raw.match(/HASHTAGS:\s*([\s\S]*?)(?=ANALYSIS:|$)/i);
  const analysisMatch = raw.match(/ANALYSIS:\s*([\s\S]*?)$/i);

  let postText = postMatch     ? postMatch[1].trim()     : raw.trim();
  let hashtags = hashMatch     ? hashMatch[1].trim()     : '';
  let analysis = analysisMatch ? analysisMatch[1].trim() : '';

  if (hashtags && !hashtags.includes('#')) {
    hashtags = hashtags.split(/\s+/).map(h => `#${h}`).join(' ');
  }

  return { postText, hashtags, analysis };
}

module.exports = { generateLinkedInPost, suggestSchedule };
