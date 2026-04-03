// public/pwa.js
// Modern PWA Installation logic for LinkedOut Pro

let deferredPrompt;
const installBtn = document.createElement('button');
installBtn.id = 'pwaInstallBtn';
installBtn.className = 'nav-item install-btn';
installBtn.style.display = 'none'; // Hidden until prompt is available
installBtn.title = 'Install LinkedOut Pro App';
installBtn.innerHTML = `
  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M7 10l5 5m0 0l5-5m-5 5V3" />
  </svg>
`;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'flex';
  // Update the settings button label to reflect it's ready
  const btn = document.getElementById('settingsInstallBtn');
  const desc = document.getElementById('settingsInstallDesc');
  if (btn) btn.style.opacity = '1';
  if (desc) desc.textContent = 'Add LinkedOut Pro to your home screen for quick access';
});

installBtn.addEventListener('click', () => triggerInstall());

// Global — called by Settings "Install" button
window.settingsInstallApp = async function() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  if (isInStandaloneMode) {
    // Already installed
    const desc = document.getElementById('settingsInstallDesc');
    if (desc) desc.textContent = '✓ App is already installed on this device!';
    return;
  }

  if (deferredPrompt) {
    // Chrome / Edge — native browser prompt
    await triggerInstall();
    return;
  }

  if (isIOS) {
    // iOS Safari — show manual instructions
    showNotification(
      '📲 Install on iOS',
      'Tap the Share icon (□↑) in Safari, then tap "Add to Home Screen".',
      'info'
    );
    return;
  }

  // Fallback — open in a new tab pointing to the PWA manifest hint
  showNotification(
    '💡 To Install',
    'Open this app in Chrome or Edge on Android/Desktop, then tap the install icon in the address bar.',
    'info'
  );
};

async function triggerInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User response to the install prompt: ${outcome}`);
  deferredPrompt = null;
  installBtn.style.display = 'none';
}

window.addEventListener('appinstalled', () => {
  console.log('LinkedOut Pro PWA was installed');
  installBtn.style.display = 'none';
  deferredPrompt = null;
  const desc = document.getElementById('settingsInstallDesc');
  const btn  = document.getElementById('settingsInstallBtn');
  if (desc) desc.textContent = '✓ App installed successfully!';
  if (btn)  { btn.textContent = 'Installed ✓'; btn.disabled = true; btn.style.opacity = '0.5'; }
  if (typeof showToast === 'function') showToast('✓ LinkedOut Pro installed!', 'success');
});

// Wait for DOM to add the button to the sidebar
window.addEventListener('load', () => {
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
        sidebarNav.appendChild(installBtn);
    }
});
