// src/routes/auth.js
// Registration, login, JWT issuance, profile management

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../config/logger');

const router = express.Router();

// In-memory user store (replace with PostgreSQL/SQLite in production)
// Schema: { id, email, passwordHash, name, agencyName, plan, tenantId, stripeCustomerId, createdAt }
const users = new Map();

const signToken = (user) =>
  jwt.sign(
    { userId: user.id, email: user.email, plan: user.plan, tenantId: user.tenantId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

// ── POST /api/auth/register ──────────────────────────────────
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('agencyName').trim().notEmpty().withMessage('Agency name is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, agencyName } = req.body;

    if ([...users.values()].find(u => u.email === email)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const user = {
        id:               uuidv4(),
        email,
        passwordHash,
        name,
        agencyName,
        plan:             'pro',       // 14-day trial starts on Pro
        trialEndsAt:      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        tenantId:         uuidv4(),    // unique per agency for white-labeling
        stripeCustomerId: null,
        createdAt:        new Date().toISOString(),
      };
      users.set(user.id, user);

      logger.info('New user registered', { email, agencyName });

      res.status(201).json({
        token: signToken(user),
        user:  { id: user.id, email, name, agencyName, plan: user.plan, trialEndsAt: user.trialEndsAt },
      });
    } catch (err) {
      logger.error('Registration error', { error: err.message });
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

// ── POST /api/auth/login ─────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const user = [...users.values()].find(u => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    logger.info('User logged in', { email });

    res.json({
      token: signToken(user),
      user:  { id: user.id, email, name: user.name, agencyName: user.agencyName, plan: user.plan },
    });
  }
);

// ── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = users.get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
});

// ── PATCH /api/auth/profile ──────────────────────────────────
router.patch(
  '/profile',
  authenticate,
  [
    body('name').optional().trim().notEmpty(),
    body('agencyName').optional().trim().notEmpty(),
  ],
  async (req, res) => {
    const user = users.get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, agencyName } = req.body;
    if (name)       user.name       = name;
    if (agencyName) user.agencyName = agencyName;
    users.set(user.id, user);

    res.json({ message: 'Profile updated', user: { name: user.name, agencyName: user.agencyName } });
  }
);

module.exports = router;
