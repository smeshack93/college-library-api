const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,        // e.g., smtp.gmail.com
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendResetEmail(toEmail, resetLink, fullName) {
  const mailOptions = {
    from: `"College Library" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Password Reset Request - College Library',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2 style="color: #6C5CE7;">Password Reset Request</h2>
        <p>Hello ${fullName || 'Student'},</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" 
             style="background: #6C5CE7; color: white; padding: 12px 30px; 
                    text-decoration: none; border-radius: 8px; display: inline-block;">
            Reset Password
          </a>
        </p>
        <p>Or copy this link into your browser:</p>
        <p style="word-break: break-all; color: #555;">${resetLink}</p>
        <p><strong>This link expires in 30 minutes.</strong></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="font-size: 12px; color: #999;">College Library System</p>
      </div>
    `
  };
  return transporter.sendMail(mailOptions);
}

module.exports = { sendResetEmail };
