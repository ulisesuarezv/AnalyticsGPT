'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('Common');

  return (
    <div
      role="group"
      aria-label={t('language')}
      className="border-border inline-flex items-center rounded-md border p-0.5"
    >
      {routing.locales.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => router.replace(pathname, { locale: code })}
          aria-current={code === locale ? 'true' : undefined}
          className={cn(
            'rounded-sm px-2 py-1 text-xs font-medium uppercase transition-colors',
            code === locale
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
