-- AlterTable: Remove unique constraint on Employee.name
DROP INDEX IF EXISTS "Employee_name_key";

-- AlterTable: Add personal fields to Employee
ALTER TABLE "Employee" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "gender" TEXT;
ALTER TABLE "Employee" ADD COLUMN "fatherOrSpouseName" TEXT;
ALTER TABLE "Employee" ADD COLUMN "maritalStatus" TEXT;
ALTER TABLE "Employee" ADD COLUMN "currentAddress" TEXT;
ALTER TABLE "Employee" ADD COLUMN "permanentAddress" TEXT;
ALTER TABLE "Employee" ADD COLUMN "emergencyContactName" TEXT;
ALTER TABLE "Employee" ADD COLUMN "emergencyContactPhone" TEXT;
ALTER TABLE "Employee" ADD COLUMN "emergencyContactRelation" TEXT;
ALTER TABLE "Employee" ADD COLUMN "pfNumber" TEXT;

-- CreateTable: SalaryRevision
CREATE TABLE "SalaryRevision" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicSalary" DOUBLE PRECISION NOT NULL,
    "pfApplicable" BOOLEAN NOT NULL,
    "esicApplicable" BOOLEAN NOT NULL,
    "ptApplicable" BOOLEAN NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryRevision_employeeId_idx" ON "SalaryRevision"("employeeId");
CREATE INDEX "SalaryRevision_effectiveFrom_idx" ON "SalaryRevision"("effectiveFrom");
CREATE INDEX "SalaryRevision_createdById_idx" ON "SalaryRevision"("createdById");

-- AddForeignKey
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
