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

export type MailSendResult = {ok: true} | {ok: false; error: string};

function mailErrorText(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const text = raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(password|pass|secret)\b\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return text || 'خطأ غير معروف في البريد';
}

export async function sendMailResult(message: MailMessage): Promise<MailSendResult> {
  const to = (Array.isArray(message.to) ? message.to : [message.to])
    .map((value) => value.trim())
    .filter(Boolean);
  if (!to.length) return {ok: false, error: 'لا يوجد مستلم'};
  const transport = mailer();
  if (!transport) return {ok: false, error: 'إعدادات البريد غير مكتملة'};
  try {
    await transport.sendMail({
      from: resolveFrom(message.from),
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return {ok: true};
  } catch (error) {
    console.error('Failed to send assignment email:', error);
    return {ok: false, error: mailErrorText(error)};
  }
}

export async function sendMail(message: MailMessage) {
  return (await sendMailResult(message)).ok;
}
