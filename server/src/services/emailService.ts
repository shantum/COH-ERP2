import { Resend } from 'resend';
import logger from '../utils/logger.js';

const log = logger.child({ module: 'email' });

const resend = new Resend(process.env.RESEND_API_KEY);

/** Default sender — update once your domain is verified in Resend */
const DEFAULT_FROM = 'COH ERP <reports@coh.one>';

interface Attachment {
  filename: string;
  /** File content as Buffer or base64 string */
  content: Buffer | string;
}

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  /** Plain text body */
  text?: string;
  /** HTML body */
  html?: string;
  attachments?: Attachment[];
  from?: string;
}

export async function sendEmail(options: SendEmailOptions) {
  const { to, subject, text, html, attachments, from = DEFAULT_FROM } = options;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      text: text ?? '',
      html,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: a.content instanceof Buffer ? a.content : Buffer.from(a.content as string, 'base64'),
      })),
    } as Parameters<typeof resend.emails.send>[0]);

    if (error) {
      log.error({ error }, 'Failed to send email');
      throw new Error(error.message);
    }

    log.info({ emailId: data?.id, to, subject }, 'Email sent');
    return data;
  } catch (err) {
    log.error({ err, to, subject }, 'Email send error');
    throw err;
  }
}
