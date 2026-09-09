# 03 · Módulos

Los 23 módulos de Sirius: qué hace cada uno, sus acciones de API, sus permisos, y **qué tan rescatable es**.

La clasificación es lo importante de este documento:

- 🟢 **GENÉRICO** — cualquier negocio lo usa. Se levanta casi tal cual.
- 🟡 **SEMI-GENÉRICO** — el concepto es genérico, la implementación está teñida de clínica. Se vuelve genérico con renombres.
- 🔴 **ESPECÍFICO** — solo tiene sentido en un laboratorio médico. Se reescribe o se descarta.

---

## Veredicto rápido

| Clasificación | Módulos | Total |
|---|---|---|
| 🟢 Genérico | tareas · pizarrón · archivos · inventario · marketing · whatsapp · whatsapp_config · usuarios · membretes · log · backup · api · papelera · configuración | **14** |
| 🟡 Semi-genérico | dashboard · admisión · calendario · catálogo de estudios · vinculación · cobertura | **6** |
| 🔴 Específico | expedientes · plantillas de estudios | **2** |
| Contenedor mixto | apps (5 sub-herramientas de distinta clasificación) | **1** |

Más tres handlers sin módulo, todos genéricos: `auth`, `assistant`, `push`.

**El titular: de 23 módulos, 20 se rescatan** — 14 casi textuales y 6 con renombres. Solo 2 se descartan.

### Los renombres que convierten 🟡 en 🟢

Son pocos y consistentes:

| Sirius | Producto nuevo |
|---|---|
| paciente | cliente / contacto |
| estudio | producto / servicio |
| episodio | orden / caso |
| médico, concierge | referidor, partner |
| servicio clínico (ENUM) | línea de servicio configurable (tabla) |

El último es el de mayor palanca: hoy los servicios están hard-codeados como ENUM en `episodes.service` y `appointments.service`, y como constantes en `services.js`, `appointments.php` y `calendario.js`. **Convertirlo en una tabla por inquilino generaliza tres módulos de un golpe.**

---

## El contrato de tres archivos

Documentado en el propio `public/includes/modules.php`:

> *"Agregar un módulo en fases futuras = 1 entrada aquí + 1 JS en assets/js/modules/ + (si aplica) 1 handler en api/handlers/. El núcleo no se toca."*

1. **Entrada en el registro** — `label`, `icon`, `phase`, opcionales `group`, `hidden`, `flags`, `mode_flags`.
2. **Módulo de frontend** — `public/assets/js/modules/<clave>.js` que exporte `render(root, ctx)`.
3. **Handler** — `public/api/handlers/<recurso>.php` con `handle_<recurso>($action)`, más una línea en `$routes`.

El sidebar, el gate de permisos, el título y el resaltado salen solos.

**El mapeo no es 1:1**: `apps` es dueño de cinco handlers (`documents`, `labs`, `quotes`, `commissions`, `coverage`), y `cobertura.php` sirve dos recursos con permisos distintos (`handle_cobertura` para Admin Tools, `handle_coverage` para Apps).

---

## Módulos principales del sidebar

### 🟡 `dashboard` — Dashboard
`modules/dashboard.js` + `handlers/dashboard.php`

Pantalla de inicio agregadora: reloj y saludo, tira compacta de indicadores, alertas descartables (stock bajo, recurrentes pendientes, vencimientos a 7 días, contenido nuevo compartido, cumpleaños próximos) y una agenda accionable de hoy/mañana que mezcla citas + tareas + entregas pendientes, cada tarjeta con el icono de su módulo de origen. Sondea cada 20 s, pausando cuando el usuario está ocupado. **A propósito no duplica navegación.**

**Acciones:** `stats`, `dismiss_alert` · **Flags:** ninguno

La composición (indicadores + alertas descartables + agenda entre módulos) es lo reusable; el SQL de abajo está atado a pacientes y episodios.

### 🟡 `admision` — Admisión
`modules/admision.js` + `modules/wizard_admision.js` + `handlers/episodes.php`

Rejilla de servicios → formulario de captura dinámico cuyas secciones y campos vienen de `assets/js/services_catalog.json` (validado del lado del servidor). Crea o reutiliza un cliente y abre un episodio, asigna personal, registra el médico tratante, los estudios pedidos y la fecha de entrega, sube documentos y manda por correo la ficha en PDF.

La variante `wizard` es una versión de una pregunta por pantalla y 10 campos, para los recolectores a domicilio, **con cola offline en IndexedDB** que postea al mismo endpoint que el flujo normal.

**Acciones:** `create`, `resend_ficha`, `update`, `set_delivery`, `assignable_users`, `search_patient`, `search_studies`, `search_doctors`, `doc_upload`
**Flags:** `wizard` (declarado en `mode_flags` — ver [01](01-arquitectura.md))

"Cliente + orden de captura con formulario por tipo de servicio dirigido por JSON" traslada directo a órdenes de trabajo, apertura de casos o admisión de cualquier giro. Solo el catálogo de campos es clínico. **El motor de formularios por JSON es una de las piezas más valiosas del sistema** — ver [06](06-producto-nuevo.md), es la mitad de la estrategia multi-giro.

### 🔴 `expedientes` — Expedientes
`modules/expedientes.js` + `handlers/patients.php` + `handlers/consultations.php`

Expediente clínico: búsqueda con debounce, vista de detalle con historial de episodios, consultas de seguimiento en dos etapas (enfermería captura, el profesional asignado completa la parte médica), edición inline, borrado suave, documentos por paciente, exportación imprimible, gráfica de progreso de peso y medidas, y una silueta corporal interactiva. "Dx Assist" manda el expediente a la IA para sugerencias de diagnóstico diferencial.

**Acciones:** `list`, `get`, `update`, `delete`, `doc_list`, `doc_delete` · consultas: `create`, `update`, `complete_doctor`
**Flags:** `dx_assist`, `edit`, `delete`

El esqueleto CRM (persona buscable + historial + documentos) es genérico, pero los campos clínicos, el cierre en dos etapas, la silueta y Dx Assist son medicina.

### 🟢 `inventario` — Inventario
`modules/inventario.js` + `handlers/inventory.php`

Catálogo con lectura de código de barras, control por lote con consumo PEPS, alertas de caducidad (ventana de 30 días) y stock bajo, ajustes manuales con motivo, y flujos de escanear-para-consumir y escanear-para-reabastecer.

**Acciones:** `list`, `item_get`, `barcode_lookup`, `item_save`, `item_toggle_active`, `lot_add`, `lot_consume`, `scan_consume`, `scan_restock`, `lot_adjust`, `lot_delete`
**Flags:** `manage` — el catálogo y las correcciones de lote; sin él solo se registran movimientos

Inventario por lotes de manual. Lo clínico son literalmente dos constantes de texto (`REASONS` incluye "Uso clínico", `UNITS` incluye "frasco"). **Se levanta casi textual.**

### 🟢 `tareas` — Tareas
`modules/tareas.js` + `handlers/tasks.php`

Tareas propias y asignadas agrupadas por ventana de vencimiento, prioridades y estatus con avance de un clic, proyectos con subtareas, tareas recurrentes, consulta por rango de fechas que alimenta al dashboard y al calendario, borrado suave a la papelera.

Incluye además un tablero aparte de "Resultados por entregar" — que en realidad es **un rastreador genérico de entregables con lista de verificación**, vale la pena generalizarlo en vez de tirarlo.

**Acciones:** `list`, `project_save`, `project_delete`, `save`, `set_status`, `toggle_recurring`, `due_in_range`, `delete`, `results_list`, `search_studies`, `search_patients`, `results_save`, `results_delete`
**Flags:** `manage` — ver y asignar tareas de todos

### 🟢 `pizarron` — Pizarrón
`modules/pizarron.js` + `handlers/board.php`

Lienzo libre con notas adhesivas, listas y dibujos a mano alzada, arrastrables y redimensionables, en seis colores, con navegación de pan/zoom y tres herramientas (cruceta, mano, lupa). Cada usuario tiene su pizarrón privado; en el público cualquiera agrega pero solo el autor (o quien tenga `manage`) edita y borra.

**Acciones:** `list`, `save`, `delete` · **Flags:** `manage`

**Cero contenido de dominio.** Directamente reusable. Incluye interacciones no triviales ya resueltas: arrastre con Pointer Events, zoom con transform del canvas y corrección de escala en los deltas del puntero, autoguardado con debounce, y sondeo pausado mientras se escribe.

### 🟢 `archivos` — Archivos
`modules/archivos.js` + `handlers/archivos.php` (recurso `files`)

Gestor de archivos completo: árbol privado por usuario más una carpeta compartida, carpetas anidadas, subida por arrastre o botón (tope de 25 MB), menú contextual con copiar-cortar-pegar-renombrar-borrar-compartir, selección múltiple con operaciones masivas, y cinco modos de vista persistidos en `localStorage`. Los archivos se guardan con nombre aleatorio bajo `uploads/archivos/` (bloqueado por `.htaccess`) y solo se sirven por `archivo.php` tras verificar sesión y permiso.

**Acciones:** `list`, `folder_create`, `folder_rename`, `folder_move`, `folder_delete`, `file_upload`, `file_rename`, `file_move`, `file_delete`, `bulk_delete`, `bulk_move`, `bulk_copy`, `copy`, `share`
**Flags:** `delete_shared` — borrar de la carpeta compartida, **incluso lo que tú mismo subiste**

Uno de los mejores candidatos de reuso del código base.

### 🟡 `calendario` — Calendario
`modules/calendario.js` + `handlers/appointments.php`

Agenda por día, semana y mes, coloreada por servicio, con estatus, invitados externos y sincronización con Google Calendar donde Sirius es la fuente de verdad. **Un fallo de Google nunca bloquea la escritura local** — buen principio.

**Acciones:** `list`, `get`, `save`, `cancel` · **Flags:** `manage`

Todo es agendamiento genérico salvo las constantes `APPT_SERVICES` / `SERVICE_LABELS`.

### 🟢 `marketing` — Marketing
`modules/marketing.js` + `handlers/marketing.php`

Calendario de planeación de contenido: publicaciones con estatus, categoría, color y miniatura, vista de portafolio histórico, catálogo editable de efemérides, y un asistente de IA que redacta el borrador de un mes completo, sugiere textos por publicación y ofrece chat libre.

**Sin integración con Canva ni con la API de Meta a propósito** — `canva_url` es un campo de liga y "publicada" se marca a mano. La decisión fue deliberada: Canva ya tiene su propio planificador, y publicar automático exigiría revisión de app de Meta.

**Acciones:** `posts_list`, `post_save`, `post_delete`, `thumbnail_upload`, `commemorative_dates_list`, `commemorative_date_save`, `commemorative_date_delete`, `generate_month_draft`, `suggest_caption`, `chat`
**Flags:** ninguno

Cualquier negocio planea contenido. Nada clínico en el esquema.

### 🟢 `whatsapp` — WhatsApp
`modules/whatsapp.js` + `handlers/whatsapp.php` + `whatsapp_webhook.php` + `whatsapp_media.php`

Bandeja de equipo sobre la Cloud API: lista de conversaciones con no leídos, chat con envío y recepción de medios, reacciones, respuestas rápidas, asignación por conversación, catálogo configurable de estatus y prioridad, sondeo cada 10 s.

**Acciones:** `list`, `get`, `messages`, `send`, `send_media`, `react`, `assign`, `set_status`, `set_priority`, `link_patient`, `unlink_patient`, `quick_replies`, `statuses`, `unread_count`, `unread_list`
**Flags:** `manage`

Bandeja compartida omnicanal genérica. El único acoplamiento es `link_patient` → renombrar a "vincular cliente".

### Contenedor · `apps` — Apps

`modules/apps.js` — **139 KB, el archivo más grande del repo**. La navegación baja nivel por nivel desde `ctx.args`: `#/apps/<herramienta>/<categoría>/<tipo>/<id>`.

| Sub-app | Flag | Qué hace | Rescate |
|---|---|---|---|
| **membretador** | `membretador` | Emite documentos membretados. Dos flujos: categorías de plantilla (formulario estructurado) y categorías de órdenes (subes el PDF del laboratorio de referencia, se parsea y se contrasta contra el catálogo). Con flujo de revisión y liberación. | 🔴 el contenido, 🟡 el motor |
| **cotizador** | `cotizador` | Arma cotizaciones buscando en el catálogo de precios, con renglones, totales e historial. | 🟡 |
| **comisiones** | `comisiones` | Calcula comisiones por periodo: la tasa del médico depende del grupo del estudio, y el concierge gana un % independiente sobre el mismo monto. Con alternado renglón por renglón, estados de cuenta y extracción por IA. | 🟡 |
| **cobertura** | `cobertura` | Consulta pública de código postal: colonias y si la unidad móvil cubre esa zona. | 🟡 |

`review` y `delete` no son sub-apps sino flags transversales (revisar y liberar estudios, borrar estudios membretados).

**El contenedor como arquitectura es 🟡 rescatable**: un "cajón de herramientas" con flags por herramienta bajo un solo permiso de módulo es un buen patrón. Pero es también el módulo que más urge partir: 139 KB en un archivo.

---

## Grupo Admin Tools

### 🟢 `usuarios` — Usuarios
CRUD de usuarios más **la matriz de permisos**: una rejilla de cada módulo del registro × usuario, con casillas por módulo y casillas anidadas por flag, guardadas como JSON en `user_permissions.flags`.

**Acciones:** `list`, `create`, `update`, `delete`, `set_permissions`

La matriz dirigida por el registro es de lo mejor que hay que llevarse.

### 🟢 `membretes` — Membretes
Sube encabezado, pie, marca de agua y firmas, más la geometría del PDF en milímetros (márgenes, altura reservada, opacidad, ancho de firma).

**Acciones:** `get`, `save`, `upload`, `remove`

Pese al nombre, es pura **configuración de identidad visual para PDFs** — sirve para facturas, certificados o reportes de cualquier giro.

### 🟢 `log` — Log
Bitácora de auditoría de solo lectura con filtros por texto, usuario, módulo y rango de fechas. El JS tiene un diccionario que traduce cada código de acción a etiqueta humana y color.

**Acciones:** `list`, `summary`

### 🟢 `backup` — Backup
Exporta la base completa; al importar, inspecciona el archivo (conteos, versión) antes de restaurar. **Exige rol `administrador` dentro del handler** — tener el módulo no basta.

**Acciones:** `info`, `inspect`, `restore`

### 🟢 `api` — API
Rejilla de tarjetas de integraciones externas: **IA** (proveedor, modelo, llave, prueba de conexión), **Calendario** (OAuth de Google), **Correo** (SMTP saliente). También es la puerta al módulo oculto de configuración de WhatsApp. **Los secretos nunca vuelven al navegador**: las respuestas solo dicen si existe una llave.

**Acciones:** ia — `get`, `save`, `test`, `ping` · calendario — `get`, `save`, `disconnect` · correo — `get`, `save`, `test`

### 🟡 `catalogo_estudios` — Catálogo de Estudios
Lista de precios detrás del Cotizador: paginado con búsqueda y filtro, borrado masivo, alta y edición en modal, exportación JSON/CSV e **importación en dos pasos (inspeccionar → aplicar) con vista previa del diff**.

**Acciones:** `list`, `save`, `delete`, `delete_bulk`, `delete_all`, `export_all`, `import_inspect`, `import_apply`

Es un catálogo de productos con importación y exportación. Renombra "estudio" a "SKU" y ya está. La importación en dos pasos vale la pena conservarla.

### 🟡 `vinculacion` — Vinculación
Dos directorios en una pantalla: médicos que refieren (alimentan el selector de Admisión) y concierges con su % individual, más las tasas globales de comisión por grupo.

**Acciones:** `doctors_list/save/delete`, `concierge_list/save/delete`, `settings_get`, `settings_save`

"Directorio de socios/referidores + tabla de tasas" es un concepto de ERP entero.

### 🟡 `cobertura` — Cobertura
Administra el área de servicio de la unidad móvil sobre una jerarquía Estado > Municipio > CP > colonia (~140 zonas de CDMX y Edomex). Cobertura de tres estados, un municipio se alterna completo, un CP individual puede sobrescribir a su municipio, y cada nivel puede llevar costo extra.

**Acciones:** `zones_list`, `zones_toggle`, `zones_set_extra_cost`, `postal_list`, `postal_toggle`, `postal_set_extra_cost`, `reimport`, `custom_areas_*`

Área de servicio con recargo por distancia aplica a cualquier negocio de reparto o servicio a domicilio. El acoplamiento es a la geografía mexicana, no a la medicina.

### 🟢 `papelera` — Papelera
Bote central de todo lo borrado suavemente: tareas, proyectos, entregas, notas, archivos y carpetas. Filtro por tipo, conteos, restaurar o purgar. **Exige rol `administrador` dentro del handler** — hasta listar expone datos ajenos.

**Acciones:** `list`, `restore`, `purge`

### 🔴 `plantillas_estudios` — Plantillas de Estudios
Una plantilla fija qué determinaciones lleva un estudio y en qué orden; los rangos de referencia se capturan una sola vez y las plantillas solo los **apuntan**, así un analito nunca termina con dos intervalos contradictorios. Incluye un camino de IA que propone una plantilla desde un PDF.

**Acciones:** `studies_list/get/save/delete`, `tests_search`, `test_save`, `test_delete`, `propose_from_pdf`

Rangos por sexo y edad no significan nada fuera de diagnóstico. (El núcleo genérico escondido: "ítem compuesto = lista ordenada de atributos con límites de validación".)

### 🟢 `whatsapp_config` — WhatsApp: Configuración *(oculto)*
No aparece en el sidebar; se llega desde una tarjeta en Admin Tools > API, pero sigue verificando permiso y es alcanzable por URL directa. Cuatro pestañas: credenciales de la Cloud API con prueba de conexión, mensajes automáticos con horario por día, respuestas rápidas y catálogo de estatus.

**Acciones:** `get_config`, `save_config`, `test_connection`, `statuses_*`, `auto_messages_*`, `quick_replies_*`

---

## Módulo del menú de avatar

### 🟢 `configuracion` — Configuración *(oculto)*
Se llega desde el menú del avatar y está en `ALWAYS_AVAILABLE_MODULES`: **todo usuario autenticado lo tiene sin necesidad de fila de permiso**. Tres cosas: instalación de PWA (instrucciones de iOS vs. `beforeinstallprompt`), buscar actualizaciones contra `BUILD_VERSION`, y personalización — ocho colores de acento por usuario más los logos de branding (solo admin).

**Acciones:** `get`, `upload_logo`, `remove_logo`, `save_theme`

---

## Handlers sin módulo

Los tres con `null` en la tabla de rutas: cualquier usuario autenticado. **Todos genéricos.**

| Recurso | Acciones | Qué es |
|---|---|---|
| `auth` | `session` | El endpoint de arranque de la SPA: devuelve usuario, módulos visibles, el registro completo (solo si puede ver `usuarios`), banderas de capacidad del servidor y el token CSRF |
| `assistant` | `status`, `chat`, `dx` | La burbuja flotante de IA |
| `push` | `vapid_key`, `subscribe`, `unsubscribe`, `list`, `unread_count`, `mark_read`, `mark_all_read`, `pending` | Notificaciones push |

Sigue con [04 · Patrones reusables](04-patrones-reusables.md) — que es donde está lo bueno.
