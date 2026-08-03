import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function HomePage({ params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <Home />;
}

// Placeholder de Fase 0. La landing real se construye en Fase 2 (hero) y Fase 6 (completa).
function Home() {
  const t = useTranslations('Home');
  const nav = useTranslations('Nav');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border flex items-center justify-between border-b px-6 py-4">
        <span className="font-bold tracking-tight">ecommerce-analytics</span>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-20">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
          {t('title')}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-lg text-pretty">
          {t('subtitle')}
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href="/demo"
            className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            {t('ctaPrimary')}
          </Link>
          <Link
            href="/pricing"
            className="border-border hover:bg-accent rounded-md border px-5 py-2.5 text-sm font-medium transition-colors"
          >
            {nav('pricing')}
          </Link>
        </div>
      </main>

      <footer className="border-border text-muted-foreground border-t px-6 py-4 text-xs">
        {t('status')}
      </footer>
    </div>
  );
}
