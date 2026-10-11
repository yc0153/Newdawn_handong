import type { Category } from '@/lib/domain/types';
import type { MessageKey } from '@/lib/i18n/messages';
export const CATEGORY_KEYS: Record<Category, MessageKey> = {
  transport: 'cat.transport',
  language: 'cat.language',
  environment: 'cat.environment',
  other: 'cat.other',
};
export const CATEGORY_ORDER: Category[] = ['transport', 'language', 'environment', 'other'];
