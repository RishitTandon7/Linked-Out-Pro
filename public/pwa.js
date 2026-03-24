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
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Update UI notify the user they can install the PWA
  installBtn.style.display = 'flex';
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  // Show the install prompt
  deferredPrompt.prompt();
  // Wait for the user to respond to the prompt
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User response to the install prompt: ${outcome}`);
  // We've used the prompt, and can't use it again, throw it away
  deferredPrompt = null;
  // Hide our install button
  installBtn.style.display = 'none';
});

window.addEventListener('appinstalled', () => {
  // Log install to analytics
  console.log('LinkedOut Pro PWA was installed');
  installBtn.style.display = 'none';
  showToast('✓ LinkedOut Pro installed!', 'success');
});

// Wait for DOM to add the button to the sidebar
window.addEventListener('load', () => {
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
        sidebarNav.appendChild(installBtn);
    }
});
