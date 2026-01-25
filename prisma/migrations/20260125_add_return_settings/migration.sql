-- CreateTable
CREATE TABLE "ReturnSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "windowDays" INTEGER NOT NULL DEFAULT 14,
    "windowWarningDays" INTEGER NOT NULL DEFAULT 12,
    "autoRejectAfterDays" INTEGER,
    "allowExpiredOverride" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ReturnSettings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReturnSettings" ADD CONSTRAINT "ReturnSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
