# CareReach Backend API

Production-ready Node.js/Express backend for the CareReach home health marketing SaaS platform.

## Architecture

```
carereach-backend/
├── src/
│   ├── index.js              # Express app entry point
│   ├── config/
│   │   └── logger.js         # Winston structured logging
│   ├── middleware/
│   │   └── auth.js           # JWT auth + plan feature gates
│   └── routes/
│       ├── auth.js           # Register, login, profile
│       ├── leads.js          # NPI Registry lead finder
│       ├── content.js        # Claude AI content generation
│       ├── email.js          # SendGrid email campaigns
│       ├── pipeline.js       # CRM pipeline CRUD
│       ├── referrals.js      # Referral tracking
│       ├── analytics.js      # KPIs and reporting
│       ├── billing.js        # Stripe subscriptions
│       ├── whiteLabel.js     # White-label branding
│       └── webhooks.js       # Stripe webhook handler
└── tests/
    └── api.test.js           # Full integration test suite
```

## Quick Start

### 1. Install dependencies
```bash
cd carereach-backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your real API keys (see section below)
```

### 3. Start development server
```bash
npm run dev      # Auto-restarts on file changes (nodemon)
# or
npm start        # Production start
```

### 4. Verify it's working
```bash
curl http://localhost:3001/health
```

---

## API Keys Setup

### Anthropic (Claude AI Content)
1. Go to https://console.anthropic.com
2. Create an API key
3. Set `ANTHROPIC_API_KEY=sk-ant-api03-...` in `.env`

### SendGrid (Email Campaigns)
1. Go to https://app.sendgrid.com/settings/api_keys
2. Create a key with **Full Access** (or Mail Send + Tracking)
3. **Verify your sender email** at Settings → Sender Authentication
4. Set `SENDGRID_API_KEY=SG.xxx...` in `.env`
5. Set `SENDGRID_FROM_EMAIL=you@yourdomain.com`

### Stripe (Billing & Subscriptions)
1. Go to https://dashboard.stripe.com/apikeys
2. Copy your **Secret key** (use test key first: `sk_test_...`)
3. Set `STRIPE_SECRET_KEY=sk_live_...` in `.env`

**Create your subscription products:**
```bash
# Using Stripe CLI:
stripe products create --name="CareReach Starter"
stripe prices create --product=prod_xxx --unit-amount=3900 --currency=usd --recurring[interval]=month

stripe products create --name="CareReach Pro"  
stripe prices create --product=prod_xxx --unit-amount=7900 --currency=usd --recurring[interval]=month

stripe products create --name="CareReach Agency"
stripe prices create --product=prod_xxx --unit-amount=19900 --currency=usd --recurring[interval]=month
```
Copy the `price_xxx` IDs into your `.env`.

**Set up webhooks:**
```bash
# Local development (install Stripe CLI first):
stripe listen --forward-to localhost:3001/api/webhooks/stripe
# Copy the webhook signing secret to STRIPE_WEBHOOK_SECRET in .env

# Production: Add https://yourapp.com/api/webhooks/stripe in Stripe Dashboard
# Events to enable: customer.subscription.created, .updated, .deleted,
#                   invoice.payment_succeeded, invoice.payment_failed
```

### NPI Registry
No setup needed — it's a free government API.
Docs: https://npiregistry.cms.hhs.gov/api-page

---

## API Reference

### Authentication
All protected routes require `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Get JWT token |
| GET | `/api/auth/me` | Get current user |
| PATCH | `/api/auth/profile` | Update profile |

### Lead Finder (NPI)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leads/search` | Search NPI Registry |
| GET | `/api/leads/provider/:npi` | Look up one provider |
| GET | `/api/leads/taxonomies` | List specialty types |

**Search params:** `state`, `city`, `taxonomy`, `limit`, `skip`, `minScore`

### AI Content
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/content/generate` | Generate content via Claude |
| GET | `/api/content/usage` | Monthly usage stats |
| GET | `/api/content/types` | Available content types |

**Content types:** `email`, `flyer`, `social`, `script`, `referralLetter`

### Email Campaigns (SendGrid)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/email/campaigns` | Create campaign |
| POST | `/api/email/campaigns/:id/send` | Send campaign |
| POST | `/api/email/send-test` | Send test email |
| GET | `/api/email/campaigns` | List campaigns |
| DELETE | `/api/email/campaigns/:id` | Delete campaign |

### CRM Pipeline
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline` | Get full board |
| POST | `/api/pipeline` | Add prospect |
| PATCH | `/api/pipeline/:id/stage` | Move to stage |
| PATCH | `/api/pipeline/:id` | Update details |
| DELETE | `/api/pipeline/:id` | Remove prospect |

**Stages:** `identified` → `contacted` → `meeting_set` → `proposal_sent` → `active_partner` → `lost`

### Referrals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/referrals` | Summary by source |
| POST | `/api/referrals` | Log a referral |
| GET | `/api/referrals/goals` | Monthly goal progress |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/summary` | KPIs and trends |
| GET | `/api/analytics/export` | CSV export (Pro+) |

### Billing (Stripe)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/billing/plans` | List pricing plans |
| POST | `/api/billing/checkout` | Create Stripe checkout |
| POST | `/api/billing/portal` | Open Stripe portal |
| POST | `/api/billing/upgrade` | Change plan |
| GET | `/api/billing/invoices` | Invoice history |
| GET | `/api/billing/subscription` | Current sub status |

### White-Label (Agency plan only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/white-label` | Get brand settings |
| PUT | `/api/white-label` | Save brand settings |
| GET | `/api/white-label/preview/:tenantId` | Public brand preview |

---

## Plan Limits

| Feature | Starter | Pro | Agency |
|---------|---------|-----|--------|
| Leads/month | 50 | 500 | Unlimited |
| Emails/month | 500 | 5,000 | Unlimited |
| AI Content calls | 20 | 200 | Unlimited |
| Analytics export | ✗ | ✓ | ✓ |
| White-label | ✗ | ✗ | ✓ |
| Multi-location | ✗ | ✗ | ✓ |

---

## Running Tests
```bash
npm test
# or watch mode:
npx jest --watch
```

---

## Deploying to Production

### Railway (recommended — simplest)
```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set ANTHROPIC_API_KEY=... SENDGRID_API_KEY=... STRIPE_SECRET_KEY=...
```

### Render
1. Connect your GitHub repo at render.com
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add environment variables in the Render dashboard

### DigitalOcean App Platform / Heroku
Similar — push code, set env vars, deploy.

### Adding a Real Database (PostgreSQL)
The current version uses in-memory Maps for data storage (data resets on restart).
To add PostgreSQL:
```bash
npm install pg prisma
npx prisma init
# Define your schema in prisma/schema.prisma
# Run: npx prisma migrate dev
# Replace Map usage in routes with Prisma calls
```

---

## Security Checklist (before going live)
- [ ] Change `JWT_SECRET` to a random 64-character string
- [ ] Use `sk_live_` Stripe keys (not `sk_test_`)
- [ ] Enable Stripe webhook signature verification
- [ ] Verify sender domain in SendGrid (required for deliverability)
- [ ] Set `NODE_ENV=production`
- [ ] Add HTTPS/SSL (Railway, Render, and Heroku do this automatically)
- [ ] Replace in-memory Maps with a real database (PostgreSQL recommended)
- [ ] Set `FRONTEND_URL` to your actual frontend domain for CORS
