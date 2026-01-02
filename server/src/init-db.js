import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function initDb() {
  try {
    // Check if database has any users
    const userCount = await prisma.user.count();

    if (userCount === 0) {
      console.log('🔧 Database is empty, initializing...');

      // Run prisma db push to create tables
      console.log('📦 Creating database schema...');
      execSync('npx prisma db push --skip-generate', {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      // Create admin user
      console.log('👤 Creating admin user...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await prisma.user.create({
        data: {
          email: 'admin@coh.com',
          password: hashedPassword,
          name: 'Admin User',
          role: 'admin',
        },
      });

      console.log('✅ Database initialized successfully!');
      console.log('   Login with: admin@coh.com / admin123');
    } else {
      console.log('✅ Database already initialized');
    }
  } catch (error) {
    // If tables don't exist, create them
    if (error.code === 'P2021' || error.message?.includes('table') || error.message?.includes('does not exist')) {
      console.log('🔧 Tables not found, creating schema...');
      execSync('npx prisma db push --skip-generate', {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      // Create admin user
      console.log('👤 Creating admin user...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await prisma.user.create({
        data: {
          email: 'admin@coh.com',
          password: hashedPassword,
          name: 'Admin User',
          role: 'admin',
        },
      });

      console.log('✅ Database initialized successfully!');
    } else {
      console.error('Database init error:', error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

export default initDb;
