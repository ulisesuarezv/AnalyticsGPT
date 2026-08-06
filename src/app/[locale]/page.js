/**
 * Landing mínima de la Fase 2: propuesta de valor, un ejemplo real de
 * pregunta→respuesta y CTA a la demo. La landing completa es la Fase 6.
 */

import { Database, LineChart, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { LandingExample } from '@/components/landing/LandingExample';
import { SiteHeader } from '@/components/SiteHeader';
import { Link } from '@/i18n/navigation';

const VALUE_PROPS = [
  { key: 'exact', Icon: Database },
  { key: 'proof', Icon: ShieldCheck },
  { key: 'insights', Icon: LineChart },
];

export default async function HomePage({ params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <Home />;
}

function Home() {
  const t = useTranslations('Home');
  const landing = useTranslations('Landing');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader>
        <Link
          href="/demo"
          className="border-border hover:bg-accent hidden rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:inline-flex"
        >
          {landing('navDemo')}
        </Link>
      </SiteHeader>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6">
        <section className="flex flex-col gap-5 py-16 sm:py-24">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('eyebrow')}
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg text-pretty">{t('subtitle')}</p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/demo"
              className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            >
              {t('ctaPrimary')}
            </Link>
            <span className="text-muted-foreground text-sm">{landing('ctaNote')}</span>
          </div>
        </section>

        <section className="pb-16 sm:pb-20">
          <LandingExample />
        </section>

        <section className="grid gap-6 pb-16 sm:grid-cols-3 sm:pb-20">
          {VALUE_PROPS.map(({ key, Icon }) => (
            <div key={key}>
              <Icon className="text-muted-foreground mb-3 size-5" />
              <h2 className="text-sm font-semibold">{landing(`props.${key}.title`)}</h2>
              <p className="text-muted-foreground mt-1 text-sm text-pretty">
                {landing(`props.${key}.body`)}
              </p>
            </div>
          ))}
        </section>

        <section id="connect" className="border-border scroll-mt-16 border-t py-14">
          <h2 className="text-2xl font-bold tracking-tight text-balance">
            {landing('connect.title')}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-pretty">
            {landing('connect.body')}
          </p>
          <Link
            href="/demo"
            className="bg-primary text-primary-foreground mt-5 inline-flex rounded-md px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            {landing('connect.cta')}
          </Link>
        </section>
      </main>

      <footer className="border-border text-muted-foreground border-t px-4 py-4 text-xs sm:px-6">
        {t('status')}
      </footer>
    </div>
  );
}
