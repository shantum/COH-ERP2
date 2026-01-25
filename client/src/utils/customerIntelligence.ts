/**
 * Customer Intelligence Utilities
 *
 * Shared utilities for customer profile components (CustomerTab, CustomerDetailModal).
 * Includes tier configuration, health scoring, and color mapping.
 */

import { Crown, Medal, Award } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

export interface TierConfig {
  bg: string;
  text: string;
  icon: LucideIcon;
  label: string;
  border: string;
  avatarBg?: string;
}

export interface TierProgress {
  progress: number;
  nextTier: string | null;
  amountToNext: number;
  shouldUpgrade: boolean;
}

export interface CustomerData {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  customerTier?: string | null;
  tier?: string | null;
  lifetimeValue?: number | null;
  totalOrders?: number | null;
  returnRate?: number | null;
  returnCount?: number | null;
  rtoCount?: number | null;
  exchangeCount?: number | null;
  firstOrderDate?: string | Date | null;
  lastOrderDate?: string | Date | null;
  acceptsMarketing?: boolean | null;
  avgOrderValue?: number | null;
  defaultAddress?: unknown | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  tags?: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Tier thresholds - must match backend tierUtils.js DEFAULT_TIER_THRESHOLDS
 */
export const TIER_THRESHOLDS = {
  bronze: 0,
  silver: 10000,
  gold: 25000,
  platinum: 50000,
} as const;

/**
 * Tier visual configuration for badges and avatars
 */
export const TIER_CONFIG: Record<string, TierConfig> = {
  platinum: {
    bg: 'bg-slate-700',
    text: 'text-white',
    icon: Crown,
    label: 'PLATINUM',
    border: 'border-slate-500',
    avatarBg: 'bg-slate-700',
  },
  gold: {
    bg: 'bg-amber-500',
    text: 'text-white',
    icon: Medal,
    label: 'GOLD',
    border: 'border-amber-400',
    avatarBg: 'bg-amber-500',
  },
  silver: {
    bg: 'bg-slate-400',
    text: 'text-white',
    icon: Medal,
    label: 'SILVER',
    border: 'border-slate-300',
    avatarBg: 'bg-slate-400',
  },
  bronze: {
    bg: 'bg-amber-700',
    text: 'text-amber-100',
    icon: Award,
    label: 'BRONZE',
    border: 'border-amber-600',
    avatarBg: 'bg-amber-700',
  },
};

/**
 * Comprehensive color name to hex mapping for visual swatches
 */
export const COLOR_MAP: Record<string, string> = {
  // Blacks
  black: '#1a1a1a',
  'carbon black': '#2d2d2d',
  'jet black': '#0a0a0a',
  // Whites & Creams
  white: '#ffffff',
  'off white': '#faf9f6',
  'cloud white': '#f5f5f5',
  cream: '#fffdd0',
  ivory: '#fffff0',
  beige: '#f5f5dc',
  // Browns & Tans
  tan: '#d2b48c',
  brown: '#8b4513',
  chocolate: '#7b3f00',
  ginger: '#b06500',
  'tree trunk': '#6b4423',
  coffee: '#6f4e37',
  espresso: '#3c2415',
  walnut: '#5d432c',
  cinnamon: '#d2691e',
  // Blues
  navy: '#000080',
  'navy blue': '#000080',
  'royal blue': '#4169e1',
  'sky blue': '#87ceeb',
  blue: '#0066cc',
  'light blue': '#add8e6',
  teal: '#008080',
  turquoise: '#40e0d0',
  denim: '#1560bd',
  indigo: '#4b0082',
  cobalt: '#0047ab',
  aqua: '#00ffff',
  cyan: '#00ffff',
  // Greens
  green: '#228b22',
  olive: '#808000',
  'olive green': '#6b8e23',
  sage: '#9dc183',
  'sage green': '#9dc183',
  mint: '#98ff98',
  'mint green': '#98ff98',
  'forest green': '#228b22',
  emerald: '#50c878',
  'emerald green': '#50c878',
  moss: '#8a9a5b',
  'moss green': '#8a9a5b',
  'hunter green': '#355e3b',
  // Reds
  red: '#dc143c',
  maroon: '#800000',
  burgundy: '#722f37',
  wine: '#722f37',
  crimson: '#dc143c',
  // Pinks & Corals
  coral: '#ff7f50',
  salmon: '#fa8072',
  pink: '#ffc0cb',
  'hot pink': '#ff69b4',
  rose: '#ff007f',
  blush: '#de5d83',
  'dusty pink': '#d4a5a5',
  'dusty rose': '#dcae96',
  // Purples
  mauve: '#e0b0ff',
  purple: '#800080',
  lavender: '#e6e6fa',
  violet: '#8b00ff',
  plum: '#dda0dd',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  lilac: '#c8a2c8',
  // Oranges
  orange: '#ff8c00',
  rust: '#b7410e',
  terracotta: '#e2725b',
  peach: '#ffcba4',
  'burnt orange': '#cc5500',
  tangerine: '#ff9966',
  // Yellows
  yellow: '#ffd700',
  mustard: '#ffdb58',
  gold: '#ffd700',
  lemon: '#fff44f',
  honey: '#eb9605',
  // Grays
  gray: '#808080',
  grey: '#808080',
  charcoal: '#36454f',
  slate: '#708090',
  'slate grey': '#708090',
  'slate gray': '#708090',
  silver: '#c0c0c0',
  ash: '#b2beb5',
  'ash grey': '#b2beb5',
  stone: '#928e85',
  graphite: '#383838',
  // Neutrals
  khaki: '#c3b091',
  camel: '#c19a6b',
  nude: '#e3bc9a',
  sand: '#c2b280',
  oatmeal: '#b5aa8f',
  taupe: '#483c32',
};

// ============================================================================
// HEALTH SCORE FUNCTIONS
// ============================================================================

/**
 * Calculate customer health score (0-100) based on RFM analysis
 * - Recency: Days since last order (max 25 pts)
 * - Frequency: Orders per month (max 25 pts)
 * - Monetary: Lifetime value (max 25 pts)
 * - Return penalty: High return rates reduce score (max -25 pts)
 */
export function calculateHealthScore(customer: CustomerData | null): number {
  if (!customer) return 0;

  const daysSinceLastOrder = customer.lastOrderDate
    ? Math.floor((Date.now() - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24))
    : 365;

  const totalOrders = customer.totalOrders || 0;
  const ltv = customer.lifetimeValue || 0;
  const returnRate = customer.returnRate || 0;

  const monthsSinceFirst = customer.firstOrderDate
    ? Math.max(1, Math.floor((Date.now() - new Date(customer.firstOrderDate).getTime()) / (1000 * 60 * 60 * 24 * 30)))
    : 1;

  const ordersPerMonth = totalOrders / monthsSinceFirst;

  const recencyScore = Math.max(0, (60 - daysSinceLastOrder) / 60) * 25;
  const frequencyScore = Math.min(ordersPerMonth * 15, 25);
  const monetaryScore = Math.min((ltv / 30000) * 25, 25);
  const returnPenalty = Math.min(returnRate * 0.5, 25);

  return Math.round(
    Math.max(0, Math.min(100, recencyScore + frequencyScore + monetaryScore + (25 - returnPenalty)))
  );
}

/**
 * Get color for health score display
 */
export function getHealthScoreColor(score: number): string {
  if (score >= 70) return '#10b981'; // emerald-500
  if (score >= 40) return '#f59e0b'; // amber-500
  return '#ef4444'; // red-500
}

/**
 * Get label for health score
 */
export function getHealthScoreLabel(score: number): string {
  if (score >= 70) return 'Excellent';
  if (score >= 40) return 'Moderate';
  return 'At Risk';
}

// ============================================================================
// TIER FUNCTIONS
// ============================================================================

/**
 * Calculate progress toward next tier
 */
export function calculateTierProgress(ltv: number, currentTier: string): TierProgress {
  const tiers = ['bronze', 'silver', 'gold', 'platinum'];
  const tierIndex = tiers.indexOf(currentTier?.toLowerCase() || 'bronze');

  // Already at highest tier
  if (tierIndex === -1 || tierIndex === tiers.length - 1) {
    return { progress: 100, nextTier: null, amountToNext: 0, shouldUpgrade: false };
  }

  const currentThreshold = TIER_THRESHOLDS[currentTier?.toLowerCase() as keyof typeof TIER_THRESHOLDS] || 0;
  const nextTierName = tiers[tierIndex + 1] as keyof typeof TIER_THRESHOLDS;
  const nextThreshold = TIER_THRESHOLDS[nextTierName];
  const amountToNext = Math.max(0, nextThreshold - ltv);

  // Customer has exceeded next tier threshold (should be upgraded)
  if (ltv >= nextThreshold) {
    return {
      progress: 100,
      nextTier: nextTierName.charAt(0).toUpperCase() + nextTierName.slice(1),
      amountToNext: 0,
      shouldUpgrade: true,
    };
  }

  const progress = Math.min(
    100,
    Math.max(0, ((ltv - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
  );

  return {
    progress,
    nextTier: nextTierName.charAt(0).toUpperCase() + nextTierName.slice(1),
    amountToNext,
    shouldUpgrade: false,
  };
}

/**
 * Get tier configuration for a given tier name
 */
export function getTierConfig(tier: string): TierConfig {
  return TIER_CONFIG[tier?.toLowerCase()] || TIER_CONFIG.bronze;
}

// ============================================================================
// COLOR FUNCTIONS
// ============================================================================

/**
 * Get hex color from color name (with fuzzy matching)
 */
export function getColorHex(colorName: string): string {
  const normalized = colorName.toLowerCase().trim();
  if (COLOR_MAP[normalized]) return COLOR_MAP[normalized];

  // Fuzzy matching - check if any key contains or is contained by the name
  const sortedKeys = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return COLOR_MAP[key];
    }
  }
  return '#9ca3af'; // gray-400 fallback
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get customer initials for avatar display
 */
export function getInitials(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = firstName?.charAt(0)?.toUpperCase() || '';
  const last = lastName?.charAt(0)?.toUpperCase() || '';
  return first + last || '?';
}

/**
 * Calculate tenure string from first order date
 */
export function calculateTenure(firstOrderDate: string | null): string {
  if (!firstOrderDate) return 'New Customer';

  const months = Math.floor((Date.now() - new Date(firstOrderDate).getTime()) / (1000 * 60 * 60 * 24 * 30));

  if (months < 1) return 'This month';
  if (months < 12) return `${months} month${months > 1 ? 's' : ''}`;

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (remainingMonths === 0) return `${years} year${years > 1 ? 's' : ''}`;
  return `${years}y ${remainingMonths}m`;
}

/**
 * Get days since last order
 */
export function getDaysSinceLastOrder(lastOrderDate: string | null): number | null {
  if (!lastOrderDate) return null;
  return Math.floor((Date.now() - new Date(lastOrderDate).getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Get relative time string (e.g., "2 days ago", "3 weeks ago")
 */
export function getRelativeTime(date: string): string {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days >= 14 ? 's' : ''} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${days >= 60 ? 's' : ''} ago`;
  return `${Math.floor(days / 365)} year${days >= 730 ? 's' : ''} ago`;
}

/**
 * Format address object into readable string
 */
export function formatAddress(address: unknown): string | null {
  if (!address) return null;

  // If it's already a string, try to parse it as JSON
  let addr = address;
  if (typeof address === 'string') {
    try {
      addr = JSON.parse(address);
    } catch {
      return address;
    }
  }

  // Build address from components
  const addrObj = addr as Record<string, unknown>;
  const parts: string[] = [];

  if (addrObj.address1) parts.push(String(addrObj.address1));
  if (addrObj.address2) parts.push(String(addrObj.address2));
  if (addrObj.city) parts.push(String(addrObj.city));
  if (addrObj.province || addrObj.province_code) {
    parts.push(String(addrObj.province || addrObj.province_code));
  }
  if (addrObj.zip) parts.push(String(addrObj.zip));

  return parts.length > 0 ? parts.join(', ') : null;
}
