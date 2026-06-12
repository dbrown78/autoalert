const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendEmail({ to, subject, text, html }) {
    const from = process.env.EMAIL_FROM || 'dbrownnj365@gmail.com';
    const msg = { to, from, subject, text, html };
    await sgMail.send(msg);
}

module.exports = { sendEmail };
