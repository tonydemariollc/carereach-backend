// src/routes/analytics.js
const express = require('express');
const { authenticate, attachLimits } = require('../middleware/auth');

const router = express.Router();

// GET /api/analytics/summary
router.get('/summary', authenticate, attachLimits, (req, res) => {
  // In production, query your DB for real metrics per userId/tenantId
  // For now, return realistic demo data scoped to the user

  const seed = req.user.userId.charCodeAt(0); // Vary by user

  res.json({
    period: 'last_30_days',
    kpis: {
      totalReferrals:     143 + (seed % 20),
      referralGrowth:     22.4,
      avgLeadCloseDays:   18,
      emailROI:           312,
      conversionRate:     24.1,
      activePartners:     8 + (seed % 5),
      leadsSearched:      1847,
      emailsSent:         3204,
      emailOpenRate:      48.1,
      emailClickRate:     11.9,
    },
    monthlyReferrals: [
      { month: 'Nov 2024', count: 84 },
      { month: 'Dec 2024', count: 97 },
      { month: 'Jan 2025', count: 108 },
      { month: 'Feb 2025', count: 119 },
      { month: 'Mar 2025', count: 131 },
      { month: 'Apr 2025', count: 143 },
    ],
    channelBreakdown: [
      { channel: 'Email Campaign',  percentage: 68, referrals: 97 },
      { channel: 'In-Person Visit', percentage: 20, referrals: 29 },
      { channel: 'Phone Outreach',  percentage: 8,  referrals: 11 },
      { channel: 'Social Media',    percentage: 4,  referrals: 6  },
    ],
    topSources: [
      { name: "St. Mary's Hospital",  count: 42, trend: '+12%' },
      { name: 'Willowbrook SNF',       count: 34, trend: '+8%'  },
      { name: 'Dr. Chen, Family Med',  count: 25, trend: 'flat' },
      { name: 'Sunrise ALF',           count: 19, trend: '+3%'  },
      { name: 'Jefferson Rehab',       count: 11, trend: '-5%'  },
    ],
    insights: [
      { type: 'success', title: 'Email is your top channel',    body: '68% of referrals came from email campaigns. Consider increasing send frequency.' },
      { type: 'warning', title: 'Jefferson Rehab declining',    body: 'Referrals down 5% this month. Schedule an in-person visit.' },
      { type: 'info',    title: '3 hot leads need follow-up',   body: 'Dr. Kim, Comfort ALF, and Valley Rehab have not been contacted yet.' },
    ],
    exportAvailable: req.planLimits.analyticsExport,
  });
});

// GET /api/analytics/export — CSV export (Pro+ only)
router.get('/export', authenticate, attachLimits, (req, res) => {
  if (!req.planLimits.analyticsExport) {
    return res.status(403).json({
      error: 'Analytics export requires Pro or Agency plan.',
      upgrade: '/api/billing/upgrade',
    });
  }

  // Build a simple CSV
  const rows = [
    ['Month', 'Referrals', 'Emails Sent', 'Open Rate', 'New Leads'],
    ['Nov 2024', 84, 480, '44%', 120],
    ['Dec 2024', 97, 520, '46%', 142],
    ['Jan 2025', 108, 604, '48%', 178],
    ['Feb 2025', 119, 720, '51%', 201],
    ['Mar 2025', 131, 840, '47%', 224],
    ['Apr 2025', 143, 1040, '48%', 243],
  ];

  const csv = rows.map(r => r.join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=carereach-analytics.csv');
  res.send(csv);
});

module.exports = router;
