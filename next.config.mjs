import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // El binario nativo de DuckDB (Fase 1, flujo CSV) no debe pasar por el bundler.
  serverExternalPackages: ['@duckdb/node-api'],
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
