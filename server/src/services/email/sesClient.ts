import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

const log = logger.child({ module: 'sesClient' });

let client: SESClient | null = null;

function getClient(): SESClient {
  if (!client) {
    if (!env.AWS_SES_ACCESS_KEY_ID || !env.AWS_SES_SECRET_ACCESS_KEY) {
      throw new Error('AWS SES credentials not configured');
    }
    client = new SESClient({
      region: env.AWS_SES_REGION,
      credentials: {
        accessKeyId: env.AWS_SES_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

interface SesSendOptions {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendViaSes(options: SesSendOptions): Promise<{ messageId: string }> {
  const { to, from, subject, html, text } = options;
  const toAddresses = Array.isArray(to) ? to : [to];

  const command = new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: toAddresses },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: html, Charset: 'UTF-8' },
        ...(text ? { Text: { Data: text, Charset: 'UTF-8' } } : {}),
      },
    },
  });

  const response = await getClient().send(command);
  const messageId = response.MessageId ?? '';

  log.info({ messageId, to: toAddresses, subject }, 'Email sent via SES');
  return { messageId };
}
