# 06 · El producto nuevo

> ⚠️ **Este documento es una propuesta, no una descripción.** Los documentos 01 a 05 describen lo que Sirius *es* y se pueden verificar contra el código. Este tiene opiniones y decisiones de diseño discutibles. Tómalo como punto de partida, no como sentencia.

**El objetivo:** un ERP ligero, vendido por suscripción, para giros distintos — restaurantes, hospitales, clínicas, tiendas, librerías, cualquier negocio chico que distribuya tareas y necesite orden.

**La estrategia:** construir desde cero, pero rescatando las bases que Sirius ya probó en producción.

---

## 1 · Qué se rescata y qué se descarta

### El veredicto de un vistazo

De 23 módulos, **20 se rescatan**: 14 casi textuales, 6 con renombres. Solo 2 se descartan y 1 es un contenedor mixto.

| Se levanta casi tal cual | Se generaliza con renombres | Se descarta |
|---|---|---|
| tareas · pizarrón · archivos · inventario · marketing · whatsapp (+config) · usuarios · membretes · log · backup · api · papelera · configuración | dashboard · admisión · calendario · catálogo · vinculación · cobertura · cotizador · comisiones | expedientes · plantillas de estudios · membretador |

### Los cinco renombres

| Sirius | Producto nuevo |
|---|---|
| paciente | **cliente / contacto** |
| estudio | **producto / servicio** |
| episodio | **orden / caso** |
| médico, concierge | **referidor, partner** |
| servicio clínico (ENUM) | **línea de servicio (tabla por inquilino)** |

El último es el de mayor palanca. Hoy los servicios son ENUM en `episodes.service` y `appointments.service`, y constantes en `services.js`, `appointments.php` y `calendario.js`. **Convertirlo en tabla generaliza tres módulos de un golpe.**

### Del núcleo

Se rescata **entero** (ver [01](01-arquitectura.md)):

- `auth.php` completo, incluido el remember-me con rotación y detección de robo
- `csrf.php`, `response.php`, `log.php`
- El pipeline del front controller
- El modelo de permisos de dos niveles, incluido `mode_flags`
- La papelera polimórfica por snapshots
- `router.js`, `api.js`, y casi todo `ui.js`

Se rescata **con arreglos**:

| Pieza | Qué arreglar |
|---|---|
| `permissions.php` | sacar las funciones clínicas de visibilidad de fila |
| `trash.php` | la reinserción de la llave primaria original puede chocar |
| `ai.php` | portar tool-calling a los tres proveedores, no solo Gemini |
| Freno de fuerza bruta | moverlo de `$_SESSION` a la base, indexado por IP y usuario |
| `sw.js` | generar la lista de precaché, no mantenerla a mano |
| Modelo de visibilidad | hacerlo un helper compartido, no copiarlo en cada handler |

**No se rescata:** `sql_full_name()`, `recurrenceText()`, `fullName()`, los defaults médicos de `ai.php`, los iconos médicos de `ICONS`.

---

## 2 · Multi-inquilino

### El punto de partida

**Hoy no existe ningún concepto de inquilino.** Cero coincidencias de `tenant`, `organization_id`, `company_id` o `branch_id` en todo el PHP. El aislamiento es por instalación completa: una base de datos, un dominio y una corrida de `setup.php` por cliente.

Eso funciona para un cliente. Para vender suscripciones, no.

### La decisión de fondo

Dos caminos:

| | Una instancia por cliente | Esquema compartido con `tenant_id` |
|---|---|---|
| Aislamiento | Total, por construcción | Lógico, depende del código |
| Costo por cliente | Alto (servidor, base, despliegue) | Marginal |
| Actualizar a todos | N despliegues | Uno |
| Riesgo de fuga | Prácticamente nulo | **Real, y es el riesgo central** |
| Complejidad inicial | Baja (es lo que ya existe) | Alta |

**Recomendación: esquema compartido.** El modelo de suscripción con clientes chicos no soporta el costo operativo de N instancias, y "actualizar a todos con un despliegue" es lo que hace viable el negocio. Pero eso mueve todo el riesgo a un solo punto, así que:

### El principio que debe gobernar el diseño

> **El acceso a datos tiene que hacer estructuralmente difícil olvidar el filtro de inquilino.** No basta con la disciplina de quien escribe la consulta.

Sirius escribe SQL crudo en cada handler. Con un solo inquilino eso está bien. Con muchos, **una sola consulta que olvide el `WHERE tenant_id = ?` es una fuga de datos entre clientes** — y va a pasar, porque hay 32 handlers y ~9,000 líneas de SQL a mano.

Opciones, de menos a más segura:

1. **Disciplina** — pasar `tenant_id` a mano en cada consulta. *No es suficiente.*
2. **Un helper obligatorio** — que todo acceso pase por una función que inyecta el filtro, y prohibir `db()->prepare()` directo en handlers.
3. **Row-Level Security del motor** (PostgreSQL) — el filtro lo aplica la base, no el código. **La más segura.**

Si el producto nuevo puede elegir motor, esta es una razón de peso para considerar PostgreSQL sobre MySQL.

### Llaves únicas que deben volverse compuestas

Cada una de estas es hoy un UNIQUE global. Con inquilinos compartidos, dos clientes chocarían:

| Tabla | Hoy | Debe ser |
|---|---|---|
| `users` | `username` | `(tenant_id, username)` |
| `patients` → clientes | `file_number` | `(tenant_id, file_number)` |
| `quotes` | `folio` | `(tenant_id, folio)` |
| `commission_statements` | `folio` | `(tenant_id, folio)` |
| `inventory_items` | `barcode` | `(tenant_id, barcode)` |
| `lab_tests`, `lab_studies` | `slug` | `(tenant_id, slug)` |
| `wa_statuses` | `skey` | `(tenant_id, skey)` |
| `wa_auto_messages` | `type` | `(tenant_id, type)` |
| `wa_conversations` | `wa_id` | `(tenant_id, wa_id)` |
| `appointments` | `google_event_id` | `(tenant_id, google_event_id)` |
| `settings` | PK `skey` | PK `(tenant_id, skey)` |

**`settings` merece atención especial**: hoy es un singleton global. La identidad misma del negocio (`clinic_name`) es literalmente una fila. Es la tabla que más obviamente delata que no hay inquilinos.

### Los tres puntos de fuga más peligrosos

Las tablas polimórficas, que guardan `entity_type` + `entity_id` **sin llave foránea**:

1. **`trash_items`** — una restauración mal filtrada puede meter datos de un cliente en otro.
2. **`activity_log`** — una consulta de auditoría sin filtro expone actividad ajena.
3. **`commission_statements.party_type/party_id`** — polimórfico sobre dos tablas distintas.

Las tres **necesitan `tenant_id` explícito**, no heredado por join, porque no hay join que las ate.

### Datos de referencia compartidos

`postal_codes` y `coverage_zones` son catálogo global (SEPOMEX), pero `has_coverage`, `extra_cost`, `coverage_override` e `is_custom` son **decisiones de negocio por inquilino**.

La partición correcta: **catálogo global de solo lectura + tabla de superposición por inquilino**. Lo mismo aplica a `commemorative_dates`: catálogo del sistema con `tenant_id` nulable, donde `NULL` significa "lo trae el sistema".

---

## 3 · Multi-giro

### El hallazgo

**Sirius ya tiene los dos mecanismos que un producto multi-vertical necesita.** No hay que inventarlos, hay que formalizarlos.

#### Mecanismo 1 · El registro de módulos → qué funcionalidad ve cada giro

Un restaurante no necesita Cobertura. Una librería no necesita WhatsApp. Un hospital sí necesita todo.

El registro de `includes/modules.php` ya decide qué módulos existen, y `user_permissions` ya decide quién ve cuáles. **Solo falta una capa arriba**: el giro (o el plan) determina qué módulos están disponibles para ese inquilino, y dentro de eso el administrador reparte permisos entre su gente.

```
giro / plan  →  conjunto de módulos disponibles  →  permisos por usuario
   (nuevo)          (ya existe: modules.php)      (ya existe: user_permissions)
```

Solo la primera flecha es nueva. Las otras dos ya funcionan.

#### Mecanismo 2 · El motor de formularios por JSON → qué campos captura cada giro

`services_catalog.json` (92 KB) define secciones y campos de captura **sin tocar código**; `forms.js` los renderiza y `includes/services.php` los valida del lado del servidor.

Eso ya es verticalización. Hoy define "qué campos pide una admisión de fisioterapia". Mañana define "qué campos pide una orden de un restaurante" o "una entrada de inventario de una librería".

```
Sirius hoy:            servicio clínico  →  catálogo JSON de campos
Producto nuevo:        giro + tipo de documento  →  catálogo de campos (en base, por inquilino)
```

El cambio: mover el catálogo de un archivo JSON versionado a **una tabla por inquilino**, para que cada cliente pueda ajustar sus propios campos sin desplegar.

### La forma de la propuesta

```
tenants          — el cliente: nombre, giro, plan, estado de suscripción
verticals        — catálogo de giros: restaurante, clínica, tienda, …
vertical_modules — qué módulos trae cada giro por defecto
tenant_modules   — qué módulos tiene realmente ese inquilino (el giro es el default, no la cárcel)
field_catalogs   — definiciones de formulario por inquilino y tipo de documento
service_lines    — las "líneas de servicio" por inquilino (reemplazan los ENUM)
```

Nota de diseño: **el giro debe ser un punto de partida, no una jaula.** Un consultorio dentro de un gimnasio, una librería que también da talleres — la realidad no respeta las categorías. El giro precarga una configuración; el administrador puede desviarse.

### Qué se vuelve genérico con esto

| Módulo | Qué lo ata hoy | Después |
|---|---|---|
| Admisión | catálogo de campos clínicos en JSON versionado | catálogo por inquilino en base |
| Calendario | `APPT_SERVICES` hard-codeado | tabla `service_lines` |
| Expedientes | campos clínicos fijos | expediente de cliente con campos del catálogo |
| Catálogo | "estudios" | productos y servicios |
| Comisiones | grupos de estudio | grupos de producto |

---

## 4 · Suscripciones

### Dónde va el candado

Ya lo discutimos y vale la pena dejarlo escrito: **la protección vive en el servidor, no en el cliente.**

Si toda la lógica y los datos están del lado del servidor, el cliente instalable (Android, Windows, Mac — ver más abajo) es una cáscara sin valor propio. "Piratear" ese binario no sirve de nada porque no hace nada sin una sesión válida contra tu servidor. Meterle protecciones anti-copia al cliente es esfuerzo mal invertido.

**Lo que sí protege:**

1. **Validar la suscripción en cada petición**, no solo al iniciar sesión. Es una capa más en el pipeline que ya existe:
   ```
   sesión → autenticado → CSRF → suscripción activa → permiso de módulo → handler
                                   ↑ el paso nuevo
   ```
   Encaja limpio en `api/index.php` justo antes del `user_can()`.
2. **Límite de sesiones o dispositivos por licencia**, si preocupa que un cliente comparta una cuenta entre sucursales.
3. **Rate limiting y monitoreo de uso anómalo** en la API — el riesgo real no es que copien la app, es que compartan credenciales o que alguien hable directo con tu API.

### Ciclo de vida a modelar

`prueba → activa → por vencer → vencida → suspendida → cancelada`

Las preguntas que hay que responder antes de escribir código, porque definen el esquema:

- ¿Qué pasa exactamente cuando alguien no paga? ¿Se bloquea la escritura pero se permite leer y exportar? ¿Se congela todo?
- ¿Cuánto tiempo se conservan los datos de un cliente cancelado?
- ¿La prueba pide tarjeta?
- ¿Se cobra por usuario, por módulo, por volumen, o plano por giro?

**Recomendación sobre el impago:** bloquear escritura y dejar lectura y exportación. Bloquear todo genera soporte furioso y disputas; dejar exportar sus propios datos es además lo correcto.

### Sobre los clientes instalables

De la conversación previa, resumido para que no se pierda:

- **Android**: TWA (Trusted Web Activity) sobre el PWA — es el camino que Google diseñó para esto.
- **Windows**: PWA instalable directo desde Chrome/Edge, o MSIX en la Microsoft Store.
- **Mac**: instalación de PWA desde el navegador; la Mac App Store exige envolver con WKWebView, firmar y notarizar.
- **Sin tienda**: un instalador propio con Tauri (más ligero que Electron y más acorde a la filosofía de cero dependencias).

**Un solo PWA cubre las tres plataformas.** Como el candado es del lado del servidor, empaquetar tres apps nativas distintas no compra seguridad adicional, solo mantenimiento. Sirius ya tiene el service worker, el manifest y el flujo de instalación funcionando ([05](05-operacion-y-despliegue.md)).

---

## 5 · Qué NO repetir

El catálogo de errores conocidos. Cada uno está documentado con detalle en su capítulo.

### Críticos

| Error | Dónde | Qué hacer |
|---|---|---|
| **Clave de instalación en la query string** | `install/setup.php` | Nunca. Queda en los logs de acceso. Migraciones como comando autenticado o parte del pipeline. |
| **Migraciones sin tabla de versiones** | `schema.php` | Tabla `schema_migrations` desde el día uno. Sin ella no puedes saber en qué revisión está una base — inviable con muchos clientes. |
| **Freno de fuerza bruta solo en sesión** | `auth.php` | Se salta tirando la cookie. Debe vivir en la base, indexado por IP y por usuario. |
| **Sin CSP y con el HTTPS forzado comentado** | `public/.htaccess` | Ambos obligatorios. |

### De arquitectura

| Error | Dónde | Qué hacer |
|---|---|---|
| **Esquema duplicado a mano** para dos motores | `schema.php` | Ya se desincronizó (índices que existen en un motor y no en otro). Generar ambos de una sola definición, o soportar un solo motor. |
| **Los ENUM no se validan en SQLite** | todo el esquema | Desarrollo y producción se comportan distinto. Validar siempre en la aplicación. |
| **`updated_at` no se actualiza en SQLite** | todo el esquema | Escribirlo explícitamente desde el código, no confiar en el motor. |
| **Sin bloqueo optimista** | ninguna tabla | Una columna `version`; dos ediciones simultáneas hoy se pisan en silencio. |
| **Lógica de IndexedDB duplicada** | `outbox.js` y `sw.js` | Service worker de tipo módulo para compartir código. |
| **Lista de precaché a mano** | `sw.js` | Generarla en el build. Hoy agregar un módulo y olvidarla no da ningún error. |
| **Modelo de visibilidad copiado en 4 handlers** | varios | Un helper compartido. |

### De organización

| Error | Dónde | Qué hacer |
|---|---|---|
| **`apps.js` de 139 KB en un archivo** | `modules/apps.js` | Partir por sub-herramienta. Es el peor caso de un patrón que en lo demás funciona bien. |
| **Fugas de dominio en el núcleo** | `sql_full_name()`, funciones clínicas en `permissions.php`, `fullName()` en `ui.js` | El núcleo no debe saber nada del negocio. Si necesita saberlo, es un módulo. |
| **`clinic_name` existe pero no se usa** | `login.php`, `index.php`, `manifest.php` | El nombre está hard-codeado en tres lugares mientras la configuración existe y se ignora. En un producto multi-inquilino esto es imposible: todo lo visible sale de la configuración del inquilino. |
| **Tool-calling solo en un proveedor** | `ai.php` | Cuando Marketing necesitó IA accionable se resolvió parseando texto con regex. Funciona, pero es un parche que se paga después. |

---

## 6 · Por dónde empezar

Un orden sugerido, de lo que menos se mueve a lo que más:

1. **El núcleo** — auth, permisos, CSRF, respuesta, log, front controller, router, cliente de API, kit de UI. Es lo más probado y lo menos discutible. ~1,400 líneas.
2. **Inquilinos y suscripciones** — antes que cualquier módulo de negocio, porque toca cada tabla que venga después. Meterlo tarde es reescribir todo.
3. **Usuarios y permisos** — el primer módulo, porque todo lo demás depende de él.
4. **Los módulos genéricos** en orden de valor: tareas, archivos, inventario, calendario. Cada uno es una copia con renombres.
5. **La capa de verticalización** — giros, catálogos de campos, líneas de servicio.
6. **Los módulos semi-genéricos**, ya sobre la capa anterior.

**Lo que no hay que hacer:** empezar por los módulos porque son los que se ven. Inquilinos y suscripciones son invisibles y aburridos, y son exactamente lo que no se puede agregar después.

---

## Cierre

Sirius costó ~38,000 líneas y meses de iteración. Lo valioso que deja no es el código: son las decisiones ya tomadas y probadas — cómo se ordenan los permisos, cómo se borra sin perder nada, cómo se hace idempotente una escritura offline, cómo se evita que un refresco de fondo te borre lo que estás escribiendo, por qué un color elegido en tiempo de ejecución no puede ser una clase de Tailwind.

Ese es el capital. El producto nuevo debería poder gastárselo desde el primer día.

---

Regresa al [índice](README.md).
