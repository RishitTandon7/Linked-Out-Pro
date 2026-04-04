// services/notifications.js — Firebase Cloud Messaging (push notifications)
// Server-side: sends push to the user's browser after key events
//
// NOTE: firebase-admin requires a Service Account JSON for full auth.
// Until that's configured, we use the FCM HTTP v1 API via REST.
// To get your service account: Firebase Console → Project Settings
//   → Service accounts → Generate new private key → save as firebase-service-account.json

const axios = require('axios');
const { all, run } = require('../database/db');

const FCM_SENDER_ID = process.env.FIREBASE_MESSAGING_SENDER_ID;
const PROJECT_ID    = process.env.FIREBASE_PROJECT_ID;

// ---- Admin SDK (preferred, if service account is present) ----
let adminMessaging = null;
try {
  const fs   = require('fs');
  const path = require('path');
  const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
  if (fs.existsSync(serviceAccountPath)) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath))
      });
    }
    adminMessaging = admin.messaging();
    console.log('✅ Firebase Admin SDK initialized (push notifications active)');
  } else {
    console.log('ℹ️  firebase-service-account.json not found — push notifications disabled');
  }
} catch (e) {
  console.warn('⚠️  Firebase Admin init failed:', e.message);
}

/**
 * Send a push notification to a user (if they have an FCM token saved)
 * @param {string} userId
 * @param {{ title, body, icon?, url? }} payload
 */
async function sendPushToUser(userId, payload) {
  try {
    const db = require('../database/db');
    let fcmToken = null;

    if (db.IS_SUPABASE) {
      const { data } = await db.supabase
        .from('users')
        .select('fcm_token')
        .eq('id', userId)
        .single();
      fcmToken = data?.fcm_token;
    } else {
      const user = await db.get('SELECT fcm_token FROM users WHERE id = ?', [userId]);
      fcmToken = user?.fcm_token;
    }

    if (!fcmToken) return; // User hasn't granted notification permission
    await sendPush(fcmToken, payload);
  } catch (e) {
    console.warn('Push notification failed:', e.message);
  }
}

/**
 * Send a push to a specific FCM token
 */
async function sendPush(fcmToken, { title, body, icon, url }) {
  if (!fcmToken) return;

  if (adminMessaging) {
    // Use Admin SDK (most reliable)
    await adminMessaging.send({
      token: fcmToken,
      notification: { title, body },
      webpush: {
        notification: {
          title,
          body,
          icon: icon || '/icon-192.png',
          requireInteraction: false
        },
        fcmOptions: { link: url || '/' }
      }
    });
  } else {
    console.log(`[Push — no admin SDK] "${title}": ${body}`);
  }
}

// ---- Convenience helpers ----

async function notifyPostPublished(userId, postId) {
  await sendPushToUser(userId, {
    title: '🚀 Post Published!',
    body:  'Your LinkedIn post just went live.',
    url:   '/dashboard'
  });
}

async function notifyPostFailed(userId, reason) {
  await sendPushToUser(userId, {
    title: '❌ Post Failed',
    body:  `Could not publish: ${reason}`,
    url:   '/dashboard'
  });
}

async function notifyPostScheduled(userId, scheduledAt) {
  const time = new Date(scheduledAt * 1000).toLocaleString();
  await sendPushToUser(userId, {
    title: '📅 Post Scheduled',
    body:  `Your post will go live at ${time}`,
    url:   '/dashboard'
  });
}

module.exports = {
  sendPush,
  sendPushToUser,
  notifyPostPublished,
  notifyPostFailed,
  notifyPostScheduled
};
