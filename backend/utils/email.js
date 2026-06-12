const nodemailer = require('nodemailer');

function createTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

async function sendEmail({ to, subject, text, html }) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[email] EMAIL_USER/EMAIL_PASS not set — skipping send.');
    return;
  }
  await transporter.sendMail({
    from: `"AutoAlert by ODIN" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

module.exports = { sendEmail };
