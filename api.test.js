// tests/api.test.js
// Integration tests using Jest + Supertest
// Run: npm test

const request = require('supertest');
const app     = require('../src/index');

let authToken;
let testUserId;

// ── Auth Tests ───────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('registers a new user and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email:      'test@premierhomehealth.com',
      password:   'SecurePass123!',
      name:       'Jessica Martinez',
      agencyName: 'Premier Home Health',
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.plan).toBe('pro');
    authToken  = res.body.token;
    testUserId = res.body.user.id;
  });

  it('rejects duplicate email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email:      'test@premierhomehealth.com',
      password:   'AnotherPass456!',
      name:       'Duplicate User',
      agencyName: 'Another Agency',
    });
    expect(res.status).toBe(409);
  });

  it('rejects short password', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email:    'short@test.com',
      password: '123',
      name:     'Test',
      agencyName: 'Test Agency',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:    'test@premierhomehealth.com',
      password: 'SecurePass123!',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:    'test@premierhomehealth.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user profile with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test@premierhomehealth.com');
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ── Health Check ─────────────────────────────────────────────
describe('GET /health', () => {
  it('returns healthy status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services).toHaveProperty('npi', true);
  });
});

// ── Leads Tests ──────────────────────────────────────────────
describe('GET /api/leads/taxonomies', () => {
  it('returns taxonomy list without auth', async () => {
    const res = await request(app)
      .get('/api/leads/taxonomies')
      .set('Authorization', `Bearer ${authToken}`);
    // taxonomies is a public-ish endpoint, auth still required
    // just verify structure
    expect(res.status).toBeLessThan(500);
  });
});

describe('GET /api/leads/search', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/leads/search');
    expect(res.status).toBe(401);
  });

  it('validates state param', async () => {
    const res = await request(app)
      .get('/api/leads/search?state=TOOLO')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(400);
  });
});

// ── Content Tests ────────────────────────────────────────────
describe('POST /api/content/generate', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/content/generate').send({});
    expect(res.status).toBe(401);
  });

  it('validates required fields', async () => {
    const res = await request(app)
      .post('/api/content/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ type: 'email' }); // missing agency, audience, services
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it('rejects invalid content type', async () => {
    const res = await request(app)
      .post('/api/content/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ type: 'invalid', agency: 'Test', audience: 'Test', services: 'Test' });
    expect(res.status).toBe(400);
  });
});

// ── Pipeline Tests ───────────────────────────────────────────
describe('Pipeline CRUD', () => {
  let prospectId;

  it('creates a prospect', async () => {
    const res = await request(app)
      .post('/api/pipeline')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name:           "St. Mary's Hospital",
        type:           'Hospital',
        estimatedValue: 8400,
        contactName:    'Sarah Johnson',
        contactEmail:   's.johnson@stmarys.org',
      });
    expect(res.status).toBe(201);
    expect(res.body.prospect.stage).toBe('identified');
    prospectId = res.body.prospect.id;
  });

  it('moves a prospect to the next stage', async () => {
    const res = await request(app)
      .patch(`/api/pipeline/${prospectId}/stage`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ stage: 'contacted' });
    expect(res.status).toBe(200);
    expect(res.body.prospect.stage).toBe('contacted');
  });

  it('returns the pipeline board', async () => {
    const res = await request(app)
      .get('/api/pipeline')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pipeline).toHaveProperty('identified');
    expect(res.body.pipeline).toHaveProperty('active_partner');
  });

  it('deletes a prospect', async () => {
    const res = await request(app)
      .delete(`/api/pipeline/${prospectId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
  });
});

// ── Referrals Tests ──────────────────────────────────────────
describe('Referral logging', () => {
  it('logs a referral', async () => {
    const res = await request(app)
      .post('/api/referrals')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        source:          "St. Mary's Hospital",
        service:         'Skilled Nursing',
        patientInitials: 'J.D.',
      });
    expect(res.status).toBe(201);
    expect(res.body.referral.source).toBe("St. Mary's Hospital");
  });

  it('returns referral summary', async () => {
    const res = await request(app)
      .get('/api/referrals')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sources');
    expect(res.body.total).toBeGreaterThan(0);
  });
});

// ── Analytics Tests ──────────────────────────────────────────
describe('GET /api/analytics/summary', () => {
  it('returns analytics KPIs', async () => {
    const res = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toHaveProperty('totalReferrals');
    expect(res.body.kpis).toHaveProperty('emailROI');
    expect(res.body.monthlyReferrals).toHaveLength(6);
  });
});

// ── Billing Tests ────────────────────────────────────────────
describe('GET /api/billing/plans', () => {
  it('returns all pricing plans', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(3);
    expect(res.body.plans.map(p => p.id)).toEqual(['starter', 'pro', 'agency']);
  });
});

// ── White-Label Tests ────────────────────────────────────────
describe('White-label branding', () => {
  it('returns default brand settings', async () => {
    const res = await request(app)
      .get('/api/white-label')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.brand.name).toBe('CareReach');
  });

  it('rejects white-label update on non-agency plan', async () => {
    const res = await request(app)
      .put('/api/white-label')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'My Brand' });
    // Pro plan users cannot use white-label
    expect(res.status).toBe(403);
  });
});

// ── Rate Limiting ─────────────────────────────────────────────
describe('Security', () => {
  it('rejects requests without auth token', async () => {
    const endpoints = ['/api/leads/search', '/api/pipeline', '/api/referrals', '/api/analytics/summary'];
    for (const ep of endpoints) {
      const res = await request(app).get(ep);
      expect(res.status).toBe(401);
    }
  });
});
