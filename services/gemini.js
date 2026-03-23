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

// ---- Model Pool (only models with available free-tier RPM quota) ----
// Ordered by capability (best first). RPM per key:
//   gemini-2.5-flash       = 5 RPM/key
//   gemini-2.5-flash-lite  = 10 RPM/key
//   gemini-2.0-flash-lite  = 30 RPM/key  (fallback)
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite-preview-06-17',
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
async function generateLinkedInPost(imageFiles, context, intent, tone) {
  const prompt = `You are an expert LinkedIn content creator and personal branding strategist.

${imageFiles.length === 1
    ? 'Analyze the provided image carefully.'
    : `Analyze all ${imageFiles.length} provided event/related photos carefully as a set.`
  }${context ? `\n\nAdditional context from the user: "${context}"` : ''}

Create a LinkedIn post with these specifications:
- Intent: ${intentMap[intent] || intentMap.achievement}
- Tone: ${toneMap[tone] || toneMap.professional}
- Start with a strong, scroll-stopping hook (first line must grab attention immediately)
- Professional yet human — no corporate-speak
- Short paragraphs (1-3 sentences max per paragraph)
- 1-2 relevant emojis (not excessive)
- 100-180 words for the main post body
- Adds real value: lesson, insight, or clear takeaway
- NEVER use: "I am happy to share", "Excited to announce", "Thrilled to", or similar clichés
- Do NOT include hashtags in the post body

OUTPUT — use EXACTLY this format, nothing else:

POST:
[Your LinkedIn post here]

HASHTAGS:
[#tag1 #tag2 #tag3 #tag4 #tag5]

ANALYSIS:
[1-2 sentence image description]`;

  const imageParts = imageFiles.map(f => imageFileToGeminiPart(f.path, f.mimetype));

  const body = {
    contents: [{ parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048 }
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
