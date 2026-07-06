# LinkedOut — Launch Day TODO 🚀
> Launch date: July 6, 2026

---

## 🔴 Critical (Fix Before/On Launch)

### 1. LinkedIn OAuth — Privacy Policy URL Missing
- [x] Create `/privacy` page in Next.js app
- [ ] Add `https://linkedout.rishit.site/privacy` to LinkedIn Developer Console → App Settings
- [ ] Re-test OAuth flow — confirm Google/Microsoft/Apple buttons appear on LinkedIn login page

### 2. Landing Page — Make Content More Explainable
- [x] Rewrite hero headline to clearly state what LinkedOut does in one line
- [x] Add a "How it works" section (3 steps: Connect LinkedIn → Write/paste idea → Get caption)
- [x] Add use-case examples (e.g. job seekers, founders, creators)
- [x] Add sample generated captions as social proof
- [ ] Add a short demo GIF or screenshot of the tool in action
- [x] Make CTA button copy more action-oriented (e.g. "Generate My First Caption Free")
- [x] Add FAQ section covering: Is it free? Does it post for me? Is my data safe?

---

## 🟡 High Priority (This Week)

### 3. Boss Mode Dashboard (rishit.tandon.7@gmail.com only)
- [x] Gate dashboard behind owner email check on backend
- [x] Build `/boss` or `/admin` route (hidden from public, no link in nav)
- [x] Dashboard metrics to show:
  - [x] Total registered users
  - [x] New signups today / this week / this month
  - [x] Daily active users (DAU)
  - [x] Total captions generated (all time + today)
  - [ ] Traffic: page views, unique visitors
  - [ ] Top referral sources (where users are coming from)
  - [x] User list with email, signup date, last active
- [x] Integrate analytics (Vercel Analytics added)
- [x] Add simple chart (signups over time)

---

## 🟢 Nice to Have (Post Launch)

- [ ] Add waitlist/email capture for users who don't want to connect LinkedIn yet
- [ ] Add testimonials section on landing page once first users give feedback
- [ ] Add OG image/meta tags for LinkedIn/Twitter share previews
- [ ] Set up error monitoring (Sentry)
- [ ] Add Google Analytics or PostHog for full funnel tracking

---

## ✅ Already Done
- [x] LinkedIn OAuth integrated
- [x] App verified on LinkedIn Developer Console (Jul 6, 2026)
- [x] App logo uploaded
- [x] Scopes configured: `openid`, `profile`, `email`, `w_member_social`