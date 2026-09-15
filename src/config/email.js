const { Resend } = require('resend');

// Initialize Resend SDK using the API Key from environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends a password reset email using Resend API over HTTPS
 * @param {string} toEmail - Recipient email address
 * @param {string} resetLink - Deep link or URL containing reset token
 * @param {string} [fullName] - Recipient name
 */
async function sendResetEmail(toEmail, resetLink, fullName) {
  try {
    const data = await resend.emails.send({
      from: 'College Library <onboarding@resend.dev>', // Update with your verified domain in production
      to: toEmail,
      subject: 'Password Reset Request - College Library',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #6C5CE7; text-align: center;">Password Reset Request</h2>
          <p>Hello <strong>${fullName || 'Student'}</strong>,</p>
          <p>We received a request to reset your password for your College Library account. Click the button below to set a new password:</p>
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
    });

    console.log(`✉️ Reset email sent successfully via Resend to ${toEmail}`);
    return data;
  } catch (error) {
    console.error(`❌ Resend Email Delivery Error (${toEmail}):`, error.message);
    throw error;
  }
}

module.exports = { sendResetEmail };
