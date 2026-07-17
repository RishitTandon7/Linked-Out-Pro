# 🧪 TEST.md — Universal Code Audit Checklist

> A language-agnostic testing & security audit file. Drop this into any project repo and work through it before every release / demo / deployment.
>
> **How to use:** Check `[x]` each item as you verify it. Anything you can't check = a bug waiting to happen.

---

## 1. 🔐 Security Vulnerabilities

### 1.1 Secrets & Credentials
- [ ] No API keys, tokens, passwords, or private keys hardcoded in source code
- [ ] `.env` files are in `.gitignore` and NOT committed to git history
- [ ] Run a secret scan: `git log -p | grep -iE "api[_-]?key|secret|password|token"` or use `gitleaks` / `trufflehog`
- [ ] Secrets rotated if they were ever committed (deleting the file is NOT enough — check git history)
- [ ] Environment variables used for all config (DB URLs, API keys, JWT secrets)

### 1.2 Injection Attacks
- [ ] **SQL Injection:** All DB queries use parameterized queries / ORM — never string concatenation
- [ ] **Command Injection:** No user input passed to `exec()`, `eval()`, `os.system()`, `subprocess` with `shell=True`
- [ ] **XSS:** All user-generated content is escaped/sanitized before rendering (check `innerHTML`, `dangerouslySetInnerHTML`, template injection)
- [ ] **Path Traversal:** File paths from user input are validated (`../../etc/passwd` should fail)
- [ ] **NoSQL Injection:** MongoDB/Supabase queries validate input types (e.g., `{$gt: ""}` attacks)

### 1.3 Authentication & Authorization
- [ ] Passwords hashed with bcrypt/argon2/scrypt — NEVER MD5, SHA1, or plaintext
- [ ] JWT tokens: signed, expiry set, secret is strong (32+ chars), algorithm pinned (no `alg: none`)
- [ ] Session tokens invalidated on logout
- [ ] Every protected endpoint checks auth **server-side** (not just hidden UI buttons)
- [ ] Authorization checked per-resource (User A can't access User B's data by changing an ID in the URL — IDOR test)
- [ ] Rate limiting on login, signup, OTP, and password-reset endpoints
- [ ] Account lockout / captcha after repeated failed logins

### 1.4 API & Network
- [ ] HTTPS enforced everywhere (no mixed content)
- [ ] CORS configured with specific origins — not `*` in production
- [ ] Sensitive data never in URL query params (they get logged)
- [ ] Error responses don't leak stack traces, DB schema, or internal paths in production
- [ ] Security headers set: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`
- [ ] Webhooks verify signatures (Razorpay/Stripe/GitHub webhook secret validation)

### 1.5 Dependencies
- [ ] Run dependency audit:
  - Node: `npm audit` / `pnpm audit`
  - Python: `pip-audit` or `safety check`
  - Rust: `cargo audit`
- [ ] No critical/high vulnerabilities unpatched
- [ ] Lockfile committed (`package-lock.json`, `poetry.lock`, etc.)
- [ ] No abandoned/unmaintained packages doing security-critical work

### 1.6 File Uploads (if applicable)
- [ ] File type validated by content (magic bytes), not just extension
- [ ] File size limits enforced
- [ ] Uploaded files stored outside webroot / served with safe Content-Type
- [ ] Filenames sanitized (no path traversal via filename)

---

## 2. 🐛 Bug & Logic Checks

### 2.1 Input Validation
- [ ] Empty input handled on every field
- [ ] Extremely long input handled (10,000+ chars)
- [ ] Special characters handled: `' " < > & \ / ; -- 🚀 emoji, unicode, RTL text`
- [ ] Negative numbers, zero, and huge numbers where numeric input is expected
- [ ] Wrong types rejected (string where number expected, array where object expected)
- [ ] Leading/trailing whitespace trimmed where it matters (emails, usernames)

### 2.2 Edge Cases
- [ ] Empty lists/arrays don't crash rendering or loops
- [ ] Null/undefined/None handled on every optional field (biggest crash source)
- [ ] Division by zero guarded
- [ ] Off-by-one errors checked in loops, pagination, slicing
- [ ] Timezone handling: dates stored in UTC, converted at display
- [ ] Concurrent actions: double-clicking submit doesn't create duplicate records (idempotency)
- [ ] Race conditions: two requests modifying the same resource simultaneously

### 2.3 Error Handling
- [ ] Every `async`/network call wrapped in try-catch or `.catch()`
- [ ] No silent failures — errors logged with context
- [ ] User sees a friendly error message, not a white screen or raw exception
- [ ] App recovers gracefully when: API is down, DB is unreachable, network drops mid-request
- [ ] Timeouts set on all external calls (no infinite hangs)
- [ ] Retry logic doesn't cause duplicate side effects (payments, emails)

### 2.4 State & Data Integrity
- [ ] No memory leaks (unremoved event listeners, uncleared intervals, unclosed connections)
- [ ] DB transactions used where multiple writes must succeed/fail together
- [ ] Cache invalidation works (stale data doesn't persist after updates)
- [ ] Deleted resources return 404, not stale data or crashes
- [ ] Unique constraints in DB back up application-level uniqueness checks

### 2.5 Frontend-Specific (if applicable)
- [ ] Loading states shown for all async operations
- [ ] Buttons disabled while request is in flight
- [ ] Back button / refresh doesn't break state or resubmit forms
- [ ] Works on mobile viewport (320px width minimum)
- [ ] No console errors or warnings in browser devtools
- [ ] Forms preserve input on validation failure (don't wipe the user's data)

### 2.6 Backend-Specific (if applicable)
- [ ] All endpoints return correct HTTP status codes (200/201/400/401/403/404/500)
- [ ] Pagination on any endpoint that returns lists (no unbounded queries)
- [ ] N+1 query problems checked (log DB queries, look for loops of queries)
- [ ] Graceful shutdown handled (in-flight requests complete)
- [ ] Health check endpoint exists (`/health` or `/ping`)

---

## 3. ⚡ Performance Checks
- [ ] Largest page/endpoint responds in < 2s under normal load
- [ ] Images compressed / lazy-loaded
- [ ] DB indexes on all columns used in WHERE / JOIN / ORDER BY
- [ ] No blocking synchronous operations in async servers
- [ ] Bundle size checked (frontend) — no accidental 5MB imports
- [ ] Load test critical endpoints (e.g., `wrk`, `k6`, `locust`) — know your breaking point

---

## 4. 🤖 Automated Scans (run all that apply)

| Check | Node/JS | Python | General |
|---|---|---|---|
| Linting | `eslint .` | `ruff check .` | — |
| Type safety | `tsc --noEmit` | `mypy .` | — |
| Dependency vulns | `npm audit` | `pip-audit` | `osv-scanner` |
| Secret scanning | — | — | `gitleaks detect` |
| Static security analysis | `semgrep --config auto` | `bandit -r .` | `semgrep --config auto` |
| Unit tests | `npm test` | `pytest` | — |
| Coverage | `npm test -- --coverage` | `pytest --cov` | aim ≥ 70% on core logic |

---

## 5. 🚀 Pre-Deployment Final Gate
- [ ] All automated scans above pass
- [ ] Debug mode / verbose logging OFF in production
- [ ] Default credentials changed (admin/admin, root/root)
- [ ] Database backups configured and restore tested
- [ ] Monitoring/alerts set up (know when it breaks before users tell you)
- [ ] Rollback plan exists (can you revert in < 5 minutes?)
- [ ] `.git`, `.env`, config files not accessible via public URL
- [ ] Tested on a clean environment (fresh clone + install + run works)

---

## 6. 📝 Manual Attack Simulation (15-min pentest)
Try to break your own app:
1. Log in as User A, grab a resource URL/ID, log in as User B, try to access it
2. Intercept a request (browser devtools / Burp), change the price/role/user_id field, resubmit
3. Paste `<script>alert(1)</script>` into every text field
4. Paste `' OR 1=1 --` into search/login fields
5. Hit rate-limited endpoints 100 times fast (script it)
6. Kill your internet mid-form-submit and see what happens
7. Send requests with missing/extra/malformed JSON fields directly via `curl`

If any of these succeed → **fix before shipping.**

---

*Last audited: __________ | Audited by: __________ | Verdict: PASS / FAIL*
