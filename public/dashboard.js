// dashboard.js — LinkedOut Pro Dashboard Logic

// ---- State ----
let currentMode       = 'single';
let selectedFiles     = [];
let currentIntent     = 'achievement';
let currentTone       = 'professional';
let currentPostId     = null;   // ID of the last generated/active draft
let currentPostText   = '';
let currentHashtags   = '';
let currentUser       = null;
let postsCache        = [];
let ppwValue          = 3;
let currentFilter     = 'all';

// ---- Init ----
window.addEventListener('DOMContentLoaded', async () => {
  await loadUser();
  await loadStats();
  await loadPosts();
  await loadSettings();
  setDefaultDateTime();
});

// ---- Load User ----
async function loadUser() {
  try {
    const res = await api('/api/auth/me');
    if (!res.user) { window.location.href = '/'; return; }
    currentUser = res.user;
    
    const uName = document.getElementById('userName');
    if (uName) uName.textContent = res.user.name;
    
    if (res.user.avatar_url) {
      ['userAvatar','mobileHeaderAvatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<img src="${res.user.avatar_url}" alt="${res.user.name}" />`;
      });
      // Also update LinkedIn preview card avatar
      const lkA = document.getElementById('lkAvatar');
      if (lkA) lkA.innerHTML = `<img src="${res.user.avatar_url}" alt="${res.user.name}" />`;
    }
    const lkN = document.getElementById('lkName');
    if (lkN) lkN.textContent = res.user.name;
  } catch (e) { 
    console.error('Failed to load user:', e);
    window.location.href = '/'; 
  }
}

// ---- Load Stats ----
async function loadStats() {
  try {
    const data = await api('/api/posts/stats/overview');
    
    // Update badge on sidebar queue icon
    const badge = document.getElementById('queueBadge');
    const total = (data.scheduled || 0) + (data.drafts || 0);
    if (total > 0) { badge.style.display = 'inline'; badge.textContent = total; }
    else badge.style.display = 'none';
  } catch (e) { console.warn('Could not load stats'); }
}
// ---- Native Analytics Sync (Modal) ----
function openSyncModal() {
  document.getElementById('syncModal').classList.remove('hidden');
  try {
    const d = JSON.parse(localStorage.getItem('linkedin_native_metrics') || '{}');
    document.getElementById('syncImpr').value = d.impressions || '';
    document.getElementById('syncFoll').value = d.followers || '';
    document.getElementById('syncView').value = d.viewers || '';
    document.getElementById('syncSrch').value = d.searches || '';
  } catch (e) {}
}

function closeSyncModal() {
  document.getElementById('syncModal').classList.add('hidden');
}

function saveSyncMetrics() {
  const impressions = parseInt(document.getElementById('syncImpr').value) || 0;
  const followers   = parseInt(document.getElementById('syncFoll').value) || 0;
  const viewers     = parseInt(document.getElementById('syncView').value) || 0;
  const searches    = parseInt(document.getElementById('syncSrch').value) || 0;

  localStorage.setItem('linkedin_native_metrics', JSON.stringify({ impressions, followers, viewers, searches }));
  
  // Immedate update
  document.getElementById('metric-impressions').textContent = impressions.toLocaleString();
  document.getElementById('metric-followers').textContent   = followers.toLocaleString();
  document.getElementById('metric-viewers').textContent     = viewers.toLocaleString();
  document.getElementById('metric-searches').textContent    = searches.toLocaleString();
  
  showToast('✓ Native analytics synced!');
  closeSyncModal();
}

// ---- Load Analytics (REAL LinkedIn Social Actions data) ----
async function loadAnalytics() {
  const list      = document.getElementById('topPostsList');

  // Show loading skeleton
  list.innerHTML = `<div class="kpi-loading">
    <div class="kpi-skeleton"></div><div class="kpi-skeleton"></div><div class="kpi-skeleton"></div>
  </div>`;

  try {
    const data = await api('/api/analytics/live');

    if (data.error === 'no_token') {
      list.innerHTML = `<div class="empty-state" style="padding:40px 20px">
        <div class="empty-icon">🔗</div>
        <div>Connect your LinkedIn account to see real analytics.</div>
      </div>`;
      return;
    }

    const posts  = data.posts  || [];
    const totals = data.totals || { likes: 0, comments: 0, posts: 0 };

    // Update top 4 native metrics
    try {
      const nativeStr = localStorage.getItem('linkedin_native_metrics');
      if (nativeStr) {
        const native = JSON.parse(nativeStr);
        document.getElementById('metric-impressions').textContent = (native.impressions || 0).toLocaleString();
        document.getElementById('metric-followers').textContent   = (native.followers || 0).toLocaleString();
        document.getElementById('metric-viewers').textContent     = (native.viewers || 0).toLocaleString();
        document.getElementById('metric-searches').textContent    = (native.searches || 0).toLocaleString();
      }
    } catch (e) { console.error('Error parsing native metrics', e); }

    // Render per-post breakdown
    if (posts.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:40px 20px">
        <div class="empty-icon">📊</div>
        <div>Publish your first post to start tracking engagement!</div>
      </div>`;
      return;
    }

    list.innerHTML = '';
    posts.slice(0, 8).forEach(p => {
      const date = p.published_at ? new Date(p.published_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const preview = (p.post_text || '').slice(0, 120) + (p.post_text?.length > 120 ? '…' : '');
      const isNative = p.native ? '<span class="q-tag" style="font-size:0.6rem">LinkedIn native</span>' : '';

      list.innerHTML += `
        <div class="kpi-row">
          <div class="kpi-post-left">
            <div class="kpi-post-text">${escapeHtml(preview)}</div>
            <div class="kpi-post-meta">${date ? `<span>${date}</span>` : ''}${isNative}</div>
          </div>
          <div class="kpi-metrics">
            <div class="kpi-metric" title="Likes">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
              <span>${p.likes.toLocaleString()}</span>
            </div>
            <div class="kpi-metric" title="Comments">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>${p.comments.toLocaleString()}</span>
            </div>
          </div>
        </div>`;
    });

    // Note about views
    const note = document.createElement('div');
    note.style.cssText = 'font-size:.7rem;color:var(--text-muted);margin-top:12px;padding:12px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid var(--border)';
    note.textContent = '⚠ LinkedIn\'s API does not expose personal post view counts. Likes & comments are real-time data.';
    list.appendChild(note);

  } catch (e) {
    list.innerHTML = `<div class="empty-state" style="padding:40px 20px;color:var(--text-muted)">
      Failed to load analytics: ${escapeHtml(e.message)}
    </div>`;
    console.error('Analytics load error:', e);
  }
}

// ---- Load Posts ----
async function loadPosts(filter = currentFilter) {
  try {
    const url = filter === 'all' ? '/api/posts' : `/api/posts?status=${filter}`;
    const data = await api(url);
    postsCache = data.posts || [];
    renderPostList(postsCache);
  } catch (e) { showToast('Failed to load posts', 'error'); }
}

function renderPostList(posts) {
  const list = document.getElementById('postList');
  if (!posts || posts.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div>Nothing here yet — forge your first post in the Studio.</div>
      </div>`;
    return;
  }

  const statusMeta = {
    draft:     { label: 'Draft',     icon: '✦', cls: 'draft' },
    scheduled: { label: 'Scheduled', icon: '⏱', cls: 'scheduled' },
    published: { label: 'Published', icon: '✓', cls: 'published' },
    failed:    { label: 'Failed',    icon: '✕', cls: 'failed' }
  };

  list.innerHTML = posts.map(post => {
    const s = statusMeta[post.status] || statusMeta.draft;
    const created   = new Date(post.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const scheduled = post.scheduled_at ? new Date(post.scheduled_at * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
    const published = post.published_at  ? new Date(post.published_at  * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

    const dateInfo = published ? `Published ${published}` : scheduled ? `Scheduled for ${scheduled}` : `Created ${created}`;
    const preview  = (post.post_text || '').slice(0, 200) + (post.post_text?.length > 200 ? '…' : '');
    const hashtags = (post.hashtags || '').split(/\s+/).filter(Boolean).slice(0, 6);

    const actions = [];
    if (post.status !== 'published') {
      actions.push(`<button class="q-btn primary" onclick="publishNowById('${post.id}')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
        Publish Now</button>`);
    }
    if (post.status === 'draft' || post.status === 'failed') {
      actions.push(`<button class="q-btn" onclick="editPost('${post.id}')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit</button>`);
    }
    if (post.status === 'scheduled') {
      actions.push(`<button class="q-btn" onclick="unschedulePost('${post.id}')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        Unschedule</button>`);
    }
    if (post.linkedin_post_id) {
      actions.push(`<a class="q-btn accent" href="https://www.linkedin.com/feed/" target="_blank">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>
        View on LinkedIn</a>`);
    }
    actions.push(`<button class="q-btn danger" onclick="deletePost('${post.id}')">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      Delete</button>`);

    return `
      <div class="q-card" id="postcard-${post.id}">
        <div class="q-card-top">
          <div class="q-status-row">
            <span class="q-badge ${s.cls}">${s.icon} ${s.label}</span>
            ${post.intent ? `<span class="q-tag">${post.intent}</span>` : ''}
            ${post.tone   ? `<span class="q-tag">${post.tone}</span>`   : ''}
          </div>
          <span class="q-date">${dateInfo}</span>
        </div>
        <div class="q-body">${escapeHtml(preview)}</div>
        ${hashtags.length ? `<div class="q-hashtags">${hashtags.map(h => `<span class="q-hash">${escapeHtml(h)}</span>`).join('')}</div>` : ''}
        <div class="q-actions">${actions.join('')}</div>
      </div>`;
  }).join('');
}

function filterPosts(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadPosts(filter);
}

// ---- Load Settings ----
async function loadSettings() {
  try {
    const data = await api('/api/settings');
    const s = data.settings;
    if (!s) return;

    document.getElementById('autoPostToggle').checked    = Boolean(s.auto_post_enabled);
    document.getElementById('preferredHour').value       = s.preferred_time_hour ?? 9;
    ppwValue = s.posts_per_week || 3;
    document.getElementById('ppwDisplay').textContent    = ppwValue;

    // Mark day buttons
    const activeDays = (s.preferred_days || '').split(',').map(d => d.trim().toLowerCase());
    document.querySelectorAll('.day-btn').forEach(btn => {
      btn.classList.toggle('active', activeDays.includes(btn.dataset.day));
    });
    document.querySelectorAll('.day-btn').forEach(btn => {
      btn.onclick = () => { btn.classList.toggle('active'); };
    });
  } catch {}
}

async function saveSettings(showFeedback = false) {
  const activeDays = [...document.querySelectorAll('.day-btn.active')]
    .map(b => b.dataset.day).join(',') || 'monday,wednesday,friday';

  try {
    await api('/api/settings', 'PATCH', {
      autoPostEnabled:  document.getElementById('autoPostToggle').checked,
      preferredTimeHour: parseInt(document.getElementById('preferredHour').value),
      postsPerWeek:     ppwValue,
      preferredDays:    activeDays
    });
    if (showFeedback) showToast('✓ Settings saved', 'success');
  } catch { showToast('Failed to save settings', 'error'); }
}

function adjustPPW(delta) {
  ppwValue = Math.max(1, Math.min(7, ppwValue + delta));
  document.getElementById('ppwDisplay').textContent = ppwValue;
  saveSettings();
}

// ---- Mode Toggle ----
function setMode(mode) {
  currentMode  = mode;
  selectedFiles = [];
  renderPreviewStrip();
  document.getElementById('singleBtn').classList.toggle('active', mode === 'single');
  document.getElementById('eventBtn').classList.toggle('active', mode !== 'single');

  const fi = document.getElementById('fileInput');
  if (fi) fi.multiple = mode === 'event';

  const txt = document.getElementById('uploadText');
  if (txt) txt.textContent = mode === 'single' ? 'Drop Visuals' : 'Drop images (multiple)';

  const lbl = document.getElementById('contextLabel');
  if (lbl) {
    lbl.innerHTML = mode === 'event'
      ? `Event description <span class="optional">(recommended)</span>`
      : `Image context <span class="optional">(optional)</span>`;
  }

  const out = document.getElementById('outputSection');
  if (out) out.classList.remove('hidden');
}

// ---- Drag & Drop ----
function handleDragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('dragover'); }
function handleDragLeave()  { document.getElementById('uploadZone').classList.remove('dragover'); }
function handleDrop(e) {
  e.preventDefault(); handleDragLeave();
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  addFiles(files);
}
function handleFileSelect(e) {
  addFiles(Array.from(e.target.files).filter(f => f.type.startsWith('image/')));
  e.target.value = '';
}

function addFiles(files) {
  selectedFiles = [...selectedFiles, ...files].slice(0, 10);
  renderPreviewStrip();
}

function removeFile(idx) { selectedFiles.splice(idx, 1); renderPreviewStrip(); }

function renderPreviewStrip() {
  const strip = document.getElementById('previewStrip');
  strip.innerHTML = '';
  selectedFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const div = document.createElement('div');
    div.className = 'preview-thumb';
    div.innerHTML = `<img src="${url}" /><button class="remove-thumb" onclick="removeFile(${idx})">✕</button>`;
    strip.appendChild(div);
  });
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
  if (selectedFiles.length === 0) { showToast('Please upload at least one image', 'error'); return; }
  setGenLoading(true);

  try {
    const context = document.getElementById('contextInput').value.trim();

    if (currentMode === 'single') {
      if (selectedFiles.length > 1) {
        showToast(`⚙️ Forging ${selectedFiles.length} separate posts sequentially...`);
      }

      const results = [];
      for (const f of selectedFiles) {
        const formData = new FormData();
        formData.append('images', f);
        formData.append('context', context);
        formData.append('intent', currentIntent);
        formData.append('tone', currentTone);

        const res = await fetch('/api/analyze/generate', { method: 'POST', body: formData, credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Generation failed');
        results.push(data);
      }

      const first = results[0];
      currentPostId   = first.postId;
      currentPostText = first.postText;
      currentHashtags = first.hashtags;
      displayPost(first.postText, first.hashtags);

      if (results.length > 1) showToast(`✓ ${results.length} posts forged and saved to queue!`, 'success');
      else showToast('✓ Post generated and saved to draft!', 'success');

    } else {
      // Event Mode: 1 post, multiple images
      const formData = new FormData();
      selectedFiles.forEach(f => formData.append('images', f));
      formData.append('context', context);
      formData.append('intent',  currentIntent);
      formData.append('tone',    currentTone);

      const res = await fetch('/api/analyze/generate', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      currentPostId   = data.postId;
      currentPostText = data.postText;
      currentHashtags = data.hashtags;
      displayPost(data.postText, data.hashtags);
      showToast('✓ Event post generated and saved to draft!', 'success');
    }

    loadStats();
    loadPosts();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setGenLoading(false);
  }
}

async function regenerate() { await generatePost(); }

function displayPost(text, hashtags) {
  const editPost = document.getElementById('editPost');
  editPost.value = text;
  
  // Defer measurement until after browser renders the new value
  requestAnimationFrame(() => {
    editPost.style.height = 'auto';
    editPost.style.height = Math.max(editPost.scrollHeight, 80) + 'px';
  });

  // Live resize on typing
  editPost.oninput = function() {
    syncPreview();
    this.style.height = 'auto';
    this.style.height = Math.max(this.scrollHeight, 80) + 'px';
  };

  // Show hashtags
  const hashWrap = document.getElementById('postHashtagsWrap');
  const hashInput = document.getElementById('editHashtags');
  if (hashtags && hashtags.trim()) {
    hashInput.value = hashtags;
    hashWrap.classList.remove('hidden');
  } else {
    hashInput.value = '';
    hashWrap.classList.add('hidden');
  }

  // Image preview
  const preview = document.getElementById('lkImagePreview');
  preview.innerHTML = '';
  preview.className = 'lk-media';
  if (selectedFiles.length === 1) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(selectedFiles[0]);
    preview.appendChild(img);
  } else if (selectedFiles.length > 1) {
    preview.classList.add('grid2');
    selectedFiles.slice(0, 4).forEach(f => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      preview.appendChild(img);
    });
  }

  const actions = document.getElementById('previewActions');
  if (actions) actions.classList.remove('hidden');
}





function syncPreview() {
  const val = document.getElementById('editPost').value;
  currentPostText = val;
  if (!val && !currentPostText) document.getElementById('previewActions')?.classList.add('hidden');
  else document.getElementById('previewActions')?.classList.remove('hidden');
  updatePostDraft();
}
function syncHashtags() {
  const val = document.getElementById('editHashtags').value;
  currentHashtags = val;
  updatePostDraft();
}

let _updateTimer;
function updatePostDraft() {
  if (!currentPostText && !currentHashtags) return; // wait to type something
  clearTimeout(_updateTimer);
  _updateTimer = setTimeout(async () => {
    try {
      if (currentPostId) {
        await api(`/api/posts/${currentPostId}`, 'PATCH', {
          postText: currentPostText, hashtags: currentHashtags
        });
      } else {
        const res = await api('/api/posts', 'POST', {
          postText: currentPostText, hashtags: currentHashtags, intent: 'manual'
        });
        currentPostId = res.post.id;
        loadStats();
      }
    } catch (e) { console.warn('Auto-save err:', e); }
  }, 1200);
}

// ---- Copy ----
async function copyFull() {
  const full = `${currentPostText}\n\n${currentHashtags}`.trim();
  await navigator.clipboard.writeText(full).catch(() => {});
  showToast('✓ Copied to clipboard!', 'success');
}

// ---- Schedule ----
function setDefaultDateTime() {
  const el = document.getElementById('scheduleDate');
  if (!el) return;
  const d = new Date(); d.setDate(d.getDate() + 1);
  let hourStr = document.getElementById('preferredHour')?.value || '9';
  let hour = parseInt(hourStr);
  if (hour === -1) {
    const optimal = [8, 9, 11, 12, 15, 17];
    hour = optimal[(d.getDate() + d.getMonth()) % optimal.length];
  }
  d.setHours(hour, 0, 0, 0);
  // Avoid local timezone shift issues by explicitly building YYYY-MM-DDTHH:mm
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  el.value = `${y}-${m}-${day}T${h}:00`;
}

async function schedulePost() {
  if (!currentPostId) { showToast('Generate a post first', 'error'); return; }
  const dt = document.getElementById('scheduleDate').value;
  if (!dt) { showToast('Pick a date and time', 'error'); return; }

  try {
    await api(`/api/posts/${currentPostId}/schedule`, 'POST', { scheduledAt: new Date(dt).toISOString() });
    showToast('✓ Post scheduled!', 'success');
    loadStats(); loadPosts();
  } catch (e) { showToast(e.message, 'error'); }
}

async function smartSchedule() {
  if (!currentPostId) { showToast('Generate a post first', 'error'); return; }
  showToast('🧠 Getting smart schedule suggestion...');
  try {
    const data = await api('/api/analyze/smart-schedule', 'POST', { postIds: [currentPostId] });
    if (data.schedule && data.schedule[0]?.suggestedDate) {
      let hourStr = document.getElementById('preferredHour')?.value || '9';
      let hour = parseInt(hourStr);
      if (hour === -1) {
        const optimal = [8, 9, 11, 12, 15, 17];
        const dScore = new Date(data.schedule[0].suggestedDate);
        hour = optimal[(dScore.getDate() + dScore.getMonth()) % optimal.length];
      }
      const hStr = String(hour).padStart(2, '0');
      document.getElementById('scheduleDate').value = `${data.schedule[0].suggestedDate}T${hStr}:00`;
      showToast(`🧠 Suggested: ${data.schedule[0].suggestedDate} at ${hStr}:00 — ${data.schedule[0].reason}`, 'success');
    }
  } catch (e) { showToast(e.message, 'error'); }
}

async function publishNow() {
  if (!currentPostId) { showToast('Generate a post first', 'error'); return; }
  if (!confirm('Publish this post to LinkedIn RIGHT NOW?')) return;
  try {
    await api(`/api/posts/${currentPostId}/publish-now`, 'POST');
    showToast('🚀 Published to LinkedIn!', 'success');
    loadStats(); loadPosts();
    document.getElementById('outputSection').classList.add('hidden');
    switchTab('queue', document.querySelector('[data-tab="queue"]'));
  } catch (e) { showToast(e.message, 'error'); }
}

async function publishNowById(id) {
  if (!confirm('Publish this post to LinkedIn RIGHT NOW?')) return;
  try {
    await api(`/api/posts/${id}/publish-now`, 'POST');
    showToast('🚀 Published!', 'success');
    loadStats(); loadPosts(currentFilter);
  } catch (e) { showToast(e.message, 'error'); }
}

async function unschedulePost(id) {
  try {
    await api(`/api/posts/${id}/unschedule`, 'POST');
    showToast('↩ Moved back to drafts');
    loadStats(); loadPosts(currentFilter);
  } catch (e) { showToast(e.message, 'error'); }
}

async function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  try {
    await api(`/api/posts/${id}`, 'DELETE');
    showToast('🗑 Post deleted');
    loadStats(); loadPosts(currentFilter);
  } catch (e) { showToast(e.message, 'error'); }
}

function editPost(id) {
  const post = postsCache.find(p => p.id === id);
  if (!post) return;
  currentPostId   = post.id;
  currentPostText = post.post_text;
  currentHashtags = post.hashtags;
  displayPost(post.post_text, post.hashtags);
  switchTab('create', document.querySelector('[data-tab="create"]'));
}

// ---- Navigation ----
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => n.classList.remove('active'));
  
  const targetTab = document.getElementById(`tab-${tab}`);
  if (targetTab) targetTab.classList.add('active');
  
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));
  
  closeSidebar();
  if (tab === 'queue') { loadPosts(currentFilter); loadStats(); }
  if (tab === 'analytics') { loadAnalytics(); }
}

function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const ovl = document.getElementById('sidebarOverlay');
  sb.classList.toggle('open');
  ovl.classList.toggle('hidden');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.add('hidden');
}

// ---- Auth ----
async function logout() {
  await api('/api/auth/logout', 'POST').catch(() => {});
  window.location.href = '/';
}

// ---- Helpers ----
async function api(url, method = 'GET', body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setGenLoading(on) {
  document.getElementById('generateBtn').disabled = on;
  document.getElementById('genBtnText').classList.toggle('hidden', on);
  document.getElementById('genBtnLoading').classList.toggle('hidden', !on);
}

let _toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
