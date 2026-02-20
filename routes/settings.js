// routes/settings.js
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');
const emailSvc = require('../services/email');

// GET /api/settings
router.get('/', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  // Also expose whether SMTP is configured via env
  out.smtp_configured = emailSvc.isConfigured() ? 'true' : 'false';
  out.smtp_user = process.env.SMTP_USER || '';
  res.json(out);
});

// PUT /api/settings
router.put('/', auth, adminOnly, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const txn = db.transaction((pairs) => {
    for (const [k, v] of Object.entries(pairs)) upsert.run(k, String(v));
  });
  txn(req.body);
  res.json({ message: 'Settings saved' });
});

// POST /api/settings/test-email
router.post('/test-email', auth, adminOnly, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  const result = await emailSvc.sendTest(to);
  if (result.skipped) return res.status(400).json({ error: 'SMTP not configured. Set SMTP_USER and SMTP_PASS in environment variables.' });
  if (!result.sent) return res.status(500).json({ error: result.error || 'Failed to send email' });
  res.json({ message: 'Test email sent to ' + to });
});

// GET /api/settings/email-log
router.get('/email-log', auth, adminOnly, (req, res) => {
  const logs = db.prepare('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 100').all();
  res.json(logs);
});

module.exports = router;
