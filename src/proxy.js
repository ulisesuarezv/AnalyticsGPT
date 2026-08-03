import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// En Next.js 16 el middleware vive en `proxy.js`.
// Fase 3 añadirá aquí el refresh de sesión de Supabase, componiendo con este handler.
export default createMiddleware(routing);

export const config = {
  // Todas las rutas excepto /api, internos de Next y ficheros con extensión.
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
