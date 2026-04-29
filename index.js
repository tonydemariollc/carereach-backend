// ============================================================
// CareReach Backend — Main Server Entry Point
// src/index.js
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logger } = require('./config/logger');

// Route imports
const authRoutes = require('./routes/auth');
const leadsRoutes = require('./routes/leads');
const contentRoutes = require('./routes/content');
const emailRoutes = require('./routes/email');
const pipelineRoutes = require('./routes/pipeline');
const referralsRoutes = require('./routes/referrals');
const analyticsRoutes = require('./routes/analytics');
const billingRoutes = require('./routes/billing');
const whiteLabelRoutes = require('./routes/whiteLabel');
const webhookRoutes = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security Middleware ──────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Stripe webhooks need raw body — mount BEFORE json parser
app.use('/api/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests. Please try again later.' },
});
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                   // 10 AI calls per minute per IP
  message: { error: 'AI rate limit reached. Wait a moment and try again.' },
});
app.use('/api/', globalLimiter);
app.use('/api/content/generate', aiLimiter);

// ── Request Logger ───────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/leads',      leadsRoutes);
app.use('/api/content',    contentRoutes);
app.use('/api/email',      emailRoutes);
app.use('/api/pipeline',   pipelineRoutes);
app.use('/api/referrals',  referralsRoutes);
app.use('/api/analytics',  analyticsRoutes);
app.use('/api/billing',    billingRoutes);
app.use('/api/white-label', whiteLabelRoutes);

// ── Health Check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      sendgrid:  !!process.env.SENDGRID_API_KEY,
      stripe:    !!process.env.STRIPE_SECRET_KEY,
      npi:       true, // no key needed
    },
  });
});

// ── 404 Handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global Error Handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
  });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`CareReach API running on port ${PORT} [${process.env.NODE_ENV}]`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app; // for testing
