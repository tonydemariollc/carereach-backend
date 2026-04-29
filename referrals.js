// src/routes/referrals.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const referrals = new Map();

// GET /api/referrals
router.get('/', authenticate, (req, res) => {
  const userRefs = [...referrals.values()].filter(r => r.userId === req.user.userId);

  // Aggregate by source
  const bySource = {};
  userRefs.forEach(r => {
    if (!bySource[r.source]) bySource[r.source] = { source: r.source, count: 0, services: {} };
    bySource[r.source].count++;
    bySource[r.source].services[r.service] = (bySource[r.source].services[r.service] || 0) + 1;
  });

  const sources = Object.values(bySource).sort((a, b) => b.count - a.count);

  // Monthly totals for the last 6 months
  const monthlyMap = {};
  userRefs.forEach(r => {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap[key] = (monthlyMap[key] || 0) + 1;
  });

  res.json({
    total:   userRefs.length,
    sources,
    monthly: monthlyMap,
    recent:  userRefs.slice(-20).reverse(),
  });
});

// POST /api/referrals — log a referral
router.post('/', authenticate,
  [
    body('source').trim().notEmpty().withMessage('Referral source is required'),
    body('service').isIn(['Skilled Nursing', 'PT/OT', 'Personal Care', 'Hospice Support', 'Other']),
    body('patientInitials').optional().trim(),
    body('notes').optional().trim(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const referral = {
      id:              uuidv4(),
      userId:          req.user.userId,
      source:          req.body.source,
      service:         req.body.service,
      patientInitials: req.body.patientInitials || null,
      notes:           req.body.notes || null,
      createdAt:       new Date().toISOString(),
    };
    referrals.set(referral.id, referral);
    res.status(201).json({ referral });
  }
);

// GET /api/referrals/goals
router.get('/goals', authenticate, (req, res) => {
  const userRefs = [...referrals.values()].filter(r => r.userId === req.user.userId);
  const now = new Date();
  const thisMonth = userRefs.filter(r => {
    const d = new Date(r.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  res.json({
    monthlyTarget: 160,
    monthlyActual: thisMonth.length,
    sourcesTarget: 5,
    sourcesActual: new Set(thisMonth.map(r => r.source)).size,
  });
});

module.exports = router;
