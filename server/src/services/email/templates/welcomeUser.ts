/**
 * Welcome User email — sent when a new user is created.
 * Contains login credentials (password + phone for OTP).
 */

import { wrapInLayout, heading, paragraph, detailTable, detailRow, button, divider } from './layout.js';

export interface WelcomeUserData {
  name: string;
  email: string;
  phone: string;
  password: string;
  loginUrl: string;
}

/** Render welcome email for the new user */
export function renderWelcomeUser(data: WelcomeUserData): string {
  const content = `
    ${heading('Welcome to COH ERP')}
    ${paragraph(`Hi ${data.name}, your account has been created. Here are your login details:`)}
    ${detailTable(
      detailRow('Email', data.email) +
      detailRow('Phone', data.phone) +
      detailRow('Password', `<code style="background:#f5f5f5;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:14px;">${data.password}</code>`)
    )}
    ${paragraph('You can log in using either your <strong>phone number via WhatsApp OTP</strong> (recommended) or your email + password.')}
    ${button('Log In to ERP', data.loginUrl)}
    ${divider()}
    ${paragraph('<span style="font-size:13px;color:#888;">Please change your password after your first login. If you didn\'t expect this email, contact the admin.</span>')}
  `;

  return wrapInLayout(content, { preheader: 'Your COH ERP account is ready' });
}

/** Render admin notification email about new user */
export function renderNewUserAdminNotice(data: WelcomeUserData): string {
  const content = `
    ${heading('New User Created')}
    ${paragraph('A new user has been added to the ERP:')}
    ${detailTable(
      detailRow('Name', data.name) +
      detailRow('Email', data.email) +
      detailRow('Phone', data.phone) +
      detailRow('Password', `<code style="background:#f5f5f5;padding:2px 8px;border-radius:4px;font-family:monospace;font-size:14px;">${data.password}</code>`)
    )}
    ${button('View Users', data.loginUrl + '/admin')}
  `;

  return wrapInLayout(content, { preheader: `New ERP user: ${data.name}` });
}
