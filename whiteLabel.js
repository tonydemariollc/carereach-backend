// src/routes/whiteLabel.js
// White-label branding configuration — Agency plan only

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate, requireFeature } = require('../middleware/auth');

const router = express.Router();

// Per-tenant brand store (replace with DB in production)
const brandSettings = new Map();

const DEFAULT_BRAND = {
  name:           'CareReach',
  tagline:        'Home Health CRM',
  primaryColor:   '#00b4a0',
  logoUrl:        null,
  customDomain:   null,
  supportEmail:   null,
  hideAttribution: false,
  emailFromName:  null,
  emailFromEmail: null,
};

// GET /api/white-label
router.get('/', authenticate, (req, res) => {
  const brand = brandSettings.get(req.user.tenantId) || { ...DEFAULT_BRAND };
  res.json({ brand, isAgencyPlan: req.user.plan === 'agency' });
});

// PUT /api/white-label — update branding (Agency plan only)
router.put('/',
  authenticate,
  requireFeature('whiteLabel'),
  [
    body('name').optional().trim().isLength({ min: 1, max: 60 }),
    body('tagline').optional().trim().isLength({ max: 80 }),
    body('primaryColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Must be a valid hex color'),
    body('customDomain').optional().trim().isFQDN({ require_tld: true }).withMessage('Must be a valid domain'),
    body('supportEmail').optional().isEmail(),
    body('hideAttribution').optional().isBoolean(),
    body('emailFromName').optional().trim(),
    body('emailFromEmail').optional().isEmail(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const current = brandSettings.get(req.user.tenantId) || { ...DEFAULT_BRAND };
    const updated  = { ...current, ...req.body, updatedAt: new Date().toISOString() };
    brandSettings.set(req.user.tenantId, updated);

    res.json({
      message: 'Brand settings saved',
      brand:   updated,
    });
  }
);

// GET /api/white-label/preview — public endpoint for rendering branded login page
// Used by custom domains: app.youragency.com calls this to get their brand
router.get('/preview/:tenantId', (req, res) => {
  const brand = brandSettings.get(req.params.tenantId);
  if (!brand) return res.status(404).json({ error: 'Brand not found' });

  // Only expose safe public fields
  res.json({
    name:         brand.name,
    tagline:      brand.tagline,
    primaryColor: brand.primaryColor,
    logoUrl:      brand.logoUrl,
  });
});

module.exports = router;
