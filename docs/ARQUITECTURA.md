# Arquitectura

Documento de decisiones técnicas. Donde contradiga a `PRODUCTO.md`, manda este.

---

## 1. La propiedad que hay que proteger

El producto se vende con una sola promesa: **los números son exactos**. Subir un CSV a ChatGPT ya
existe y es gratis; lo que no da es una cifra en la que confiar. Toda decisión técnica se juzga contra
esto:

> El LLM **escribe la consulta**. La base de datos **produce los números**. El LLM nunca inventa una
> cifra, solo la redacta.

Corolario práctico: la respuesta en lenguaje natural se genera a partir del resultado real de la query.
Si la query falla, no hay respuesta — nunca un número aproximado "para salir del paso".

---

## 2. Pipeline

```
                        ┌─ datos de tienda ─────────────────────────────┐
                        │                                               │
pregunta (ES/EN) ──▶ text-to-SQL ──▶ guard ──▶ Postgres (rol readonly)  │
                        │                      vistas scoped por tenant │
                        │                              │                │
                        └──────────────────────────────┼────────────────┘
                                                       │
                        ┌─ datos de CSV/XLSX ──────────┼────────────────┐
                        │                              │                │
  archivo ──▶ SheetJS ──▶ DuckDB in-memory ──▶ guard ──┤                │
                        │                              │                │
                        └──────────────────────────────┼────────────────┘
                                                       ▼
                                        resultado exacto (filas)
                                                       │
                                                       ▼
                              LLM #2: respuesta natural + chart + insights
                                                       │
                                                       ▼
                                        Recharts + tabla + insight cards
```

Dos fuentes, dos motores, **un solo contrato de salida**. La UI de chat no sabe de dónde vinieron los
datos.

### Desviación respecto a `PRODUCTO.md` §4

El documento original define: sincronizar Shopify → Supabase → **cargar los datos del tenant en DuckDB
in-memory en cada query** → ejecutar SQL DuckDB.

Se descarta. En serverless, cada request pagaría la hidratación completa del tenant (leer de Postgres,
serializar, cargar en DuckDB) antes de empezar a responder — sobre datos que ya están en una base
relacional perfectamente capaz de agregarlos. Se sustituye por SQL directo contra Postgres.

DuckDB **sí** se mantiene para el flujo CSV/XLSX, donde es la herramienta correcta: datos efímeros que
no viven en ninguna base y necesitan un motor SQL sobre memoria.

Coste del cambio: dos dialectos SQL en los prompts (Postgres y DuckDB). Se resuelve con un fragmento de
prompt por dialecto sobre un mismo esqueleto. Es un coste barato y contenido.

---

## 3. Aislamiento multi-tenant

El riesgo estructural del producto: **estamos ejecutando SQL escrito por un LLM**. Un fallo aquí no es
un bug de UI, es la fuga de los datos de ventas de un cliente a otro.

Tres capas independientes. Ninguna es suficiente sola; las tres juntas hacen que un fallo en una no sea
explotable.

### Capa 1 — Validador (`src/lib/sql/guard.js`)

Antes de tocar la base, el SQL generado debe pasar:

- exactamente **un** statement (rechazo si hay `;` con contenido detrás)
- empieza por `SELECT` o por un `WITH` cuyo cuerpo sea `SELECT`
- sin DDL/DML/DCL: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`,
  `REVOKE`, `COPY`, `CALL`, `SET`, `ATTACH`
- sin `pg_`/`information_schema`/`pg_catalog`
- sin comentarios (`--`, `/* */`) — se eliminan antes de validar, no se aceptan como truco de evasión
- solo referencia las vistas del catálogo expuesto

El validador **rechaza**, no sanea. Sanear invita a bypasses; rechazar es auditable.

### Capa 2 — Permisos de rol

Conexión dedicada `DATABASE_URL_READONLY` con el rol `query_runner`:

- `SELECT` únicamente, y solo sobre las vistas `v_*`
- **cero** privilegios sobre las tablas base
- transacción `READ ONLY` con `statement_timeout` (5s) y `idle_in_transaction_session_timeout`

Aunque el validador fallara y pasara un `DELETE`, Postgres lo rechaza por permisos.

### Capa 3 — Vistas scoped

Vistas `security_barrier` que filtran por el tenant de la sesión:

```sql
create view v_orders with (security_barrier) as
  select order_number, created_at_platform, financial_status, fulfillment_status,
         total_price, subtotal_price, total_tax, total_discounts, currency,
         customer_id, source_name, tags
    from orders
   where store_id = current_setting('app.store_id')::uuid;
```

Cada query corre así:

```sql
begin read only;
set local statement_timeout = '5s';
set local app.store_id = $1;   -- viene de la SESIÓN, jamás del cliente ni del LLM
<sql generado>;
commit;
```

Aunque el LLM escribiera `SELECT * FROM v_orders` sin filtro, la vista solo devuelve el tenant activo.
El `store_id` es un parámetro bindeado, no interpolación de string.

**Las vistas son además el catálogo que ve el LLM.** El prompt de text-to-SQL describe `v_*`, nunca las
tablas base. Esto tiene un efecto secundario útil: `store_id`, tokens de acceso y demás columnas
internas no aparecen en el schema, así que el modelo ni siquiera intenta usarlas.

### En el flujo CSV

No hay multi-tenancy que romper: cada instancia de DuckDB es efímera y contiene un único archivo, de un
único usuario, y muere con el request. El guard se aplica igual (evita `ATTACH`, lectura de ficheros
locales y funciones de sistema de DuckDB).

---

## 4. Capa LLM

Dos llamadas por query, con responsabilidades separadas:

| # | Función | Entrada | Salida |
|---|---|---|---|
| 1 | `text-to-sql` | pregunta + catálogo de vistas + 3 filas de muestra + resumen del historial | SQL, o `UNANSWERABLE: <motivo>` |
| 2 | `summarize` | pregunta + SQL + resultado real | respuesta + `chart_suggestion` + `chart_config` + `insights[]` |

**Recuperación de errores** (prompts literales en `PRODUCTO.md` §9):

1. SQL inválido o falla al ejecutar → reintento con el mensaje de error en el prompt (máx. 2)
2. Sigue fallando → reintento con `LLM_FALLBACK`
3. Sigue fallando → error honesto al usuario. **Nunca** una respuesta inventada.

**Modelo por env.** `src/lib/llm/models.js` resuelve `LLM_MODEL` / `LLM_FALLBACK` a través del AI SDK.
Ningún otro módulo nombra un proveedor. Cambiar de modelo o de proveedor es cambiar una variable de
entorno, no un refactor.

**Coste.** El doc estima ~$0.02 por 50 queries con `gpt-4o-mini`. Se registran los tokens por mensaje
(`messages.tokens_used`) desde la Fase 1 para poder contrastar la estimación con datos reales antes de
fijar el precio.

---

## 5. Contrato de `/api/query`

Estable desde la Fase 1. La Fase 2 consume esto y no debería necesitar cambiarlo.

**Request**

```jsonc
{
  "question": "¿Cuál fue mi producto más vendido este mes?",
  "source": "store",           // "store" | "csv" | "demo"
  "historySummary": "string?", // contexto de la conversación, ver abajo
  "locale": "es"
}
```

**Sobre `historySummary`.** La ruta recibe el contexto ya resumido, no un `sessionId`. El servidor no
va a buscar el historial: quien llama decide qué contexto es relevante y lo manda. En la Fase 3, cuando
las conversaciones se persistan, el resumen se compone en servidor a partir de `messages` — pero el
contrato de esta ruta no cambia.

Es lo que hace que funcione "¿y el mes pasado?" después de "¿cuánto vendí en julio?". Si la Fase 2 no
lo manda, cada pregunta se interpreta aislada y el chat deja de ser una conversación.

**Response 200**

```jsonc
{
  "answer": "Tu producto más vendido fue …",
  "sql": "select …",           // se muestra al usuario: es la prueba de que el número es real
  "rows": [{ "...": "..." }],
  "rowCount": 12,
  "truncated": false,
  "chart": {
    "type": "bar",             // bar | line | pie | scatter | table | null
    "xField": "product_title",
    "yField": "units_sold",
    "title": "Top productos — últimos 30 días"
  },
  "insights": [
    { "title": "…", "description": "…", "querySuggestion": "…" }
  ],
  "meta": { "model": "openai/gpt-4o-mini", "attempts": 1, "tokens": 1840, "ms": 2310 }
}
```

**Errores** — `{ "error": { "code", "message" } }` con códigos estables:
`UNANSWERABLE`, `SQL_FAILED`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `NO_DATA`, `INTERNAL`.
`message` es texto apto para mostrar al usuario, ya localizado. Los detalles crudos van al log, nunca
a la respuesta.

---

## 6. Modelo de datos

El schema de `PRODUCTO.md` §8 se adopta tal cual (tablas, RLS, índices), con dos añadidos:

1. Las vistas `v_*` de la sección 3.
2. El rol `query_runner` y sus grants.

RLS protege el acceso vía SDK de Supabase (sesión del usuario). Las vistas scoped protegen el acceso
vía SQL generado. Son dos caminos distintos a los mismos datos y **cada uno necesita su propia
defensa** — es un error común asumir que RLS cubre también el segundo.

---

## 7. Estructura de `src/lib`

```
lib/
├── db/           # cliente Postgres readonly, ejecución en transacción scoped
├── sql/          # guard.js (validador) + catalog.js (schema que ve el LLM)
├── duckdb/       # motor in-memory para CSV
├── llm/          # models.js, text-to-sql.js, summarize.js
├── excel/        # parser SheetJS
├── supabase/     # clients browser/server + proxy (Fase 3)
├── shopify/      # OAuth, GraphQL, sync, webhooks (Fase 7)
├── stripe/       # client, plans (Fase 5)
└── utils/        # rate-limit, format
```

---

## 8. Decisiones registradas

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| 1 | Postgres para datos de tienda | Hidratar DuckDB por query | Latencia y coste sin beneficio |
| 2 | DuckDB solo para CSV | Postgres temporal por upload | DuckDB es el motor correcto para datos efímeros |
| 3 | Vistas scoped + rol readonly | Solo RLS | RLS no cubre la conexión SQL directa |
| 4 | Guard que rechaza | Guard que sanea | Sanear invita a bypasses |
| 5 | Modelo por env var | SDK de OpenAI directo | Cambiar de proveedor sin refactor |
| 6 | `en` como locale por defecto | `es` | El mercado Shopify principal es angloparlante |
| 7 | Bilingüe desde Fase 0 | i18n al final | Retrofit de i18n sobre 8 fases de copy es caro |
| 8 | Demo sin login como primer hito | Shopify primero | Valida el core sin depender de credenciales que no existen |
