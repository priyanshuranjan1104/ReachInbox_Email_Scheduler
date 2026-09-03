# REQUIREMENTS CHECKLIST
# ReachInbox Email Scheduler — Intern Assignment

> Derived from the ReachInbox Software Development Intern Assignment specification.  
> Check off each item as it is implemented and verified.

---

## BACKEND

### Core Setup
- [ ] TypeScript strict mode configured
- [ ] Express.js server bootstrapped
- [ ] Environment variables loaded via `dotenv` (never committed)
- [ ] Structured logging (e.g. pino / winston)
- [ ] Global error handling middleware
- [ ] Input validation middleware (e.g. zod / joi)

### Database — PostgreSQL
- [ ] PostgreSQL running via Docker Compose
- [ ] Prisma ORM configured and connected
- [ ] Initial migration: `users`, `jobs`, `emails`, `rate_limit_events` tables
- [ ] Idempotency key column on `emails` table (prevents duplicate sends)

### Job Queue — BullMQ + Redis
- [ ] Redis running via Docker Compose
- [ ] BullMQ queue defined (`email-queue`)
- [ ] BullMQ worker defined with **configurable concurrency** (env var)
- [ ] Email jobs enqueued with **configurable delay** between recipients
- [ ] Jobs survive Redis/server restart (BullMQ persistence via Redis AOF)
- [ ] API-based scheduling only — **no cron jobs**

### Email Sending — Ethereal SMTP
- [ ] Nodemailer configured with Ethereal SMTP credentials (generated at runtime)
- [ ] Ethereal preview URL logged after each send
- [ ] Email status updated in PostgreSQL after send attempt

### Rate Limiting
- [ ] **Minimum delay** between emails (BullMQ `delay` option, ms-based)
- [ ] **Hourly rate limit** (global) — Redis sliding-window counter
- [ ] **Per-sender rate limit** — Redis counter per sender email address
- [ ] Rate-limit state stored in **Redis** (survives backend restart)
- [ ] When hourly limit is reached: job **rescheduled** to next window (not dropped)
- [ ] When per-sender limit is reached: job **rescheduled** (not dropped)
- [ ] **Slack notification** sent when any rate limit is hit

### Slack Integration
- [ ] Real **Slack OAuth** flow implemented (not a webhook-only integration)
- [ ] Slack app installed to a workspace via OAuth
- [ ] Slack notification sent on rate-limit event (includes job ID, limit type, retry time)

### Fault Tolerance & Idempotency
- [ ] BullMQ job data includes `idempotencyKey` (jobId + recipient hash)
- [ ] Before sending, worker checks PostgreSQL for existing `idempotencyKey`
- [ ] **Duplicate send prevention**: if key already exists with `SENT` status → skip
- [ ] Application state **persists after server/worker restart**

### Scale / Stress
- [ ] Correctly handles scheduling **1000+ emails** in a single job
- [ ] No memory leak or queue overflow when 1000+ jobs are enqueued
- [ ] Worker processes queue without blocking the API server

### BullMQ Dashboard
- [ ] Bull Board mounted at `/admin/queues`
- [ ] Shows: active, waiting, delayed, failed, completed queues
- [ ] Supports manual retry of failed jobs

---

## AUTHENTICATION

### Google OAuth
- [ ] Real **Google OAuth 2.0** implemented (Passport.js `passport-google-oauth20`)
- [ ] Redirects to Google consent screen
- [ ] On successful login: stores **user name**, **user email**, **avatar URL**
- [ ] Session persisted in Redis (`express-session` + `connect-redis`)
- [ ] **Logout** endpoint clears session
- [ ] Protected API routes return `401` if unauthenticated
- [ ] OAuth credentials stored in `.env` only (never in source code)

---

## FRONTEND

### Setup
- [ ] Next.js 14 (App Router) with TypeScript
- [ ] Tailwind CSS configured
- [ ] ESLint + Prettier configured
- [ ] API client (fetch wrapper / axios) with auth headers

### Pages & Views
- [ ] **Dashboard** — overview stats (total scheduled, sent, failed, rate-limited)
- [ ] **Scheduled Emails** — paginated list of pending/scheduled emails
- [ ] **Sent Emails** — paginated list of delivered emails with Ethereal preview links
- [ ] **Compose New Email** — form to create a new batch job

### Compose Form
- [ ] **Subject** field
- [ ] **Body** field (rich text or plain textarea)
- [ ] **CSV / plain-text upload** for recipient list
- [ ] **Email count detection** — show number of recipients parsed from file
- [ ] **Start time** — datetime picker for when to begin sending
- [ ] **Delay between emails** — numeric input (seconds/minutes)
- [ ] **Hourly limit** — numeric input (max emails per hour)

### UX Polish
- [ ] **Loading states** on all async operations
- [ ] **Empty states** for lists with no data
- [ ] **Error handling** — display API errors gracefully
- [ ] **Reusable components** — Button, Input, Badge, Table, Modal, Toast

### Search UI
- [ ] Search bar connected to Elasticsearch API
- [ ] Search results show email subject, recipient, status, timestamp
- [ ] Filter search results by status (scheduled / sent)

---

## SEARCH

- [ ] Elasticsearch running via Docker Compose
- [ ] Elasticsearch index created for `emails`
- [ ] Email documents indexed on: **schedule** and **send**
- [ ] Full-text search across: subject, body, recipient, sender, status
- [ ] Search API endpoint: `GET /api/search?q=...&status=...`
- [ ] Paginated search results
- [ ] Search results displayed in frontend

---

## INFRASTRUCTURE

- [ ] **PostgreSQL** running via Docker Compose (no Windows install)
- [ ] **Redis** running via Docker Compose (no Windows install)
- [ ] **Elasticsearch** running via Docker Compose (no Windows install)
- [ ] All credentials are environment-variable driven
- [ ] `docker compose up -d` brings up all services cleanly
- [ ] Healthchecks configured for all services
- [ ] Named volumes for data persistence across restarts
- [ ] `docker compose down -v` performs clean reset

---

## SUBMISSION

- [ ] Private GitHub repository created
- [ ] All code committed and pushed
- [ ] **README.md** present with:
  - [ ] Architecture explanation (diagram)
  - [ ] Setup instructions (step-by-step)
  - [ ] Environment variable reference
  - [ ] API reference
  - [ ] Assumptions documented
  - [ ] Trade-offs documented
- [ ] **Demo video** ≤ 5 minutes recorded and linked
  - [ ] Shows Google OAuth login
  - [ ] Shows scheduling 1000+ emails
  - [ ] Shows BullMQ dashboard with live jobs
  - [ ] Shows rate-limit hit + Slack notification
  - [ ] Shows Elasticsearch search
  - [ ] Shows Sent Emails list with Ethereal preview links

---

## CHECKLIST SUMMARY

| Area           | Total Items | Completed |
|----------------|-------------|-----------|
| Backend        | 27          | 0         |
| Authentication | 7           | 0         |
| Frontend       | 18          | 0         |
| Search         | 7           | 0         |
| Infrastructure | 8           | 0         |
| Submission     | 10          | 0         |
| **TOTAL**      | **77**      | **0**     |

> Update this table as items are completed.
