# 🛡️ SECURITY.md — Hardened Defense-in-Depth Checklist

> **Reality check:** No system is 100% unhackable. The goal is *defense in depth* — many layers, so that breaking one doesn't break everything. Assume every layer WILL eventually fail, and make sure the next one catches it.
>
> **Threat model first:** Before checking anything, answer: *What am I protecting? Who wants it? What happens if they get it?* Security without a threat model is just cargo-culting.

---

## 🎯 The 5 Core Principles
1. **Least privilege** — every user, service, token, and DB account gets the *minimum* access needed. Nothing more.
2. **Defense in depth** — never rely on one control. Auth + validation + rate limits + monitoring, layered.
3. **Fail closed** — when something breaks or is ambiguous, deny access, don't grant it.
4. **Zero trust** — validate *everything* server-side. The client is hostile. Always.
5. **Assume breach** — design so that a compromised component can't take down the whole system.

---

## 1. 🔐 Secrets Management (the #1 way startups get owned)
- [ ] **Zero secrets in code, ever** — enforced by a pre-commit hook (`gitleaks protect --staged`)
- [ ] Secrets live in a manager: AWS Secrets Manager / Vault / Doppler / at minimum `.env` (gitignored)
- [ ] **Scan full git history** — a deleted secret is still in history: `gitleaks detect --log-opts="--all"`
- [ ] **Every secret ever committed is ROTATED** — the old value is compromised forever
- [ ] Different secrets per environment (dev / staging / prod never share keys)
- [ ] Secrets have expiry + rotation schedule where the provider supports it
- [ ] CI/CD secrets stored in the platform's secret store, never echoed in logs
- [ ] `.env.example` committed with dummy values so nobody hardcodes real ones

## 2. 🔑 Authentication (get this wrong and nothing else matters)
- [ ] Passwords hashed with **argon2id** (preferred) or **bcrypt** (cost ≥ 12) — never MD5/SHA/plaintext
- [ ] Minimum password policy + block against known-breached passwords (HaveIBeenPwned API)
- [ ] **MFA/2FA** available for all accounts, mandatory for admins
- [ ] JWT done right: short-lived access token (≤15 min) + rotating refresh token, algorithm pinned (`RS256`/`HS256`, reject `none`), strong 32+ char secret
- [ ] Refresh tokens are revocable (stored server-side / in a denylist)
- [ ] Sessions invalidated on logout AND on password change
- [ ] **Rate limit + exponential backoff** on login, signup, OTP, password reset
- [ ] Account lockout or CAPTCHA after N failed attempts
- [ ] Generic error messages ("invalid credentials") — never reveal whether the email exists (user enumeration)
- [ ] Password reset tokens: single-use, short expiry, cryptographically random, tied to the user

## 3. 🚪 Authorization (the most-missed vuln class)
- [ ] **Every** endpoint checks authz server-side — hiding a UI button is NOT security
- [ ] **IDOR test:** User A cannot access User B's data by changing an ID in the URL/body. Test this manually.
- [ ] Object-level authorization: check ownership on *every* resource fetch, not just at login
- [ ] Function-level authorization: normal users can't hit admin endpoints even if they know the URL
- [ ] Role checks default to DENY (fail closed)
- [ ] No privilege escalation: users can't set their own `role`/`is_admin` via the API
- [ ] Mass-assignment protected: whitelist which fields an API accepts, never blindly spread request body into a DB model

## 4. 💉 Injection & Input (assume all input is an attack)
- [ ] **SQL/NoSQL:** parameterized queries / ORM only — zero string concatenation
- [ ] **Command injection:** no user input in `exec`/`eval`/`system`/`subprocess(shell=True)`
- [ ] **XSS:** output-encode all user content; avoid `innerHTML`/`dangerouslySetInnerHTML`; set a strict CSP
- [ ] **SSRF:** validate & allowlist any URL the server fetches (block internal IPs `169.254.*`, `127.*`, `10.*`, metadata endpoints)
- [ ] **Path traversal:** canonicalize and validate all file paths against an allowlist
- [ ] **Deserialization:** never deserialize untrusted data with `pickle`/`yaml.load`/native Java serialization
- [ ] **Prototype pollution** (JS): guard against `__proto__`/`constructor` keys in JSON
- [ ] Validate input against a strict schema (zod / pydantic / joi) — allowlist, don't blocklist
- [ ] Enforce max lengths and size limits on every field and request body

## 5. 🌐 Network & Transport
- [ ] **HTTPS/TLS everywhere**, HTTP redirects to HTTPS, HSTS header with long max-age
- [ ] TLS 1.2+ only; weak ciphers disabled
- [ ] **CORS:** explicit origin allowlist — never `Access-Control-Allow-Origin: *` with credentials
- [ ] Security headers (all present):
  - `Content-Security-Policy` (strict, no `unsafe-inline`)
  - `Strict-Transport-Security`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` (clickjacking)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
- [ ] **CSRF protection** on all state-changing requests (SameSite=Strict cookies + CSRF tokens)
- [ ] Cookies: `HttpOnly`, `Secure`, `SameSite=Strict`
- [ ] Webhooks verify HMAC signatures (Razorpay/Stripe/GitHub) — reject unsigned
- [ ] Sensitive data never in URLs/query strings (they get logged everywhere)

## 6. 🚦 Rate Limiting & Abuse Prevention
- [ ] Global rate limit per IP + per authenticated user
- [ ] Stricter limits on expensive/sensitive endpoints (auth, search, file upload, AI/LLM calls)
- [ ] Request body size caps (block giant-payload DoS)
- [ ] Timeout on every external call — no infinite hangs
- [ ] LLM/AI endpoints: token & cost limits per user (prevent bill-bombing)
- [ ] Bot protection on public forms (CAPTCHA / Turnstile)
- [ ] DDoS protection at the edge (Cloudflare / WAF in front of origin)

## 7. 📦 Dependencies & Supply Chain
- [ ] Automated audit in CI: `npm audit` / `pip-audit` / `cargo audit` — **build fails on critical**
- [ ] Dependabot / Renovate enabled for auto-update PRs
- [ ] Lockfiles committed and integrity-verified
- [ ] Pin dependency versions; review before major upgrades
- [ ] Minimize dependencies — every package is attack surface
- [ ] `osv-scanner` or `snyk` in the pipeline for a second opinion
- [ ] Verify integrity of anything downloaded at build time (checksums)

## 8. 🗄️ Data Protection
- [ ] Encryption at rest (DB, backups, file storage)
- [ ] Encryption in transit (TLS between every service, including internal)
- [ ] PII minimized — don't collect what you don't need
- [ ] Sensitive fields encrypted at the application layer where warranted
- [ ] DB user has least privilege (app account can't `DROP TABLE` or read other schemas)
- [ ] Backups: automated, encrypted, and **restore-tested** (an untested backup isn't a backup)
- [ ] Soft-delete + audit trail for critical records
- [ ] Data retention & deletion policy (GDPR/DPDP compliance if you have EU/India users)

## 9. 📁 File Uploads
- [ ] Validate by magic bytes / content, not extension
- [ ] Enforce strict size and type limits
- [ ] Store outside webroot; serve with forced `Content-Disposition` and safe content-type
- [ ] Randomize stored filenames (no user-controlled paths)
- [ ] Scan uploads for malware if they'll be shared/served
- [ ] Never execute uploaded content

## 10. 📊 Logging, Monitoring & Detection
- [ ] Structured logging on all auth events, access-denied, and errors
- [ ] **Never log** passwords, tokens, full card numbers, or PII
- [ ] Centralized logs (can't be tampered by an attacker who breaches one box)
- [ ] Alerts on: repeated auth failures, privilege changes, unusual data access, error spikes
- [ ] Someone actually *watches* the alerts (or they're useless)
- [ ] Audit log for admin actions — immutable, timestamped, attributed

## 11. ⚙️ Configuration & Deployment
- [ ] Debug mode **OFF** in production; stack traces never shown to users
- [ ] Default/sample credentials removed
- [ ] Admin panels behind IP allowlist / VPN / extra auth
- [ ] `.env`, `.git`, `/config`, backups NOT reachable via public URL
- [ ] Containers run as non-root, minimal base image, read-only filesystem where possible
- [ ] Servers/OS/runtime patched and auto-updating
- [ ] Infrastructure-as-code reviewed (no `0.0.0.0/0` open security groups)
- [ ] Rollback plan tested (< 5 min to revert)
- [ ] Least-privilege IAM roles for every service

## 12. 🤖 Automated Security Scans (wire into CI/CD)

| Layer | Tool | Fails build on |
|---|---|---|
| Secrets | `gitleaks` / `trufflehog` | any secret found |
| SAST (code) | `semgrep --config auto` | high severity |
| Python SAST | `bandit -r .` | high severity |
| Deps | `osv-scanner` / `npm audit` / `pip-audit` | critical CVE |
| Container | `trivy image <img>` | critical CVE |
| IaC | `checkov` / `tfsec` | misconfig |
| DAST (running app) | `OWASP ZAP` baseline | high alerts |
| Types | `tsc --noEmit` / `mypy` | any error |

---

## 13. 🔴 Red Team Yourself (do this before an attacker does)
Actively try to break in:
1. **IDOR:** log in as User A, note a resource ID, log in as User B, request A's resource
2. **Privilege escalation:** send `"role":"admin"` / `"is_admin":true` in profile-update requests
3. **Auth bypass:** hit protected endpoints with no token, expired token, another user's token, `alg:none` JWT
4. **Injection:** `' OR 1=1--`, `<script>alert(1)</script>`, `${7*7}`, `../../etc/passwd`, `{$gt:""}` in every field
5. **SSRF:** submit URLs pointing to `http://169.254.169.254/` (cloud metadata) and `http://localhost`
6. **Rate limits:** script 1000 rapid requests to login and any expensive endpoint
7. **Mass assignment:** add unexpected fields to JSON bodies and see if they stick
8. **Business logic:** intercept requests, change price/quantity/user_id, replay
9. **CSRF:** craft a cross-site request to a state-changing endpoint
10. **Cost bomb:** hammer LLM/AI/email endpoints — do you get a huge bill?

Anything that succeeds = **critical, fix before shipping.**

---

## 14. 📅 Ongoing (security is a process, not a checkbox)
- [ ] Dependency audit runs on every PR
- [ ] Secrets rotated on a schedule
- [ ] Quarterly review of access/permissions (remove ex-users, unused keys)
- [ ] Incident response plan written *before* you need it (who to call, how to revoke, how to communicate)
- [ ] Consider a bug bounty / responsible disclosure policy once you have real users
- [ ] Re-run this whole checklist before every major release

---

## 📚 Standards to align with
- **OWASP Top 10** — the canonical web vuln list; map your code against it
- **OWASP ASVS** — Application Security Verification Standard (deeper, level 1/2/3)
- **CIS Benchmarks** — for OS/cloud/container hardening

---

*"The only truly secure system is one that is powered off, cast in a block of concrete, and sealed in a lead-lined room with armed guards — and even then I have my doubts." — Gene Spafford*

*Last audited: __________ | Audited by: __________ | Verdict: PASS / FAIL / NEEDS-WORK*
