/**
 * Seed Employees
 *
 * Creates 17 employees from the Excel payroll data.
 * Creates Party records and links to existing Tailor records by name match.
 *
 * Usage: npx tsx prisma/seed-employees.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EMPLOYEES = [
  { name: 'Prabhakar Maharana', dept: 'production', basic: 14250, pf: true, esic: false, pt: true },
  { name: 'Mohamad Hasmuddin Mansuri', dept: 'production', basic: 13750, pf: true, esic: false, pt: true },
  { name: 'Ramji Prajapati', dept: 'production', basic: 12500, pf: true, esic: false, pt: true },
  { name: 'Leena Divekar', dept: 'production', basic: 11000, pf: true, esic: false, pt: false },
  { name: 'Vishal Vishwanath Jadhav', dept: 'production', basic: 13200, pf: true, esic: false, pt: true },
  { name: 'Bablu Turi', dept: 'production', basic: 12250, pf: true, esic: false, pt: true },
  { name: 'Chintamani Rajkumar', dept: 'production', basic: 11500, pf: true, esic: false, pt: true },
  { name: 'Manoj Kumar Goutam', dept: 'production', basic: 10000, pf: true, esic: true, pt: true },
  { name: 'Rajkumar', dept: 'production', basic: 9250, pf: true, esic: true, pt: true },
  { name: 'Anwar Ali', dept: 'production', basic: 11000, pf: true, esic: false, pt: true },
  { name: 'Abdullah Ansari', dept: 'production', basic: 11500, pf: true, esic: false, pt: true },
  { name: 'Haresh Sadhu Poojary', dept: 'production', basic: 14000, pf: true, esic: false, pt: true },
  { name: 'Kaishar Khan', dept: 'production', basic: 12000, pf: true, esic: false, pt: true },
  { name: 'Mahindra P', dept: 'production', basic: 13000, pf: true, esic: false, pt: true },
  { name: 'Karishma Singh', dept: 'office', basic: 44000, pf: true, esic: false, pt: true },
  { name: 'Pritee Dinesh', dept: 'office', basic: 30000, pf: true, esic: false, pt: true },
  { name: 'Pranay Das', dept: 'office', basic: 15000, pf: true, esic: false, pt: true },
] as const;

async function main() {
  console.log('Seeding employees...\n');

  // Fetch all tailors for name matching
  const tailors = await prisma.tailor.findMany({ select: { id: true, name: true } });
  const tailorByName = new Map(tailors.map((t) => [t.name.toLowerCase(), t.id]));

  let created = 0;
  let skipped = 0;

  for (const emp of EMPLOYEES) {
    // Check if employee already exists
    const existing = await prisma.employee.findUnique({ where: { name: emp.name } });
    if (existing) {
      console.log(`  SKIP: ${emp.name} (already exists)`);
      skipped++;
      continue;
    }

    // Create Party record for finance integration
    const partyName = `Employee: ${emp.name}`;
    const party = await prisma.party.upsert({
      where: { name: partyName },
      update: {},
      create: { name: partyName, category: 'statutory' },
    });

    // Try to match tailor by name (case-insensitive)
    const tailorId = tailorByName.get(emp.name.toLowerCase()) ?? null;

    // Check if tailor is already linked to another employee
    let finalTailorId = tailorId;
    if (tailorId) {
      const alreadyLinked = await prisma.employee.findUnique({ where: { tailorId } });
      if (alreadyLinked) {
        console.log(`  NOTE: Tailor "${emp.name}" already linked to another employee, skipping tailor link`);
        finalTailorId = null;
      }
    }

    await prisma.employee.create({
      data: {
        name: emp.name,
        department: emp.dept,
        basicSalary: emp.basic,
        pfApplicable: emp.pf,
        esicApplicable: emp.esic,
        ptApplicable: emp.pt,
        partyId: party.id,
        ...(finalTailorId ? { tailorId: finalTailorId } : {}),
      },
    });

    const tailorNote = finalTailorId ? ' (linked to tailor)' : '';
    console.log(`  OK: ${emp.name} — ${emp.dept}, Basic: ₹${emp.basic.toLocaleString('en-IN')}${tailorNote}`);
    created++;
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
