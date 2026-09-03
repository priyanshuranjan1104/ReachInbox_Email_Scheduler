import nodemailer from 'nodemailer';
import { logger } from '../middleware/errorHandler';

// ──────────────────────────────────────────────────────────────────────────────
// Email Service — Ethereal SMTP via Nodemailer
//
// Uses Ethereal (https://ethereal.email) for development — no real emails sent.
// Credentials are auto-generated once and cached for the process lifetime.
// All sent messages are viewable at the Ethereal web UI using the preview URL.
//
// Production: swap the transporter for an SES / SendGrid / SMTP connection.
// ──────────────────────────────────────────────────────────────────────────────

export type SendEmailParams = {
  recipient: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  body: string;
};

export type SendEmailResult = {
  messageId: string;
  previewUrl: string | false;
};

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedAccount: { user: string; pass: string } | null = null;

/**
 * Create (or return the cached) Ethereal SMTP transporter.
 *
 * Credentials are created on first call and reused for the process lifetime.
 * If SMTP_HOST/SMTP_USER/SMTP_PASS env vars are set, those are used instead
 * (allows swapping to a real SMTP server without code changes).
 *
 * Throws a clear ConfigurationError if neither Ethereal auto-create nor
 * explicit env vars provide a working configuration.
 */
async function getTransporter(): Promise<nodemailer.Transporter> {
  if (cachedTransporter) return cachedTransporter;

  const smtpHost = process.env['SMTP_HOST'];
  const smtpUser = process.env['SMTP_USER'];
  const smtpPass = process.env['SMTP_PASS'];
  const smtpPort = parseInt(process.env['SMTP_PORT'] ?? '587', 10);
  const smtpSecure = process.env['SMTP_SECURE'] === 'true';

  if (smtpHost && smtpUser && smtpPass) {
    // ── Explicit SMTP configuration (production / custom dev) ───────────────
    logger.info({ host: smtpHost, port: smtpPort, user: smtpUser }, 'Using explicit SMTP configuration');

    cachedTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
    });
  } else {
    // ── Ethereal auto-generated test account ────────────────────────────────
    logger.info('No SMTP_HOST set — creating Ethereal test account...');

    try {
      const testAccount = await nodemailer.createTestAccount();
      cachedAccount = { user: testAccount.user, pass: testAccount.pass };

      cachedTransporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });

      logger.info(
        {
          etherealUser: testAccount.user,
          // Do NOT log the password
          smtpHost: testAccount.smtp.host,
          smtpPort: testAccount.smtp.port,
          webUi: 'https://ethereal.email',
        },
        '✅ Ethereal SMTP account created — view sent emails at https://ethereal.email',
      );
    } catch (err) {
      throw new Error(
        `Failed to create Ethereal SMTP test account. ` +
        `Set SMTP_HOST, SMTP_USER, SMTP_PASS env vars to use a custom SMTP server. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Verify the connection is usable
  try {
    await cachedTransporter.verify();
    logger.info('✅ SMTP transporter verified successfully');
  } catch (err) {
    cachedTransporter = null; // don't cache a broken transporter
    throw new Error(
      `SMTP connection verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return cachedTransporter;
}

/**
 * Send a single email via SMTP.
 * Returns the messageId and (for Ethereal) a preview URL.
 *
 * Throws on SMTP failure — the caller (worker) handles retries.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const transporter = await getTransporter();

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${params.senderName}" <${params.senderEmail}>`,
    to: params.recipient,
    subject: params.subject,
    text: params.body,
    html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${
      params.body
        .split('\n')
        .map((line) => `<p>${line}</p>`)
        .join('')
    }</div>`,
    headers: {
      'X-ReachInbox-Sender': params.senderEmail,
    },
  };

  const info = await transporter.sendMail(mailOptions);
  const previewUrl = nodemailer.getTestMessageUrl(info);

  logger.info(
    {
      messageId: info.messageId,
      recipient: params.recipient,
      subject: params.subject,
      previewUrl: previewUrl || 'N/A (not Ethereal)',
    },
    'Email sent successfully',
  );

  return {
    messageId: info.messageId as string,
    previewUrl,
  };
}

/**
 * Reset the transporter cache (used in tests).
 */
export function resetEmailTransporter(): void {
  cachedTransporter = null;
  cachedAccount = null;
}

/**
 * Return cached Ethereal account info (for display/dashboard).
 * Never returns the password.
 */
export function getEtherealInfo(): { user: string } | null {
  if (!cachedAccount) return null;
  return { user: cachedAccount.user };
}
