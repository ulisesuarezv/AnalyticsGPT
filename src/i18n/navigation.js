import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Usar SIEMPRE estos wrappers en vez de los de `next/navigation`:
// mantienen el locale activo en cada navegación.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
