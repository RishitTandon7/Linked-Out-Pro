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
        temperature: 1.0,
        maxOutputTokens: 800
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
  const intentMap = {
    achievement: 'Achievement (won award, completed milestone, certification)',
    announcement: 'Announcement (new role, new project, launch)',
    storytelling: 'Storytelling (journey, lesson learned, experience)',
    motivation: 'Motivation (insight, advice, encouragement)',
    showcase: 'Product / Work Showcase'
  };
  const toneMap = {
    professional: 'Professional, confident, polished',
    casual: 'Casual and conversational, yet smart',
    bold: 'Bold, direct, high-energy',
    humble: 'Humble, grateful, grounded'
  };

  return `You are an expert LinkedIn content creator and personal branding strategist.

${imageCount === 1
    ? 'Analyze the provided image carefully.'
    : `Analyze all ${imageCount} provided event photos carefully.`
  }
${context ? `\nAdditional context from the user: "${context}"` : ''}

Create a LinkedIn post with the following specifications:
- Intent: ${intentMap[currentIntent]}
- Tone: ${toneMap[currentTone]}
- Start with a strong, scroll-stopping hook (first line must grab attention)
- Professional yet human—no corporate-speak
- Use storytelling or insight where applicable
- Keep paragraphs short (1-3 sentences max per paragraph)
- Include 1-2 relevant emojis (not excessive, no emoji dumps)
- Word count: 100-180 words for the main post body
- Add value: lesson, insight, or clear takeaway
- NEVER start with "I am happy to share" or "Excited to announce" or similar clichés
- Do NOT include hashtags in the post body itself

Then provide 4-6 highly relevant hashtags on a separate line.

IMPORTANT: Output EXACTLY in this format with no extra text before or after:

POST:
[Your LinkedIn post here]

HASHTAGS:
[#tag1 #tag2 #tag3 #tag4 #tag5]`;
}

// ---- Parse Response ----
function parseAndDisplayPost(raw) {
  let postText = '';
  let hashtagsText = '';

  const postMatch = raw.match(/POST:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
  const hashMatch = raw.match(/HASHTAGS:\s*([\s\S]*?)$/i);

  postText = postMatch ? postMatch[1].trim() : raw.trim();
  hashtagsText = hashMatch ? hashMatch[1].trim() : '';

  // Ensure hashtags have # prefix
  if (hashtagsText && !hashtagsText.startsWith('#')) {
    hashtagsText = hashtagsText.split(/\s+/).map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
  }

  lastGeneratedPost = postText;
  lastGeneratedHashtags = hashtagsText;

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
