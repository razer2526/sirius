# 02 · Modelo de datos

Las 48 tablas de Sirius, agrupadas por dominio, y los tres patrones de esquema que las mantienen.

Todo el esquema vive en **un solo archivo**: `public/install/schema.php` (~1,730 líneas), con cuatro funciones:

```php
sirius_schema_tables(PDO $pdo, bool $isMysql): array      // CREATE TABLE (dos bloques paralelos)
sirius_schema_migrations(PDO $pdo, bool $isMysql): array  // solo ALTER TABLE
sirius_seed_*(PDO $pdo, …): array                         // datos iniciales, idempotentes
sirius_install_schema(PDO $pdo, bool $isMysql, string $clinicName): array  // orquestador
```

Cada una devuelve un arreglo de líneas de bitácora; el orquestador las concatena y `install/setup.php` las imprime.

---

## Los tres patrones de esquema

### 1 · Doble motor: dos diccionarios paralelos

`sirius_schema_tables()` tiene **dos arreglos asociativos completos y paralelos**, elegidos por `$isMysql`: el bloque MySQL en las líneas 5–1297, el de SQLite en 1298 en adelante. No hay abstracción compartida — **una columna nueva se escribe dos veces, a mano.**

En la rama de MySQL:

```php
$suffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
```

Cada `CREATE TABLE` de MySQL cierra con `)$suffix`; los de SQLite solo con `)`.

**Mapeo de tipos:**

| MySQL | SQLite |
|---|---|
| `INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `ENUM('a','b')` | `TEXT` — **se conserva el default pero se pierde la restricción** |
| `JSON` | `TEXT` |
| `VARCHAR(n)` / `TEXT` | `TEXT` |
| `DECIMAL(p,s)` | `REAL` |
| `TINYINT(1)` | `INTEGER` |
| `DATE` / `DATETIME` | `TEXT` |

**Las dos diferencias que muerden:**

1. **Los ENUM no se validan en SQLite.** La única validación real de valores permitidos vive en PHP, en las constantes de cada handler (`const TASK_PRIORITIES = [...]`). En desarrollo (SQLite) un valor inválido pasa; en producción (MySQL) revienta. Es una fuente clásica de "funciona en mi máquina".

2. **SQLite no tiene `ON UPDATE CURRENT_TIMESTAMP`.**
   - MySQL: `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
   - SQLite: `updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))` — y ahí se queda para siempre.

   O sea que `updated_at` **se comporta distinto entre desarrollo y producción** salvo que el código lo escriba explícitamente.

**Llaves foráneas e índices:**

- MySQL declara constraints con nombre a nivel de tabla; SQLite usa referencias inline a nivel de columna.
- SQLite no puede declarar índices dentro del `CREATE TABLE`: un bloque `if (!$isMysql)` después del loop emite ~48 sentencias `CREATE INDEX IF NOT EXISTS` sueltas.
- En SQLite las llaves foráneas están apagadas por defecto; se encienden por conexión con `PRAGMA foreign_keys = ON` en `db.php`, y se apagan a propósito durante las restauraciones de respaldo.

**Trampa documentada:** `commission_statements.lines` — `lines` es palabra reservada en MySQL y debe ir entre backticks o el `CREATE TABLE` falla y aborta el instalador completo. En SQLite pasa sin más.

> ⚠️ **Los dos bloques ya se desincronizaron.** Hay índices que existen en MySQL y no en SQLite (`documents.idx_doc_type`, `documents.idx_doc_patient`, `lab_reference_ranges.idx_range_test`) y nombres de índice que difieren para el mismo índice (`idx_lab_study_active` vs `idx_labstudy_active`). Es el argumento más fuerte para que en el producto nuevo **ambos motores se generen de una sola definición**.

### 2 · Migraciones: idempotencia por tragarse la excepción

`sirius_schema_migrations()` es un arreglo plano de ~40 cadenas `ALTER TABLE … ADD COLUMN`. Sin tabla de versiones, sin numeración, sin `down`, sin consultar `information_schema`.

```php
foreach ($migrations as $sql) {
    try { $pdo->exec($sql); $applied++; }
    catch (Throwable $e) { /* la columna ya existe */ }
}
```

**Intenta todos los ALTER en cada corrida**; si la columna ya existe, el motor lanza error, PDO lo convierte en excepción y el catch la descarta. En una instalación nueva `$applied` es `0`, porque `sirius_schema_tables()` ya creó todas las columnas.

**Por qué las tablas nuevas no necesitan entrada aquí:** `sirius_schema_tables()` corre primero en cada pasada y todo es `CREATE TABLE IF NOT EXISTS`. Sobre una base existente, las tablas viejas son no-op y una tabla nueva simplemente se crea. Pero `CREATE TABLE IF NOT EXISTS` **no agrega columnas** a una tabla que ya existe — por eso una columna nueva en una tabla vieja se escribe **tres veces**: en el bloque MySQL, en el de SQLite, y como `ALTER` en migraciones.

Tres cosas viven fuera del loop:

1. Un índice único de MySQL que se emite aparte, porque agregar un UNIQUE en la misma transacción implícita que la columna puede ser rechazado.
2. Los índices post-migración de SQLite.
3. **Un backfill de datos** — la única migración que no es DDL. Mueve el modelo viejo de un solo asignado al de muchos-a-muchos:
   ```php
   $ignore = $isMysql ? 'IGNORE' : 'OR IGNORE';
   "INSERT $ignore INTO task_assignees (task_id, user_id)
    SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL"
   ```
   El `INSERT IGNORE` contra la restricción `UNIQUE (task_id, user_id)` lo hace seguro de repetir: nunca duplica ni pisa asignaciones agregadas después. **Este es el patrón a copiar para cualquier backfill.**

> ⚠️ Sin tabla de versiones **nunca puedes saber en qué revisión está una base**. Para un solo cliente es tolerable; para un producto con decenas de instalaciones es inviable. En el producto nuevo: tabla `schema_migrations` desde el día uno.

### 3 · Seeds: idempotencia por clave natural

Todos siguen la misma forma: **`SELECT` por clave de negocio → `INSERT` solo si falta**. Ninguno hace `UPDATE` de filas existentes (salvo `postal_codes`, a propósito), así que las ediciones del usuario sobreviven a una reinstalación.

| Función | Llena | Clave de idempotencia |
|---|---|---|
| `sirius_seed_settings()` | `settings`: nombre de la clínica, modelo de IA, tasas de comisión | `skey` |
| `sirius_seed_admin()` | un usuario `administrador` | **`COUNT(*) FROM users == 0`** — no por username |
| `sirius_seed_whatsapp()` | 3 estatus de conversación + 2 mensajes automáticos | `skey` / `type` |
| `sirius_seed_cobertura()` | zonas y códigos postales desde un CSV de SEPOMEX | `(estado, municipio)` / `cp` |
| `sirius_seed_commemorative_dates()` | 46 efemérides de salud y celebración | `(month, day, label)` |

**`sirius_seed_cobertura()` es el más interesante** porque combina tres estrategias distintas en una sola función:

1. **Zonas: insertar-si-falta, nunca actualizar.** Explícitamente no toca `has_coverage`, porque ese dato es del administrador, no del seed.
2. **Geocodificación: por lotes y reanudable.** Máximo 40 zonas por corrida, con `sleep(1)` entre llamadas para respetar el límite de Nominatim, y la bitácora le dice al operador cuántas faltan y que vuelva a entrar.
3. **Códigos postales: upsert real**, porque es catálogo de referencia sin estado editable. Las filas que el admin agregó a mano (`is_custom = 1`) quedan intactas simplemente porque no aparecen en el CSV.

`sirius_install_schema()` encadena: tablas → migraciones → settings → whatsapp → cobertura → efemérides. **Deliberadamente no toca usuarios** — el admin solo lo crea el asistente de primera instalación.

---

## Inventario de tablas

48 tablas. La columna **Rescate** anticipa el [06](06-producto-nuevo.md): 🟢 genérica · 🟡 genérica con renombre · 🔴 específica de clínica.

### A · Identidad, sesión y permisos

| Tabla | Qué es | Columnas clave | Rescate |
|---|---|---|---|
| `users` | Cuentas del personal. Raíz de casi toda FK del esquema. | `username` UNIQUE, `password_hash`, `role` ENUM(`estandar`,`administrador`,`developper`), `is_active`, `assignable`, `theme` | 🟢 |
| `user_permissions` | Permisos por usuario y módulo. PK `(user_id, module_key)`. | `module_key` VARCHAR(40), **`flags` JSON** | 🟢 |
| `remember_tokens` | Tokens de "recordarme", selector/validador. | `selector` UNIQUE, `validator_hash` CHAR(64), `expires_at` | 🟢 |
| `push_subscriptions` | Endpoints de Web Push por usuario y dispositivo. | `endpoint` UNIQUE (en MySQL índice de prefijo 255), `p256dh`, `auth` | 🟢 |

### B · Pacientes y expediente clínico

| Tabla | Qué es | Columnas clave | Rescate |
|---|---|---|---|
| `patients` | Expediente maestro, con demografía mexicana. | `file_number` UNIQUE, nombre partido en tres, `curp`, bloque de domicilio, texto libre clínico (alergias, crónicos, medicación), `is_deleted` | 🔴 → `contactos`/`clientes` |
| `episodes` | Un encuentro de servicio por paciente. La entidad operativa central. | `service` ENUM(`laboratorio`,`control_peso`,`fisioterapia`,`podologia`), `status` ENUM(`activo`,`cerrado`), **`service_data` JSON**, `client_uuid` UNIQUE | 🟡 → `órdenes`/`casos` |
| `consultations` | Notas de seguimiento dentro de un episodio, con doble firma enfermería/médico. | **`params` JSON** (signos vitales), `nurse_closed_at`, `doctor_closed_at` | 🔴 |
| `patient_documents` | Archivos adjuntos al expediente. | `stored_name`, `mime`, `size`, `category` | 🟡 |
| `episode_studies` | Renglones: qué estudios consumió un episodio (alimenta comisiones). | `study_name` (snapshot), `commission_group`, `amount_charged` | 🟡 |
| `result_deliveries` | Tablero ligero de "resultados por entregar". **Sin FK a pacientes.** | `patient_name` texto libre, `due_date`, `studies`, `needs_invoice` | 🟡 → entregables |

**`client_uuid` merece atención**: es la llave de idempotencia del asistente offline. El cliente genera un `crypto.randomUUID()`, lo guarda en la cola de IndexedDB y lo manda con el episodio. Si un reintento llega duplicado, la restricción UNIQUE lo rechaza en vez de crear dos episodios. **Patrón a copiar completo.**

### C · Catálogo de laboratorio

| Tabla | Qué es | Rescate |
|---|---|---|
| `lab_tests` | Catálogo de determinaciones. `slug` UNIQUE, `times_used` como contador para ordenar el autocompletado. | 🔴 |
| `lab_reference_ranges` | Valores de referencia por analito, segmentados por sexo (`A`/`F`/`M`), edad y condición. | 🔴 |
| `lab_studies` | Panel: agrupación ordenada de analitos. **No copia los rangos**, solo apunta a ellos. | 🔴 |
| `lab_study_items` | Join panel↔analito, con `sort_order`. UNIQUE `(study_id, test_id)`. | 🔴 |

El núcleo genérico escondido aquí es "ítem compuesto = lista ordenada de atributos de catálogo con límites de validación" — sirve para fichas técnicas o listas de control de calidad. Pero los rangos por sexo y edad no significan nada fuera de diagnóstico.

### D · Documentos generados

| Tabla | Qué es | Rescate |
|---|---|---|
| `documents` | Documentos membretados (el corazón del Membretador). Muy dirigido por JSON: **`patient_data`**, **`clinical_data`**, **`results`**, más `status` ENUM(`borrador`,`revisado`) y flujo de revisión (`reviewed_by`, `reviewed_at`). | 🔴 contenido / 🟡 el motor |

El motor —"generar documento con plantilla + membrete + flujo de revisión y liberación"— es genérico y sirve para facturas, certificados o reportes. Solo las plantillas y la semántica de liberación son de laboratorio.

### E · Comercial: cotizaciones, precios, comisiones, red de referidos

| Tabla | Qué es | Rescate |
|---|---|---|
| `quote_studies` | Lista de precios / catálogo vendible. `commission_group`, `public_price`, `is_active`. | 🟡 → `productos` |
| `quotes` | Cotizaciones con **`items` JSON** como snapshot de renglones, más subtotal, descuento y total. | 🟡 |
| `vinculacion_concierge` | Socios que refieren y agrupan médicos, con su `commission_pct`. | 🟡 → `partners` |
| `vinculacion_doctors` | Médicos que refieren, opcionalmente bajo un concierge. | 🟡 → `referidores` |
| `commission_entries` | Eventos individuales que generan comisión. **`studies` JSON**. | 🟡 |
| `commission_statements` | Estado de cuenta periódico. `party_type` ENUM(`doctor`,`concierge`) + `party_id` — **polimórfico, sin FK**. **`` `lines` `` JSON**. | 🟡 |

Todo este bloque es maquinaria genérica de comisiones y pagos a socios. Solo el vocabulario es médico.

### F · Cobertura geográfica

| Tabla | Qué es | Rescate |
|---|---|---|
| `coverage_zones` | Cobertura a nivel municipio, geocodificada. UNIQUE `(estado, municipio)`, `has_coverage`, `extra_cost`, lat/lon. | 🟡 |
| `postal_codes` | Catálogo SEPOMEX con **`colonias` JSON**, más `coverage_override` (NULL = hereda de la zona) y `is_custom`. | 🟡 |

**Nota para multi-tenant**: el catálogo de códigos postales es dato de referencia *global*, pero `has_coverage`, `extra_cost`, `coverage_override` e `is_custom` son decisiones de negocio *por inquilino*. La partición correcta es catálogo global + tabla de superposición por inquilino.

### G · Tareas y proyectos

| Tabla | Qué es | Rescate |
|---|---|---|
| `projects` | Contenedor de tareas. `status` ENUM(`activo`,`completado`,`archivado`). | 🟢 |
| `tasks` | Tareas y subtareas con recurrencia. Auto-FK `parent_id`, `priority` ENUM(4), `recurrence` ENUM(`diaria`,`semanal`), `weekday` TINYINT (0 = domingo, igual que `Date.getDay()`). | 🟢 |
| `task_assignees` / `project_assignees` | Muchos-a-muchos con `users`. UNIQUE por par. | 🟢 |
| `task_completions` | Bitácora de completado por periodo para tareas recurrentes. **UNIQUE `(task_id, period_key)`**. | 🟢 |

`task_completions` resuelve elegantemente el problema de las tareas recurrentes: en vez de generar filas futuras, se registra el cubo de tiempo completado. La restricción UNIQUE hace imposible completar dos veces el mismo periodo. **Patrón a copiar.**

### H · Inventario

| Tabla | Qué es | Rescate |
|---|---|---|
| `inventory_items` | Catálogo. `barcode` UNIQUE, `min_stock` (umbral de alerta), `unit`. | 🟢 |
| `inventory_lots` | Lote con caducidad — habilita PEPS y alertas de vencimiento. `quantity_remaining`, `expiry_date`, `unit_cost`, `supplier` (texto libre). | 🟢 |
| `inventory_movements` | Libro mayor inmutable. `type` ENUM(`entrada`,`salida`,`ajuste`), `reason`. | 🟢 |

Inventario por lotes con caducidad es genérico (farmacia, alimentos, químicos). ⚠️ Falta lo que un ERP real necesita: **tabla de proveedores** (hoy es texto libre) y órdenes de compra.

### I · Pizarrón y archivos

| Tabla | Qué es | Rescate |
|---|---|---|
| `board_items` | Notas, listas y dibujos en un lienzo. `scope` ENUM(`private`,`public`), `type` ENUM(`note`,`checklist`,`drawing`), **`content` JSON**, geometría `pos_x/pos_y/width/height/z_index`. | 🟢 |
| `file_folders` | Carpetas jerárquicas, auto-FK `parent_id`. | 🟢 |
| `files` | Metadatos; el binario vive en disco bajo `stored_name`. | 🟢 |

Las tres comparten el patrón **`scope` privado/público + `owner_id`**, que se rescata textual.

### J · Calendario

| Tabla | Qué es | Rescate |
|---|---|---|
| `appointments` | Citas con sincronización a Google Calendar. `service` ENUM(6 valores médicos), `status` ENUM(4), `source` ENUM(`sirius`,`google`), `google_event_id` UNIQUE + `google_updated_at`, **`attendees` JSON**. | 🟡 |

Todo es agendamiento genérico salvo el ENUM de servicios. Convertirlo en una tabla por inquilino y queda genérico.

### K · Marketing

| Tabla | Qué es | Rescate |
|---|---|---|
| `content_posts` | Calendario editorial de redes. `status` ENUM(`idea`,`diseno`,`programada`,`publicada`), `canva_url`, `thumbnail_file`, `emoji`, `color`. | 🟢 |
| `commemorative_dates` | Catálogo recurrente `month` + `day` **sin año**, así aplica todos los años. | 🟢 |

### L · Bandeja de WhatsApp

| Tabla | Qué es | Rescate |
|---|---|---|
| `wa_statuses` | Estatus configurables del pipeline. `skey` UNIQUE, `color`, `is_default`. | 🟢 |
| `wa_conversations` | Un hilo por número, estilo CRM. `wa_id` UNIQUE, `last_inbound_at` (ventana de 24 h), `unread_count`, `priority` ENUM(3). | 🟢 |
| `wa_messages` | Mensajes con medios y reacciones. `direction` ENUM(`in`,`out`), `wa_message_id` UNIQUE. Las **reacciones se guardan como propiedades del mensaje original**, no como filas nuevas. | 🟢 |
| `wa_quick_replies` | Respuestas predefinidas. | 🟢 |
| `wa_auto_messages` | Bienvenida y ausencia. `type` UNIQUE, `schedule`. | 🟢 |

### M · Sistema: configuración, auditoría, notificaciones, papelera

| Tabla | Qué es | Rescate |
|---|---|---|
| `settings` | Almacén llave/valor global. PK `skey` VARCHAR(60), `svalue` TEXT. **Singleton: una fila por llave para toda la instalación.** | 🟢 con `tenant_id` |
| `activity_log` | Bitácora de auditoría, solo append. `user_id` **+ `username` desnormalizado y sin FK**, `entity_type`/`entity_id` polimórficos. | 🟢 |
| `notifications` | Bandeja de notificaciones. `read_at` NULL = no leída. | 🟢 |
| `dismissed_alerts` | Descarte por usuario de alertas calculadas. UNIQUE `(user_id, alert_key)`. | 🟢 |
| `trash_items` | Papelera universal. `entity_type` + `entity_id` polimórficos, **`snapshot` JSON**, auto-FK `related_trash_id` para cascadas. | 🟢 |

`settings` es un patrón limpio y reusable: la configuración de IA, el branding, el nombre de la clínica y WhatsApp viven todos ahí como blobs JSON, sin necesidad de una tabla por cosa.

---

## Huecos conocidos del modelo

Cosas que un ERP comercial necesita y que aquí no existen:

- **Cero concepto de inquilino.** Ninguna tabla tiene `tenant_id`, `organization_id` ni equivalente. El aislamiento es por instalación completa. Ver [06](06-producto-nuevo.md).
- **Nada de facturación**: no hay planes, suscripciones, pagos ni ciclos de cobro.
- **Sin moneda ni localización**: `DECIMAL(10,2)` en todos lados con MXN implícito, y `patients.state` con default `'Ciudad de México'`.
- **Sin bloqueo optimista**: ninguna tabla tiene `version` o `row_version`, así que dos ediciones simultáneas se pisan silenciosamente.
- **Borrado suave inconsistente**: solo `patients` tiene `is_deleted`; todo lo demás depende de los snapshots de `trash_items`.
- **Sin tabla de proveedores** pese a tener inventario por lotes.
- **Tres pares polimórficos sin FK** (`trash_items`, `activity_log`, `commission_statements.party_*`) — son exactamente los puntos donde una fuga entre inquilinos sería más fácil.

Sigue con [03 · Módulos](03-modulos.md).
