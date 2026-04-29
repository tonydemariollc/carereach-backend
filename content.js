// src/routes/content.js
// AI content generation powered by Anthropic Claude API
// Generates emails, flyers, phone scripts, and social posts

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { body, validationResult } = require('express-validator');
const { authenticate, attachLimits } = require('../middleware/auth');
const { logger } = require('../config/logger');

const router = express.Router();

// Initialize Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Content type prompts ─────────────────────────────────────
const CONTENT_PROMPTS = {
  email: ({ agency, audience, services, differentiator, tone, recipientName, facilityName }) => `
You are a healthcare marketing expert specializing in home health agency growth.

Write a professional cold outreach email from ${agency} to a ${audience}.

Details:
- Agency: ${agency}
- Services offered: ${services}
- Key differentiator: ${differentiator}
- Tone: ${tone}
${recipientName ? `- Recipient name: ${recipientName}` : ''}
${facilityName ? `- Facility/Practice: ${facilityName}` : ''}

Requirements:
- Write a compelling subject line
- Keep the body under 200 words
- Include a clear, low-pressure call to action (15-minute meeting or call)
- Sound human and relationship-focused, not salesy
- Reference specific challenges the recipient faces in their role
- Format: "Subject: [subject line]" then a blank line then the email body

Do NOT include meta-commentary. Output only the email itself.
`.trim(),

  flyer: ({ agency, audience, services, differentiator, phone, email, website }) => `
You are a healthcare marketing expert. Create a professional leave-behind marketing flyer for a home health agency.

Agency: ${agency}
Target audience: ${audience}
Services: ${services}
Key differentiator: ${differentiator}
${phone ? `Phone: ${phone}` : ''}
${email ? `Email: ${email}` : ''}
${website ? `Website: ${website}` : ''}

Requirements:
- Create a structured flyer with clear sections
- Use bullet points for services
- Include a compelling headline
- Add a strong value proposition statement
- End with contact information and a clear next step
- Format it so it reads naturally as a leave-behind document

Output only the flyer text. No meta-commentary.
`.trim(),

  social: ({ agency, audience, services, differentiator, platform }) => `
You are a healthcare marketing expert. Write a compelling ${platform || 'LinkedIn'} post for a home health agency.

Agency: ${agency}
Target audience: ${audience}
Services: ${services}
Key differentiator: ${differentiator}

Requirements:
- Start with a hook that grabs attention in the first line
- Speak to the pain points of ${audience}
- Use appropriate emojis sparingly
- Include relevant hashtags at the end (5-8)
- Keep it under 300 words
- End with a soft CTA (DM, comment, or connect)

Output only the social post. No meta-commentary.
`.trim(),

  script: ({ agency, audience, services, differentiator }) => `
You are a healthcare marketing expert. Write a phone call script for a home health agency liaison.

Agency: ${agency}
Calling: ${audience}
Services: ${services}
Key differentiator: ${differentiator}

Requirements:
- Include a natural opening that doesn't sound scripted
- Write a concise 30-second value pitch
- Include 3 common objection responses:
  1. "We already have an agency we use"
  2. "We're too busy right now"
  3. "Send me some information"
- End with a confident close for a meeting
- Format with clear section labels: [OPENING], [VALUE PITCH], [OBJECTIONS], [CLOSE]

Output only the script. No meta-commentary.
`.trim(),

  referralLetter: ({ agency, audience, services, differentiator, signature }) => `
You are a healthcare marketing expert. Write a formal referral partnership introduction letter.

Agency: ${agency}
Recipient type: ${audience}
Services: ${services}
Key differentiator: ${differentiator}
${signature ? `Signature name/title: ${signature}` : ''}

Requirements:
- Professional business letter format
- Include date placeholder [DATE] and recipient placeholder [Name, Title, Organization]
- 3 paragraphs: intro, value proposition, call to action
- Formal but warm tone
- Include a line about HIPAA compliance and patient-centered care

Output only the letter. No meta-commentary.
`.trim(),
};

// Usage tracking (replace with DB in production)
const usageByUser = new Map();
function trackUsage(userId) {
  const now = new Date();
  const key = `${userId}-${now.getFullYear()}-${now.getMonth()}`;
  usageByUser.set(key, (usageByUser.get(key) || 0) + 1);
  return usageByUser.get(key);
}
function getUsage(userId) {
  const now = new Date();
  const key = `${userId}-${now.getFullYear()}-${now.getMonth()}`;
  return usageByUser.get(key) || 0;
}

// ── POST /api/content/generate ───────────────────────────────
router.post(
  '/generate',
  authenticate,
  attachLimits,
  [
    body('type').isIn(['email', 'flyer', 'social', 'script', 'referralLetter']),
    body('agency').trim().notEmpty().withMessage('Agency name is required'),
    body('audience').trim().notEmpty().withMessage('Target audience is required'),
    body('services').trim().notEmpty().withMessage('Services are required'),
    body('differentiator').optional().trim(),
    body('tone').optional().trim(),
    body('recipientName').optional().trim(),
    body('facilityName').optional().trim(),
    body('phone').optional().trim(),
    body('email').optional().isEmail(),
    body('website').optional().trim(),
    body('platform').optional().isIn(['LinkedIn', 'Facebook', 'Instagram', 'Twitter']),
    body('signature').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    // Check monthly usage limit
    const usage = getUsage(req.user.userId);
    if (usage >= req.planLimits.aiContentCalls) {
      return res.status(429).json({
        error: `You've reached your monthly AI content limit (${req.planLimits.aiContentCalls} calls).`,
        usage,
        limit: req.planLimits.aiContentCalls,
        upgrade: '/api/billing/upgrade',
      });
    }

    const { type, ...params } = req.body;
    const promptFn = CONTENT_PROMPTS[type];
    if (!promptFn) return res.status(400).json({ error: `Unknown content type: ${type}` });

    const prompt = promptFn(params);

    try {
      logger.info('AI content generation', { userId: req.user.userId, type, agency: params.agency });

      const message = await anthropic.messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      });

      const content = message.content[0]?.text || '';
      const callsUsed = trackUsage(req.user.userId);

      res.json({
        content,
        type,
        callsUsed,
        callsRemaining: req.planLimits.aiContentCalls - callsUsed,
        model: message.model,
        usage: message.usage,
      });
    } catch (err) {
      logger.error('Claude API error', { error: err.message, type });

      if (err.status === 401) return res.status(500).json({ error: 'Invalid Anthropic API key. Check your Settings.' });
      if (err.status === 429) return res.status(429).json({ error: 'Anthropic rate limit reached. Please wait a moment.' });

      res.status(500).json({ error: 'Content generation failed. Please try again.' });
    }
  }
);

// ── GET /api/content/usage ───────────────────────────────────
router.get('/usage', authenticate, attachLimits, (req, res) => {
  const used = getUsage(req.user.userId);
  res.json({
    used,
    limit:     req.planLimits.aiContentCalls,
    remaining: Math.max(0, req.planLimits.aiContentCalls - used),
    plan:      req.user.plan,
  });
});

// ── GET /api/content/types ───────────────────────────────────
router.get('/types', (_req, res) => {
  res.json({
    types: [
      { value: 'email',         label: 'Email Pitch',              description: 'Cold outreach email to referral sources' },
      { value: 'flyer',         label: 'Leave-Behind Flyer',       description: 'Marketing one-pager for in-person visits' },
      { value: 'social',        label: 'Social Media Post',        description: 'LinkedIn, Facebook, or Instagram post' },
      { value: 'script',        label: 'Phone Call Script',        description: 'Cold call script with objection handling' },
      { value: 'referralLetter', label: 'Referral Letter',         description: 'Formal partnership introduction letter' },
    ],
  });
});

module.exports = router;
