-- Add extraAccess field to User model for simplified permission system
-- This field stores feature access grants beyond the user's role
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "extraAccess" JSONB DEFAULT '[]';
