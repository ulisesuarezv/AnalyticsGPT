import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

/** Cabecera común a la landing y a la demo. */
export function SiteHeader({ children }) {
  return (
    <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
      <Link href="/" className="font-bold tracking-tight">
        ecommerce-analytics
      </Link>
      <div className="flex items-center gap-2">
        {children}
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
