/* =============================================
   LINKEDOUT PRO — APP LOGIC
   ============================================= */

// ---- State ----
let currentMode = 'single';
let selectedFiles = [];          // Array of File objects
let currentIntent = 'achievement';
let currentTone = 'professional';
let lastGeneratedPost = '';
let lastGeneratedHashtags = '';
let apiKey = localStorage.getItem('lo_gemini_key') || '';

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  updateApiStatus();
});

// ---- API Key Management ----
function toggleApiSection() {
  const wrap = document.getElementById('apiInputWrap');
  const btn  = document.getElementById('apiToggleBtn');
  const isOpen = wrap.classList.contains('open');

  if (isOpen) {
    wrap.classList.remove('open');
    btn.textContent = 'Configure';
  } else {
    wrap.classList.add('open');
    document.getElementById('apiKeyInput').value = apiKey;
    btn.textContent = 'Close';
  }
}

function saveApiKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) { showToast('Please enter a valid API key', 'error'); return; }
  apiKey = val;
  localStorage.setItem('lo_gemini_key', apiKey);
  showToast('✓ API key saved securely in browser');
  updateApiStatus();
  toggleApiSection();
}

function updateApiStatus() {
  const btn = document.getElementById('apiToggleBtn');
  if (apiKey) {
    btn.innerHTML = `<span class="api-saved">✓ Key saved</span>`;
  } else {
    btn.textContent = 'Configure';
  }
}

// ---- Mode Toggle ----
function setMode(mode) {
  currentMode = mode;
  selectedFiles = [];
  renderPreviewStrip();

  document.getElementById('singleBtn').classList.toggle('active', mode === 'single');
  document.getElementById('eventBtn').classList.toggle('active', mode === 'event');
  document.getElementById('singleUpload').classList.toggle('hidden', mode !== 'single');
  document.getElementById('eventUpload').classList.toggle('hidden', mode !== 'event');

  // Update context label
  const lbl = document.getElementById('contextLabelText');
  if (mode === 'event') {
    lbl.innerHTML = `Event description <span class="optional">(recommended for events)</span>`;
  } else {
    lbl.innerHTML = `Image context <span class="optional">(optional)</span>`;
  }

  // Hide output section when switching modes
  document.getElementById('outputSection').classList.add('hidden');
}

// ---- Drag & Drop ----
function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('dragover');
}

function handleDrop(e, mode) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  addFiles(files);
}

['singleUpload', 'eventUpload'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  }
});

// ---- File Select ----
function handleFileSelect(e, mode) {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
  addFiles(files);
  e.target.value = '';
}

function addFiles(files) {
  if (currentMode === 'single') {
    selectedFiles = [files[0]].filter(Boolean);
  } else {
    selectedFiles = [...selectedFiles, ...files].slice(0, 10);
  }
  renderPreviewStrip();
}

function removeFile(idx) {
  selectedFiles.splice(idx, 1);
  renderPreviewStrip();
}

function renderPreviewStrip() {
  const strip = document.getElementById('previewStrip');
  strip.innerHTML = '';

  selectedFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb';
    thumb.innerHTML = `
      <img src="${url}" alt="preview ${idx+1}" />
      <button class="remove-thumb" onclick="removeFile(${idx})">✕</button>
    `;
    strip.appendChild(thumb);
  });

  if (currentMode === 'event' && selectedFiles.length > 0 && selectedFiles.length < 10) {
    const addMore = document.createElement('div');
    addMore.className = 'preview-count';
    addMore.style.cursor = 'pointer';
    addMore.innerHTML = `+ Add<br>more`;
    addMore.onclick = () => document.getElementById('eventFileInput').click();
    strip.appendChild(addMore);
  }
}

// ---- Intent & Tone ----
function selectIntent(btn) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  currentIntent = btn.dataset.intent;
}

function selectTone(btn) {
  document.querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentTone = btn.dataset.tone;
}

// ---- Generate Post ----
async function generatePost() {
  if (!apiKey) {
    showToast('Please configure your Gemini API key first', 'error');
    toggleApiSection();
    return;
  }
  if (selectedFiles.length === 0) {
    showToast('Please upload at least one image', 'error');
    return;
  }

  setLoading(true);

  try {
    const context = document.getElementById('contextInput').value.trim();
    const imageParts = await filesToGeminiParts(selectedFiles);
    const prompt = buildPrompt(context, imageParts.length);

    const body = {
      contents: [{
        parts: [
          { text: prompt },
          ...imageParts
        ]
      }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 4096
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err?.error?.message || `API Error ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) throw new Error('Empty response from Gemini');

    parseAndDisplayPost(text);

  } catch (err) {
    console.error(err);
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

async function regeneratePost() {
  await generatePost();
}

// ---- Build Prompt ----
function buildPrompt(context, imageCount) {
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

  const today = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  });

  const imageAnalysisInstruction = imageCount === 0
    ? 'Generate a post based solely on the context provided below.'
    : imageCount === 1
      ? 'Analyze the provided image carefully (such as a certificate, document, award, or photo) and use it as the basis for the post.'
      : `Analyze all ${imageCount} provided event/related photos carefully as a set.`;

  const toneString = toneMap[currentTone] || 'Authentic + Direct';
  const intentString = intentMap[currentIntent] || 'Achievement with Insight';

  return `You are an expert LinkedIn viral content strategist and personal branding specialist.
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
}

// ---- Parse Response ----
function parseAndDisplayPost(raw) {
  let postText = '';
  let hashtagsText = '';
  let hookScoreText = '';

  const postMatch = raw.match(/POST:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
  const hashMatch = raw.match(/HASHTAGS:\s*([\s\S]*?)(?=HOOK SCORE:|$)/i);
  const hookScoreMatch = raw.match(/HOOK SCORE:\s*([\s\S]*?)$/i);

  postText = postMatch ? postMatch[1].trim() : raw.trim();
  hashtagsText = hashMatch ? hashMatch[1].trim() : '';
  hookScoreText = hookScoreMatch ? hookScoreMatch[1].trim() : '';

  // Ensure hashtags have # prefix
  if (hashtagsText && !hashtagsText.startsWith('#')) {
    hashtagsText = hashtagsText.split(/\s+/).map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
  }

  lastGeneratedPost = postText;
  lastGeneratedHashtags = hashtagsText;
  // Store or log the hook score if needed (here we can log it)
  console.log('Hook Score generated client-side:', hookScoreText);

  displayPost(postText, hashtagsText);
}

// ---- Display Post ----
function displayPost(postText, hashtagsText) {
  // Sync preview card
  document.getElementById('postBody').textContent = postText;
  document.getElementById('postHashtags').textContent = hashtagsText;

  // Show image preview in card
  const imgPreview = document.getElementById('lkImagePreview');
  imgPreview.innerHTML = '';
  imgPreview.className = 'lk-image-preview';

  if (selectedFiles.length === 1) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(selectedFiles[0]);
    img.alt = 'Post image';
    imgPreview.appendChild(img);
  } else if (selectedFiles.length > 1) {
    imgPreview.classList.add('multi-grid');
    selectedFiles.slice(0, 4).forEach((file, i) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.alt = `Event photo ${i+1}`;
      imgPreview.appendChild(img);
    });
  }

  // Sync editable fields
  document.getElementById('editablePost').value = postText;
  document.getElementById('editableHashtags').value = hashtagsText;

  // Show output
  const out = document.getElementById('outputSection');
  out.classList.remove('hidden');
  setTimeout(() => out.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

// ---- Sync Editable -> Preview ----
function syncPreview() {
  const val = document.getElementById('editablePost').value;
  document.getElementById('postBody').textContent = val;
  lastGeneratedPost = val;
}

function syncHashtags() {
  const val = document.getElementById('editableHashtags').value;
  document.getElementById('postHashtags').textContent = val;
  lastGeneratedHashtags = val;
}

// ---- Copy Actions ----
async function copyPost() {
  await copyToClipboard(lastGeneratedPost);
  const btn = document.getElementById('copyBtn');
  btn.innerHTML = `<svg width="14" height="14" fill="none" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copied!`;
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" fill="none" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy`;
  }, 2000);
}

async function copyFull() {
  const fullPost = `${lastGeneratedPost}\n\n${lastGeneratedHashtags}`.trim();
  await copyToClipboard(fullPost);
  const btn = document.querySelector('.copy-full-btn');
  btn.classList.add('copied');
  btn.innerHTML = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copied to clipboard!`;
  showToast('✓ Full post copied! Ready to paste on LinkedIn');
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = `<svg width="16" height="16" fill="none" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg> Copy Full Post + Hashtags`;
  }, 3000);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// ---- Gemini Helpers ----
async function filesToGeminiParts(files) {
  const parts = [];
  for (const file of files) {
    const b64 = await fileToBase64(file);
    parts.push({
      inline_data: {
        mime_type: file.type || 'image/jpeg',
        data: b64
      }
    });
  }
  return parts;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:image/...;base64,<data>
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---- UI Helpers ----
function setLoading(loading) {
  const btn = document.getElementById('generateBtn');
  const text = document.getElementById('generateBtnText');
  const spin = document.getElementById('generateBtnLoading');

  btn.disabled = loading;
  text.classList.toggle('hidden', loading);
  spin.classList.toggle('hidden', !loading);
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  toast.classList.remove('hidden');

  clearTimeout(showToast._timeout);
  showToast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3200);
}
