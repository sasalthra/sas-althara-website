import nodemailer from 'nodemailer';

type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
};

export const CRM_MAIL_FROM = 'ساس الثراء <sasalthra.sa@gmail.com>';
const DEFAULT_FROM = CRM_MAIL_FROM;

let transporter: nodemailer.Transporter | null | undefined;

function fromAddress() {
  const configured = (process.env.SMTP_FROM || '').trim();
  if (!configured || /info@/i.test(configured)) return DEFAULT_FROM;
  return configured;
}

function resolveFrom(requested?: string) {
  const asked = (requested || '').trim();
  if (asked && !/info@/i.test(asked)) return asked;
  return fromAddress();
}

function smtpReady() {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      (process.env.SMTP_PASSWORD || process.env.SMTP_PASS) &&
      fromAddress()
  );
}

function mailer() {
  if (transporter !== undefined) return transporter;
  if (!smtpReady()) {
    console.warn('SMTP is not configured; assignment emails skipped');
    transporter = null;
    return null;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '',
    },
  });
  return transporter;
}

export async function sendMail(message: MailMessage) {
  const to = (Array.isArray(message.to) ? message.to : [message.to])
    .map((value) => value.trim())
    .filter(Boolean);
  if (!to.length) return false;
  const transport = mailer();
  if (!transport) return false;
  try {
    await transport.sendMail({
      from: resolveFrom(message.from),
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return true;
  } catch (error) {
    console.error('Failed to send assignment email:', error);
    return false;
  }
}
