-- Add latitude, longitude, clientIp to StorefrontEvent
ALTER TABLE "StorefrontEvent" ADD COLUMN IF NOT EXISTS "latitude" TEXT;
ALTER TABLE "StorefrontEvent" ADD COLUMN IF NOT EXISTS "longitude" TEXT;
ALTER TABLE "StorefrontEvent" ADD COLUMN IF NOT EXISTS "clientIp" TEXT;
