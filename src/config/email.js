const nodemailer = require('nodemailer');

// 1. Configure SMTP Transporter with timeout guards
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000, // 10 seconds connection attempt limit
  greetingTimeout: 5000,    // 5 seconds waiting for SMTP greeting
  socketTimeout: 10000,     // 10 seconds socket inactivity limit
});

/**
 * Verifies SMTP connection configuration on server startup
 */
const verifyTransporter = async () => {
  try {
    await transporter.verify();
    console.log('✉️  SMTP Server connection verified successfully');
  } catch (error) {
    console.error('❌ SMTP Connection Error:', error.message);
  }
};

/**
 * Sends password reset email to user
 * @param {string} toEmail - Recipient email address
 * @param {string} resetLink - Deep link or URL containing reset token
 * @param {string} [fullName] - Recipient name
 */
async function sendResetEmail(toEmail, resetLink, fullName) {
  const mailOptions = {
    from: `"College Library" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Password Reset Request - College Library',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #6C5CE7; text-align: center;">Password Reset Request</h2>
        <p>Hello <strong>${fullName || 'Student'}</strong>,</p>
        <p>We received a request to reset your password for your College Library account. Click the button below to complete the process:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" 
             style="background-color: #6C5CE7; color: #ffffff; padding: 14px 28px; 
                    text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>Or copy and paste this link into your mobile browser:</p>
        <p style="word-break: break-all; color: #555555; background-color: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 13px;">${resetLink}</p>
        <p style="color: #d63031;"><strong>Note: This link will expire in 30 minutes.</strong></p>
        <p>If you did not request this change, you can safely ignore this message.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="font-size: 12px; color: #999999; text-align: center;">College Library System • Automated Notification</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Password reset email dispatched to ${toEmail}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send password reset email to ${toEmail}:`, error.message);
    throw error;
  }
}

module.exports = {
  transporter,
  verifyTransporter,
  sendResetEmail
};
