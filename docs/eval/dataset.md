# Dataset demo — "Aurora Home & Living"

Generado por `scripts/seed-demo.js`. **Determinista**: seed `20260804`, misma seed → mismos datos.
Regenerar con `npm run db:seed` (borra y recrea el store demo por `shop_domain`).

El "hoy" del dataset es **fijo**: `DATASET_END = 2026-08-01` (exclusivo), 12 meses hacia atrás desde
`2025-08-01`. No se mueve con el reloj — si lo hiciera, las respuestas esperadas del eval caducarían
solas y los tests golden empezarían a fallar sin que nadie tocara nada.

## Forma

| Magnitud | Valor |
|---|---|
| Pedidos | 3.000 |
| Líneas de pedido | 4.936 |
| Productos | 60, en 6 categorías |
| Clientes con al menos un pedido | 1.158 (de 1.200 generados) |
| Registros de inventario | 69 (algunos productos en 2 almacenes) |
| Moneda | EUR, toda la tienda |
| AOV | **74,32 €** (banda pedida: 40-120 €) |
| Pedidos no `paid` | 7,6% (`refunded` + `partially_refunded`) |

**Estacionalidad**: pico claro en Q4. Diciembre 2025 es el mes fuerte; enero y febrero caen a la mitad.

**Repetición**: mayoría de clientes con 1 pedido (55,0%), cola larga hasta 15 pedidos.

**Integridad verificada** tras cada seed:
- `subtotal_price` de cada pedido == suma de sus líneas (`quantity * price - total_discount`) → 0 descuadres
- `order_number` crece con la fecha → 0 fuera de orden

## Patrones plantados a propósito

Los insights de la Fase 2 se juzgan contra esto. Si un insight "descubre" otra cosa, o no encuentra
estos, es que no está funcionando.

### P1 — Un producto se hunde en los dos últimos meses

**`prod_0004` · "Ceramic Cast Iron Pan"** (categoría Kitchen, vendor Aurora Kitchen).

Es uno de los productos más vendidos del catálogo durante 10 meses y se desploma en junio-julio 2026.

| Ventana | Unidades |
|---|---|
| Jun+Jul 2026 | 22 |
| Feb-May 2026 (equivalente a 2 meses) | 45,5 |
| **Variación** | **−52%** |

Implementado descartando ~1 de cada 3 líneas de ese producto a partir de `2026-06-01`. Se descarta la
línea entera en vez de bajarle el peso relativo: entre 60 productos, mover un peso apenas cambia nada
y el patrón se queda por debajo del ruido natural (±35% mes a mes).

### P2 — Una región despega en el último trimestre

**País Vasco** (España; ciudades Bilbao y San Sebastián).

| Provincia | Últ. trimestre | Trimestre previo | Variación |
|---|---|---|---|
| **País Vasco** | 33 | 8 | **+313%** |
| Galicia | 63 | 42 | +50% |
| Andalucía | 59 | 53 | +11% |
| Cataluña | 35 | 33 | +6% |
| Madrid | 49 | 51 | −4% |
| Valencia | 42 | 44 | −5% |

Crece **más del triple** que la media del resto de provincias españolas.

> Todas las cifras de este documento se midieron contra la base tras el último seed. Si cambias la seed o los parámetros del
> generador, **vuelve a medir y actualiza esta tabla** o el eval quedará mintiendo.

## Export CSV

`public/demo-data/sample-ecommerce.csv` — 4.936 filas, una por línea de pedido, desnormalizado
(pedido + cliente + producto en la misma fila). Es la misma realidad que Postgres, en el formato que
consume el flujo DuckDB.
