// public/push.js — client-side Firebase push notification setup
// Loaded by dashboard.html to register the user's browser for push notifications

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyB9Gv1QJjs9WcQy2KWjxN8oYUjUFB01G-Y',
  authDomain:        'linkedout-pro.firebaseapp.com',
  projectId:         'linkedout-pro',
  storageBucket:     'linkedout-pro.firebasestorage.app',
  messagingSenderId: '422351727164',
  appId:             '1:422351727164:web:4aef82742967c2935e3139'
};

const VAPID_KEY = 'BMUnazGtkOgpGGUJqh1azGsWCVwd0OKlycThONN-ZOXNXH5Igsw1boUIJmsbQ7qvxzaeZMmRjLm60ICmVg-FV7A';

let _messaging = null;

/**
 * Initialize Firebase + request notification permission.
 * Saves the FCM token to the backend so we can push to this browser.
 * Call this after the user logs in.
 */
async function initPushNotifications() {
  try {
    // Dynamically import Firebase (compat version works without bundler)
    if (typeof firebase === 'undefined') return;  // Firebase scripts not loaded yet

    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _messaging = firebase.messaging();

    // Register service worker
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Push notification permission denied');
      return;
    }

    // Get FCM token
    const token = await _messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return;

    console.log('🔔 FCM token obtained — registering with server');

    // Save token to backend
    await fetch('/api/auth/fcm-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    // Handle foreground messages (tab is open)
    _messaging.onMessage((payload) => {
      const { title, body } = payload.notification || {};
      showPushToast(title, body);
    });

  } catch (e) {
    console.warn('Push notification setup failed:', e.message);
  }
}

/** Show an in-app toast when a push arrives while the tab is open */
function showPushToast(title, body) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = `${title} — ${body}`;
  t.className = 'toast success';
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 5000);
}
