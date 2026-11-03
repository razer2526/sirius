# Sirius · Registro de actualizaciones

**Laboratorio y Clínica Bosques Polanco**
Manuales de referencia: versión 1.0 · octubre de 2026

> Los tres manuales (usuario estándar, administrador y desarrollador) **no se modifican** después de publicarse: son la versión 1.0. Todo cambio posterior se anota **aquí**, con fecha, a quién afecta y qué hay que hacer, si algo. Lo más reciente va primero.

> **Cómo leer cada entrada.** *Afecta a:* quién nota el cambio. *Acción:* lo único que hay que hacer (casi siempre, nada). *Manual:* dónde aparece la versión anterior, para que sepas qué texto quedó superado.

---

## Índice

1. [5 de noviembre de 2026 · Admisión: nuevo formulario de Facial](#5-de-noviembre-de-2026--admisión-nuevo-formulario-de-facial)
2. [3 de noviembre de 2026 · Comisiones: filtro por estatus y botones Pagado / Pendiente en las acciones](#3-de-noviembre-de-2026--comisiones-filtro-por-estatus-y-botones-pagado--pendiente-en-las-acciones)
3. [3 de noviembre de 2026 · Comisiones: botón de corte solo para administradores, estatus visible y PDF con el estatus abajo](#3-de-noviembre-de-2026--comisiones-boton-de-corte-solo-para-administradores-estatus-visible-y-pdf-con-el-estatus-abajo)
4. [3 de noviembre de 2026 · Comisiones: bimestre en curso y cierre «Pagado» con clave SPEI](#3-de-noviembre-de-2026--comisiones-bimestre-en-curso-y-cierre-pagado-con-clave-spei)
5. [3 de noviembre de 2026 · Comisiones: la fecha del PDF se ve igual que en la ventana](#3-de-noviembre-de-2026--comisiones-la-fecha-del-pdf-se-ve-igual-que-en-la-ventana)
6. [3 de noviembre de 2026 · Comisiones: nuevo formato del PDF del estado de cuenta](#3-de-noviembre-de-2026--comisiones-nuevo-formato-del-pdf-del-estado-de-cuenta)
7. [3 de noviembre de 2026 · Comisiones: el estado de cuenta por periodo se arma solo](#3-de-noviembre-de-2026--comisiones-el-estado-de-cuenta-por-periodo-se-arma-solo)
8. [3 de noviembre de 2026 · Proyectos: tarjetas, descripción con formato y tablero](#3-de-noviembre-de-2026--proyectos-tarjetas-descripción-con-formato-y-tablero)
9. [3 de noviembre de 2026 · Tareas: tarjetas verticales, imágenes y notas a mano](#3-de-noviembre-de-2026--tareas-tarjetas-verticales-imágenes-y-notas-a-mano)
10. [13 de octubre de 2026 · Tareas: descripción visible, con formato y casillas](#13-de-octubre-de-2026--tareas-descripción-visible-con-formato-y-casillas)
11. [9 de octubre de 2026 · Ficha de identificación: sin «No referido» de más y correo personalizable](#9-de-octubre-de-2026--ficha-de-identificación-sin-no-referido-de-más-y-correo-personalizable)
12. [9 de octubre de 2026 · Calendario: semana por defecto y citas de solo lectura](#9-de-octubre-de-2026--calendario-semana-por-defecto-y-citas-de-solo-lectura)
13. [9 de octubre de 2026 · Membretador: datos del paciente desde su ficha](#9-de-octubre-de-2026--membretador-datos-del-paciente-desde-su-ficha)
14. [9 de octubre de 2026 · Membretador: crear plantillas de estudio](#9-de-octubre-de-2026--membretador-crear-plantillas-de-estudio)
15. [8 de octubre de 2026 · Calendario: sincronización con Google](#8-de-octubre-de-2026--calendario-sincronización-con-google)
16. [8 de octubre de 2026 · Tablet: la app ya se puede girar](#8-de-octubre-de-2026--tablet-la-app-ya-se-puede-girar)
17. [8 de octubre de 2026 · Seguridad y pruebas automáticas](#8-de-octubre-de-2026--seguridad-y-pruebas-automáticas)
18. [8 de octubre de 2026 · Correcciones de la revisión](#8-de-octubre-de-2026--correcciones-de-la-revisión)
19. [Cómo se agrega una entrada nueva](#cómo-se-agrega-una-entrada-nueva)

---

## 5 de noviembre de 2026 · Admisión: nuevo formulario de Facial

Mejora (PR 89). **Sí hay cambio de esquema: hay que correr `install/setup.php` después de desplegar.** Mientras no se corra, guardar una admisión o una cita de **Facial** marca error (los demás servicios no se ven afectados). Si no ves los cambios, entra a **Configuración → Buscar actualizaciones**.

### Admisión · Facial

- **Qué cambió:** en **Admisión** hay una tarjeta nueva, **Facial**. Su formulario trae, además de los **datos del paciente** de siempre:
  - **Padecimientos y antecedentes patológicos personales** (diabetes, tiroides, acné, rosácea, dermatitis, melasma, procedimientos estéticos previos, embarazo o lactancia, tabaquismo…).
  - **Patologías heredofamiliares**, con parentesco y si vive o finado.
  - **Medicamentos** (isotretinoína, retinoides, corticoides, anticoagulantes, hormonales…) y suplementos.
  - **Alergias** (medicamentos, anestésicos, látex, níquel, fragancias, cosméticos…).
  - **Exposición a animales y químicos**, y exposición solar y protector solar.
  - **Rutina de maquillaje:** frecuencia de uso, si se desmaquilla, y por cada producto (prebase, base, corrector, polvo, rubor, contorno, iluminador, sombras, delineador, máscara, cejas, labial, fijador, desmaquillante) se marca y se anota la **marca y el tipo**.
  - **Métricas faciales:** de **piel** (tipo de piel, fototipo de Fitzpatrick, envejecimiento de Glogau, hidratación, sebo, elasticidad, pH, melanina, eritema, poros, arrugas, manchas) y **medidas en mm** (forma del rostro, simetría, altura facial, tercios, anchos bicigomático, bigonial y frontal, distancias interpupilar e intercantal, nariz, boca y labios). El **índice facial** y el **índice mandibular** se calculan solos.
  - **Firma del paciente.**
- **También:** Facial aparece en **Expedientes** (filtro de servicio, visita, impresión y consultas subsecuentes con su propia ficha de sesión) y se puede agendar en el **Calendario**.
- **Afecta a:** quien hace admisiones y quien agenda citas.
- **Acción:** después del despliegue, correr `install/setup.php` (agrega «Facial» a la lista de servicios de la base de datos).
- **Manual:** usuario estándar, apartado 6 («Admisión: registrar a un paciente»), que aún no menciona Facial.

---

## 3 de noviembre de 2026 · Comisiones: filtro por estatus y botones Pagado / Pendiente en las acciones

Mejora (PR 88). No hay cambios de esquema: **no hace falta correr `setup.php`**. Si no ves los cambios, entra a **Configuración → Buscar actualizaciones**.

### Listado de estados de cuenta

- **Filtro de estatus:** junto al selector de periodo hay ahora un selector **Estatus** con **Todos**, **Pendiente de pago** y **Pagado**.
- **Acciones:** cada estado de cuenta tiene un par de botones, **Pagado** y **Pendiente**, y el administrador decide cuál es. El que está activo se ve resaltado (verde si está pagado, amarillo si está pendiente).
  - **Pagado:** pide la clave de rastreo SPEI. Si ya estaba pagado, abre el pago para corregir la clave.
  - **Pendiente:** regresa el estado de cuenta a pendiente de pago (pide confirmación) y borra la clave de rastreo.
- **Quién puede:** solo los administradores ven estos botones. Los demás ven el estatus pero no lo pueden cambiar.
- **Afecta a:** quien administra Comisiones. Los mismos botones aparecen en la sección de estados de cuenta dentro de la cuenta de cada médico.
- **Acción:** ninguna.
- **Manual:** administrador, apartado 9 («Vinculación y comisiones»).

---

## 3 de noviembre de 2026 · Comisiones: botón de corte solo para administradores, estatus visible y PDF con el estatus abajo

Mejora (PR 87). No hay cambios de esquema: **no hace falta correr `setup.php`**. Si no ves los cambios, entra a **Configuración → Buscar actualizaciones** para cargar la versión nueva.

### Pantalla de Comisiones

- **Qué cambió:** el listado de **Estados de cuenta** tiene ahora un selector **Generados en** (abre en el bimestre en curso; también «Todos los periodos»). Cada estado de cuenta muestra su **estatus**: verde **Pagado** (con su clave de rastreo SPEI) o amarillo **Pendiente de pago**.
- **Botón del corte:** **Marcar como pagado** (o **Editar pago** si ya lo está) aparece en cada estado de cuenta, en el listado y en la cuenta de cada médico, y **solo lo ven y lo pueden usar los administradores**. Pide la clave de rastreo SPEI. En la cuenta del médico se muestran sus estados de cuenta del periodo elegido y, siempre, los que siguen pendientes de pago.
- **Registros sin estado de cuenta:** en la cuenta del médico, los registros que aún no están en un estado de cuenta dicen **Sin estado de cuenta** (antes decían «Pendiente», que se confundía con el pago).

### PDF del estado de cuenta

- **Qué cambió:** el estatus ya no va en el encabezado. Ahora está **abajo, justo arriba del pie de la última hoja**: un recuadro **verde «PAGADO»** o **amarillo «PENDIENTE DE PAGO»**. Si está pagado, **un renglón más abajo** viene la **clave de rastreo SPEI**.
- **Afecta a:** quien administra Comisiones. Los PDF ya generados se ven con el formato nuevo al volver a descargarlos.
- **Acción:** ninguna.
- **Manual:** administrador, apartado 9 («Vinculación y comisiones»).

---

## 3 de noviembre de 2026 · Comisiones: bimestre en curso y cierre «Pagado» con clave SPEI

Mejora (PR 86). **Sí hay cambio de esquema: hay que correr `install/setup.php` después de desplegar.** Mientras no se corra, la cuenta de cada médico en Comisiones marca error.

### La cuenta del médico abre en el bimestre en curso

- **Qué cambió:** al abrir Apps → Comisiones → un médico, ya no se carga la lista completa de registros: solo los del **bimestre en curso**. Arriba hay un selector de **Periodo** para ver bimestres anteriores o **Todos los periodos**. Si quedan registros pendientes en otros periodos, un aviso lo indica con un enlace para verlos.

### Cierre del estado de cuenta: «Pagado» con clave de rastreo SPEI

- **Qué cambió:** cada estado de cuenta ahora está **Pendiente de pago** o **Pagado**. Se cambia haciendo clic en la etiqueta de pago, en el listado de Comisiones o en la cuenta del médico. Al marcar **Pagado** el sistema pide la **clave de rastreo SPEI** de la transferencia (obligatoria; los espacios se quitan solos). El PDF del estado de cuenta muestra el **Estatus de pago** arriba y, si está pagado, la **clave de rastreo SPEI en un recuadro justo arriba del pie de la última hoja**.
- **Corregir o deshacer:** haciendo clic en la etiqueta de un estado pagado se puede corregir la clave o **quitar el pago**. Un estado pagado no se puede eliminar hasta quitarle el pago.
- **Afecta a:** quien administra Comisiones. Los estados de cuenta anteriores quedan como **Pendiente de pago** hasta que se marquen.
- **Acción:** correr `install/setup.php` una vez tras el despliegue.
- **Manual:** administrador, apartado 9 («Vinculación y comisiones»).

---

## 3 de noviembre de 2026 · Comisiones: la fecha del PDF se ve igual que en la ventana

Corrección (PR 85). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### Fecha en el PDF del estado de cuenta

- **Qué cambió:** en el PDF del estado de cuenta la columna **Fecha** salía con guiones («--») en los estados hechos con **Registro manual** antes del cambio anterior. Ahora la fecha se toma del registro original y se imprime **como la muestra la ventana de Comisiones** (año-mes-día, por ejemplo 2026-10-28). Las filas van ordenadas de la fecha más reciente a la más antigua, igual que en la ventana.
- **Afecta a:** quien descarga estados de cuenta de comisiones. Los estados ya generados se corrigen solos al volver a descargarlos.
- **Acción:** ninguna. Descarga de nuevo el PDF.
- **Manual:** administrador, apartado 9 («Estado de cuenta en PDF»).

---

## 3 de noviembre de 2026 · Comisiones: nuevo formato del PDF del estado de cuenta

Mejora (PR 84). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### Columnas, pie y numeración del PDF

- **Qué cambió:** el PDF del estado de cuenta de comisiones cambia en tres cosas.
  - **Columnas:** ahora son **Fecha**, **Nombre del paciente**, **Estudios** y **Monto**. Hay **un renglón por visita del paciente**: si en la misma admisión se hicieron varios estudios, van juntos en la columna Estudios y el Monto es la **comisión** de esa visita (ya no se imprime lo cobrado al paciente ni el porcentaje). La barra de **Total comisión** sigue al final y suma los montos.
  - **Pie de página:** el pie corporativo (razón social, dirección, teléfonos) aparece **solo en la última hoja**. Antes se repetía en todas.
  - **Numeración:** todas las hojas llevan **«Página X de Y»**, incluida la primera.
  El mismo pie y la misma numeración aplican al estado de cuenta hecho desde **Pegar lista (imagen)**, que conserva sus columnas.
- **Afecta a:** quien genera o descarga estados de cuenta de comisiones. Los **estados ya generados** también se ven con el formato nuevo al volver a abrirlos. Los hechos con **Registro manual** antes de este cambio no guardaron la fecha de la visita, y en ellos la columna Fecha muestra «—».
- **Acción:** ninguna.
- **Manual:** administrador, apartado 9 («Estado de cuenta en PDF»).

---

## 3 de noviembre de 2026 · Comisiones: el estado de cuenta por periodo se arma solo

Corrección y mejora (PR 83). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### Ya encuentra las admisiones del médico

- **Qué cambió:** en **Apps → Comisiones → Nuevo estado de cuenta → Por periodo** la vista previa salía vacía («No hay estudios comisionables») aunque el médico sí tuviera pacientes. Había dos causas: (1) la admisión del **asistido** solo deja **escribir** el nombre del médico, no elegirlo de la lista de convenio, y Comisiones solo veía las admisiones ligadas a un médico de la lista; (2) solo contaba los estudios que tuvieran **grupo de comisión** en el catálogo, y casi ninguno lo tiene (ni los estudios capturados a mano). Ahora:
  - Al guardar una admisión, si el nombre escrito (por ejemplo «Dr. Rodolfo Ramírez») corresponde a **un solo** médico de Vinculación, la admisión queda ligada a él. Si coincide con dos o con ninguno, no se liga.
  - Las admisiones **anteriores** también se encuentran por el nombre escrito; en la vista previa aparecen con la nota «Médico escrito en Admisión: …» para que las revises.
  - Los estudios **sin grupo** se calculan como en el **Registro manual**: **FilmArray, monto fijo de $750**; cualquier otro estudio, la tasa de **Análisis clínicos** de Vinculación (10 % de fábrica). Los estudios que sí traen grupo siguen usando su tasa de Vinculación.
  - **Pegar lista (imagen)** usa las mismas reglas.
- **Afecta a:** quien genera estados de cuenta de comisiones.
- **Acción:** revisa los montos de la vista previa antes de generar. Si un nombre no se encontró, escríbelo en Admisión igual que en **Vinculación** (nombre y primer apellido, como mínimo).
- **Manual:** estándar, apartado 14.3 (Comisiones).

### La vista previa aparece sola y el periodo es por bimestre

- **Qué cambió:** ya no hay botón **Vista previa**: al elegir **médico (o concierge)** y **periodo**, los estudios aparecen solos. El selector **Periodo** ofrece los bimestres (por ejemplo «Septiembre – Octubre 2026») y arranca en el **último bimestre terminado**, que es el que toca facturar; **Otro rango de fechas…** y los campos **Desde / Hasta** siguen disponibles. Cada línea muestra ahora también la **fecha de admisión**.
- **Afecta a:** quien genera estados de cuenta de comisiones.
- **Acción:** ninguna. Se siguen pudiendo **excluir líneas** antes de **Generar estado de cuenta**.
- **Manual:** estándar, apartado 14.3.

---

## 3 de noviembre de 2026 · Proyectos: tarjetas, descripción con formato y tablero

Mejora (PR 82, se apoya en el PR 81). **Hay un cambio de esquema** (una columna nueva en `task_assets`): después del despliegue, el administrador debe abrir `install/setup.php` y aplicar la actualización (si ya la había corrido por el PR 81, hay que correrla otra vez; es seguro repetirla). Sin eso, subir imágenes a la descripción de un proyecto falla con «Error de base de datos».

### Tarjetas de proyecto con más información

- **Qué cambió:** en **Tareas → Proyectos**, cada tarjeta muestra ahora el **avance**, la **fecha límite** (en rojo y con «Vencido» si ya pasó y el proyecto no está terminado), el número de tareas, las **casillas** de su descripción, los **responsables** y **lo siguiente por hacer** (las 3 tareas pendientes más urgentes y cuántas más hay). Están en cuadrícula: 3 por fila en pantalla grande, 2 en tablet y 1 en el celular.
- **Afecta a:** todos los que ven proyectos.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 8.3 (Proyectos).

### Dentro del proyecto: pestañas «Tareas» y «Descripción»

- **Qué cambió:** al abrir un proyecto hay dos pestañas.
  - **Tareas:** las tareas del proyecto, como siempre, en **tarjetas** o en **tablero** (ver abajo).
  - **Descripción:** notas del proyecto con **el mismo editor que las tareas**: negrita, cursiva, subrayado, alineación, viñetas, casillas, imágenes (botón, Ctrl+V o arrastrar) y **notas a mano**. Sirve para el alcance, listas de pendientes, planos o dibujos. Un punto verde junto al nombre de la pestaña indica que ya tiene contenido.
- **Quién la edita:** quien gestiona Tareas (con el botón **Editar proyecto** o **Editar descripción**; el formulario del proyecto ahora usa ese mismo editor). **Todos los que ven el proyecto** pueden verla y marcar sus casillas, y ven sus imágenes.
- **Las descripciones anteriores** (texto simple) se ven igual y pasan al formato nuevo la primera vez que se editen y guarden.
- **Afecta a:** todos los que usan proyectos; edita quien gestiona Tareas.
- **Acción:** el administrador corre **`install/setup.php`** una vez tras el despliegue.
- **Manual:** estándar, apartado 8.3.

### Vista de tablero

- **Qué cambió:** en la pestaña **Tareas** de un proyecto hay un selector **Tarjetas / Tablero**. El **tablero** tiene tres columnas: **Pendiente**, **En progreso** y **Completada**. Para cambiar el estado de una tarea **arrastra su tarjeta desde el asa (✥) a otra columna** (con el mouse, el dedo o el lápiz), o toca la etiqueta de estado de la tarjeta, que lo cambia sin arrastrar. Al soltar en **Completada**, la tarea se completa como si la hubieras marcado a mano (y avisa a quien la creó).
- **Tareas frecuentes** (diarias o semanales): aparecen en **Pendiente** o **Completada** (al día) según su periodo y **no se arrastran**; su etiqueta las alterna.
- **En el celular:** las columnas se deslizan de lado.
- **Se recuerda** la última vista que elegiste (tarjetas o tablero) en ese navegador.
- **Afecta a:** todos los que usan proyectos.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 8.3 (Proyectos).

---

## 3 de noviembre de 2026 · Tareas: tarjetas verticales, imágenes y notas a mano

Mejora (PR 81). **Sí hay cambio de esquema** (tabla nueva `task_assets`): después del despliegue, el administrador debe abrir `install/setup.php` y aplicar la actualización. Sin eso, subir imágenes a una tarea falla con «Error de base de datos»; el resto de Tareas sigue funcionando.

### Las tareas se ven en tarjetas verticales, en cuadrícula

- **Qué cambió:** las tareas ya no van en una sola fila ancha. Ahora son **tarjetas verticales en cuadrícula**: **4 por fila** en pantalla grande (3 en mediana, 2 en tablet) y **una sola tarjeta por fila en el celular**. Esto aplica a **Mis tareas** y al detalle de un proyecto, y en todas las secciones (prioridad alta, hoy, mañana, esta semana, posterior y completadas); la sección «Prioridad alta» ya no usa tarjetas cuadradas aparte.
- **Descripción completa en la tarjeta:** la tarjeta muestra la descripción con su formato, las casillas y las imágenes. Si algo no cabe, **se desplaza dentro de la tarjeta**. Al tocar el **título** se abre la **tarea completa** (sin recortes, con todas sus imágenes y subtareas); desde ahí también se pueden marcar casillas y hay un botón **Editar**.
- **Afecta a:** todos los que usan Tareas.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 8.1 (Mis tareas).

### Descripción con alineación, viñetas, imágenes y notas a mano

- **Qué cambió:** la barra del campo **Descripción** suma:
  - **Alineación:** izquierda, centro, derecha y justificado.
  - **Viñetas:** una lista con puntos. **Enter** crea otra viñeta; **Enter en una vacía** (o Retroceso al inicio) la regresa a texto normal.
  - **Imagen:** con el botón **Imagen** (elige una foto), **pegando** una captura o imagen copiada con **Ctrl+V**, o **arrastrándola** al campo. Se reduce sola si es muy grande.
  - **A mano:** abre una hoja para **escribir o dibujar con el dedo, el lápiz de la tablet o el mouse** (4 colores, fino o grueso, deshacer y borrar todo). Al pulsar **Insertar en la tarea** queda como una imagen recortada al trazo.
- **Límites:** imágenes PNG, JPG, GIF o WEBP de **hasta 8 MB** y **hasta 20 por tarea**. Una imagen quitada de la descripción se borra del servidor pasado un día.
- **Quién las ve:** solo quien ve la tarea (asignados, quien la creó y quien gestiona Tareas). Al tocar una imagen en la tarjeta se abre en grande.
- **Papelera:** si un usuario estándar elimina una tarea, va a la **papelera con sus imágenes** y las conserva al restaurarla. Si un administrador la elimina de forma definitiva, se borran también sus imágenes.
- **Lo que sigue sin admitir:** colores, tamaños y tipografías (como antes). Las imágenes viven en el servidor, igual que las del Pizarrón: **no entran al respaldo de la base de datos**.
- **Afecta a:** todos los que crean o trabajan tareas.
- **Acción:** el administrador corre **`install/setup.php`** una vez tras el despliegue (crea la tabla `task_assets`). Nada más.
- **Manual:** estándar, apartado 8.2 (Crear una tarea).

---

## 13 de octubre de 2026 · Tareas: descripción visible, con formato y casillas

Mejora (PR 80). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### La descripción se ve en la tarjeta de la tarea

- **Qué cambió:** la descripción de una tarea ahora aparece **dentro de la tarjeta**, debajo de las etiquetas, sin tener que abrir «Editar». Si es larga, la caja de la descripción tiene su propia barra para desplazarse. Las descripciones anteriores (texto simple) se ven igual que antes, línea por línea.
- **Afecta a:** todos los que usan Tareas.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 8.1 (Mis tareas).

### Descripción con negritas, cursivas, subrayado y casillas

- **Qué cambió:** el campo **Descripción** de la tarea (al crear o editar) ahora es un editor con una barra: **B** (negrita), **I** (cursiva), **U** (subrayado) y **Casillas**. Con **Casillas** el renglón se vuelve un **pendiente con casilla**; al pulsar **Enter** se crea otro pendiente, y **Enter en uno vacío** (o Retroceso al inicio) lo regresa a texto normal. Funciona igual que en el Pizarrón.
- **Casillas desde la tarjeta:** las casillas de la descripción se pueden **marcar directamente en la tarjeta**, sin abrir la tarea. Junto a las etiquetas aparece el avance (**☑ 2/3**).
- **La tarea se completa sola:** cuando se marca la **última casilla**, la tarea pasa a **Completada** (se pone verde, con el título y los pendientes tachados, y avisa a quien la creó, como al completarla a mano). Si después se **desmarca** una casilla, vuelve a **Pendiente**.
- **Tareas frecuentes** (diarias o semanales): las casillas valen para **el periodo en curso**. Al marcar todas, la tarea queda **«Al día»** en ese periodo, y **al comenzar el día o la semana siguiente las casillas aparecen sin marcar** otra vez, sin hacer nada.
- **Completar a mano:** el círculo de la tarjeta y el estado siguen funcionando como siempre; completar una tarea a mano **no** marca sus casillas.
- **Lo que no admite:** colores, tamaños, tipografías ni imágenes (solo negrita, cursiva, subrayado y casillas). Al pegar texto se pega **sin formato**. Una tarea sin casillas se comporta como siempre.
- **Más espacio para escribir:** el campo de la descripción en el formulario es más alto (unas 12 líneas, y se puede estirar) y la ventana es más ancha.
- **Afecta a:** todos los que crean o trabajan tareas. Pueden marcar casillas quienes tienen acceso a la tarea (asignados, quien la creó o quien gestiona Tareas).
- **Acción:** ninguna. Las descripciones existentes se convierten al formato nuevo la primera vez que alguien edite la tarea y la guarde.
- **Manual:** estándar, apartados 8.1 y 8.2 (Crear una tarea).

---

## 9 de octubre de 2026 · Membretador: crear plantillas de estudio

Función nueva (PR 76). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### «Crear plantilla» dentro del Membretador

- **Qué cambió:** en **Apps → Membretador → Análisis clínicos** hay un botón nuevo, **Crear plantilla** (en la lista de órdenes y en la pantalla «¿Qué estudios vas a membretar?»). Abre un asistente que pregunta:
  1. el **nombre del estudio**;
  2. la **técnica** (se aplica a todas las determinaciones; se puede cambiar en cada una);
  3. las **determinaciones**: nombre, unidad y sus **valores de referencia**, con filas para distinto sexo, edad o condición, o un texto (por ejemplo «Negativo»). También se pueden agregar determinaciones que **ya existen en el catálogo** buscándolas.
- Al guardar, la plantilla queda **seleccionada** y se continúa con la orden. El reporte sale con **el mismo formato de siempre** (técnica bajo cada determinación, resultado, unidad y referencias del paciente).
- **Quién puede usarlo:** quien tenga el **privilegio de Membretador** (el administrador lo tiene siempre). Antes, las plantillas solo se creaban en Admin Tools (solo administradores).
- **Qué no hace:** nunca sobrescribe. Un **nombre de plantilla repetido se rechaza**, y una determinación que **ya existe** en el catálogo (mismo nombre y unidad) se usa tal cual, sin cambiar sus referencias, y el asistente avisa cuáles fueron. Para corregir referencias ya guardadas se sigue usando **Admin Tools → Plantillas de Estudios**.
- **Consejo:** si los valores cambian por sexo, usa una fila **Femenino** y otra **Masculino**, sin «Ambos sexos»: «Ambos sexos» se muestra también a mujeres y a hombres, y el asistente avisa si se mezclan.
- **Afecta a:** quien membreta análisis clínicos.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 14.1 (Membretador); administrador, apartado 8 (Plantillas de Estudios).

---

## 9 de octubre de 2026 · Ficha de identificación: sin «No referido» de más y correo personalizable

Mejoras (PR 79). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### La ficha de las admisiones del asistido ya no imprime datos que ese modo no pregunta

- **Qué pasaba:** el formulario de admisión de laboratorio en modo **asistido (wizard)** no pregunta sexo, grupo sanguíneo, domicilio ni la historia clínica (fumador, anticoagulantes, legrado, anticonceptivos, FUR), pero la ficha los imprimía todos como «No referido».
- **Qué cambió:** en las admisiones hechas con el asistido, la ficha **omite** esos datos. Los que **sí se preguntan** en el asistido y quedaron vacíos (fecha de nacimiento, edad, teléfono, correo, médico, síntomas, medicamentos…) siguen diciendo «No referido».
  - Si después se **corrige** la admisión en el formulario completo y se captura alguno de esos datos, ese dato **sí aparece** (la historia clínica completa aparece en cuanto se captura cualquiera de sus datos).
  - Las **fichas anteriores** hechas con el asistido (que aún no tenían marca) también se imprimen sin esos datos, porque nunca se capturaron.
  - Las admisiones del **formulario completo** no cambian.
- **Afecta a:** quien imprime o envía fichas de laboratorio hechas por los recolectores.
- **Acción:** ninguna.
- **Manual:** estándar, apartados 6.6 (asistido) y 7.7 (la ficha).

### Asunto, mensaje y firma del correo de la ficha, personalizables

- **Qué cambió:** en **Admin Tools → API → Correo** hay una sección nueva, **Mensaje de la ficha de identificación**, con tres campos: **Asunto**, **Mensaje** y **Firma**.
  - Se pueden usar las variables **`{paciente}`** (nombre completo), **`{folio}`** (folio de la orden) y **`{clinica}`** (nombre de la clínica); hay botones para insertarlas donde esté el cursor.
  - En el mensaje, una **línea en blanco** separa párrafos. En la firma, la **primera línea sale en negrita** y los teléfonos (55 1234 5678) y correos se vuelven enlaces.
  - Una **vista previa** con datos de ejemplo se actualiza mientras escribes, y **Enviar prueba del mensaje de la ficha** manda un correo de ejemplo a la dirección que indiques (sin el PDF).
  - **Restablecer textos originales** vuelve al asunto, mensaje y firma de siempre. Con los campos vacíos se usan los originales.
- **Qué no cambia:** el PDF adjunto, las copias internas (BCC), el remitente y el reenvío de la ficha. El texto, por seguridad, se trata como texto plano: no admite HTML y el asunto siempre queda en una sola línea.
- **Afecta a:** administradores (quien configura el correo) y los pacientes, que reciben el nuevo texto.
- **Acción:** si quieres otro texto, personalízalo y pulsa **Guardar configuración**. Si no haces nada, el correo sale igual que antes.
- **Manual:** administrador, apartado 5.2 (Correo saliente).

---

## 9 de octubre de 2026 · Calendario: semana por defecto y citas de solo lectura

Mejora (PR 78). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### El Calendario se abre en la vista de semana

- **Qué cambió:** al entrar a **Calendario** ya no se abre el mes, sino la **semana actual**: ahí se leen completas las citas del día (el mes muestra solo 4 por día y recorta el resto). **Día** y **Mes** siguen a un clic en el selector de arriba, y **Hoy** vuelve a la fecha actual en la vista que estés usando.
- **Afecta a:** todos los que usan el Calendario.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 12 (Calendario): la captura principal muestra el mes, que ya no es la vista inicial.

### Las citas se abren en solo lectura; para cambiarlas hay que pulsar «Editar»

- **Qué cambió:** al pulsar una cita (en Día, Semana o Mes) se abre una **tarjeta de detalle** con título, estado, fecha y hora, servicio, responsable, ubicación, paciente, invitados y notas, **sin campos editables**. Abajo hay dos botones: **Cerrar** y **Editar**.
  - **Editar** abre el formulario de siempre (con **Guardar** y **Cancelar cita**). Cancelar una cita **solo** se puede desde ahí, después de pulsar Editar.
  - Quien no pueda editar la cita (no es la persona responsable ni administra el calendario) solo ve **Cerrar**, con un aviso.
  - Las citas que vienen de **Google Calendar** muestran un recordatorio: si se editan en Sirius, el cambio también se envía a Google.
- **Por qué:** abrir una cita para mirarla ya no puede modificarla ni cancelarla por un descuido.
- **Afecta a:** todos los que usan el Calendario. **Crear** una cita nueva (botón **Nueva cita** o el **+** de un día) funciona igual que antes.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 12.1: la captura «Detalle de una cita» muestra el formulario editable, que ahora se abre solo tras pulsar Editar.

---

## 9 de octubre de 2026 · Membretador: datos del paciente desde su ficha

Mejora (PR 77). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### Subir la ficha de identificación en las órdenes de análisis clínicos

- **Qué cambió:** en **Apps → Membretador → Análisis clínicos → Nueva orden** hay una tarjeta **Datos del paciente** con el botón **Subir ficha (PDF)**. Al subir la ficha de identificación del paciente (la que genera Admisión), Sirius llena solo: **nombre, sexo, edad, fecha de nacimiento y teléfono**; y, si estaban vacíos, el **folio**, el **médico solicitante** y la **toma de muestra**. Todo sigue editable, y el llenado **manual** funciona igual que antes.
- **Referencias al paciente:** con el sexo y la edad que trae la ficha, los **valores de referencia** de las determinaciones de las plantillas se ajustan al paciente (por ejemplo, hemoglobina de mujer o de hombre). Las referencias que tú hayas editado a mano **no se tocan**. Lo que ya habías escrito en los demás campos del formulario se conserva.
- **Cuándo usarlo:** antes o después de subir el PDF del laboratorio. Los datos del paciente que traiga ese PDF y los de la ficha se combinan: la ficha completa lo que el PDF no trae (teléfono, fecha de nacimiento…).
- **Afecta a:** quien membreta análisis clínicos.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 14.1 (Membretador).

---

## 8 de octubre de 2026 · Calendario: sincronización con Google

Rediseño de la sincronización Google → Sirius (PR 74). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### Se acabaron los avisos repetidos del calendario

- **Qué pasaba:** Sirius pedía a Google «lo que cambió desde la última vez». Con un calendario que tiene un **evento diario desde hace años**, cualquier cambio a esa serie devolvía **miles de eventos** (todos los del pasado y los del futuro lejano), y cada uno mandaba su propio aviso a todo el equipo. Además, la fecha de modificación de cada evento se guardaba en un formato que MySQL alteraba, así que **todo parecía modificado en cada revisión** (cada 5 minutos) y los avisos se repetían.
- **Qué cambió:**
  - Sirius revisa en cada corrida solo una **ventana de eventos: de un mes atrás a seis meses adelante**, y compara cada evento con lo que ya tiene. Lo que ya está al día **no se reprocesa ni avisa**. Los eventos de fuera de la ventana **no se importan** (los diarios de hace años ya no estorban) y los que van entrando a la ventana con el paso de los días aparecen solos.
  - La **primera sincronización** (o la que sigue a reconectar la cuenta) importa **en silencio**, sin avisar por cada evento.
  - Cuando hay cambios, se avisan **juntos**: hasta 3 por separado; si son más, **un solo aviso-resumen** («12 cambios desde Google Calendar: …»).
  - La bitácora anota un renglón por corrida («Google Calendar: N nuevas, …») en vez de uno por evento.
- **Afecta a:** todos los que reciben avisos del calendario.
- **Acción:** ninguna. Los avisos que ya llegaron siguen en la campana: puedes marcarlos como leídos. Si en la base ya se importaron eventos de años pasados, **no se borran solos**: avísanos y los limpiamos.
- **Manual:** administrador, apartado 5 (API → Google Calendar); estándar, apartado 12 (Calendario).

### Eventos de Google que no aparecían en el calendario de Sirius

- **Qué cambió:** (1) los eventos de **todo el día** se ignoraban; ahora se importan de 00:00 a 23:59. (2) Un evento que **Sirius** creó en Google y cuyo identificador no se alcanzó a guardar ahora se **vuelve a enlazar** con la cita original, en vez de volver como duplicado. (3) Si un evento falla al importarse, **ya no detiene** a los demás ni deja la sincronización a medias.
- **Afecta a:** quien usa Google Calendar junto con Sirius.
- **Acción:** ninguna; los eventos aparecen en la siguiente sincronización (máximo 5 minutos). Si algo sigue sin aparecer, abre una vez `https://sirius-bpm.com/cron_calendar_sync.php?key=<cron_key>`: la respuesta indica cuántos eventos se importaron, cuántos tuvieron error y cuál fue el primer error.
- **Manual:** administrador, apartado 5.

---

## 8 de octubre de 2026 · Tablet: la app ya se puede girar

Corrección del bloqueo de orientación (PR 75). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### La aplicación instalada ya no se bloquea en vertical

- **Qué pasaba:** la configuración de la aplicación instalada (el manifest) pedía orientación vertical fija, así que en una **tablet** Sirius se abría siempre en vertical y no se podía usar en horizontal aunque se girara el equipo.
- **Qué cambió:** ahora permite cualquier orientación. En horizontal (1024 píxeles o más de ancho) se ve el menú lateral fijo, igual que en una computadora; en vertical, el menú se oculta tras el botón de las tres rayas.
- **Afecta a:** quien usa Sirius **instalada** como aplicación en Android (tablet o teléfono). En el navegador normal nunca hubo bloqueo.
- **Acción:** Android actualiza la aplicación instalada por su cuenta, pero puede tardar **hasta un día**. Para verlo de inmediato: **desinstalar la aplicación de la tablet y volver a instalarla** desde el navegador (Configuración → Instalar la app). También hay que tener activado el giro automático de la tablet.
- **Manual:** estándar, apartados 3.3 (Sirius en el teléfono) y 16.

---

## 8 de octubre de 2026 · Seguridad y pruebas automáticas

Endurecimiento de seguridad y pruebas automáticas (PR 71 y 72). **Exige correr una vez la actualización de la base de datos** al desplegarlo, porque agrega la tabla `login_attempts`. Esa actualización **ya no se hace con `?key=` en la dirección**: ver la segunda entrada.

### Respaldos cifrados con contraseña

- **Qué cambió:** al exportar un respaldo aparece **«Proteger con contraseña (recomendado)»**, activado por defecto. El archivo se cifra (AES-256) con una contraseña de **mínimo 10 caracteres**. Al importarlo, Sirius pide esa contraseña antes de mostrar el contenido. Sin contraseña (opción desmarcada, con confirmación) el archivo sigue saliendo como antes.
- **Afecta a:** administradores en **Admin Tools → Backup**. Los respaldos anteriores sin cifrar se siguen pudiendo importar.
- **Acción:** usa contraseña al exportar y **guárdala en un lugar seguro: si se pierde, el respaldo no se puede recuperar**. Conviene no guardarla junto al archivo.
- **Por qué:** el respaldo incluye las llaves de IA, correo y WhatsApp y los hashes de contraseña de los usuarios.
- **Manual:** administrador, apartado 12; desarrollador, apartados 8.6 y 16.

### Actualizar la base de datos: ahora es un formulario, no una dirección con clave

- **Qué cambió:** `install/setup.php?key=…` **ya no funciona**. Ahora se abre `https://sirius-bpm.com/install/setup.php`, se escribe la clave de instalación en el campo y se pulsa **Aplicar**. La clave viaja por POST y **ya no queda en los registros de acceso ni en el historial del navegador**. Tras 5 claves incorrectas hay una espera de 10 minutos.
- **Afecta a:** quien aplique actualizaciones de base de datos (administrador/desarrollador).
- **Acción:** **hacerlo una vez después de este despliegue** (crea la tabla `login_attempts`); si no se hace, todo sigue funcionando, solo que el freno por IP del inicio de sesión no se activa. Si guardaste el enlace con `?key=`, bórralo de tus favoritos.
- **Manual:** administrador, apartados 20.2 y 21; desarrollador, apartado 12.3.

### Inicio de sesión: freno también por IP

- **Qué cambió:** además del freno por sesión (5 fallos → 5 minutos), ahora una **misma IP** que acumula 20 inicios de sesión fallidos en 15 minutos queda bloqueada temporalmente, con el mensaje «Demasiados intentos desde esta red».
- **Afecta a:** quien intente adivinar contraseñas abriendo sesiones nuevas. El personal de la clínica no lo nota: sale por una misma IP, y el límite es holgado a propósito.
- **Acción:** ninguna. Si alguien del equipo se ve bloqueado, esperar 15 minutos.
- **Manual:** desarrollador, apartados 6 y 16.

### La conexión siempre es segura (HTTPS)

- **Qué cambió:** entrar por `http://` redirige automáticamente a `https://`. Estaba comentado en la configuración del servidor.
- **Afecta a:** todos, sin notarlo. Enlaces y favoritos antiguos con `http://` siguen funcionando.
- **Acción:** ninguna. Si algún día el sitio no abre y el navegador dice «demasiadas redirecciones», avisa al desarrollador.
- **Manual:** administrador, apartado 19; desarrollador, apartado 16.

### El nombre de la clínica sale de la configuración

- **Qué cambió:** la pantalla de inicio de sesión y el nombre de la aplicación instalada muestran el nombre capturado al instalar (**settings → clinic_name**) y no uno fijo en el código. Para esta clínica no cambia lo que se ve en el login. El nombre de la aplicación instalada pasa a ser «Sirius — Laboratorio y Clínica Bosques Polanco».
- **Afecta a:** todos, apenas.
- **Acción:** ninguna. En dispositivos donde Sirius ya está instalada, el nombre bajo el icono puede tardar en actualizarse o requerir reinstalarla.
- **Manual:** desarrollador, hallazgo 5 del apartado 17.

### Política de seguridad de contenido (CSP), en modo de observación

- **Qué cambió:** el servidor ahora manda una política que describe de dónde puede cargar cosas la aplicación (solo lo propio, el mapa de Cobertura —Leaflet y OpenStreetMap— y nada más; **sin scripts en línea**). Por ahora es **solo de observación**: no bloquea nada, solo registra en el log de errores del servidor (líneas que empiezan con `CSP:`) lo que habría bloqueado.
- **Afecta a:** nadie lo nota. En una revisión de 40 pantallas (incluido el mapa) no hubo ningún reporte.
- **Acción:** ninguna por ahora. Pasados unos días, si en **cPanel → Errores** no aparecen líneas `CSP:` legítimas, se activa el modo estricto (cambio de una palabra en `.htaccess`).
- **Por qué:** limita el daño si algún día se cuela texto malicioso en una pantalla.
- **Manual:** desarrollador, apartado 16 (falta de CSP queda superado).

### Pruebas automáticas

- **Qué cambió:** hay 18 pruebas unitarias/estructurales y 13 de integración (`tests/`), que GitHub corre en cada pull request. Cubren permisos, vacaciones y antigüedad, respaldo cifrado, el freno de login, el esquema, el precaché del service worker y el ciclo completo de login, CSRF y permisos.
- **Afecta a:** desarrolladores. No cambia nada para los usuarios.
- **Acción:** antes de abrir un PR, `tools\php\php.exe tests\run.php` y `tools\php\php.exe tests\api_smoke.php`.
un.php` y `tools\php\php.exe testspi_smoke.php`.
- **Manual:** desarrollador, apartado 13 («No hay pruebas automatizadas» queda superado) y hallazgo 7 del apartado 17.

---

## 8 de octubre de 2026 · Correcciones de la revisión

Correcciones que salen de la revisión del código hecha para los manuales (PR 70). No hay cambios de esquema de base de datos: **no hace falta correr `install/setup.php`**.

### Cobertura, Papelera y la silueta corporal ahora funcionan sin conexión

- **Qué cambió:** cuatro archivos de la interfaz no estaban en el precaché del service worker (`body_silhouette.js`, `coverage_map.js`, `modules/cobertura.js` y `modules/papelera.js`). Ya están.
- **Afecta a:** quien usa Sirius instalado como aplicación y se queda sin conexión: antes, esas pantallas no abrían; ahora sí cargan (los datos siguen requiriendo conexión).
- **Acción:** en cada dispositivo, **Configuración → Buscar actualizaciones** (la app nunca se actualiza sola a media sesión).
- **Manual:** desarrollador, apartado 10.1 y hallazgo 1 del apartado 17.

### Plantillas de Estudios: un rango sin sexo ya no da error

- **Qué cambió:** al guardar una plantilla de estudio, si un rango de referencia traía el sexo vacío, el guardado fallaba con un error del servidor. Ahora ese rango se toma como **«Ambos» (A)**, igual que cuando no se indica el sexo.
- **Afecta a:** administradores que editan o importan plantillas y valores de referencia. No se había observado el fallo en la práctica; era un caso latente.
- **Acción:** ninguna.
- **Manual:** desarrollador, hallazgo 4 del apartado 17 y la fila de «sex NOT NULL» del apartado 15.

### Membretes: los textos de ejemplo del responsable sanitario son genéricos

- **Qué cambió:** los campos del responsable sanitario mostraban, en gris, un nombre y una cédula de aspecto real como ejemplo. Ahora dicen «Dr. Nombre Apellido Apellido» y «Ced. Prof. 0000000».
- **Afecta a:** administradores en **Admin Tools → Membretes**. Es solo una pista visual: **no cambia ningún PDF ni lo ya capturado**.
- **Acción:** ninguna. Confirma que la firma de cada área tenga **sus propios datos reales** capturados.
- **Manual:** administrador, apartado 6; desarrollador, hallazgo 2 del apartado 17.

### WhatsApp: Configuración ya no trae un Business ID precargado

- **Qué cambió:** el campo **Business ID** venía con un número fijo en el código. Ahora viene vacío por defecto. Ese dato solo se muestra en la pantalla; **no se usa en las llamadas a WhatsApp**, así que el envío y la recepción de mensajes no se afectan.
- **Afecta a:** administradores en **Admin Tools → WhatsApp: Configuración → Credenciales**.
- **Acción:** si nunca habías guardado la configuración de WhatsApp y el campo aparece vacío, **escribe el Business ID de tu cuenta de Meta** y pulsa **Guardar**. Si ya lo habías guardado, se conserva.
- **Manual:** administrador, apartado 11; desarrollador, hallazgo 3 del apartado 17.

---

## Cómo se agrega una entrada nueva

Cada cambio que el usuario o el administrador pueda notar se anota en este archivo en el mismo PR que lo introduce, **arriba** de las entradas anteriores:

1. Un `##` con la fecha («9 de octubre de 2026») y, debajo, una línea con el PR y si exige correr `install/setup.php`.
2. Un `###` por cambio, con las cuatro viñetas: **Qué cambió**, **Afecta a**, **Acción**, **Manual**.
3. Actualizar el índice.
4. Regenerar el PDF: `python docs/manuales/build_manuales.py 04`.

Los manuales 01–03 solo se reescriben cuando se publique una **versión nueva completa** (2.0), no por cada cambio.
