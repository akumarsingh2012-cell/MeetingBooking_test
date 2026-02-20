// server.js  –  Main entry point
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/rooms',         require('./routes/rooms'));
app.use('/api/bookings',      require('./routes/bookings'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/settings',      require('./routes/settings'));

// ─── Public check-in page (QR code scan lands here) ───────────────────────
app.get('/checkin/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkin.html'));
});

// ─── Serve Frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 MeetingBook server running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database    : ${process.env.DB_PATH || './data/mrb.sqlite'}`);
  console.log(`   Email SMTP  : ${process.env.SMTP_USER ? '✅ ' + process.env.SMTP_USER : '⚠️  Not configured'}\n`);

  // Start background scheduler for reminders
  try {
    const { startReminderJob } = require('./services/scheduler');
    startReminderJob();
  } catch (e) {
    console.warn('[SCHEDULER] Could not start:', e.message);
  }
});
