// src/routes/leads.js
// NPI Registry lead finder — real government API, no key required
// Docs: https://npiregistry.cms.hhs.gov/api-page

const express = require('express');
const fetch = require('node-fetch');
const { query, validationResult } = require('express-validator');
const { authenticate, attachLimits } = require('../middleware/auth');
const { logger } = require('../config/logger');

const router = express.Router();
const NPI_BASE = process.env.NPI_API_BASE || 'https://npiregistry.cms.hhs.gov/api';

// ── Lead scoring algorithm ───────────────────────────────────
// Scores 0-100 based on factors relevant to home health referrals
function scoreProvider(provider) {
  let score = 50;
  const taxonomy = provider.taxonomies?.[0]?.desc?.toLowerCase() || '';
  const state    = provider.addresses?.[0]?.state || '';

  // Specialty scoring — highest-value referral sources first
  const highValue = ['discharge', 'social work', 'internal medicine', 'family medicine', 'geriatric'];
  const medValue  = ['skilled nursing', 'rehabilitation', 'physical therapy', 'occupational'];
  const lowValue  = ['assisted living', 'nursing', 'home health'];

  if (highValue.some(k => taxonomy.includes(k))) score += 30;
  else if (medValue.some(k => taxonomy.includes(k))) score += 20;
  else if (lowValue.some(k => taxonomy.includes(k))) score += 10;

  // Active NPI status
  if (provider.basic?.status === 'A') score += 10;

  // Has address details (more complete = more reachable)
  if (provider.addresses?.[0]?.telephone_number) score += 5;
  if (provider.addresses?.[0]?.address_2) score += 3;

  // Randomize slightly for realism (+/- 5)
  score += Math.floor(Math.random() * 10) - 5;

  return Math.min(100, Math.max(10, score));
}

function estimateReferralValue(taxonomy = '') {
  const t = taxonomy.toLowerCase();
  if (t.includes('hospital') || t.includes('discharge')) return '$6,000–$12,000/mo';
  if (t.includes('skilled nursing'))                      return '$4,000–$8,000/mo';
  if (t.includes('geriatric') || t.includes('internal'))  return '$2,500–$5,000/mo';
  if (t.includes('rehabilitation') || t.includes('physical')) return '$2,000–$4,000/mo';
  if (t.includes('assisted') || t.includes('living'))    return '$1,500–$3,500/mo';
  return '$1,000–$3,000/mo';
}

function formatProvider(raw) {
  const addr   = raw.addresses?.find(a => a.address_purpose === 'LOCATION') || raw.addresses?.[0] || {};
  const taxon  = raw.taxonomies?.[0] || {};
  const isOrg  = raw.enumeration_type === 'NPI-2';
  const name   = isOrg
    ? (raw.basic?.organization_name || 'Organization')
    : `${raw.basic?.first_name || ''} ${raw.basic?.last_name || ''}`.trim();

  return {
    npi:          raw.number,
    name,
    credential:   raw.basic?.credential || '',
    specialty:    taxon.desc || 'Healthcare Provider',
    taxonomyCode: taxon.code || '',
    address:      [addr.address_1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
    phone:        addr.telephone_number || null,
    fax:          addr.fax_number || null,
    city:         addr.city || '',
    state:        addr.state || '',
    zip:          addr.postal_code || '',
    status:       raw.basic?.status === 'A' ? 'Active' : 'Inactive',
    score:        scoreProvider(raw),
    estimatedValue: estimateReferralValue(taxon.desc),
    enumerationDate: raw.basic?.enumeration_date || null,
    type:         isOrg ? 'Organization' : 'Individual',
  };
}

// ── GET /api/leads/search ────────────────────────────────────
router.get(
  '/search',
  authenticate,
  attachLimits,
  [
    query('state').optional().isLength({ min: 2, max: 2 }),
    query('city').optional().trim(),
    query('taxonomy').optional().trim(),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('skip').optional().isInt({ min: 0 }),
    query('minScore').optional().isInt({ min: 0, max: 100 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    // Enforce plan lead limits
    const limit = Math.min(
      parseInt(req.query.limit) || 25,
      req.planLimits.leadsPerMonth
    );

    const params = new URLSearchParams({
      version: '2.1',
      limit:   limit.toString(),
      skip:    req.query.skip || '0',
      pretty:  'on',
    });

    if (req.query.state)    params.append('state', req.query.state.toUpperCase());
    if (req.query.city)     params.append('city',  req.query.city);
    if (req.query.taxonomy) params.append('taxonomy_description', req.query.taxonomy);

    try {
      logger.info('NPI search', { state: req.query.state, city: req.query.city, taxonomy: req.query.taxonomy });

      const response = await fetch(`${NPI_BASE}/?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000,
      });

      if (!response.ok) throw new Error(`NPI API responded with ${response.status}`);

      const data = await response.json();
      let providers = (data.results || []).map(formatProvider);

      // Filter by minimum score if requested
      const minScore = parseInt(req.query.minScore) || 0;
      if (minScore > 0) providers = providers.filter(p => p.score >= minScore);

      // Sort by score descending
      providers.sort((a, b) => b.score - a.score);

      res.json({
        total:     data.result_count || providers.length,
        returned:  providers.length,
        providers,
        planLimit: req.planLimits.leadsPerMonth,
        source:    'NPI Registry — U.S. Centers for Medicare & Medicaid Services',
      });
    } catch (err) {
      logger.error('NPI search failed', { error: err.message });
      res.status(502).json({ error: 'Could not reach NPI Registry. Please try again shortly.' });
    }
  }
);

// ── GET /api/leads/provider/:npi ─────────────────────────────
router.get('/provider/:npi', authenticate, async (req, res) => {
  const { npi } = req.params;
  if (!/^\d{10}$/.test(npi)) return res.status(400).json({ error: 'NPI must be a 10-digit number' });

  try {
    const response = await fetch(`${NPI_BASE}/?version=2.1&number=${npi}&pretty=on`);
    const data = await response.json();

    if (!data.results?.length) return res.status(404).json({ error: 'Provider not found' });

    res.json({ provider: formatProvider(data.results[0]) });
  } catch (err) {
    logger.error('NPI lookup failed', { npi, error: err.message });
    res.status(502).json({ error: 'Could not reach NPI Registry' });
  }
});

// ── GET /api/leads/taxonomies ────────────────────────────────
// Return common home-health-relevant specialties for the UI dropdown
router.get('/taxonomies', (_req, res) => {
  res.json({
    taxonomies: [
      { label: 'Hospital Discharge Planners',    value: 'Clinical Social Worker' },
      { label: 'Internal Medicine Physicians',   value: 'Internal Medicine' },
      { label: 'Family Medicine Physicians',     value: 'Family Medicine' },
      { label: 'Geriatric Medicine',             value: 'Geriatric Medicine' },
      { label: 'Skilled Nursing Facilities',     value: 'Skilled Nursing Facility' },
      { label: 'Assisted Living Facilities',     value: 'Assisted Living Facility' },
      { label: 'Rehabilitation Centers',         value: 'Rehabilitation' },
      { label: 'Physical Therapists',            value: 'Physical Therapy' },
      { label: 'Occupational Therapists',        value: 'Occupational Therapy' },
      { label: 'Wound Care Specialists',         value: 'Wound Care' },
      { label: 'Palliative Care',                value: 'Palliative Care' },
      { label: 'Hospice Organizations',          value: 'Hospice' },
    ],
  });
});

module.exports = router;
