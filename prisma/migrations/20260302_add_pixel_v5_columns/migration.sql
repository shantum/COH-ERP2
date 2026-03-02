-- Pixel v5: browser context, parsed UA, extended CF geo/network, VPN detection
ALTER TABLE "StorefrontEvent"
  ADD COLUMN "browserTimezone" TEXT,
  ADD COLUMN "browserLanguage" TEXT,
  ADD COLUMN "pageTitle" TEXT,
  ADD COLUMN "browser" TEXT,
  ADD COLUMN "os" TEXT,
  ADD COLUMN "cfTimezone" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "asOrganization" TEXT,
  ADD COLUMN "asn" INTEGER,
  ADD COLUMN "continent" TEXT,
  ADD COLUMN "regionCode" TEXT,
  ADD COLUMN "httpProtocol" TEXT,
  ADD COLUMN "tlsVersion" TEXT,
  ADD COLUMN "isVpn" BOOLEAN;
