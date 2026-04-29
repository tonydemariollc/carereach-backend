// src/routes/email.js
// Email campaign delivery via SendGrid
// Handles campaign creation, sending, scheduling, and open/click tracking

const express = require('express');
const sgMail = require('@sendgrid/mail');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { authenticate, attachLimits } = require('../middleware/auth');
const { logger } = require('../config/logger');

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

const router = express.Router();

// In-memory campaign store (replace with DB in production)
const campaigns = new Map();

// ── Helpers ──────────────────────────────────────────────────
function personalizeBody(template, contact) {
  return template
    .replace(/\[First Name\]/gi,       contact.firstName || contact.name?.split(' ')[0] || 'there')
    .replace(/\[Last Name\]/gi,        contact.lastName  || '')
    .replace(/\[Name\]/gi,             contact.name      || 'there')
    .replace(/\[Hospital Name\]/gi,    contact.facility  || 'your facility')
    .replace(/\[Facility\]/gi,         contact.facility  || 'your facility')
    .replace(/\[Organization\]/gi,     contact.facility  || 'your organization')
    .replace(/\[Title\]/gi,            contact.title     || '');
}

function buildHtmlEmail(subject, body, agencyName, brandColor = '#00b4a0') {
  const textToHtml = (text) => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0}
.wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0}
.header{background:${brandColor};padding:20px 32px}.header h2{color:#fff;margin:0;font-size:18px}
.body{padding:28px 32px;font-size:15px;line-height:1.7;color:#1e293b}
.footer{background:#f1f5f9;padding:16px 32px;font-size:11px;color:#94a3b8;text-align:center}
a{color:${brandColor}}</style></head>
<body><div class="wrap">
<div class="header"><h2>${agencyName}</h2></div>
<div class="body">${textToHtml(body)}</div>
<div class="footer">
  This email was sent by ${agencyName}. 
  <a href="{{unsubscribe}}">Unsubscribe</a>
</div>
</div></body></html>`;
}

// ── POST /api/email/campaigns ────────────────────────────────
router.post(
  '/campaigns',
  authenticate,
  [
    body('name').trim().notEmpty(),
    body('subject').trim().notEmpty(),
    body('body').trim().notEmpty(),
    body('fromName').trim().notEmpty(),
    body('fromEmail').isEmail(),
    body('recipients').isArray({ min: 1 }).withMessage('At least one recipient required'),
    body('recipients.*.email').isEmail(),
    body('scheduledAt').optional().isISO8601(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, subject, body: emailBody, fromName, fromEmail, recipients, scheduledAt } = req.body;

    const campaign = {
      id:          uuidv4(),
      userId:      req.user.userId,
      name,
      subject,
      body:        emailBody,
      fromName,
      fromEmail,
      recipients,
      status:      scheduledAt ? 'scheduled' : 'draft',
      scheduledAt: scheduledAt || null,
      sentAt:      null,
      stats:       { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 },
      createdAt:   new Date().toISOString(),
    };

    campaigns.set(campaign.id, campaign);
    logger.info('Campaign created', { campaignId: campaign.id, name });

    res.status(201).json({ campaign });
  }
);

// ── POST /api/email/campaigns/:id/send ──────────────────────
router.post(
  '/campaigns/:id/send',
  authenticate,
  attachLimits,
  async (req, res) => {
    const campaign = campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.userId !== req.user.userId) return res.status(403).json({ error: 'Access denied' });
    if (campaign.status === 'sent') return res.status(400).json({ error: 'Campaign already sent' });

    // Check plan email limit
    if (campaign.recipients.length > req.planLimits.emailsPerMonth) {
      return res.status(403).json({
        error: `Your plan allows ${req.planLimits.emailsPerMonth} emails/month. This campaign has ${campaign.recipients.length} recipients.`,
        upgrade: '/api/billing/upgrade',
      });
    }

    // Get white-label brand color if set
    const brandColor = req.body.brandColor || '#00b4a0';
    const agencyName = campaign.fromName;

    try {
      const messages = campaign.recipients.map(contact => ({
        to:   contact.email,
        from: {
          email: campaign.fromEmail,
          name:  campaign.fromName,
        },
        subject:     personalizeBody(campaign.subject, contact),
        text:        personalizeBody(campaign.body, contact),
        html:        buildHtmlEmail(
                       personalizeBody(campaign.subject, contact),
                       personalizeBody(campaign.body, contact),
                       agencyName,
                       brandColor
                     ),
        trackingSettings: {
          clickTracking:    { enable: true },
          openTracking:     { enable: true },
          subscriptionTracking: { enable: true },
        },
        customArgs: {
          campaign_id: campaign.id,
          user_id:     req.user.userId,
        },
      }));

      // SendGrid supports batch sends up to 1,000 per API call
      const BATCH_SIZE = 1000;
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        await sgMail.send(messages.slice(i, i + BATCH_SIZE));
      }

      campaign.status = 'sent';
      campaign.sentAt = new Date().toISOString();
      campaign.stats.sent = campaign.recipients.length;
      campaigns.set(campaign.id, campaign);

      logger.info('Campaign sent', { campaignId: campaign.id, count: campaign.recipients.length });

      res.json({
        message:    `Campaign sent to ${campaign.recipients.length} recipients`,
        campaignId: campaign.id,
        sentAt:     campaign.sentAt,
        stats:      campaign.stats,
      });
    } catch (err) {
      logger.error('SendGrid error', { error: err.message, body: err.response?.body });
      const sgError = err.response?.body?.errors?.[0]?.message;
      res.status(502).json({ error: sgError || 'Email delivery failed. Check your SendGrid API key.' });
    }
  }
);

// ── POST /api/email/send-test ────────────────────────────────
router.post(
  '/send-test',
  authenticate,
  [
    body('to').isEmail(),
    body('subject').trim().notEmpty(),
    body('body').trim().notEmpty(),
    body('fromName').trim().notEmpty(),
    body('fromEmail').isEmail(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { to, subject, body: emailBody, fromName, fromEmail } = req.body;

    try {
      await sgMail.send({
        to,
        from:    { email: fromEmail, name: fromName },
        subject: `[TEST] ${subject}`,
        text:    emailBody,
        html:    buildHtmlEmail(`[TEST] ${subject}`, emailBody, fromName),
      });

      res.json({ message: `Test email sent to ${to}` });
    } catch (err) {
      logger.error('Test email error', { error: err.message });
      res.status(502).json({ error: 'Test email failed. Verify your SendGrid API key and sender email.' });
    }
  }
);

// ── GET /api/email/campaigns ─────────────────────────────────
router.get('/campaigns', authenticate, (req, res) => {
  const userCampaigns = [...campaigns.values()]
    .filter(c => c.userId === req.user.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ campaigns: userCampaigns });
});

// ── GET /api/email/campaigns/:id ─────────────────────────────
router.get('/campaigns/:id', authenticate, (req, res) => {
  const campaign = campaigns.get(req.params.id);
  if (!campaign || campaign.userId !== req.user.userId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  res.json({ campaign });
});

// ── DELETE /api/email/campaigns/:id ──────────────────────────
router.delete('/campaigns/:id', authenticate, (req, res) => {
  const campaign = campaigns.get(req.params.id);
  if (!campaign || campaign.userId !== req.user.userId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  campaigns.delete(req.params.id);
  res.json({ message: 'Campaign deleted' });
});

module.exports = router;
