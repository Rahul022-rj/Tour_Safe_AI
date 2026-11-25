// Outbound notifications (email + SMS) with delivery history.
//   Email: any SMTP server via nodemailer (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM)
//   SMS:   Twilio REST API (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)
// A notification is stored as "sent" only when the provider accepted it. Missing credentials -> "not_configured".
// The same event to the same recipient is sent at most once per NOTIFY_COOLDOWN_MS to avoid flooding.
const nodemailer = require('nodemailer');
const config = require('../config');
const Notification = require('../models/Notification');
const { mask } = require('../utils/http');

let transporter = null;
function getTransporter() {
  if (!config.emailConfigured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 10000,
    });
  }
  return transporter;
}

// Test hook: replace the real providers with fakes
let providers = {
  async email({ to, subject, text }) {
    const t = getTransporter();
    const info = await t.sendMail({ from: config.smtp.from, to, subject, text });
    if (!info.accepted?.length) throw new Error(`SMTP server rejected the recipient (${info.response || 'no response'})`);
    return { provider: 'smtp', id: info.messageId };
  },
  async sms({ to, text }) {
    const { accountSid, authToken, from } = config.twilio;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: text.slice(0, 1500) }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${data.message || 'request rejected'}`);
    return { provider: 'twilio', id: data.sid };
  },
};
const channelConfigured = { email: () => config.emailConfigured, sms: () => config.smsConfigured };

function setProvidersForTests(fakes, configuredOverride) {
  providers = { ...providers, ...fakes };
  if (configuredOverride) Object.assign(channelConfigured, configuredOverride);
}

// Sends one message on one channel and records the outcome. Never throws.
async function deliver({ channel, to, recipientType, userId, event, subject, text, incidentId, dedupeKey }) {
  const base = { channel, to: mask(to), recipientType, userId, event, subject, incidentId, dedupeKey };
  try {
    if (!to) return await Notification.create({ ...base, to: '-', status: 'skipped', error: 'No recipient address' });
    if (dedupeKey) {
      const recent = await Notification.exists({
        dedupeKey,
        status: 'sent',
        createdAt: { $gte: new Date(Date.now() - config.notifyCooldownMs) },
      });
      if (recent) return await Notification.create({ ...base, status: 'skipped', error: 'Duplicate within cooldown window' });
    }
    if (!channelConfigured[channel]()) {
      const what = channel === 'email' ? 'SMTP_HOST and EMAIL_FROM' : 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER';
      return await Notification.create({ ...base, status: 'not_configured', error: `${channel.toUpperCase()} provider not configured: set ${what}` });
    }
    const result = await providers[channel]({ to, subject, text });
    return await Notification.create({ ...base, status: 'sent', provider: result.provider, providerMessageId: result.id });
  } catch (err) {
    console.warn(`[notify] ${channel} ${event} to ${mask(to)} failed: ${err.message}`);
    try {
      return await Notification.create({ ...base, status: 'failed', error: String(err.message).slice(0, 300) });
    } catch {
      return null;
    }
  }
}

const mapsLink = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` : '');

// Builds the message plan for an event: who gets what on which channel
function plan(event, user, ctx) {
  const ec = user.emergencyContact || {};
  const prefs = user.notificationPrefs || {};
  const link = mapsLink(ctx.lat, ctx.lng);
  const toEc = prefs.notifyEmergencyContact !== false;
  const out = [];
  const add = (channel, recipientType, to, subject, text) => {
    if (recipientType === 'tourist' && prefs[channel] === false) return;
    if (recipientType === 'emergency_contact' && !toEc) return;
    out.push({ channel, recipientType, to, subject, text });
  };

  switch (event) {
    case 'SOS': {
      const text = `TourSafe SOS: ${user.name} requested emergency help${ctx.message ? ` ("${ctx.message}")` : ''}. Location: ${link || 'unknown'}. The control room has been notified.`;
      add('sms', 'emergency_contact', ec.phone, null, text);
      add('email', 'emergency_contact', ec.email, `SOS from ${user.name}`, text);
      add('email', 'tourist', user.email, 'Your SOS was received', `Your SOS was received by the TourSafe control room at ${new Date().toUTCString()}. Location sent: ${link || 'last known position'}.`);
      break;
    }
    case 'ZONE_RED': {
      const text = `TourSafe warning: you entered a RESTRICTED area (${ctx.zoneName}). Please leave immediately. ${link}`;
      add('sms', 'tourist', user.phone, null, text);
      add('email', 'tourist', user.email, `Restricted area: ${ctx.zoneName}`, text);
      add('email', 'emergency_contact', ec.email, `${user.name} entered a restricted area`, `${user.name} entered the restricted area "${ctx.zoneName}". ${link}`);
      break;
    }
    case 'ZONE_YELLOW':
      add('email', 'tourist', user.email, `Caution area: ${ctx.zoneName}`, `TourSafe caution: you entered "${ctx.zoneName}". ${ctx.description || 'Stay alert.'} ${link}`);
      break;
    case 'INCIDENT_ASSIGNED': {
      const text = `TourSafe: ${ctx.assignedTo} has been assigned to your emergency. Stay where you are if it is safe.`;
      add('sms', 'tourist', user.phone, null, text);
      add('email', 'tourist', user.email, 'Help has been assigned', text);
      add('sms', 'emergency_contact', ec.phone, null, `TourSafe: help (${ctx.assignedTo}) has been assigned to ${user.name}'s emergency.`);
      break;
    }
    case 'INCIDENT_STATUS':
      add('email', 'tourist', user.email, `Incident ${ctx.status}`, `Your TourSafe incident is now: ${ctx.status}${ctx.note ? ` (${ctx.note})` : ''}.`);
      add('email', 'emergency_contact', ec.email, `${user.name}'s incident is ${ctx.status}`, `The TourSafe incident for ${user.name} is now ${ctx.status}.`);
      break;
    case 'CHECKIN_MISSED': {
      const text = `TourSafe: ${user.name} did not confirm a safety check-in due at ${new Date(ctx.dueAt).toUTCString()}${ctx.note ? ` ("${ctx.note}")` : ''}. Last known location: ${link || 'unknown'}. The control room has been alerted.`;
      add('sms', 'emergency_contact', ec.phone, null, text);
      add('email', 'emergency_contact', ec.email, `${user.name} missed a safety check-in`, text);
      add('sms', 'tourist', user.phone, null, 'TourSafe: you missed your safety check-in. Open the app and tap "I\'m safe", or press SOS if you need help.');
      break;
    }
    case 'JOURNEY_OVERDUE': {
      const text = `TourSafe: ${user.name} has not yet arrived at ${ctx.destinationName || 'their destination'} (expected ${new Date(ctx.expectedArrivalAt).toUTCString()}). Last known location: ${link || 'unknown'}.`;
      add('email', 'emergency_contact', ec.email, `${user.name} is overdue`, text);
      add('sms', 'tourist', user.phone, null, 'TourSafe: you have not reached your destination yet. If you are fine, end your journey in the app.');
      break;
    }
    default:
      break;
  }
  return out;
}

// Notify everyone relevant about an event. Runs in the background; resolves with the stored records.
async function notifyEvent(event, user, ctx = {}) {
  const messages = plan(event, user, ctx);
  const scope = ctx.incidentId || ctx.zoneId || '';
  return Promise.all(
    messages.map((m) =>
      deliver({
        ...m,
        userId: user._id,
        event,
        incidentId: ctx.incidentId,
        // SOS and incident updates are always sent; zone alerts are de-duplicated per zone
        dedupeKey: event.startsWith('ZONE_') ? `${event}:${user._id}:${scope}:${m.channel}:${m.recipientType}` : undefined,
      })
    )
  );
}

// Password reset email. Returns the stored Notification (status tells whether it really went out).
async function sendPasswordResetEmail(user, link) {
  return deliver({
    channel: 'email',
    recipientType: 'tourist',
    to: user.email,
    userId: user._id,
    event: 'PASSWORD_RESET',
    subject: 'Reset your TourSafe password',
    text: `A password reset was requested for your TourSafe account.\n\nOpen this link within ${config.passwordResetMinutes} minutes to choose a new password:\n${link}\n\nIf you did not request this, ignore this email; your password stays unchanged.`,
  });
}

module.exports = { notifyEvent, sendPasswordResetEmail, deliver, plan, setProvidersForTests };
