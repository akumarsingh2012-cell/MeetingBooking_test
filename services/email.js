// services/email.js  –  Nodemailer email service with all templates
const nodemailer = require('nodemailer');
const db = require('../db/database');

const genId = () => `el_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Transporter ───────────────────────────────────────────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function isConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

// ─── ICS (calendar invite) generator ──────────────────────────────────────
function buildICS(booking) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const dateStr = booking.date.replace(/-/g, '');
  const startStr = dateStr + 'T' + booking.start_time.replace(':', '') + '00';
  const endStr   = dateStr + 'T' + booking.end_time.replace(':', '') + '00';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SLMG Beverages//Meeting Room Booking//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${booking.id}@slmg-mrb`,
    `DTSTART:${startStr}`,
    `DTEND:${endStr}`,
    `SUMMARY:${booking.purpose}`,
    `DESCRIPTION:Room: ${booking.room_name}\\nFloor: ${booking.room_floor || ''}\\nBooked by: ${booking.user_name}`,
    `LOCATION:${booking.room_name}${booking.room_floor ? ', ' + booking.room_floor : ''}`,
    `ORGANIZER;CN=SLMG Meeting Room:mailto:${process.env.SMTP_USER || 'noreply@slmg.com'}`,
    'STATUS:CONFIRMED',
    `URL:${appUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// ─── HTML Email base template ──────────────────────────────────────────────
function baseTemplate({ title, preheader, body, cta, ctaUrl, ctaColor = '#3d6ce7' }) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f0f2f7;font-family:'Segoe UI',Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;">${preheader || title}</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f7;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <!-- Header -->
  <tr><td style="background:#0f172a;padding:20px 32px;text-align:center;">
    <div style="background:#fff;border-radius:10px;padding:10px 20px;display:inline-block;">
      <img src="${appUrl}/slmg-logo.webp" alt="SLMG Beverages" style="height:40px;display:block;" onerror="this.style.display='none'"/>
    </div>
    <div style="color:#fff;font-size:13px;margin-top:8px;opacity:.6;">Meeting Room Booking System</div>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:32px;">
    <h2 style="margin:0 0 6px;color:#1a1d2e;font-size:20px;">${title}</h2>
    ${body}
    ${cta ? `<div style="text-align:center;margin-top:28px;">
      <a href="${ctaUrl || appUrl}" style="background:${ctaColor};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block;">${cta}</a>
    </div>` : ''}
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="margin:0;color:#94a3b8;font-size:12px;">SLMG Beverages · Meeting Room Booking</p>
    <p style="margin:4px 0 0;color:#cbd5e1;font-size:11px;">This is an automated message. Please do not reply.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// ─── Booking detail card HTML (reused in multiple emails) ──────────────────
function bookingCard(b) {
  const rows = [
    ['📅 Date', b.date],
    ['⏰ Time', `${b.start_time} – ${b.end_time}`],
    ['🏢 Room', `${b.room_name}${b.room_floor ? ' · ' + b.room_floor : ''}`],
    ['👤 Booked By', `${b.user_name} (${b.user_email})`],
    ['📋 Type', b.meeting_type],
    ['🎯 Purpose', b.purpose],
    b.persons ? ['👥 Persons', b.persons] : null,
    b.food ? ['🍽️ Food', `Yes – ${b.veg_nonveg || 'Not specified'}`] : null,
    b.remarks ? ['📝 Remarks', b.remarks] : null,
  ].filter(Boolean);

  return `<div style="background:#f8fafc;border-radius:10px;padding:20px;margin:20px 0;border:1px solid #e2e8f0;">
    ${rows.map(([k, v]) => `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
      <span style="color:#64748b;font-size:13px;min-width:110px;flex-shrink:0;">${k}</span>
      <span style="color:#1a1d2e;font-size:13px;font-weight:600;">${v}</span>
    </div>`).join('')}
  </div>`;
}

// ─── Send helper (logs to DB) ──────────────────────────────────────────────
async function send({ to, subject, html, attachments, type, bookingId }) {
  if (!isConfigured()) {
    console.log(`[EMAIL SKIP] Not configured. Would send "${subject}" to ${to}`);
    return { skipped: true };
  }
  const t = getTransporter();
  const logId = genId();
  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      attachments,
    });
    db.prepare(`INSERT INTO email_log (id, booking_id, recipient, subject, type, status) VALUES (?, ?, ?, ?, ?, 'sent')`)
      .run(logId, bookingId || null, to, subject, type);
    console.log(`[EMAIL ✅] ${type} → ${to}`);
    return { sent: true };
  } catch (err) {
    db.prepare(`INSERT INTO email_log (id, booking_id, recipient, subject, type, status, error) VALUES (?, ?, ?, ?, ?, 'failed', ?)`)
      .run(logId, bookingId || null, to, subject, type, err.message);
    console.error(`[EMAIL ❌] ${type} → ${to}: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── ICS attachment builder ────────────────────────────────────────────────
function icsAttachment(booking) {
  return [{
    filename: 'meeting-invite.ics',
    content: buildICS(booking),
    contentType: 'text/calendar; method=REQUEST',
  }];
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL TRIGGER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// 1. New booking created → notify admin
async function sendNewBookingAdmin(booking) {
  const admins = db.prepare("SELECT email FROM users WHERE role='admin' AND active=1").all();
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const html = baseTemplate({
    title: '📅 New Booking Request',
    preheader: `${booking.user_name} booked ${booking.room_name} on ${booking.date}`,
    body: `<p style="color:#64748b;font-size:14px;margin:0 0 4px;">A new meeting room booking has been submitted.</p>
           ${bookingCard(booking)}
           <div style="background:${booking.meeting_type === 'external' ? '#fef3c7' : '#f0fdf4'};border-radius:8px;padding:12px 16px;border-left:4px solid ${booking.meeting_type === 'external' ? '#d97706' : '#16a34a'};">
             <span style="font-weight:700;color:${booking.meeting_type === 'external' ? '#92400e' : '#14532d'};font-size:13px;">
               ${booking.meeting_type === 'external' ? '⚠️ This is an EXTERNAL meeting — approval required.' : '✅ Internal meeting — auto-approved.'}
             </span>
           </div>`,
    cta: booking.meeting_type === 'external' ? 'Review & Approve' : 'View Dashboard',
    ctaUrl: appUrl,
    ctaColor: booking.meeting_type === 'external' ? '#d97706' : '#3d6ce7',
  });
  for (const admin of admins) {
    await send({ to: admin.email, subject: `[MRB] New Booking – ${booking.room_name} on ${booking.date}`, html, type: 'new_booking_admin', bookingId: booking.id });
  }
}

// 2. Booking approved → notify user + guests
async function sendApproved(booking) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const html = baseTemplate({
    title: '✅ Booking Approved!',
    preheader: `Your booking for ${booking.room_name} on ${booking.date} is confirmed`,
    body: `<p style="color:#64748b;font-size:14px;">Great news! Your meeting room booking has been approved.</p>
           ${bookingCard(booking)}
           <div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;border-left:4px solid #16a34a;">
             <span style="font-weight:700;color:#14532d;font-size:13px;">✅ Your booking is confirmed. A calendar invite is attached.</span>
           </div>`,
    cta: 'View My Bookings',
    ctaUrl: appUrl,
    ctaColor: '#16a34a',
  });
  await send({ to: booking.user_email, subject: `[MRB] ✅ Approved – ${booking.room_name} on ${booking.date}`, html, attachments: icsAttachment(booking), type: 'approved', bookingId: booking.id });

  // Also send calendar invite to guests
  const guests = safeJson(booking.guest_emails, []);
  for (const gEmail of guests) {
    const gHtml = baseTemplate({
      title: `📅 You're invited to a meeting`,
      preheader: `${booking.user_name} has invited you to a meeting`,
      body: `<p style="color:#64748b;font-size:14px;">You have been invited to the following meeting at SLMG Beverages.</p>
             ${bookingCard(booking)}`,
      cta: 'Add to Calendar',
      ctaUrl: appUrl,
      ctaColor: '#3d6ce7',
    });
    await send({ to: gEmail, subject: `[SLMG] Meeting Invite – ${booking.purpose} on ${booking.date}`, html: gHtml, attachments: icsAttachment(booking), type: 'guest_invite', bookingId: booking.id });
  }
}

// 3. Booking rejected → notify user
async function sendRejected(booking) {
  const html = baseTemplate({
    title: '❌ Booking Not Approved',
    preheader: `Your booking for ${booking.room_name} was not approved`,
    body: `<p style="color:#64748b;font-size:14px;">Unfortunately, your meeting room booking could not be approved.</p>
           ${bookingCard(booking)}
           <div style="background:#fef2f2;border-radius:8px;padding:12px 16px;border-left:4px solid #dc2626;">
             <span style="font-weight:700;color:#991b1b;font-size:13px;">Reason: </span>
             <span style="color:#991b1b;font-size:13px;">${booking.rejection_reason || 'No reason provided'}</span>
           </div>
           <p style="color:#64748b;font-size:13px;margin-top:16px;">Please try booking a different time slot or contact admin for assistance.</p>`,
    cta: 'Book Another Slot',
    ctaUrl: process.env.APP_URL || 'http://localhost:3000',
    ctaColor: '#dc2626',
  });
  await send({ to: booking.user_email, subject: `[MRB] ❌ Booking Not Approved – ${booking.room_name} on ${booking.date}`, html, type: 'rejected', bookingId: booking.id });
}

// 4. Booking cancelled → notify admin
async function sendCancelled(booking) {
  const admins = db.prepare("SELECT email FROM users WHERE role='admin' AND active=1").all();
  const html = baseTemplate({
    title: '🚫 Booking Cancelled',
    preheader: `${booking.user_name} cancelled their booking for ${booking.room_name}`,
    body: `<p style="color:#64748b;font-size:14px;">A meeting room booking has been cancelled. The slot is now available.</p>
           ${bookingCard(booking)}`,
    cta: 'View Dashboard',
    ctaUrl: process.env.APP_URL || 'http://localhost:3000',
    ctaColor: '#64748b',
  });
  for (const admin of admins) {
    await send({ to: admin.email, subject: `[MRB] Cancelled – ${booking.room_name} on ${booking.date}`, html, type: 'cancelled_admin', bookingId: booking.id });
  }
  // Also notify user their cancellation is confirmed
  const userHtml = baseTemplate({
    title: '🚫 Booking Cancelled',
    body: `<p style="color:#64748b;font-size:14px;">Your booking has been successfully cancelled.</p>${bookingCard(booking)}`,
  });
  await send({ to: booking.user_email, subject: `[MRB] Cancellation Confirmed – ${booking.room_name} on ${booking.date}`, html: userHtml, type: 'cancelled_user', bookingId: booking.id });
}

// 5. Meeting reminder (30 min before)
async function sendReminder(booking) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const html = baseTemplate({
    title: '⏰ Meeting Starting Soon!',
    preheader: `Your meeting in ${booking.room_name} starts at ${booking.start_time}`,
    body: `<p style="color:#64748b;font-size:14px;">This is a reminder that your meeting is starting soon.</p>
           ${bookingCard(booking)}
           <div style="background:#eff6ff;border-radius:8px;padding:12px 16px;border-left:4px solid #3d6ce7;">
             <span style="font-weight:700;color:#1e40af;font-size:14px;">⏰ Starting in ${process.env.REMINDER_MINUTES || 30} minutes!</span>
           </div>`,
    cta: 'Check In Now',
    ctaUrl: `${appUrl}/checkin/${booking.checkin_token}`,
    ctaColor: '#3d6ce7',
  });
  await send({ to: booking.user_email, subject: `[MRB] ⏰ Reminder – ${booking.purpose} starts at ${booking.start_time}`, html, type: 'reminder', bookingId: booking.id });
  // Mark reminder sent
  db.prepare('UPDATE bookings SET reminder_sent = 1 WHERE id = ?').run(booking.id);
}

// 6. Test email
async function sendTest(toEmail) {
  const html = baseTemplate({
    title: '✅ Email Configuration Working!',
    preheader: 'Your email settings are correctly configured',
    body: `<p style="color:#64748b;font-size:14px;">Great news! Your SMTP email configuration is working correctly.</p>
           <div style="background:#f0fdf4;border-radius:8px;padding:16px;border-left:4px solid #16a34a;margin-top:16px;">
             <p style="margin:0;color:#14532d;font-weight:700;">Email notifications are now active for:</p>
             <ul style="color:#14532d;font-size:13px;margin:8px 0 0;padding-left:18px;">
               <li>New booking alerts (to admin)</li>
               <li>Approval / Rejection notifications (to user)</li>
               <li>Meeting reminders (30 min before)</li>
               <li>Cancellation notifications</li>
               <li>Guest calendar invites (.ics)</li>
             </ul>
           </div>`,
    cta: 'Open App',
    ctaUrl: process.env.APP_URL || 'http://localhost:3000',
    ctaColor: '#16a34a',
  });
  return send({ to: toEmail, subject: '[MRB] ✅ Email Test – Configuration Working!', html, type: 'test' });
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

module.exports = { sendNewBookingAdmin, sendApproved, sendRejected, sendCancelled, sendReminder, sendTest, isConfigured };
