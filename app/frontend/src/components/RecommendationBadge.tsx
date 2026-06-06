// Thin wrapper — delegates rendering to Pill so call sites don't change.
import React from 'react';
import { Badge } from '../types';
import { Pill } from './Pill';

interface RecommendationBadgeProps {
  badge: Badge;
}

export function RecommendationBadge({ badge }: RecommendationBadgeProps): React.ReactElement | null {
  if (badge === null) return null;
  return <Pill variant={badge} />;
}
