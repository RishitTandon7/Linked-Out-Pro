// dashboard.js — LinkedOut Pro Dashboard Logic

// ---- App Version (must match server.js APP_VERSION on latest deploy) ----
const PAGE_VERSION = '1.7.6';

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
  checkForUpdate();                      // Check now
  setInterval(checkForUpdate, 5 * 60 * 1000); // Re-check every 5 minutes
  startClientScheduler();  // Client-driven scheduler: publishes due posts every 60s
});

// ---- Client-Driven Scheduler ----
// Pings /api/cron/trigger every 60 seconds while the dashboard is open.
// This gives real-time post publishing without needing paid cron services.
// GitHub Actions runs every 5 min as an offline backup.
let _schedulerInterval = null;

function startClientScheduler() {
  // Fire once immediately to catch any posts that are already overdue
  triggerCronSilent();

  // Then fire every 60 seconds while the tab is visible
  _schedulerInterval = setInterval(() => {
    if (!document.hidden) triggerCronSilent();
  }, 60 * 1000);

  // When user switches back to this tab, fire immediately (catches missed ticks)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) triggerCronSilent();
  });
}

async function triggerCronSilent() {
  try {
    const res  = await fetch('/api/cron/trigger', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (data.published > 0) {
      console.log(`✅ Client scheduler: published ${data.published} post(s)`);
      // Refresh the queue so newly-published posts show up
      loadStats();
      loadPosts(currentFilter);
    }
  } catch {
    // Silent — network errors or server being cold-started are non-fatal
  }
}

// ---- Update Check ----
// Polls /api/version and shows a sticky banner if the server has a newer version.
// Users simply click the banner (or the Refresh button) to reload and get the update.
async function checkForUpdate() {
  try {
    const res  = await fetch('/api/version', { cache: 'no-store' });
    const data = await res.json();
    if (data.version && data.version !== PAGE_VERSION) {
      showUpdateBanner(data.version);
    }
  } catch { /* silent — no network or server issue */ }
}

function showUpdateBanner(newVersion) {
  if (document.getElementById('updateBanner')) return; // already shown
  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
    'background:linear-gradient(90deg,#f59e0b,#d97706)',
    'color:#1a1200', 'font-size:0.82rem', 'font-weight:600',
    'padding:10px 20px', 'display:flex', 'align-items:center',
    'justify-content:center', 'gap:14px', 'box-shadow:0 2px 12px rgba(0,0,0,0.3)',
    'animation:slideDown 0.35s ease'
  ].join(';');
  banner.innerHTML = `
    <span>🚀 LinkedOut Pro <strong>v${newVersion}</strong> is available — you're on v${PAGE_VERSION}</span>
    <button onclick="location.reload(true)" style="background:#1a1200;color:#f59e0b;border:none;border-radius:6px;padding:5px 14px;font-weight:700;cursor:pointer;font-size:0.8rem;">Refresh now</button>
    <button onclick="this.parentElement.remove()" style="background:transparent;border:none;cursor:pointer;font-size:1rem;opacity:0.6;" title="Dismiss">×</button>
  `;
  document.body.prepend(banner);
}

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
    
    // Show boss mode button if owner
    if (res.user.email === 'rishit.tandon.7@gmail.com') {
      const bossBtn = document.getElementById('bossNavBtn');
      if (bossBtn) bossBtn.style.display = 'flex';
      const mBossBtn = document.getElementById('mobileBossNavBtn');
      if (mBossBtn) mBossBtn.style.display = 'flex';
    }
    
    const uName = document.getElementById('userName');
    if (uName) uName.textContent = res.user.name;
    
    if (res.user.avatar_url) {
      ['userAvatar','mobileHeaderAvatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<img src="${res.user.avatar_url}" alt="${res.user.name}" />`;
      });
      // Also update LinkedIn preview card avatar — preserve the hint badge
      const lkA = document.getElementById('lkAvatar');
      if (lkA) {
        // Keep the hint badge, insert the profile img before it
        const hint = lkA.querySelector('.lk-avatar-hint');
        const img = document.createElement('img');
        img.src = res.user.avatar_url;
        img.alt = res.user.name;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
        lkA.insertBefore(img, hint || null);
      }
    }
    const lkN = document.getElementById('lkName');
    if (lkN) lkN.textContent = res.user.name;
  } catch (e) { 
    console.error('Failed to load user:', e);
    window.location.href = '/'; 
  }
}

// ---- LinkedIn In-App View ----
let _liViewerOpen = false;

function toggleLinkedInView() {
  const overlay = document.getElementById('linkedinViewerOverlay');
  if (!overlay) return;

  if (_liViewerOpen) {
    // Close — slide out
    overlay.classList.add('li-viewer-hidden');
    _liViewerOpen = false;
    setTimeout(() => {
      const iframe = document.getElementById('linkedinIframe');
      if (iframe) iframe.src = 'about:blank';
    }, 400);
  } else {
    // Open — slide in
    overlay.classList.remove('li-viewer-hidden');
    _liViewerOpen = true;
    
    const iframe = document.getElementById('linkedinIframe');
    if (iframe) {
      iframe.src = 'https://www.linkedin.com/feed/';
    }
  }
}

function openLinkedInExternal() {
  window.open('https://www.linkedin.com/in/me', '_blank', 'noopener,noreferrer');
}

function openLinkedInFeed() {
  window.open('https://www.linkedin.com/feed/', '_blank', 'noopener,noreferrer');
}


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

// ---- AI Strategy (Resume to Content) ----
let selectedResumeFile = null;

// Initialize dropzone (called after DOM loads or manually)
function initResumeDropZone() {
  const dropZone = document.getElementById('resumeDropZone');
  const fileInput = document.getElementById('resumeFileInput');
  const fileLabel = document.getElementById('resumeFileLabel');
  
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
    dropZone.addEventListener('dragleave', () => dropZone.style.borderColor = 'var(--border)');
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border)';
      if (e.dataTransfer.files.length) handleResumeFile(e.dataTransfer.files[0], fileLabel);
    });
    fileInput.addEventListener('change', e => {
      if (e.target.files.length) handleResumeFile(e.target.files[0], fileLabel);
    });
  }
}

function handleResumeFile(file, labelEl) {
  selectedResumeFile = file;
  if (labelEl) labelEl.textContent = file.name;
  const btn = document.getElementById('btnGenerateStrategy');
  if (btn) btn.disabled = false;
}

// Progressive Flux Loader implementation
function startFluxLoader(durationSecs) {
  const container = document.getElementById('fluxLoaderContainer');
  const btn = document.getElementById('btnGenerateStrategy');
  const fill = document.getElementById('fluxBarFill');
  const labelText = document.getElementById('fluxLabelText');
  
  if (!container || !fill || !labelText) return null;
  
  btn.style.display = 'none';
  container.style.display = 'flex';
  
  const phases = [
    { at: 0, label: "uploading & parsing" },
    { at: 25, label: "analyzing experience" },
    { at: 55, label: "generating profile tips" },
    { at: 80, label: "brainstorming content" },
    { at: 100, label: "complete" }
  ];
  
  let start = null;
  let rafId = null;
  const totalMs = durationSecs * 1000;
  let currentLabel = "";
  let isDone = false;
  
  function setLabel(newLabel) {
    if (currentLabel === newLabel) return;
    currentLabel = newLabel;
    
    // 3D swap animation
    labelText.classList.remove('new');
    labelText.classList.add('changing');
    
    setTimeout(() => {
      labelText.textContent = newLabel;
      labelText.classList.remove('changing');
      labelText.classList.add('new');
    }, 450);
  }

  function tick(ts) {
    if (isDone) return;
    if (!start) start = ts;
    const pct = Math.min(100, ((ts - start) / totalMs) * 100);
    fill.style.width = `${pct}%`;
    
    // Pick phase
    let activePhase = phases[0].label;
    for (const p of phases) {
      if (pct >= p.at) activePhase = p.label;
    }
    setLabel(activePhase);
    
    if (pct < 100) {
      rafId = requestAnimationFrame(tick);
    }
  }
  
  rafId = requestAnimationFrame(tick);
  
  // Return a finish function to fast-forward to 100% when API returns early
  return () => {
    isDone = true;
    cancelAnimationFrame(rafId);
    fill.style.width = `100%`;
    setLabel("complete");
    setTimeout(() => {
      container.style.display = 'none';
      btn.style.display = 'flex';
    }, 1000);
  };
}

async function generateStrategy() {
  if (!selectedResumeFile) return;
  
  const btnGenerate = document.getElementById('btnGenerateStrategy');
  btnGenerate.disabled = true;
  
  document.getElementById('strategyResults').style.display = 'none';
  
  // Start the flux loader with an estimated 15 second duration
  const finishLoader = startFluxLoader(15);

  const formData = new FormData();
  formData.append('resume', selectedResumeFile);

  try {
    const res = await fetch('/api/analyze/resume-strategy', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate');
    
    // Save to local storage for persistence across reloads
    localStorage.setItem('lo_strategy_data', JSON.stringify(data));
    
    // Also save to backend for cross-device syncing
    api('/api/settings', 'PATCH', { last_ai_strategy: JSON.stringify(data) }).catch(e => console.warn('Failed to sync strategy to server', e));
    
    if (finishLoader) finishLoader();
    
    // Slight delay to let the "complete" animation show before rendering
    setTimeout(() => {
      renderStrategy(data);
    }, 1000);
    
  } catch (e) {
    showToast(e.message, 'error');
    if (finishLoader) finishLoader();
  } finally {
    btnGenerate.disabled = false;
  }
}

function renderStrategy(data) {
  document.getElementById('strategyResults').style.display = 'block';
  
  const headlinesHtml = (data.headlines || []).map(h => `
    <div style="padding:16px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;font-weight:500;">
      ${escapeHtml(h)}
    </div>
  `).join('');
  document.getElementById('strategyHeadlines').innerHTML = headlinesHtml;

  const profileHtml = (data.profileTips || []).map(tip => `
    <div style="padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:12px;">
      <div style="font-size:0.75rem;font-weight:700;color:var(--primary);margin-bottom:8px;text-transform:uppercase;">${escapeHtml(tip.section)}</div>
      <div style="font-size:0.9rem;line-height:1.5;color:var(--text-secondary)">${escapeHtml(tip.advice)}</div>
    </div>
  `).join('');
  const tipsContainer = document.getElementById('strategyProfileTips');
  if (tipsContainer) tipsContainer.innerHTML = profileHtml;

  const planHtml = (data.contentIdeas || []).map((idea, i) => {
    const postDate = new Date();
    postDate.setDate(postDate.getDate() + 1); // just default to tomorrow for ideas
    postDate.setHours(9, 0, 0, 0);

    const safeText = encodeURIComponent(idea.draft || '');
    const safeIso = postDate.toISOString().slice(0, 16);
    
    return `
    <div style="padding:20px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-size:0.75rem;font-weight:700;color:var(--primary);margin-bottom:4px;">IDEA ${i+1} • ${escapeHtml(idea.topic || 'Post')}</div>
        </div>
        <button class="action-btn-secondary" style="padding:6px 12px;font-size:0.75rem;" onclick="addStrategyToQueue('${safeText}', '${safeIso}')">
          ➕ Add to Queue
        </button>
      </div>
      <div style="white-space:pre-wrap;font-size:0.9rem;line-height:1.6;color:var(--text-secondary)">${escapeHtml(idea.draft || '')}</div>
    </div>
  `}).join('');
  document.getElementById('strategyPlan').innerHTML = planHtml;
}

function addStrategyToQueue(encodedText, isoDate) {
  const btn = document.querySelector('[data-tab="create"]');
  if (btn) switchTab('create', btn);
  
  const postInput = document.getElementById('postInput');
  if (postInput) {
    postInput.value = decodeURIComponent(encodedText);
    postInput.dispatchEvent(new Event('input')); // auto-resize if it's bound
  }
  
  const dateInput = document.getElementById('scheduleDate');
  if (dateInput) dateInput.value = isoDate;
  
  showToast('Draft added to Studio! You can now edit and Schedule it.', 'success');
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
  document.querySelectorAll('.mode-btn[data-filter]').forEach(b => b.classList.remove('active'));
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
  displayPost(currentPostText || '', currentHashtags || '');
  document.getElementById('singleBtn').classList.toggle('active', mode === 'single');
  document.getElementById('eventBtn').classList.toggle('active', mode !== 'single');

  const txt = document.getElementById('uploadText');
  if (txt) txt.textContent = mode === 'single' ? 'Drop images or videos — each becomes a separate post' : 'Drop images or videos — all combined into one post';

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
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
  addFiles(files);
}
function handleFileSelect(e) {
  addFiles(Array.from(e.target.files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/')));
  e.target.value = '';
}

function addFiles(files) {
  selectedFiles = [...selectedFiles, ...files].slice(0, 10);
  renderPreviewStrip();
  updateForgeButton();
  displayPost(currentPostText || '', currentHashtags || '');
}

function removeFile(idx) {
  selectedFiles.splice(idx, 1);
  renderPreviewStrip();
  updateForgeButton();
  displayPost(currentPostText || '', currentHashtags || '');
}

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

function moveFile(idx, direction) {
  if (direction === 'left' && idx > 0) {
    const temp = selectedFiles[idx];
    selectedFiles[idx] = selectedFiles[idx - 1];
    selectedFiles[idx - 1] = temp;
  } else if (direction === 'right' && idx < selectedFiles.length - 1) {
    const temp = selectedFiles[idx];
    selectedFiles[idx] = selectedFiles[idx + 1];
    selectedFiles[idx + 1] = temp;
  }
  renderPreviewStrip();
  updateForgeButton();
  // Live sync with the preview card if a post is already displayed
  if (currentPostText) {
    displayPost(currentPostText, currentHashtags);
  }
}

function renderPreviewStrip() {
  const strip = document.getElementById('previewStrip');
  strip.innerHTML = '';
  selectedFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const div = document.createElement('div');
    div.className = 'preview-thumb';
    const isVideo = file.type.startsWith('video/');
    const mediaEl = isVideo
      ? `<video src="${url}" muted playsinline style="width:100%;height:100%;object-fit:cover;border-radius:6px;"></video>
         <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;background:rgba(0,0,0,0.5);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`
      : `<img src="${url}" />`;
      
    const leftBtn = idx > 0
      ? `<button class="move-thumb-left" onclick="moveFile(${idx}, 'left')" title="Move left">◀</button>`
      : '';
    const rightBtn = idx < selectedFiles.length - 1
      ? `<button class="move-thumb-right" onclick="moveFile(${idx}, 'right')" title="Move right">▶</button>`
      : '';

    div.innerHTML = `${mediaEl}
      <button class="remove-thumb" onclick="removeFile(${idx})">✕</button>
      ${leftBtn}
      ${rightBtn}
      ${!isVideo ? `<button class="edit-thumb" onclick="openImgEditor(${idx})" title="Edit image"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}`;
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

// ---- Image Compression Helper ----
async function compressImageIfNeeded(file) {
  if (!file.type.startsWith('image/')) return file;

  return new Promise((resolve) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      
      const MAX_WIDTH = 1200;
      const MAX_HEIGHT = 1200;
      let width = img.width;
      let height = img.height;

      // Maintain aspect ratio
      if (width > height) {
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width = Math.round((width * MAX_HEIGHT) / height);
          height = MAX_HEIGHT;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          console.log(`Image compressed: ${(file.size / 1024).toFixed(1)}KB -> ${(compressedFile.size / 1024).toFixed(1)}KB`);
          resolve(compressedFile);
        },
        'image/jpeg',
        0.80
      );
    };
    img.onerror = () => {
      resolve(file);
    };
  });
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
        const compressedFile = await compressImageIfNeeded(f);
        const formData = new FormData();
        formData.append('images', compressedFile);
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
      for (const f of selectedFiles) {
        const compressedFile = await compressImageIfNeeded(f);
        formData.append('images', compressedFile);
      }
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

  // Image / video preview
  const preview = document.getElementById('lkImagePreview');
  preview.innerHTML = '';
  preview.className = 'lk-media';

  const previewFiles = [];  // { url, isVideo }
  if (selectedFiles && selectedFiles.length > 0) {
    selectedFiles.forEach(f => previewFiles.push({ url: URL.createObjectURL(f), isVideo: f.type.startsWith('video/') }));
  } else if (serverImages && serverImages.length > 0) {
    serverImages.forEach(img => {
      const isVideo = img.mimetype && img.mimetype.startsWith('video/');
      previewFiles.push({ url: img.storage_url || ('/uploads/' + img.filename), isVideo });
    });
  }

  // Helper function to build correct media element (img or video)
  function createMediaElement(file) {
    if (file.isVideo) {
      const vid = document.createElement('video');
      vid.src = file.url;
      vid.muted = true;
      vid.playsInline = true;
      vid.loop = true;
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      return vid;
    } else {
      const img = document.createElement('img');
      img.src = file.url;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      return img;
    }
  }

  if (previewFiles.length === 1) {
    const { url, isVideo } = previewFiles[0];
    const wrapper = document.createElement('div');
    wrapper.className = 'lk-gallery-item';
    wrapper.style.cursor = 'pointer';
    wrapper.onclick = () => openLightbox(0, previewFiles);
    
    if (isVideo) {
      const vid = document.createElement('video');
      vid.src = url; vid.controls = true; vid.muted = true;
      vid.style.cssText = 'width:100%;border-radius:8px;max-height:320px;';
      wrapper.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = url;
      wrapper.appendChild(img);
    }
    preview.appendChild(wrapper);
  } else if (previewFiles.length === 2) {
    preview.className = 'lk-media lk-gallery lk-gallery-2';
    previewFiles.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'lk-gallery-item';
      item.style.cursor = 'pointer';
      item.onclick = () => openLightbox(idx, previewFiles);
      item.appendChild(createMediaElement(file));
      preview.appendChild(item);
    });
  } else if (previewFiles.length === 3) {
    preview.className = 'lk-media lk-gallery lk-gallery-3';
    
    // Left large item
    const leftItem = document.createElement('div');
    leftItem.className = 'lk-gallery-item';
    leftItem.style.cursor = 'pointer';
    leftItem.onclick = () => openLightbox(0, previewFiles);
    leftItem.appendChild(createMediaElement(previewFiles[0]));
    preview.appendChild(leftItem);
    
    // Right stacked items
    const rightCol = document.createElement('div');
    rightCol.className = 'lk-gallery-3-right';
    previewFiles.slice(1, 3).forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'lk-gallery-item';
      item.style.cursor = 'pointer';
      item.onclick = () => openLightbox(idx + 1, previewFiles);
      item.appendChild(createMediaElement(file));
      rightCol.appendChild(item);
    });
    preview.appendChild(rightCol);
  } else if (previewFiles.length === 4) {
    preview.className = 'lk-media lk-gallery lk-gallery-4';
    
    // Top full-width item
    const topItem = document.createElement('div');
    topItem.className = 'lk-gallery-item';
    topItem.style.cursor = 'pointer';
    topItem.onclick = () => openLightbox(0, previewFiles);
    topItem.appendChild(createMediaElement(previewFiles[0]));
    preview.appendChild(topItem);
    
    // Bottom 3 split items
    const bottomRow = document.createElement('div');
    bottomRow.className = 'lk-gallery-4-bottom';
    previewFiles.slice(1, 4).forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'lk-gallery-item';
      item.style.cursor = 'pointer';
      item.onclick = () => openLightbox(idx + 1, previewFiles);
      item.appendChild(createMediaElement(file));
      bottomRow.appendChild(item);
    });
    preview.appendChild(bottomRow);
  } else if (previewFiles.length >= 5) {
    preview.className = 'lk-media lk-gallery lk-gallery-5';
    
    // Top 2 split items
    const topRow = document.createElement('div');
    topRow.className = 'lk-gallery-5-top';
    previewFiles.slice(0, 2).forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'lk-gallery-item';
      item.style.cursor = 'pointer';
      item.onclick = () => openLightbox(idx, previewFiles);
      item.appendChild(createMediaElement(file));
      topRow.appendChild(item);
    });
    preview.appendChild(topRow);
    
    // Bottom 3 split items
    const bottomRow = document.createElement('div');
    bottomRow.className = 'lk-gallery-5-bottom';
    
    previewFiles.slice(2, 5).forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'lk-gallery-item';
      item.style.cursor = 'pointer';
      item.onclick = () => openLightbox(idx + 2, previewFiles);
      item.appendChild(createMediaElement(file));
      
      // If there are more than 5 images, overlay on the last (5th) thumbnail
      if (idx === 2 && previewFiles.length > 5) {
        const overlay = document.createElement('div');
        overlay.className = 'lk-gallery-overlay';
        overlay.textContent = `+${previewFiles.length - 4}`;
        item.appendChild(overlay);
      }
      
      bottomRow.appendChild(item);
    });
    preview.appendChild(bottomRow);
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

  // Reset file input element so same file can be re-selected
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
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
    // Pass full postText from cache straight to the server so LinkedIn receives
    // the complete text — bypasses any Supabase VARCHAR column truncation.
    const cached = postsCache.find(p => p.id === id);
    const body = cached
      ? { postText: cached.post_text, hashtags: cached.hashtags || '' }
      : {};
    await api(`/api/posts/${id}/publish-now`, 'POST', body);
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
    <div class="schedule-timing-notice" style="margin-top:6px">
      <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      Posts may publish 5–15 min after the set time
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
    // Pass full postText from cache to protect against Supabase VARCHAR truncation.
    const cached = postsCache.find(p => p.id === id);
    const payload = { scheduledAt: Math.floor(scheduledAtMs / 1000) };
    if (cached) {
      payload.postText = cached.post_text;
      payload.hashtags = cached.hashtags || '';
    }
    await api(`/api/posts/${id}/schedule`, 'POST', payload);
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

// Initialize AI Strategy UI
document.addEventListener('DOMContentLoaded', async () => {
  initResumeDropZone();
  
  // Try to load from server settings first (for cross-device sync)
  try {
    const res = await fetch('/api/settings', { headers: { 'Authorization': `Bearer ${localStorage.getItem('lo_token')}` } });
    if (res.ok) {
      const { settings } = await res.json();
      if (settings && settings.last_ai_strategy) {
        localStorage.setItem('lo_strategy_data', settings.last_ai_strategy);
        renderStrategy(JSON.parse(settings.last_ai_strategy));
        return; // Success, skip local storage fallback
      }
    }
  } catch (e) {
    console.warn("Failed to fetch server settings for strategy", e);
  }
  
  // Fallback to local storage if network is down or empty
  const savedStrategy = localStorage.getItem('lo_strategy_data');
  if (savedStrategy) {
    try {
      renderStrategy(JSON.parse(savedStrategy));
    } catch(e) {
      console.warn("Failed to parse saved strategy", e);
      localStorage.removeItem('lo_strategy_data');
    }
  }
});

// ---- Lightbox Carousel ----
let lightboxFiles = [];
let lightboxIndex = 0;

function openLightbox(idx, files) {
  lightboxFiles = files || [];
  lightboxIndex = idx || 0;
  
  const modal = document.getElementById('lightboxModal');
  if (modal) {
    modal.classList.remove('hidden');
    renderLightboxItem();
    // Add keyboard listener for arrows and escape
    document.addEventListener('keydown', handleLightboxKeydown);
  }
}

function closeLightbox() {
  const modal = document.getElementById('lightboxModal');
  if (modal) {
    modal.classList.add('hidden');
    document.getElementById('lightboxContent').innerHTML = '';
    document.removeEventListener('keydown', handleLightboxKeydown);
  }
}

function renderLightboxItem() {
  const content = document.getElementById('lightboxContent');
  const caption = document.getElementById('lightboxCaption');
  if (!content || lightboxFiles.length === 0) return;
  
  content.innerHTML = '';
  const file = lightboxFiles[lightboxIndex];
  
  if (file.isVideo) {
    const vid = document.createElement('video');
    vid.src = file.url;
    vid.controls = true;
    vid.autoplay = true;
    vid.style.cssText = 'max-width:100%; max-height:80vh; border-radius:8px;';
    content.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src = file.url;
    content.appendChild(img);
  }
  
  if (caption) {
    caption.textContent = `${lightboxIndex + 1} of ${lightboxFiles.length}`;
  }
  
  // Show/hide arrows based on index and length
  const leftArrow = document.querySelector('.lightbox-arrow.left');
  const rightArrow = document.querySelector('.lightbox-arrow.right');
  if (leftArrow) leftArrow.style.display = lightboxIndex > 0 ? 'flex' : 'none';
  if (rightArrow) rightArrow.style.display = lightboxIndex < lightboxFiles.length - 1 ? 'flex' : 'none';
}

function lightboxNext() {
  if (lightboxIndex < lightboxFiles.length - 1) {
    lightboxIndex++;
    renderLightboxItem();
  }
}

function lightboxPrev() {
  if (lightboxIndex > 0) {
    lightboxIndex--;
    renderLightboxItem();
  }
}

function handleLightboxKeydown(e) {
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowRight') lightboxNext();
  if (e.key === 'ArrowLeft') lightboxPrev();
}
