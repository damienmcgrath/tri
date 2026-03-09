# Production Readiness Plan

This plan is a pre-launch hardening checklist for taking TriCoach AI from “working MVP” to “public production” with emphasis on **security**, **performance**, and **operational reliability**.

## 1) Current-state assessment (what exists now)

### Strengths already in place
- Auth gating for protected routes is implemented in middleware.
- Environment variables are validated via Zod helper.
- Supabase RLS is already part of the schema strategy.
- File upload restrictions include extension and max size checks.
- Basic tests, linting, and type-check commands exist.

### Gaps that block public launch
- No explicit production security headers/CSP configuration yet.
- No API rate limiting/abuse protection on upload and chat endpoints.
- No explicit bot/traffic protection or WAF layer documented.
- No SLOs, alerting, on-call workflow, or incident runbooks documented.
- No budget controls for OpenAI usage and no clear per-user cost guardrails.
- No defined load/performance targets or capacity test baselines.

## 2) Launch gates (go/no-go)

Do not launch publicly until all **P0** gates are complete.

### P0 (must complete before public launch)
1. **Security hardening**
   - Add security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
   - Add CSRF strategy for state-changing endpoints where needed.
   - Add centralized input/file validation and sanitize user-generated content.
   - Add API rate limiting for auth-adjacent, upload, and AI chat routes.
   - Run dependency and secret scans in CI.
2. **Data protection**
   - Verify all user tables enforce RLS with deny-by-default posture.
   - Ensure least-privilege service-role usage and key rotation procedure.
   - Define retention/deletion policy for uploads and AI chat history.
3. **Performance baseline**
   - Set page/API latency targets and verify against representative load.
   - Add caching strategy for expensive reads and AI context fetches.
   - Enforce payload size limits and request timeouts.
4. **Observability and incident response**
   - Ship structured logs with request IDs and user-safe metadata.
   - Add error tracking and alerting (Sentry + uptime checks + DB alerts).
   - Create runbooks for auth outage, DB outage, AI provider failure, and upload parser failure.
5. **Release and rollback safety**
   - Blue/green or canary deployment process.
   - One-command rollback and migration rollback/forward plan.
   - Staging environment parity with production critical settings.

### P1 (complete within first 2 weeks after launch)
- Add synthetic monitoring for critical user paths (sign in, upload, chat, plan edit).
- Add anomaly alerts for upload parse failures and AI error spikes.
- Add dashboard for per-user and per-feature cost tracking.
- Add background job retries and dead-letter handling for async workflows.

### P2 (complete in first 1-2 months)
- Formal security review/pen test.
- Disaster recovery game day (restore from backup, region failover simulation).
- Performance optimization pass from real-user telemetry (Web Vitals + slow queries).

## 3) Security workplan

### Application/API security
- Enforce strict schema validation for all API bodies and query params.
- Add rate limits:
  - `/api/coach/chat`: requests/min per user and per IP.
  - upload endpoints: requests/hour and bytes/day per user.
  - auth endpoints: brute-force protection and lockout thresholds.
- Add abuse controls (captcha/challenge) on high-risk anonymous entry points.
- Add anti-automation controls for account creation/sign-in.

### Web security headers and browser protections
- Configure CSP with explicit `connect-src` for Supabase/OpenAI only.
- Enable HSTS in production.
- Add frame-ancestors restrictions.
- Add secure cookies and strict same-site settings where possible.

### Supply-chain and secrets
- CI checks: `npm audit` (or equivalent), lockfile integrity, secret scanning.
- Rotate all production keys before launch.
- Store secrets only in deployment platform secret manager.
- Create emergency key revocation playbook.

### Data security and privacy
- Classify stored data (workout data, uploads, chat text, auth data).
- Encrypt sensitive data at rest (platform defaults + DB settings verification).
- Publish privacy policy and terms before public launch.
- Add user data export and delete flow (privacy compliance baseline).

## 4) Performance and scalability workplan

### Targets (initial)
- p95 API latency: < 500ms for non-AI endpoints.
- p95 page load (authenticated app shell): < 2.5s on broadband.
- Error rate: < 1% on core flows.
- Chat first-response (stream start or first token): < 3s median.

### Backend and database
- Add query-level observability and slow query logs.
- Ensure indexes for frequent filters/sorts in dashboard/plan/calendar paths.
- Add pagination/limits to all list endpoints.
- Add server-side caching for repeated dashboard summary reads.

### Frontend
- Review bundle size; defer heavy client-only components.
- Use route-level loading states and suspense boundaries.
- Avoid unnecessary re-fetching in protected pages.
- Track Core Web Vitals and regressions in CI.

### AI cost/performance controls
- Set hard per-user daily token caps and global daily spend cap.
- Add response caching keyed by prompt/context fingerprint.
- Add timeout + graceful fallback responses.
- Add model fallback chain and provider outage handling.

## 5) Reliability, operations, and support

### Observability stack
- Error tracking: Sentry.
- Product analytics: PostHog (funnel and feature usage).
- Metrics: request rate, latency, error rate, saturation, queue depth.
- Uptime monitor for homepage, health check, auth callback, and API routes.

### On-call and runbooks
- Define severity levels (SEV1-SEV4).
- Define escalation path and incident communication template.
- Create runbooks for:
  - Supabase incident.
  - OpenAI API degradation.
  - Upload parsing regression.
  - Migration failure.

### Backup/restore and DR
- Verify automated DB backups and restoration drills.
- Define RPO/RTO targets.
- Document restore steps and ownership.

## 6) Product and business readiness checklist

### Legal/compliance
- Privacy Policy and Terms of Service live on production domain.
- Cookie policy/consent flow if required by target geography.
- Medical/safety disclaimers for AI coaching responses.

### Trust and communication
- Status page or at least incident communication channel.
- In-app feedback/report issue mechanism.
- User-facing changelog for major behavior changes.

### Support readiness
- Basic support workflow (email/help desk).
- SLA/SLO expectations for users.
- Triage categories: billing, auth, sync, AI coach, data mismatch.

## 7) Execution plan (recommended sequence)

### Week 1: Security + release safety
- Implement security headers, rate limiting, and CI scans.
- Complete key rotation and secret manager audit.
- Write incident runbooks and rollback playbook.

### Week 2: Performance baseline + observability
- Instrument latency/error dashboards.
- Run load tests and tune top DB/API bottlenecks.
- Add AI spend caps and caching.

### Week 3: Staging dress rehearsal
- Full end-to-end launch simulation in staging.
- Run migration/rollback drill.
- Run incident tabletop exercise.

### Week 4: Controlled production rollout
- Launch to small cohort first.
- Monitor SLOs and error budgets daily.
- Expand access only after stable metrics over multiple days.

## 8) Definition of production-ready

You are ready for public launch when:
- All P0 gates are complete and signed off.
- Load/performance targets are met in staging and initial canary.
- Alerting and on-call response are proven in drills.
- Privacy/legal pages are published and linked.
- Rollback can be executed quickly with validated procedure.
