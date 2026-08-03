-- =============================================================================
-- 001_schema.sql — Fase 1
--
-- Tablas de docs/PRODUCTO.md §8 (reordenadas para que las FK compilen),
-- índices, RLS + policies, y los dos añadidos de docs/ARQUITECTURA.md §3 y §6:
--   · vistas `security_barrier` scoped por tenant  (capa 3 de aislamiento)
--   · rol `query_runner` con SELECT solo sobre esas vistas (capa 2)
--
-- Idempotente: se puede reejecutar sobre una base ya migrada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas
--    Orden de creación: customers y products antes que orders y order_items,
--    porque los referencian. El schema de PRODUCTO.md §8 está escrito en un
--    orden que no compila tal cual.
-- -----------------------------------------------------------------------------

-- Tenants (tiendas conectadas)
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  platform text check (platform in ('shopify', 'woocommerce', 'amazon', 'csv')) not null,
  shop_domain text,
  access_token text,                   -- encrypted (estrategia pendiente, Fase 7)
  shop_name text,
  currency text default 'USD',
  last_sync_at timestamptz,
  sync_status text check (sync_status in ('pending', 'syncing', 'complete', 'error')) default 'pending',
  created_at timestamptz default now()
);

-- Clientes
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  platform_customer_id text not null,
  orders_count int default 0,
  total_spent numeric(12,2) default 0,
  first_order_at timestamptz,
  last_order_at timestamptz,
  city text,
  province text,
  country text,
  tags text,
  created_at timestamptz default now(),
  unique(store_id, platform_customer_id)
);

-- Productos
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  platform_product_id text not null,
  title text not null,
  product_type text,
  vendor text,
  tags text,
  status text,
  created_at_platform timestamptz,
  created_at timestamptz default now(),
  unique(store_id, platform_product_id)
);

-- Pedidos sincronizados
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  platform_order_id text not null,
  order_number text,
  created_at_platform timestamptz,
  financial_status text,
  fulfillment_status text,
  total_price numeric(12,2),
  subtotal_price numeric(12,2),
  total_tax numeric(12,2),
  total_discounts numeric(12,2),
  currency text,
  customer_id uuid references customers(id),
  source_name text,
  tags text,
  created_at timestamptz default now(),
  unique(store_id, platform_order_id)
);

-- Line items de pedidos
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  product_id uuid references products(id),
  variant_title text,
  title text not null,
  quantity int not null,
  price numeric(12,2),
  total_discount numeric(12,2) default 0,
  sku text,
  created_at timestamptz default now()
);

-- Inventario
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  sku text,
  quantity int default 0,
  location text,
  updated_at timestamptz default now()
);

-- Sesiones de chat
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  store_id uuid references stores(id),
  title text,
  source text check (source in ('store', 'csv')) default 'store',
  csv_file_name text,
  csv_schema jsonb,
  created_at timestamptz default now()
);

-- Mensajes del chat
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade,
  role text check (role in ('user', 'assistant')) not null,
  content text not null,
  sql_generated text,
  query_result jsonb,
  chart_type text,
  chart_config jsonb,
  insights jsonb,
  tokens_used int default 0,
  created_at timestamptz default now()
);

-- Uso (rate limiting + billing)
create table if not exists usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  month date not null,
  queries_count int default 0,
  tokens_total int default 0,
  unique(user_id, month)
);

-- Suscripciones
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text check (plan in ('free', 'core', 'pro')) default 'free',
  status text check (status in ('active', 'canceled', 'past_due', 'trialing')) default 'active',
  current_period_end timestamptz,
  created_at timestamptz default now()
);

-- CSV uploads temporales
create table if not exists csv_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  file_name text not null,
  file_size_bytes bigint,
  storage_path text,
  schema_json jsonb,
  row_count bigint,
  expires_at timestamptz default now() + interval '24 hours',
  created_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- 2. Índices (PRODUCTO.md §8)
-- -----------------------------------------------------------------------------

create index if not exists idx_orders_store on orders(store_id);
create index if not exists idx_orders_created on orders(store_id, created_at_platform);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_items_store on order_items(store_id);
create index if not exists idx_products_store on products(store_id);
create index if not exists idx_customers_store on customers(store_id);
create index if not exists idx_inventory_store on inventory(store_id);
create index if not exists idx_sessions_user on chat_sessions(user_id);
create index if not exists idx_messages_session on messages(session_id);
create index if not exists idx_usage_user_month on usage(user_id, month);

-- Añadidos: las vistas scoped filtran por store_id y unen por las claves
-- naturales; sin estos índices cada query del LLM hace seq scan.
create index if not exists idx_order_items_product on order_items(product_id);
create index if not exists idx_orders_customer on orders(customer_id);
create index if not exists idx_inventory_product on inventory(product_id);

-- -----------------------------------------------------------------------------
-- 3. RLS (PRODUCTO.md §8)
--    Protege el acceso vía SDK de Supabase (sesión de usuario). NO protege la
--    conexión SQL directa del motor de queries: de eso se encargan las vistas
--    scoped y el rol query_runner. Ver ARQUITECTURA.md §6.
-- -----------------------------------------------------------------------------

alter table stores enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table inventory enable row level security;
alter table chat_sessions enable row level security;
alter table messages enable row level security;
alter table usage enable row level security;
alter table subscriptions enable row level security;
alter table csv_uploads enable row level security;

drop policy if exists "users_own_stores" on stores;
create policy "users_own_stores" on stores for all using (auth.uid() = user_id);

drop policy if exists "users_own_orders" on orders;
create policy "users_own_orders" on orders for all using (
  store_id in (select id from stores where user_id = auth.uid())
);

drop policy if exists "users_own_order_items" on order_items;
create policy "users_own_order_items" on order_items for all using (
  store_id in (select id from stores where user_id = auth.uid())
);

drop policy if exists "users_own_products" on products;
create policy "users_own_products" on products for all using (
  store_id in (select id from stores where user_id = auth.uid())
);

drop policy if exists "users_own_customers" on customers;
create policy "users_own_customers" on customers for all using (
  store_id in (select id from stores where user_id = auth.uid())
);

drop policy if exists "users_own_inventory" on inventory;
create policy "users_own_inventory" on inventory for all using (
  store_id in (select id from stores where user_id = auth.uid())
);

drop policy if exists "users_own_sessions" on chat_sessions;
create policy "users_own_sessions" on chat_sessions for all using (auth.uid() = user_id);

drop policy if exists "users_own_messages" on messages;
create policy "users_own_messages" on messages for all using (
  session_id in (select id from chat_sessions where user_id = auth.uid())
);

drop policy if exists "users_own_usage" on usage;
create policy "users_own_usage" on usage for all using (auth.uid() = user_id);

drop policy if exists "users_own_subs" on subscriptions;
create policy "users_own_subs" on subscriptions for all using (auth.uid() = user_id);

drop policy if exists "users_own_csvs" on csv_uploads;
create policy "users_own_csvs" on csv_uploads for all using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 4. Vistas scoped por tenant — capa 3 de aislamiento (ARQUITECTURA.md §3)
--
--    · `security_barrier`: impide que una función barata del usuario se evalúe
--      antes que el filtro de tenant.
--    · Filtran por `app.store_id`, un GUC de sesión que fija el servidor con
--      set_config() y un parámetro bindeado. Si no está fijado, `current_setting`
--      con missing_ok devuelve null y las vistas devuelven CERO filas: el fallo
--      es cerrado, no abierto.
--    · No exponen `store_id`, ni los `id` uuid internos, ni `access_token`, ni
--      timestamps de sincronización. El LLM solo ve columnas de negocio.
--    · Para que el LLM pueda hacer joins sin ver uuids internos, se exponen las
--      claves naturales del tenant: `order_number`, `product_ref`, `customer_ref`.
--    · Estas vistas son además el catálogo que ve el LLM (src/lib/sql/catalog.js).
-- -----------------------------------------------------------------------------

create or replace function app_current_store_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.store_id', true), '')::uuid;
$$;

drop view if exists v_order_items;
drop view if exists v_orders;
drop view if exists v_inventory;
drop view if exists v_products;
drop view if exists v_customers;

create view v_customers with (security_barrier) as
  select c.platform_customer_id as customer_ref,
         c.orders_count,
         c.total_spent,
         c.first_order_at,
         c.last_order_at,
         c.city,
         c.province,
         c.country,
         c.tags
    from customers c
   where c.store_id = app_current_store_id();

create view v_products with (security_barrier) as
  select p.platform_product_id as product_ref,
         p.title,
         p.product_type,
         p.vendor,
         p.tags,
         p.status,
         p.created_at_platform
    from products p
   where p.store_id = app_current_store_id();

create view v_orders with (security_barrier) as
  select o.order_number,
         o.created_at_platform,
         o.financial_status,
         o.fulfillment_status,
         o.total_price,
         o.subtotal_price,
         o.total_tax,
         o.total_discounts,
         o.currency,
         c.platform_customer_id as customer_ref,
         o.source_name,
         o.tags
    from orders o
    left join customers c on c.id = o.customer_id
   where o.store_id = app_current_store_id();

create view v_order_items with (security_barrier) as
  select o.order_number,
         p.platform_product_id as product_ref,
         oi.title,
         oi.variant_title,
         oi.sku,
         oi.quantity,
         oi.price,
         oi.total_discount,
         -- Denormalizado a propósito: `line_total` y la fecha del pedido evitan
         -- que el LLM tenga que recomponer el importe de línea o unir con
         -- v_orders solo para filtrar por fecha. Menos SQL, menos formas de
         -- agregar mal.
         round(oi.quantity * oi.price - coalesce(oi.total_discount, 0), 2) as line_total,
         o.created_at_platform,
         o.financial_status
    from order_items oi
    join orders o on o.id = oi.order_id
    left join products p on p.id = oi.product_id
   where oi.store_id = app_current_store_id();

create view v_inventory with (security_barrier) as
  select p.platform_product_id as product_ref,
         p.title as product_title,
         i.sku,
         i.quantity,
         i.location,
         i.updated_at
    from inventory i
    left join products p on p.id = i.product_id
   where i.store_id = app_current_store_id();

-- -----------------------------------------------------------------------------
-- 5. Rol query_runner — capa 2 de aislamiento (ARQUITECTURA.md §3)
--
--    Único rol con el que se ejecuta SQL generado por el LLM. SELECT solo sobre
--    las vistas v_*, cero privilegios sobre las tablas base. `noinherit` para
--    que no herede nada por pertenencia a otros roles.
--
--    El rol se crea aquí SIN contraseña. La contraseña la fija
--    scripts/apply-migrations.js en un paso aparte, pasándola por un parámetro
--    bindeado — así nunca acaba interpolada en un fichero versionado.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'query_runner') then
    create role query_runner with login noinherit;
  else
    alter role query_runner with login noinherit;
  end if;
end
$$;

-- Nada por defecto, y nada heredado de futuros grants a public.
revoke all on schema public from query_runner;
revoke all on all tables in schema public from query_runner;
revoke all on all sequences in schema public from query_runner;
revoke all on all functions in schema public from query_runner;

grant usage on schema public to query_runner;
grant select on v_orders, v_order_items, v_products, v_customers, v_inventory to query_runner;
grant execute on function app_current_store_id() to query_runner;

-- Higiene de la sesión del rol: nunca escribe, nunca se queda colgado.
alter role query_runner set default_transaction_read_only = on;
alter role query_runner set statement_timeout = '5s';
alter role query_runner set idle_in_transaction_session_timeout = '10s';
alter role query_runner set search_path = public;

-- -----------------------------------------------------------------------------
-- 6. Catálogo que ve el LLM
--
--    Las descripciones viven en la base como COMMENT, no en un fichero JS: así
--    src/lib/sql/catalog.js las lee de aquí y es imposible que el catálogo del
--    prompt se desincronice del schema real.
-- -----------------------------------------------------------------------------

comment on view v_orders is 'Un pedido por fila. La unidad de venta: cabecera del pedido con sus importes totales.';
comment on column v_orders.order_number is 'Identificador del pedido visible para el seller. Clave para unir con v_order_items.';
comment on column v_orders.created_at_platform is 'Fecha y hora en que se hizo el pedido. Es la fecha que hay que usar para cualquier filtro temporal.';
comment on column v_orders.financial_status is 'Estado de cobro: paid, refunded, partially_refunded, pending. Una devolución es refunded o partially_refunded.';
comment on column v_orders.fulfillment_status is 'Estado de envío: fulfilled, unfulfilled, partial.';
comment on column v_orders.total_price is 'Importe total del pedido, impuestos incluidos y descuentos ya restados. Es el campo de facturación.';
comment on column v_orders.subtotal_price is 'Importe de los productos antes de impuestos y después de descuentos.';
comment on column v_orders.total_tax is 'Impuestos del pedido.';
comment on column v_orders.total_discounts is 'Descuentos aplicados al pedido. 0 si no hubo.';
comment on column v_orders.currency is 'Moneda del pedido, en ISO 4217. Toda la tienda usa la misma: no hay que convertir.';
comment on column v_orders.customer_ref is 'Referencia del cliente que hizo el pedido. Une con v_customers.customer_ref. Null si fue compra de invitado.';
comment on column v_orders.source_name is 'Canal de venta: web, pos, mobile.';
comment on column v_orders.tags is 'Etiquetas del pedido separadas por coma.';

comment on view v_order_items is 'Una línea de pedido por fila: qué producto y cuántas unidades lleva cada pedido. Es la tabla para preguntas de productos y unidades vendidas.';
comment on column v_order_items.order_number is 'Pedido al que pertenece la línea. Une con v_orders.order_number.';
comment on column v_order_items.product_ref is 'Referencia del producto. Une con v_products.product_ref y v_inventory.product_ref.';
comment on column v_order_items.title is 'Nombre del producto tal y como se vendió.';
comment on column v_order_items.variant_title is 'Variante vendida (talla, color). Null si el producto no tiene variantes.';
comment on column v_order_items.sku is 'SKU de la variante.';
comment on column v_order_items.quantity is 'Unidades vendidas en esta línea. Para "producto más vendido por unidades", sumar esto.';
comment on column v_order_items.price is 'Precio unitario del producto, sin descuento de línea.';
comment on column v_order_items.total_discount is 'Descuento aplicado a la línea entera, no por unidad.';
comment on column v_order_items.line_total is 'Ingreso real de la línea: quantity * price - total_discount. Para "producto que más factura", sumar esto y no price.';
comment on column v_order_items.created_at_platform is 'Fecha del pedido al que pertenece la línea, repetida aquí para poder filtrar por fecha sin unir con v_orders.';
comment on column v_order_items.financial_status is 'Estado de cobro del pedido al que pertenece la línea. Para excluir devoluciones, filtrar aquí.';

comment on view v_products is 'Catálogo de productos de la tienda. Una fila por producto (no por variante).';
comment on column v_products.product_ref is 'Referencia del producto. Une con v_order_items.product_ref.';
comment on column v_products.title is 'Nombre del producto.';
comment on column v_products.product_type is 'Categoría del producto.';
comment on column v_products.vendor is 'Marca o proveedor.';
comment on column v_products.tags is 'Etiquetas del producto separadas por coma.';
comment on column v_products.status is 'active, draft o archived. Los productos a la venta son active.';
comment on column v_products.created_at_platform is 'Fecha de alta del producto en la tienda.';

comment on view v_customers is 'Clientes de la tienda, con sus totales ya agregados. Una fila por cliente.';
comment on column v_customers.customer_ref is 'Referencia del cliente. Une con v_orders.customer_ref.';
comment on column v_customers.orders_count is 'Número total de pedidos del cliente en toda su vida. Un cliente recurrente tiene orders_count >= 2.';
comment on column v_customers.total_spent is 'Gasto total acumulado del cliente en toda su vida.';
comment on column v_customers.first_order_at is 'Fecha del primer pedido del cliente.';
comment on column v_customers.last_order_at is 'Fecha del último pedido del cliente.';
comment on column v_customers.city is 'Ciudad de envío del cliente.';
comment on column v_customers.province is 'Provincia, región o estado del cliente. Es el campo para preguntas de geografía dentro de un país.';
comment on column v_customers.country is 'País del cliente, nombre completo en inglés.';
comment on column v_customers.tags is 'Etiquetas del cliente separadas por coma.';

comment on view v_inventory is 'Stock actual por producto y almacén. Es una foto del presente: no tiene historia.';
comment on column v_inventory.product_ref is 'Referencia del producto. Une con v_products.product_ref.';
comment on column v_inventory.product_title is 'Nombre del producto, repetido aquí para no tener que unir con v_products.';
comment on column v_inventory.sku is 'SKU de la variante.';
comment on column v_inventory.quantity is 'Unidades disponibles ahora mismo. 0 es rotura de stock.';
comment on column v_inventory.location is 'Almacén o tienda física donde está el stock.';
comment on column v_inventory.updated_at is 'Última actualización del stock.';
