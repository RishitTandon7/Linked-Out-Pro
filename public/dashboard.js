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
let multiPostResults  = [];     // All generated results in single-mode multi-image
let multiPostIndex    = 0;      // Which result is currently shown

// ---- Init ----
window.addEventListener('DOMContentLoaded', async () => {
  await loadUser();
  await loadStats();
  await loadPosts();
  await loadSettings();
  setDefaultDateTime();
  updateNotifButtonState();  // Reflect current notification permission in Settings
  startOnboarding();  // Show walkthrough for first-time users
});

// ========================
// ONBOARDING WALKTHROUGH
// ========================
let _obStep = 0;
const OB_STEPS = 4;

function startOnboarding() {
  // Only show once per user — keyed by userId when available
  const key = 'lop_onboarded_' + (currentUser?.id || 'guest');
  if (localStorage.getItem(key)) return;
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  _obStep = 0;
  _renderObStep();
  // Show PWA install button if prompt is already available
  if (typeof deferredPrompt !== 'undefined' && deferredPrompt) {
    const btn = document.getElementById('obInstallBtn');
    if (btn) btn.style.display = 'flex';
    const alt = document.getElementById('obInstallAlt');
    if (alt) alt.style.display = 'none';
  }
}

function _renderObStep() {
  document.querySelectorAll('.ob-step').forEach((el, i) => el.classList.toggle('active', i === _obStep));
  document.querySelectorAll('.ob-dot').forEach((el, i) => el.classList.toggle('active', i === _obStep));
  const isLast = _obStep === OB_STEPS - 1;
  // Step 0 = welcome → next button says "Start Tour"
  const isWelcome = _obStep === 0;
  document.getElementById('obNextLabel').textContent = isWelcome ? 'Start Tour →' : (isLast ? 'Start Creating →' : 'Next');
  document.getElementById('obSkipBtn').style.display = isLast ? 'none' : 'inline-block';
  if (_obStep === 3 && typeof deferredPrompt !== 'undefined' && deferredPrompt) {
    const btn = document.getElementById('obInstallBtn');
    if (btn) btn.style.display = 'flex';
    const alt = document.getElementById('obInstallAlt');
    if (alt) alt.style.display = 'none';
  }
}

function nextOnboardingStep() {
  // Step 0 (Welcome) → launch live tour instead of next static step
  if (_obStep === 0) { closeOnboarding(); startLiveTour(); return; }
  if (_obStep < OB_STEPS - 1) { _obStep++; _renderObStep(); }
  else closeOnboarding();
}

function skipOnboarding() { closeOnboarding(); }

function closeOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (overlay) {
    overlay.style.opacity = '0';
    overlay.style.transform = 'scale(0.97)';
    overlay.style.transition = 'all 0.3s ease';
    setTimeout(() => overlay.classList.add('hidden'), 300);
  }
  localStorage.setItem('lop_onboarded_' + (currentUser?.id || 'guest'), '1');
}

async function onboardingEnableNotifications() {
  const btn = document.getElementById('obEnableNotifBtn');
  const hint = document.getElementById('obNotifSkipHint');
  if (btn) { btn.disabled = true; btn.textContent = 'Requesting...'; }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      if (btn) {
        btn.classList.add('done');
        btn.innerHTML = '<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg> Notifications Enabled!';
        btn.disabled = false;
      }
      if (hint) hint.textContent = "You'll get notified when posts go live ✓";
      if (typeof initPushNotifications === 'function') initPushNotifications();
      setTimeout(() => nextOnboardingStep(), 1200);
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Permission Denied — Skip'; }
      if (hint) hint.textContent = 'You can enable notifications later in browser settings';
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Not Available — Skip'; }
  }
}

async function onboardingInstallApp() {
  if (typeof deferredPrompt !== 'undefined' && deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    const btn = document.getElementById('obInstallBtn');
    if (outcome === 'accepted' && btn) {
      btn.classList.add('done');
      btn.innerHTML = '<svg width="18" height="18" fill="none" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg> Installed!';
      setTimeout(() => closeOnboarding(), 1000);
    }
  }
}

// ---- Push Notification Permission ----
async function requestNotificationPermission() {
  const btn  = document.getElementById('notifEnableBtn');
  const desc = document.getElementById('notifSettingDesc');
  if (!btn) return;

  if (!('Notification' in window)) {
    if (desc) desc.textContent = 'Notifications not supported in this browser';
    return;
  }
  if (Notification.permission === 'granted') {
    showToast('Notifications already enabled ✓', 'success');
    updateNotifButtonState();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Requesting...';

  try {
    if (typeof initPushNotifications === 'function') {
      await initPushNotifications();
    }
    updateNotifButtonState();
    if (Notification.permission === 'granted') {
      showToast('🔔 Notifications enabled! You\'ll be notified when posts publish.', 'success');
    } else {
      showToast('Notification permission was denied', 'error');
    }
  } catch (e) {
    showToast('Could not enable notifications: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function updateNotifButtonState() {
  const btn  = document.getElementById('notifEnableBtn');
  const desc = document.getElementById('notifSettingDesc');
  if (!btn) return;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  if (perm === 'granted') {
    btn.innerHTML = `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12" stroke-linecap="round"/></svg> Enabled`;
    btn.style.opacity = '0.6';
    btn.style.cursor = 'default';
    btn.onclick = null;
    if (desc) desc.textContent = 'You\'ll be notified when posts publish or fail';
  } else if (perm === 'denied') {
    btn.textContent = 'Blocked';
    btn.style.opacity = '0.5';
    if (desc) desc.textContent = 'Blocked by browser — allow in site settings to enable';
  }
}

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

// ---- Analytics Refresh (live LinkedIn data) ----
async function openSyncModal() {
  // No modal: just re-fetch live data
  await loadAnalytics();
}

// ---- Load Analytics (REAL LinkedIn Social Actions data) ----
async function loadAnalytics() {
  const list      = document.getElementById('topPostsList');
  const syncBtn   = document.querySelector('[onclick="openSyncModal()"]');

  // Show loading state
  if (syncBtn) { syncBtn.disabled = true; syncBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg> Loading...`; }
  list.innerHTML = `<div style="display:flex;gap:12px;padding:20px 0">${[1,2,3].map(() => `<div class="kpi-skeleton" style="height:60px;border-radius:12px;flex:1"></div>`).join('')}</div>`;

  // Reset stat cards to loading state
  ['metric-impressions','metric-followers','metric-viewers','metric-searches'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '…';
  });

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

    // ---- Real stat cards from live data ----
    // LinkedIn personal API doesn't expose impressions/followers/viewers/searches.
    // We use what IS available: total likes, total comments, total posts published, last post date.
    const totalPosts    = totals.posts;
    const totalLikes    = totals.likes;
    const totalComments = totals.comments;
    const lastPost = posts.length > 0 && posts[0].published_at
      ? new Date(posts[0].published_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—';

    document.getElementById('metric-impressions').textContent = totalLikes.toLocaleString();
    document.getElementById('metric-followers').textContent   = totalComments.toLocaleString();
    document.getElementById('metric-viewers').textContent     = totalPosts.toLocaleString();
    document.getElementById('metric-searches').textContent    = lastPost;

    // Update labels to match real data
    const labels = document.querySelectorAll('.stat-card .stat-label');
    const trends = document.querySelectorAll('.stat-card .stat-trend');
    if (labels[0]) labels[0].textContent = 'Total Likes';
    if (labels[1]) labels[1].textContent = 'Total Comments';
    if (labels[2]) labels[2].textContent = 'Posts Published';
    if (labels[3]) labels[3].textContent = 'Latest Post';
    if (trends[0]) trends[0].textContent = 'real-time from LinkedIn';
    if (trends[1]) trends[1].textContent = 'real-time from LinkedIn';
    if (trends[2]) trends[2].textContent = 'via this app + LinkedIn';
    if (trends[3]) trends[3].textContent = data.meta?.fetchedAt ? 'Synced ' + new Date(data.meta.fetchedAt).toLocaleTimeString() : '';

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
      const isNative = p.native ? `<span class="q-tag" style="font-size:0.6rem">LinkedIn native</span>` : '';

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
    note.textContent = '⚠ LinkedIn\'s personal API does not expose impressions, followers, or profile views. Showing real-time likes & comments.';
    list.appendChild(note);

  } catch (e) {
    list.innerHTML = `<div class="empty-state" style="padding:40px 20px;color:var(--text-muted)">
      Failed to load analytics: ${escapeHtml(e.message)}
    </div>`;
    console.error('Analytics load error:', e);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg> Refresh`;
    }
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
      actions.push(`<button class="q-btn accent" onclick="openScheduleFromQueue('${post.id}')">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Schedule</button>`);
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

    document.getElementById('autoPostToggle').checked = Boolean(s.auto_post_enabled);
    ppwValue = s.posts_per_week || 3;
    document.getElementById('ppwDisplay').textContent = ppwValue;

    // Sync custom Prime Time dropdown
    const hourVal = String(s.preferred_time_hour ?? 9);
    const labels = { '-1': 'Let Agent Decide ✨', '8': '8:00 AM', '9': '9:00 AM', '12': '12:00 PM', '18': '6:00 PM' };
    document.getElementById('preferredHour').value = hourVal;
    const labelEl = document.getElementById('preferredHourLabel');
    if (labelEl) labelEl.textContent = labels[hourVal] || '9:00 AM';
    // Mark active option
    document.querySelectorAll('#preferredHourDrop .custom-select-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.value === hourVal);
    });

    // Mark day buttons
    const activeDays = (s.preferred_days || '').split(',').map(d => d.trim().toLowerCase());
    document.querySelectorAll('.day-btn').forEach(btn => {
      btn.classList.toggle('active', activeDays.includes(btn.dataset.day));
    });
    document.querySelectorAll('.day-btn').forEach(btn => {
      btn.onclick = () => {
        btn.classList.toggle('active');
        saveSettings(true);
      };
    });
  } catch {}
}

// ---- Custom Select Dropdown ----
function toggleCustomSelect(id) {
  const el = document.getElementById(id);
  const isOpen = el.classList.contains('open');
  // Close all other open selects
  document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
  if (!isOpen) el.classList.add('open');
}

function selectCustomOption(dropId, value, label) {
  const drop = document.getElementById(dropId);
  // Update hidden input
  const hidden = drop.querySelector('input[type=hidden]');
  if (hidden) hidden.value = value;
  // Update label
  const labelEl = drop.querySelector('.custom-select-trigger span');
  if (labelEl) labelEl.textContent = label;
  // Mark active
  drop.querySelectorAll('.custom-select-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.value === value);
  });
  // Close
  drop.classList.remove('open');
  // Save settings
  saveSettings(true);
}

// Close custom dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select')) {
    document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
  }
});

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

  const txt = document.getElementById('uploadText');
  if (txt) txt.textContent = mode === 'single' ? 'Drop images — each becomes a separate post' : 'Drop images — all combined into one post';

  const lbl = document.getElementById('contextLabel');
  if (lbl) {
    lbl.innerHTML = mode === 'event'
      ? `Event description <span class="optional">(recommended)</span>`
      : `Image context <span class="optional">(optional)</span>`;
  }

  const out = document.getElementById('outputSection');
  if (out) out.classList.remove('hidden');

  updateForgeButton();
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
  updateForgeButton();
}

function removeFile(idx) { selectedFiles.splice(idx, 1); renderPreviewStrip(); updateForgeButton(); }

// ---- Update forge button + banner to reflect current mode & file count ----
function updateForgeButton() {
  const n = selectedFiles.length;
  const btnText = document.getElementById('genBtnText');
  const banner  = document.getElementById('modeBannerText');
  if (!btnText) return;

  if (currentMode === 'single') {
    if (n === 0) {
      btnText.textContent = 'Forge Post';
      if (banner) banner.textContent = 'Each image will generate its own separate LinkedIn post';
    } else if (n === 1) {
      btnText.textContent = 'Forge 1 Post';
      if (banner) banner.textContent = '1 image selected → 1 LinkedIn post will be created';
    } else {
      btnText.textContent = `Forge ${n} Separate Posts`;
      if (banner) banner.textContent = `${n} images selected → ${n} separate LinkedIn posts will be created (one per image)`;
    }
  } else {
    if (n <= 1) {
      btnText.textContent = 'Forge 1 Post';
      if (banner) banner.textContent = 'All images will be combined into one single LinkedIn post';
    } else {
      btnText.textContent = `Forge 1 Post (${n} images)`;
      if (banner) banner.textContent = `${n} images selected → combined into 1 single LinkedIn post`;
    }
  }
}

function renderPreviewStrip() {
  const strip = document.getElementById('previewStrip');
  strip.innerHTML = '';
  selectedFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const div = document.createElement('div');
    div.className = 'preview-thumb';
    div.innerHTML = `<img src="${url}" />
      <button class="remove-thumb" onclick="removeFile(${idx})">✕</button>
      <button class="edit-thumb" onclick="openImgEditor(${idx})" title="Edit image">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>`;
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
      for (let i = 0; i < selectedFiles.length; i++) {
        const f = selectedFiles[i];
        const formData = new FormData();
        formData.append('images', f);
        formData.append('context', context);
        formData.append('intent', currentIntent);
        formData.append('tone', currentTone);

        const res = await fetch('/api/analyze/generate', { method: 'POST', body: formData, credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Generation failed');
        // Store the corresponding file index so we know which preview image to show
        results.push({ ...data, fileIndex: i });
      }

      multiPostResults = results;
      multiPostIndex   = 0;

      // Show the first result
      const first = results[0];
      currentPostId   = first.postId;
      currentPostText = first.postText;
      currentHashtags = first.hashtags;

      // Temporarily set selectedFiles to just this image for the preview
      const savedFiles = selectedFiles;
      selectedFiles = [savedFiles[first.fileIndex]];
      displayPost(first.postText, first.hashtags);
      selectedFiles = savedFiles;

      // Render multi-post navigator if more than one result
      renderMultiPostNav(results, 0);

      if (results.length > 1) {
        // Multiple posts — auto-schedule all and send to Queue
        showToast(`✓ ${results.length} posts forged! Auto-scheduling all...`, 'success');
        for (const r of results) await autoSchedulePost(r.postId, false);
        resetStudio();
        switchTab('queue', document.querySelector('[data-tab="queue"]'));
      } else {
        // Single post — stay in Studio, let the user decide (Schedule / Publish Now / Retry)
        showToast('✓ Post forged! Review it and choose to Schedule or Publish Now.', 'success');
      }

    } else {
      // Event Mode: 1 post, multiple images — stay in Studio for user decision
      const formData = new FormData();
      selectedFiles.forEach(f => formData.append('images', f));
      formData.append('context', context);
      formData.append('intent',  currentIntent);
      formData.append('tone',    currentTone);

      const res = await fetch('/api/analyze/generate', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      multiPostResults = [];
      multiPostIndex   = 0;
      currentPostId   = data.postId;
      currentPostText = data.postText;
      currentHashtags = data.hashtags;
      displayPost(data.postText, data.hashtags);
      removeMultiPostNav();
      showToast('✓ Event post forged! Review it and choose to Schedule or Publish Now.', 'success');
    }

    loadStats();
    loadPosts();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setGenLoading(false);
  }
}

// ---- Multi-post navigator (shown when single-mode generates N posts) ----
function renderMultiPostNav(results, idx) {
  // Remove any existing navigator
  removeMultiPostNav();
  if (results.length <= 1) return;

  const actions = document.getElementById('previewActions');
  if (!actions) return;

  const nav = document.createElement('div');
  nav.id = 'multiPostNav';
  nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:8px;padding:8px 0;border-bottom:1px solid var(--border)';
  nav.innerHTML = `
    <button class="action-btn-line" id="multiPrevBtn" onclick="navigateMultiPost(-1)" style="padding:6px 14px;font-size:0.8rem">← Prev</button>
    <span id="multiPostCounter" style="font-size:0.78rem;color:var(--text-muted);font-weight:600">Post ${idx + 1} of ${results.length}</span>
    <button class="action-btn-line" id="multiNextBtn" onclick="navigateMultiPost(1)" style="padding:6px 14px;font-size:0.8rem">Next →</button>
  `;
  actions.parentNode.insertBefore(nav, actions);
  updateMultiNavButtons(idx, results.length);
}

function removeMultiPostNav() {
  const existing = document.getElementById('multiPostNav');
  if (existing) existing.remove();
}

function updateMultiNavButtons(idx, total) {
  const prev = document.getElementById('multiPrevBtn');
  const next = document.getElementById('multiNextBtn');
  const counter = document.getElementById('multiPostCounter');
  if (prev) prev.disabled = (idx === 0);
  if (next) next.disabled = (idx === total - 1);
  if (counter) counter.textContent = `Post ${idx + 1} of ${total}`;
}

function navigateMultiPost(delta) {
  const results = multiPostResults;
  if (!results || results.length === 0) return;
  const newIdx = Math.max(0, Math.min(results.length - 1, multiPostIndex + delta));
  if (newIdx === multiPostIndex) return;
  multiPostIndex = newIdx;

  const r = results[newIdx];
  currentPostId   = r.postId;
  currentPostText = r.postText;
  currentHashtags = r.hashtags;

  // Show only this image in the preview
  const savedFiles = selectedFiles;
  selectedFiles = [savedFiles[r.fileIndex]];
  displayPost(r.postText, r.hashtags);
  selectedFiles = savedFiles;

  updateMultiNavButtons(newIdx, results.length);
}

async function regenerate() { await generatePost(); }

function displayPost(text, hashtags, serverImages = []) {
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
  
  const previewUrls = [];
  if (selectedFiles && selectedFiles.length > 0) {
    selectedFiles.forEach(f => previewUrls.push(URL.createObjectURL(f)));
  } else if (serverImages && serverImages.length > 0) {
    serverImages.forEach(img => {
      previewUrls.push(img.storage_url || ('/uploads/' + img.filename));
    });
  }

  if (previewUrls.length === 1) {
    const img = document.createElement('img');
    img.src = previewUrls[0];
    preview.appendChild(img);
  } else if (previewUrls.length > 1) {
    preview.classList.add('grid2');
    previewUrls.slice(0, 4).forEach(src => {
      const img = document.createElement('img');
      img.src = src;
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

// ---- Reset Studio to a clean slate ----
function resetStudio() {
  // Clear file state
  selectedFiles     = [];
  multiPostResults  = [];
  multiPostIndex    = 0;
  currentPostId     = null;
  currentPostText   = '';
  currentHashtags   = '';

  // Reset UI
  renderPreviewStrip();
  removeMultiPostNav();
  updateForgeButton();

  // Hide preview panel
  const out = document.getElementById('outputSection');
  if (out) out.classList.add('hidden');
  const actions = document.getElementById('previewActions');
  if (actions) actions.classList.add('hidden');

  // Clear editor
  const editPost = document.getElementById('editPost');
  if (editPost) { editPost.value = ''; editPost.style.height = 'auto'; }
  const editHashtags = document.getElementById('editHashtags');
  if (editHashtags) editHashtags.value = '';
  const hashWrap = document.getElementById('postHashtagsWrap');
  if (hashWrap) hashWrap.classList.add('hidden');

  // Clear context textarea
  const ctx = document.getElementById('contextInput');
  if (ctx) ctx.value = '';

  // Clear image preview in LinkedIn card
  const lkImg = document.getElementById('lkImagePreview');
  if (lkImg) { lkImg.innerHTML = ''; lkImg.className = 'lk-media'; }

  // Reset file input elements so same file can be re-selected
  ['singleFileInput','eventFileInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// ---- Auto-Schedule (uses user's saved settings, no user input needed) ----
async function autoSchedulePost(postId, redirectToQueue = true) {
  if (!postId) return;
  try {
    // Read user's preferred settings from the UI (already loaded when settings tab renders)
    const hourVal = parseInt(document.getElementById('preferredHour')?.value ?? '9');
    const hour = (isNaN(hourVal) || hourVal === -1)
      ? [8, 9, 11, 12, 15, 17][Math.floor(Math.random() * 6)] // optimal hours if "Let Agent Decide"
      : hourVal;

    // Read preferred days (highlighted day buttons in Settings)
    const dayNameToNum = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const preferredDays = new Set();
    document.querySelectorAll('.day-btn.active').forEach(btn => {
      const d = dayNameToNum[btn.dataset.day];
      if (d !== undefined) preferredDays.add(d);
    });
    // Fallback to Mon/Wed/Fri if none set
    if (preferredDays.size === 0) [1, 3, 5].forEach(d => preferredDays.add(d));

    // Find the next slot that lands on a preferred day and is at least a few hours from now,
    // also respects posts_per_week by checking how many are already scheduled this week
    const now = new Date();
    let candidate = new Date(now);
    candidate.setHours(hour, 0, 0, 0);
    // Move to tomorrow if the time today has passed
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);

    // Walk forward until we land on a preferred day (max 14 day scan)
    let safety = 0;
    while (!preferredDays.has(candidate.getDay()) && safety < 14) {
      candidate.setDate(candidate.getDate() + 1);
      safety++;
    }

    const scheduledAtSec = Math.floor(candidate.getTime() / 1000);

    await api(`/api/posts/${postId}/schedule`, 'POST', { scheduledAt: scheduledAtSec });

    const label = candidate.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    showToast(`📅 Sent to queue — scheduled for ${label}`, 'success');

    loadStats(); loadPosts();

    // Clear the Studio and navigate to Queue so the user sees their scheduled post
    if (redirectToQueue) {
      resetStudio();
      switchTab('queue', document.querySelector('[data-tab="queue"]'));
    }
  } catch (e) {
    // Don't block UI — just log; post remains a draft
    console.warn('Auto-schedule failed:', e.message);
    showToast('✓ Post saved as draft (auto-schedule failed)', 'info');
    loadStats(); loadPosts();
  }
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

  const [datePart, timePart] = dt.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute]     = timePart.split(':').map(Number);
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  const scheduledAtMs = localDate.getTime();

  if (isNaN(scheduledAtMs) || scheduledAtMs <= Date.now()) {
    showToast('Please pick a future date and time', 'error');
    return;
  }

  try {
    // Send full text directly so the server writes the complete content to DB.
    // This protects against Supabase column character-limit truncation.
    const latestText = document.getElementById('editPost')?.value || currentPostText;
    const latestTags = document.getElementById('editHashtags')?.value || currentHashtags;
    await api(`/api/posts/${currentPostId}/schedule`, 'POST', {
      scheduledAt: Math.floor(scheduledAtMs / 1000),
      postText:    latestText,
      hashtags:    latestTags
    });
    showToast('✓ Post scheduled!', 'success');
    loadStats(); loadPosts();
    resetStudio();
    switchTab('queue', document.querySelector('[data-tab="queue"]'));
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
    // Send the full textarea text directly in the request body.
    // This bypasses any Supabase column character-limit truncation —
    // the server uses this value straight to LinkedIn without a DB round-trip.
    const latestText = document.getElementById('editPost')?.value || currentPostText;
    const latestTags = document.getElementById('editHashtags')?.value || currentHashtags;
    await api(`/api/posts/${currentPostId}/publish-now`, 'POST', {
      postText: latestText,
      hashtags: latestTags
    });
    showToast('🚀 Published to LinkedIn!', 'success');
    loadStats(); loadPosts();
    resetStudio();
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

// ---- Queue Inline Scheduling ----
function openScheduleFromQueue(id) {
  const card = document.getElementById(`postcard-${id}`);
  if (!card) return;
  const actionsWrap = card.querySelector('.q-actions');
  
  // Save original HTML to allow canceling
  if (!actionsWrap.dataset.originalHtml) {
    actionsWrap.dataset.originalHtml = actionsWrap.innerHTML;
  }
  
  // Set default datetime to tomorrow 9am (similar to setDefaultDateTime logic)
  const d = new Date(); d.setDate(d.getDate() + 1);
  let hourStr = document.getElementById('preferredHour')?.value || '9';
  let hour = parseInt(hourStr);
  if (isNaN(hour) || hour === -1) hour = 9;
  d.setHours(hour, 0, 0, 0);
  
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const defaultDt = `${y}-${m}-${day}T${h}:00`;

  actionsWrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;width:100%;flex-wrap:wrap">
      <input type="datetime-local" id="queue-dt-${id}" class="forge-input date-input" value="${defaultDt}" style="flex:1;min-width:140px;padding:6px;font-size:0.75rem" />
      <button class="q-btn primary" onclick="queueScheduleConfirm('${id}')">Confirm</button>
      <button class="q-btn" onclick="queueScheduleCancel('${id}')">Cancel</button>
    </div>
  `;
}

function queueScheduleCancel(id) {
  const card = document.getElementById(`postcard-${id}`);
  if (!card) return;
  const actionsWrap = card.querySelector('.q-actions');
  actionsWrap.innerHTML = actionsWrap.dataset.originalHtml;
}

async function queueScheduleConfirm(id) {
  const dtInput = document.getElementById(`queue-dt-${id}`).value;
  if (!dtInput) { showToast('Pick a date and time', 'error'); return; }
  
  const [datePart, timePart] = dtInput.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute]     = timePart.split(':').map(Number);
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  const scheduledAtMs = localDate.getTime();

  if (isNaN(scheduledAtMs) || scheduledAtMs <= Date.now()) {
    showToast('Please pick a future date and time', 'error');
    return;
  }

  try {
    await api(`/api/posts/${id}/schedule`, 'POST', { scheduledAt: Math.floor(scheduledAtMs / 1000) });
    showToast('✓ Post scheduled!', 'success');
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

async function editPost(id) {
  const post = postsCache.find(p => p.id === id);
  if (!post) return;
  currentPostId   = post.id;
  currentPostText = post.post_text;
  currentHashtags = post.hashtags;

  if (post.images && post.images.length > 1) {
    setMode('event');
  } else {
    setMode('single');
  }

  // Update right pane UI immediately
  displayPost(post.post_text, post.hashtags, post.images);
  switchTab('create', document.querySelector('[data-tab="create"]'));

  // Pre-load server images into selectedFiles asynchronously so they appear in the left upload zone
  if (post.images && post.images.length > 0) {
    selectedFiles = [];
    for (const img of post.images) {
      try {
        const url = img.storage_url || ('/uploads/' + img.filename);
        const res = await fetch(url);
        if (!res.ok) continue; // Skip if file not found locally
        const blob = await res.blob();
        const file = new File([blob], img.filename, { type: img.mimetype || blob.type || 'image/jpeg' });
        selectedFiles.push(file);
      } catch (e) {
        console.warn('Could not load image as file', e);
      }
    }
  } else {
    selectedFiles = [];
  }
  renderPreviewStrip();
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

/**
 * Modern Premium Notification System
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('notifyContainer');
  if (!container) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message; t.className = `toast ${type}`;
    t.classList.remove('hidden');
    return;
  }

  const notify = document.createElement('div');
  notify.className = `premium-notify ${type}`;
  
  let iconHtml = '';
  if (type === 'success') {
    iconHtml = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (type === 'error') {
    iconHtml = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else {
    iconHtml = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  const title = type === 'success' ? 'Success' : (type === 'error' ? 'Critical' : 'Link');

  notify.innerHTML = `
    <div class="notify-icon ${type}">${iconHtml}</div>
    <div class="notify-content">
      <div class="notify-title">${title}</div>
      <div class="notify-msg">${message}</div>
    </div>
  `;

  container.prepend(notify);

  const timer = setTimeout(() => {
    notify.classList.add('exiting');
    notify.addEventListener('animationend', () => notify.remove(), { once: true });
  }, 5000);

  notify.addEventListener('click', () => {
    clearTimeout(timer);
    notify.classList.add('exiting');
    notify.addEventListener('animationend', () => notify.remove(), { once: true });
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
