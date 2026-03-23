// public/firebase-messaging-sw.js
// Service Worker for Firebase Cloud Messaging (background push notifications)
// This file MUST be at the root of your public directory

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyB9Gv1QJjs9WcQy2KWjxN8oYUjUFB01G-Y',
  authDomain:        'linkedout-pro.firebaseapp.com',
  projectId:         'linkedout-pro',
  storageBucket:     'linkedout-pro.firebasestorage.app',
  messagingSenderId: '422351727164',
  appId:             '1:422351727164:web:4aef82742967c2935e3139'
});

const messaging = firebase.messaging();

// Handle background push messages (when the tab is not in focus)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background push received:', payload);

  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'LinkedOut Pro', {
    body:    body  || 'You have a new notification',
    icon:    icon  || '/icon-192.png',
    badge:   '/icon-192.png',
    vibrate: [200, 100, 200],
    data:    payload.data || {}
  });
});

// Click on notification → open or focus the dashboard
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
