// src/routes/pipeline.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prospects = new Map();

const STAGES = ['identified', 'contacted', 'meeting_set', 'proposal_sent', 'active_partner', 'lost'];

// GET /api/pipeline
router.get('/', authenticate, (req, res) => {
  const userProspects = [...prospects.values()].filter(p => p.userId === req.user.userId);
  const board = Object.fromEntries(STAGES.map(s => [s, []]));
  userProspects.forEach(p => { if (board[p.stage]) board[p.stage].push(p); });
  res.json({ pipeline: board, total: userProspects.length });
});

// POST /api/pipeline — add prospect
router.post('/', authenticate,
  [
    body('name').trim().notEmpty(),
    body('type').isIn(['Hospital', 'SNF', 'ALF', 'Physician', 'Rehab', 'Other']),
    body('estimatedValue').optional().isNumeric(),
    body('npi').optional().trim(),
    body('contactName').optional().trim(),
    body('contactEmail').optional().isEmail(),
    body('contactPhone').optional().trim(),
    body('notes').optional().trim(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const prospect = {
      id:             uuidv4(),
      userId:         req.user.userId,
      stage:          'identified',
      ...req.body,
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      activityLog:    [{ action: 'created', at: new Date().toISOString() }],
    };
    prospects.set(prospect.id, prospect);
    res.status(201).json({ prospect });
  }
);

// PATCH /api/pipeline/:id/stage — move card
router.patch('/:id/stage', authenticate,
  [body('stage').isIn(STAGES)],
  (req, res) => {
    const p = prospects.get(req.params.id);
    if (!p || p.userId !== req.user.userId) return res.status(404).json({ error: 'Prospect not found' });
    const prevStage = p.stage;
    p.stage     = req.body.stage;
    p.updatedAt = new Date().toISOString();
    p.activityLog.push({ action: `moved from ${prevStage} to ${req.body.stage}`, at: p.updatedAt });
    prospects.set(p.id, p);
    res.json({ prospect: p });
  }
);

// PATCH /api/pipeline/:id — update prospect details
router.patch('/:id', authenticate, (req, res) => {
  const p = prospects.get(req.params.id);
  if (!p || p.userId !== req.user.userId) return res.status(404).json({ error: 'Prospect not found' });
  Object.assign(p, req.body, { updatedAt: new Date().toISOString() });
  prospects.set(p.id, p);
  res.json({ prospect: p });
});

// DELETE /api/pipeline/:id
router.delete('/:id', authenticate, (req, res) => {
  const p = prospects.get(req.params.id);
  if (!p || p.userId !== req.user.userId) return res.status(404).json({ error: 'Prospect not found' });
  prospects.delete(req.params.id);
  res.json({ message: 'Prospect removed from pipeline' });
});

module.exports = router;

// ─────────────────────────────────────────────────────────────
// src/routes/referrals.js (inlined for brevity)
// ─────────────────────────────────────────────────────────────
