import { Command } from 'commander';
import { login, clearToken, loadToken, api } from '../api.js';
import { success, error, field, heading } from '../format.js';
import { createInterface } from 'node:readline';

function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      let input = '';
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf-8');
      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener('data', onData);
          rl.close();
          console.log();
          resolve(input);
        } else if (ch === '\u007F' || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += ch;
          process.stdout.write('*');
        }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Login to COH ERP')
    .option('-e, --email <email>', 'Email address')
    .option('-p, --password <password>', 'Password')
    .action(async (opts: { email?: string; password?: string }) => {
      const email = opts.email || (await prompt('Email: '));
      const password = opts.password || (await prompt('Password: ', true));

      const result = await login(email, password);
      if (result.success && result.user) {
        success(`Logged in as ${result.user.name} (${result.user.role})`);
      } else {
        error(result.error || 'Login failed');
        process.exit(1);
      }
    });

  program
    .command('logout')
    .description('Clear stored auth token')
    .action(() => {
      clearToken();
      success('Logged out');
    });

  program
    .command('whoami')
    .description('Show current user')
    .action(async () => {
      const token = loadToken();
      if (!token) {
        error('Not logged in. Run: coh login');
        process.exit(1);
      }

      const res = await api<{
        name: string;
        email: string;
        role: string;
        roleName: string | null;
        permissions: string[];
      }>('/api/auth/me');

      if (!res.ok) {
        error('Token expired or invalid. Run: coh login');
        process.exit(1);
      }

      heading('Current User');
      field('Name', res.data.name);
      field('Email', res.data.email);
      field('Role', res.data.roleName || res.data.role);
      console.log();
    });
}
