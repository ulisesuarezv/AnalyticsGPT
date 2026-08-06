/**
 * /demo — la demo pública. Sin login, sobre el store demo de la Fase 1.
 *
 * Es el hito que se enseña para validar demanda: alguien abre el link, pregunta
 * y obtiene números reales sin registrarse. El `store_id` lo resuelve el
 * servidor (ARQUITECTURA.md §3); esta página solo necesita la divisa para
 * formatear las cifras.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ChatInterface } from '@/components/chat/ChatInterface';
import { SiteHeader } from '@/components/SiteHeader';
import { Link } from '@/i18n/navigation';
import { getDemoDataRange, getDemoStore } from '@/lib/db/stores';

// El chat siempre golpea la API en caliente; prerenderizar no aporta nada.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Demo' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/** El CTA aparece tras un par de respuestas, y nunca corta la conversación. */
async function SignupCta({ locale }) {
  const t = await getTranslations({ locale, namespace: 'Demo' });

  return (
    <div className="border-border bg-card rounded-lg border p-4 sm:p-5">
      <p className="font-medium text-pretty">{t('ctaTitle')}</p>
      <p className="text-muted-foreground mt-1 text-sm text-pretty">{t('ctaBody')}</p>
      <Link
        href="/#connect"
        className="bg-primary text-primary-foreground mt-3 inline-flex rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
      >
        {t('ctaButton')}
      </Link>
    </div>
  );
}

export default async function DemoPage({ params }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Demo' });

  let currency = null;
  let storeName = null;
  let period = null;
  try {
    const store = await getDemoStore();
    currency = store.currency;
    storeName = store.shop_name;

    const range = await getDemoDataRange();
    if (range) {
      const month = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' });
      period = `${month.format(new Date(range.from))} – ${month.format(new Date(range.to))}`;
    }
  } catch {
    // Sin base no hay demo, pero la página se pinta y la primera pregunta dará
    // un error honesto — mejor que un 500 en el link que se está enseñando.
  }

  return (
    <div className="flex h-dvh flex-col">
      <SiteHeader />

      <div className="border-border bg-muted/30 border-b px-4 py-2 sm:px-6">
        <p className="text-muted-foreground mx-auto max-w-3xl text-xs text-pretty">
          {storeName && period
            ? t('banner', { store: storeName, period })
            : t('bannerFallback')}
        </p>
      </div>

      <ChatInterface
        source="demo"
        currency={currency}
        ctaAfter={2}
        afterQuestions={<SignupCta locale={locale} />}
      />
    </div>
  );
}
