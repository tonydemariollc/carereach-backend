// src/routes/webhooks.js
// Stripe webhook handler — processes subscription lifecycle events
// IMPORTANT: This route must receive raw body (not parsed JSON)
// It is mounted BEFORE express.json() in index.js

const express = require('express');
const Stripe = require('stripe');
const { logger } = require('../config/logger');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const router = express.Router();

// ── POST /api/webhooks/stripe ────────────────────────────────
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }), // Raw body required for signature verification
  async (req, res) => {
    const sig     = req.headers['stripe-signature'];
    const secret  = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      logger.warn('Webhook signature verification failed', { error: err.message });
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    logger.info('Stripe webhook received', { type: event.type, id: event.id });

    try {
      await handleEvent(event);
      res.json({ received: true });
    } catch (err) {
      logger.error('Webhook handler error', { type: event.type, error: err.message });
      // Return 200 to prevent Stripe from retrying — log the error for manual review
      res.json({ received: true, error: err.message });
    }
  }
);

// ── Event Handlers ───────────────────────────────────────────
async function handleEvent(event) {
  const { type, data } = event;

  switch (type) {

    // New subscription created (after checkout or trial start)
    case 'customer.subscription.created': {
      const sub  = data.object;
      const plan = sub.metadata?.plan || 'pro';
      logger.info('Subscription created', { subscriptionId: sub.id, plan, customerId: sub.customer });
      // TODO: Update user plan in your database
      // await db.users.update({ stripeCustomerId: sub.customer }, { plan, subscriptionId: sub.id });
      // TODO: Send welcome email via SendGrid
      break;
    }

    // Trial ended, subscription now active (first real charge)
    case 'customer.subscription.trial_will_end': {
      const sub = data.object;
      logger.info('Trial ending soon', { subscriptionId: sub.id, trialEnd: sub.trial_end });
      // TODO: Send "your trial ends in 3 days" email
      break;
    }

    // Plan changed (upgrade or downgrade)
    case 'customer.subscription.updated': {
      const sub     = data.object;
      const newPlan = sub.metadata?.plan;
      logger.info('Subscription updated', { subscriptionId: sub.id, plan: newPlan, status: sub.status });
      // TODO: Update user plan in DB
      // await db.users.update({ stripeCustomerId: sub.customer }, { plan: newPlan });
      break;
    }

    // Subscription cancelled or expired
    case 'customer.subscription.deleted': {
      const sub = data.object;
      logger.info('Subscription cancelled', { subscriptionId: sub.id, customerId: sub.customer });
      // TODO: Downgrade user to free/suspended status in DB
      // TODO: Send cancellation email with feedback survey
      break;
    }

    // Payment succeeded
    case 'invoice.payment_succeeded': {
      const inv = data.object;
      if (inv.billing_reason === 'subscription_cycle') {
        logger.info('Recurring payment succeeded', { invoiceId: inv.id, amount: inv.amount_paid / 100 });
        // TODO: Send receipt email
      }
      break;
    }

    // Payment failed — notify user immediately
    case 'invoice.payment_failed': {
      const inv = data.object;
      logger.warn('Payment failed', { invoiceId: inv.id, customerId: inv.customer, attemptCount: inv.attempt_count });
      // TODO: Send "payment failed" email with update link
      // TODO: After 3 failures, suspend account access
      break;
    }

    // Customer added or updated a payment method
    case 'payment_method.attached': {
      logger.info('Payment method attached', { customerId: data.object.customer });
      break;
    }

    default:
      logger.debug('Unhandled webhook event', { type });
  }
}

module.exports = router;
