// src/routes/billing.js
// Stripe subscription management
// Handles checkout sessions, plan upgrades, customer portal, and invoices

const express = require('express');
const Stripe = require('stripe');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../config/logger');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const router = express.Router();

// Map plan names to Stripe Price IDs (set these in your .env)
const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro:     process.env.STRIPE_PRICE_PRO,
  agency:  process.env.STRIPE_PRICE_AGENCY,
};

// Plan metadata for the UI
const PLANS = [
  {
    id:       'starter',
    name:     'Starter',
    price:    39,
    interval: 'month',
    features: ['50 leads/month', 'AI content generator', 'Basic CRM', '500 emails/month'],
    limits:   { leads: 50, emails: 500, aiContent: 20 },
  },
  {
    id:       'pro',
    name:     'Pro',
    price:    79,
    interval: 'month',
    popular:  true,
    features: ['500 leads/month', 'Unlimited AI content', 'Full CRM', '5,000 emails/month', 'Analytics dashboard', 'NPI integration'],
    limits:   { leads: 500, emails: 5000, aiContent: 200 },
  },
  {
    id:       'agency',
    name:     'Agency',
    price:    199,
    interval: 'month',
    features: ['Unlimited leads', 'Unlimited AI content', 'Unlimited emails', 'Multi-location', 'White-label branding', 'Priority support'],
    limits:   { leads: Infinity, emails: Infinity, aiContent: Infinity },
  },
];

// ── GET /api/billing/plans ───────────────────────────────────
router.get('/plans', (_req, res) => {
  res.json({ plans: PLANS });
});

// ── POST /api/billing/checkout ───────────────────────────────
// Creates a Stripe Checkout Session for new subscriptions
router.post(
  '/checkout',
  authenticate,
  [body('plan').isIn(['starter', 'pro', 'agency'])],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { plan } = req.body;
    const priceId  = PRICE_IDS[plan];

    if (!priceId) {
      return res.status(500).json({ error: `Stripe price ID for "${plan}" not configured. Check STRIPE_PRICE_${plan.toUpperCase()} in .env` });
    }

    try {
      // Create or retrieve Stripe customer
      let customerId = req.user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email:    req.user.email,
          metadata: { userId: req.user.userId, tenantId: req.user.tenantId },
        });
        customerId = customer.id;
        // In production: save customerId to your DB here
        logger.info('Stripe customer created', { customerId, userId: req.user.userId });
      }

      const session = await stripe.checkout.sessions.create({
        customer:            customerId,
        mode:                'subscription',
        payment_method_types: ['card'],
        line_items: [{
          price:    priceId,
          quantity: 1,
        }],
        subscription_data: {
          trial_period_days: 14,
          metadata: {
            userId:   req.user.userId,
            tenantId: req.user.tenantId,
            plan,
          },
        },
        success_url: `${process.env.FRONTEND_URL}/dashboard?checkout=success&plan=${plan}`,
        cancel_url:  `${process.env.FRONTEND_URL}/pricing?checkout=cancelled`,
        metadata: {
          userId: req.user.userId,
          plan,
        },
      });

      logger.info('Checkout session created', { sessionId: session.id, plan, userId: req.user.userId });

      res.json({ checkoutUrl: session.url, sessionId: session.id });
    } catch (err) {
      logger.error('Stripe checkout error', { error: err.message });
      res.status(500).json({ error: 'Could not create checkout session. Verify your Stripe configuration.' });
    }
  }
);

// ── POST /api/billing/portal ─────────────────────────────────
// Opens the Stripe customer portal (manage/cancel subscription)
router.post('/portal', authenticate, async (req, res) => {
  try {
    const customerId = req.user.stripeCustomerId;
    if (!customerId) {
      return res.status(400).json({ error: 'No billing account found. Please subscribe to a plan first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard/billing`,
    });

    res.json({ portalUrl: session.url });
  } catch (err) {
    logger.error('Stripe portal error', { error: err.message });
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// ── POST /api/billing/upgrade ────────────────────────────────
// Upgrades or downgrades an existing subscription immediately
router.post(
  '/upgrade',
  authenticate,
  [body('plan').isIn(['starter', 'pro', 'agency'])],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { plan } = req.body;
    const priceId  = PRICE_IDS[plan];

    if (!priceId) {
      return res.status(500).json({ error: `Stripe price for "${plan}" not configured.` });
    }

    try {
      // Look up current subscription
      const subscriptions = await stripe.subscriptions.list({
        customer: req.user.stripeCustomerId,
        status:   'active',
        limit:    1,
      });

      if (!subscriptions.data.length) {
        // No active sub — redirect to checkout
        return res.status(400).json({ error: 'No active subscription. Please start a new subscription.', redirect: '/api/billing/checkout' });
      }

      const subscription = subscriptions.data[0];
      const currentItem  = subscription.items.data[0];

      // Upgrade/downgrade the subscription
      const updated = await stripe.subscriptions.update(subscription.id, {
        items: [{ id: currentItem.id, price: priceId }],
        proration_behavior: 'create_prorations', // Credit unused time
        metadata: { plan },
      });

      logger.info('Subscription upgraded', { subscriptionId: updated.id, plan, userId: req.user.userId });

      res.json({
        message:        `Successfully ${req.user.plan === plan ? 'kept' : 'changed'} to ${plan} plan`,
        plan,
        subscription:   { id: updated.id, status: updated.status },
      });
    } catch (err) {
      logger.error('Stripe upgrade error', { error: err.message });
      res.status(500).json({ error: 'Subscription update failed.' });
    }
  }
);

// ── GET /api/billing/invoices ────────────────────────────────
router.get('/invoices', authenticate, async (req, res) => {
  try {
    if (!req.user.stripeCustomerId) {
      return res.json({ invoices: [] });
    }

    const invoices = await stripe.invoices.list({
      customer: req.user.stripeCustomerId,
      limit:    24,
    });

    const formatted = invoices.data.map(inv => ({
      id:          inv.id,
      number:      inv.number,
      amount:      (inv.amount_paid / 100).toFixed(2),
      currency:    inv.currency.toUpperCase(),
      status:      inv.status,
      paidAt:      inv.status_transitions?.paid_at
                     ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
                     : null,
      invoiceUrl:  inv.hosted_invoice_url,
      pdfUrl:      inv.invoice_pdf,
      description: inv.lines?.data?.[0]?.description || 'CareReach Subscription',
    }));

    res.json({ invoices: formatted });
  } catch (err) {
    logger.error('Invoice fetch error', { error: err.message });
    res.status(500).json({ error: 'Could not retrieve invoices.' });
  }
});

// ── GET /api/billing/subscription ───────────────────────────
router.get('/subscription', authenticate, async (req, res) => {
  try {
    if (!req.user.stripeCustomerId) {
      return res.json({ subscription: null, plan: req.user.plan, trial: true });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: req.user.stripeCustomerId,
      status:   'all',
      limit:    1,
    });

    if (!subscriptions.data.length) {
      return res.json({ subscription: null, plan: req.user.plan });
    }

    const sub = subscriptions.data[0];
    res.json({
      subscription: {
        id:               sub.id,
        status:           sub.status,
        plan:             sub.metadata?.plan || req.user.plan,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        trialEnd:         sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      },
    });
  } catch (err) {
    logger.error('Subscription fetch error', { error: err.message });
    res.status(500).json({ error: 'Could not retrieve subscription.' });
  }
});

module.exports = router;
