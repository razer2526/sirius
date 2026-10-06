# Sirius · Manual de usuario estándar

**Laboratorio y Clínica Bosques Polanco**
Versión 1.0 · octubre de 2026

> Este manual explica cómo trabajar en Sirius todos los días: entrar al sistema, registrar a un paciente, consultar expedientes, llevar tareas, inventario, agenda y mensajes. Está escrito para el **personal con rol Estándar**. Si eres administrador, además de este manual necesitas el **Manual de usuario administrador**.

> **Sobre las capturas.** Todas las imágenes salen de un entorno de demostración con **datos ficticios** (pacientes, médicos y teléfonos inventados). Los números rojos de las capturas se explican en el texto que las acompaña.

---

## Índice

1. [Antes de empezar](#1-antes-de-empezar)
2. [Entrar y salir](#2-entrar-y-salir)
3. [Conoce la pantalla](#3-conoce-la-pantalla)
4. [Dashboard: tu resumen del día](#4-dashboard-tu-resumen-del-día)
5. [Notificaciones](#5-notificaciones)
6. [Admisión: registrar a un paciente](#6-admisión-registrar-a-un-paciente)
7. [Expedientes](#7-expedientes)
8. [Tareas](#8-tareas)
9. [Inventario](#9-inventario)
10. [Pizarrón](#10-pizarrón)
11. [Archivos](#11-archivos)
12. [Calendario](#12-calendario)
13. [WhatsApp](#13-whatsapp)
14. [Apps](#14-apps)
15. [Asistente Sirius](#15-asistente-sirius)
16. [Tu perfil y tu configuración](#16-tu-perfil-y-tu-configuración)
17. [Problemas frecuentes](#17-problemas-frecuentes)
18. [Glosario](#18-glosario)

---

## 1. Antes de empezar

### 1.1 Qué es Sirius

Sirius es el sistema de gestión del laboratorio y la clínica. En un solo lugar se hace:

- la **admisión** de pacientes de Laboratorio, Control de peso, Fisioterapia y Podología;
- el **expediente** de cada paciente, con sus visitas, consultas de seguimiento y documentos;
- el **inventario** de material y reactivos;
- las **tareas** del equipo, la **agenda**, el **pizarrón** de avisos y el gestor de **archivos**;
- la bandeja de **WhatsApp** del equipo;
- herramientas como el **Cotizador**, las **Comisiones** de médicos y el mapa de **Cobertura** a domicilio.

### 1.2 Qué necesitas

| Necesitas | Detalle |
|---|---|
| Un navegador actualizado | Chrome, Edge, Firefox o Safari, en computadora, tableta o teléfono. |
| La dirección del sistema | La que te dé el administrador (en producción es `https://sirius-bpm.com`). |
| Tu usuario y contraseña | Los crea el administrador. Si los olvidas, pídele que te los restablezca. |

Sirius funciona igual en el teléfono que en la computadora: la pantalla se adapta (véase el apartado 3.3). También se puede **instalar como app** (apartado 16.3).

### 1.3 Qué puedes ver: depende de tus permisos

Tu administrador decide **qué módulos aparecen en tu menú** y qué privilegios extra tienes dentro de cada uno. Por eso tu menú puede ser distinto al de un compañero. Dos opciones **siempre** están disponibles para todos: **Perfil** y **Configuración** (menú de tu nombre, arriba a la derecha).

Si necesitas algo que no ves, **no es un fallo**: pide el permiso al administrador.

---

## 2. Entrar y salir

![Pantalla de inicio de sesión](img/std-01-login.png)
*Inicio de sesión. 1 Usuario · 2 Contraseña · 3 «Recuérdame en este dispositivo» · 4 Entrar.*

### 2.1 Iniciar sesión

1. Abre la dirección de Sirius en el navegador.
2. Escribe tu **usuario** (1) y tu **contraseña** (2).
3. Pulsa **Entrar** (4).

**«Recuérdame en este dispositivo».** Si lo marcas, Sirius no te vuelve a pedir la contraseña durante **30 días** en ese navegador. Úsalo solo en tu propio equipo, **nunca en una computadora compartida**.

> **Seguridad.** Después de **5 intentos fallidos** seguidos, Sirius te pide esperar **5 minutos** antes de volver a intentar. No es un error del sistema: es una protección.

### 2.2 Cerrar sesión

Abre el menú de tu nombre (arriba a la derecha) y pulsa **Cerrar sesión**. Hazlo siempre al terminar tu turno si la computadora es compartida.

Mientras tengas Sirius abierto, el sistema mantiene tu sesión viva con una señal discreta cada pocos minutos, para que un formulario largo no te saque a media captura. Si aun así la sesión caduca, Sirius te lleva a la pantalla de inicio de sesión.

---

## 3. Conoce la pantalla

![Partes de la pantalla principal](img/std-02-pantalla.png)
*La pantalla principal. 1 Menú lateral · 2 Botón del menú · 3 Título del módulo · 4 Actualizar · 5 Campana de avisos · 6 Menú de tu usuario · 7 Área de trabajo · 8 Asistente Sirius.*

### 3.1 Las partes

| N.º | Parte | Para qué sirve |
|---|---|---|
| 1 | **Menú lateral** | Los módulos a los que tienes acceso. El que estás usando aparece resaltado. |
| 2 | **Botón del menú** | En computadora, contrae el menú para ganar espacio (solo quedan los iconos). En teléfono, lo abre y lo cierra. |
| 3 | **Título** | Dice en qué módulo estás. |
| 4 | **Actualizar** | Recarga Sirius completo. Úsalo si algo se ve desactualizado. |
| 5 | **Campana** | Tus avisos: WhatsApp sin leer y notificaciones (apartado 5). |
| 6 | **Tu nombre y rol** | Abre el menú con **Perfil**, **Configuración** y **Cerrar sesión**. |
| 7 | **Área de trabajo** | Aquí aparece el módulo que abriste. |
| 8 | **Burbuja del asistente** | Abre el asistente Sirius (apartado 15). |

### 3.2 El menú del avatar

![Menú del usuario](img/std-04-menu-avatar.png)
*Menú de tu usuario. 1 Perfil · 2 Configuración · 3 Cerrar sesión.*

### 3.3 Sirius en el teléfono

![Sirius en el teléfono](img/std-07-movil-dashboard.png)
![Menú en el teléfono](img/std-07-movil-menu.png)
*En pantallas pequeñas el menú se esconde: ábrelo con el botón de las tres rayas. Al elegir un módulo se cierra solo.*

### 3.4 Tu menú depende de tu puesto

Estos son ejemplos reales de cómo cambia el menú según los permisos:

| Recepción | Recolector a domicilio | Enfermería |
|---|---|---|
| ![](img/std-06-menu-recepcion.png) | ![](img/std-06-menu-recolector.png) | ![](img/std-06-menu-enfermeria.png) |

El **recolector** solo ve **Admisión**, y esta se le abre directamente en el formulario paso a paso (apartado 6.6).

---

## 4. Dashboard: tu resumen del día

El **Dashboard** es la pantalla de inicio. Resume lo que necesitas saber sin abrir cada módulo; **no sustituye** a los módulos, solo te avisa.

![Dashboard](img/adm-01-dashboard.png)

De arriba abajo encontrarás:

- **Saludo, fecha y reloj.**
- **Cuatro indicadores:** pacientes registrados, admisiones de hoy, consultas de hoy y mensajes de WhatsApp sin leer.
- **Alertas.** Tarjetas que avisan de cosas que requieren atención. Solo aparecen las de los módulos a los que tienes acceso:
  - **Inventario:** artículos con stock bajo y lotes por caducar o ya caducados.
  - **Tareas:** tareas frecuentes (diarias o semanales) que aún no completaste en este periodo y tareas con fecha límite en los próximos 7 días.
  - **Calendario:** citas próximas (hasta 7 días).
  - **Pizarrón y Archivos:** contenido compartido nuevo de los últimos 3 días.
  - **Expedientes:** cumpleaños de pacientes en los próximos 7 días.
  - **WhatsApp:** conversaciones con mensajes sin leer.
  - **Apps:** estudios en borrador que esperan revisión (solo para quien puede revisarlos).
- **¿Qué tenemos para hoy?** y **¿Qué va a pasar mañana?** Tu agenda: citas, tareas y entregas pendientes, cada tarjeta con el icono de su módulo.

**Descartar una alerta.** Cada alerta tiene una **✕**. Al pulsarla desaparece **solo para ti**. Las alertas de tareas frecuentes **reaparecen** cuando empieza un periodo nuevo (el día siguiente o la semana siguiente).

El Dashboard se **actualiza solo** cada pocos segundos; deja de actualizarse mientras tienes una ventana abierta o estás escribiendo, para no interrumpirte.

---

## 5. Notificaciones

### 5.1 La campana

![Campana de avisos](img/std-03-campana.png)
*El panel de la campana. 1 Avisos recientes: mensajes de WhatsApp sin leer y notificaciones de Sirius.*

La **campana** (con un globo rojo cuando hay novedades) reúne:

- los **mensajes de WhatsApp sin leer**, con el nombre del contacto;
- las **notificaciones de Sirius**: «Nueva tarea asignada», «Nueva cita asignada», «Nuevo proyecto asignado», avisos del pizarrón público.

Pulsa un aviso para ir directamente al lugar al que se refiere.

### 5.2 Avisos en el teléfono o la computadora (aunque Sirius esté cerrado)

En el panel de la campana puedes pulsar **Activar notificaciones**. El navegador te pedirá permiso; al aceptarlo, **ese dispositivo** recibirá avisos de Sirius aunque la pestaña esté cerrada.

- Activa las notificaciones **en cada dispositivo** que uses (celular y computadora son independientes).
- Los avisos **no incluyen datos clínicos** en el mensaje que viaja por los servicios del navegador; el contenido solo se muestra cuando tu sesión de Sirius es válida.
- Si no te llega nada, abre la campana y pulsa **Enviar notificación de prueba**. Sirius te dirá si el aviso salió, y si no, por qué. Si denegaste el permiso en el navegador, hay que volver a permitirlo en los ajustes del sitio del navegador.

---

## 6. Admisión: registrar a un paciente

La **admisión** es el primer paso con un paciente: se capturan sus datos, el motivo y la ficha de su servicio. Cada admisión abre una **visita** en su expediente.

![Servicios de admisión](img/std-10-admision-servicios.png)
*Elige el servicio. 1 Laboratorio · 2 Control de peso · 3 Fisioterapia · 4 Podología.*

> **Quién ve a quién.** Cada admisión tiene un **Responsable asignado**. Si eliges a una persona, **solo ella y los administradores** ven ese expediente. Si dejas **«General»**, lo ve cualquiera con acceso a Expedientes. Elige con cuidado: si asignas el expediente a otra persona, tú dejas de verlo.

### 6.1 Antes de capturar: ¿ya está registrado?

Escribe en el buscador **«¿Paciente ya registrado? Búscalo»** (nombre, folio o teléfono). Si aparece, **elígelo**: no se vuelve a capturar nada de sus datos personales y se abre una nueva visita en el mismo expediente.

![Búsqueda de paciente existente](img/std-17-paciente-existente-busqueda.png)
*1 Buscador · 2 Resultados (nombre y folio).*

![Paciente elegido](img/std-18-paciente-existente-elegido.png)
*Paciente elegido. 1 Tarjeta del paciente con su folio y la leyenda de visita anterior · 2 «Quitar», para elegir a otro o registrar uno nuevo.*

La tarjeta te avisa si el paciente **ya vino antes** («Paciente recurrente: última visita de…»). Si eliges un paciente existente, los campos de datos personales se ocultan.

**Posible duplicado.** Si capturas como nuevo a alguien con el **mismo nombre y la misma fecha de nacimiento** que un paciente que ya existe, al guardar Sirius te muestra este aviso:

![Aviso de posible duplicado](img/std-19-posible-duplicado.png)

- **Usar el existente:** la admisión se guarda en el expediente que ya existe (lo más común).
- **Registrar como nuevo:** solo si de verdad es otra persona (por ejemplo, homónimos).

### 6.2 Admisión de Laboratorio paso a paso

![Formulario de laboratorio: datos del paciente](img/std-11-lab-formulario-paciente.png)
*Parte superior del formulario. 1 Buscador de paciente existente · 2 Datos del paciente.*

**Paso 1 · Datos del paciente.** Solo **Nombre(s)** y **Apellido paterno** son obligatorios (marcados con *). Entre más datos captures, más completa saldrá la ficha: fecha de nacimiento, sexo, grupo sanguíneo, celular, correo, domicilio, contacto de emergencia y, en menores, la **persona a cargo o titular**.

> **Correo del paciente.** Si capturas el correo y tu clínica tiene el correo saliente activo, al terminar Sirius **envía la ficha en PDF** al paciente. Revisa que esté bien escrito: si no, los datos viajarían a otra persona.

![Motivo, médico y estudios](img/std-12-lab-motivo-estudios.png)
*1 Motivo de consulta o estudio · 2 Médico tratante · 3 Responsable asignado · 4 Fecha de entrega estimada · 5 Buscador de estudios.*

**Paso 2 · Motivo y referencia.**

1. **Motivo de consulta / estudio** (1): una línea sobre por qué viene.
2. **Médico tratante** (2): elige a un médico de la lista de convenio, **«Otro»** (y escribe el nombre) o **«Sin médico / no aplica»**. Esta elección alimenta las **comisiones** de los médicos (apartado 14.3).
3. **Responsable asignado** (3): ver el recuadro de arriba sobre quién ve a quién.
4. **Fecha de entrega estimada** (4): Sirius propone **dos días después de hoy**; ajústala si el estudio tarda más (cultivos, laboratorio externo).

**Paso 3 · Estudios a realizar.** Escribe parte del nombre en el buscador (5) y elige el estudio de la lista; aparece con su precio de catálogo.

![Buscar un estudio](img/std-13-lab-buscar-estudio.png)
*1 Buscador · 2 Resultados con nombre y precio.*

Después **escribe el monto realmente cobrado** de cada estudio (ya con el descuento aplicado). Si el estudio no está en el catálogo, pulsa **«+ Agregar estudio no catalogado»** y captúralo a mano.

![Estudios agregados](img/std-14-lab-estudios-agregados.png)
*1 Estudios agregados con su monto (puedes quitar uno con la ✕) · 2 Total cobrado, que se suma solo · 3 Agregar un estudio que no está en el catálogo.*

**Paso 4 · Historia clínica y síntomas.**

![Historia clínica y síntomas](img/std-15-lab-historia-sintomas.png)
*1 Historia clínica (casillas) · 2 Síntomas.*

- **Historia clínica:** marca lo que aplique (fumador, alcohol, anticoagulantes, legrado, anticonceptivos, infección de transmisión sexual) y la **FUR** si corresponde.
- **Síntomas:** al marcar un síntoma, Sirius **te pide «desde cuándo»** (Hoy o ayer, 2 a 6 días, 1 a 2 semanas, 2 a 4 semanas, Más de 1 mes, Más de 6 meses). Es obligatorio indicarlo para ese síntoma. Si falta alguno, escríbelo en **«Otro — especificar»**.
- **Medicamentos** y **Método de pago** (efectivo, tarjeta de crédito o débito, transferencia o link de pago).

**Paso 5 · Firma del paciente.**

![Firma y registro](img/std-16-lab-firma.png)
*1 Recuadro de firma (con el dedo o el mouse) · 2 «Limpiar firma» · 3 «Registrar admisión».*

El paciente firma en el recuadro. **La misma firma** aparece después en la ficha de identificación y en el consentimiento informado. Si no le gustó, pulsa **Limpiar firma** y que firme de nuevo.

**Documentos adjuntos.** Al final puedes adjuntar archivos del paciente (estudios previos, historial, imágenes). Se **suben al expediente** al registrar la admisión.

**Paso 6 · Registrar.** Pulsa **Registrar admisión**.

![Admisión registrada](img/std-25-admision-registrada.png)
*Admisión registrada. 1 Ver expediente · 2 Ver ficha (el PDF) · 3 Nueva admisión.*

Sirius te muestra el **folio del paciente** y el **folio de la orden** de laboratorio. Desde aquí:

- **Ver expediente:** abre al paciente.
- **Ver ficha:** abre el PDF de la ficha de identificación para **imprimirlo** (apartado 7.7).
- **Nueva admisión:** vuelve a la lista de servicios.
- Si el correo saliente está activo, te dice si la **ficha se envió** al paciente (y a qué dirección) o por qué no se pudo; **la admisión se guarda de todas formas**.

### 6.3 Admisión de Control de peso

![Control de peso: inicio](img/std-20-control-peso-inicio.png)
*El formulario es largo: está dividido en secciones (exposiciones, inmunizaciones, antecedentes, condiciones de presentación, antropometría, plicometría, bioimpedancia, signos vitales, estilo de vida, objetivo, hábitos nutricionales y firma).*

La parte medular es la **antropometría**:

![Antropometría](img/std-21-control-peso-antropometria.png)
*1 Peso (kg) · 2 Talla (cm) · 3 IMC, que se calcula solo · 4 ICC (cintura/cadera), que se calcula solo.*

- Captura **peso y talla** y Sirius calcula el **IMC** al instante. Con cintura y cadera calcula el **ICC**; con cintura y talla, el **ICE**.
- Las **plicometrías** (pliegues, en mm) suman solas la **sumatoria**.
- Las secciones **«Salud femenina»** aparecen solo si el sexo del paciente es femenino u otro.

![Bioimpedancia](img/std-22-control-peso-bioimpedancia.png)
*1 Bioimpedancia: % de grasa, masa grasa, masa muscular, agua total, grasa visceral, edad metabólica, TMB/BMR e impedancia.*

> **Báscula Bluetooth.** Actualmente el botón para tomar estos datos directamente de una báscula Bluetooth solo lo ve el administrador, mientras se termina de soportar el modelo de báscula de la clínica. Mientras tanto, captura estos valores a mano como siempre.

### 6.4 Admisión de Fisioterapia y Podología

![Fisioterapia](img/std-23-fisioterapia-formulario.png)
![Podología](img/std-24-podologia-formulario.png)

Ambas piden datos del paciente y su ficha: **datos patológicos personales**, **antecedentes heredofamiliares**, **antecedentes no patológicos**, **signos vitales** (con IMC automático) y **firma**. Fisioterapia añade **Salud femenina** o **Salud masculina** según el sexo del paciente.

### 6.5 Corregir una admisión

Si te equivocaste, ve al **expediente** del paciente, abre la pestaña **Admisión** de la visita y pulsa **Editar** (requiere el privilegio de edición de expedientes; si no lo ves, pídeselo al administrador). Todo cambio queda registrado en la bitácora.

### 6.6 Modo asistido (para recolectores a domicilio)

Es una versión del formulario de Laboratorio **de una pregunta por pantalla**, con letra y botones grandes, pensada para capturar de pie, en la puerta de una casa y con una mano. Solo pide **diez datos**. **Nada es obligatorio, salvo el nombre y el apellido paterno**; lo que no se capture saldrá en la ficha como «No referido».

Si tu usuario es de **recolector**, Sirius te abre **directamente** este modo. Si eres de otro puesto y quieres usarlo, entra por el enlace **«Laboratorio en modo asistido»** de la lista de servicios (cuando tu administrador te lo haya habilitado).

| | |
|---|---|
| ![](img/std-30-wizard-paso1.png) **Paso 1 · Nombre.** 1 Campo de nombre · 2 Continuar. | ![](img/std-31-wizard-nacimiento.png) **Paso 2 · Fecha de nacimiento.** |
| ![](img/std-32-wizard-medico.png) **Paso 4 · Médico.** | ![](img/std-33-wizard-estudios.png) **Paso 5 · Estudios.** Escribe y toca «OK» para agregar tal cual, o elige de la lista. |
| ![](img/std-35-wizard-pago.png) **Paso 6 · Pago y monto.** El monto se captura **una sola vez**, no por estudio. | ![](img/std-36-wizard-sintomas.png) **Paso 7 · Molestias.** Toca las que apliquen e indica desde cuándo. |
| ![](img/std-37-wizard-firma.png) **Paso 9 · Firma.** | ![](img/std-38-wizard-confirmar.png) **Paso 10 · Revisa antes de guardar.** Sirius te muestra el correo al que irá la ficha: **revísalo**. |

Los pasos 3 (contacto: celular y correo) y 8 (medicamentos) son iguales de sencillos. Con **Atrás** regresas a corregir.

> **Sin señal.** El modo asistido **guarda la admisión en el dispositivo si no hay internet** y la envía sola cuando vuelve la conexión. Verás un aviso con cuántas admisiones están pendientes de enviar. Si una admisión **se atora** (el servidor la rechazó), aparece marcada para que alguien la revise: avisa al administrador.

---

## 7. Expedientes

El módulo **Expedientes** reúne a todos los pacientes con sus visitas y documentos.

### 7.1 Buscar a un paciente

![Lista de expedientes](img/std-40-expedientes-lista.png)
*1 Buscador · 2 Área (servicio) · 3 y 4 Rango de fechas · 5 Tarjeta de un paciente.*

Escribe en el **buscador** (1) un nombre, folio o teléfono; la lista se filtra mientras escribes. Con **Área** (2) y las fechas (3, 4) limitas por servicio y por fechas de visita. Cada tarjeta muestra el nombre, el folio (`BP-AAAA-NNNN`), la edad, el sexo y las áreas en las que se ha atendido.

![Búsqueda](img/std-41-expedientes-busqueda.png)

> **Solo ves a quien te corresponde.** La lista incluye a los pacientes de visitas «Generales» y de las que te asignaron a ti. Si abres un expediente asignado a otra persona, Sirius responde **«No tienes acceso a este expediente»**:
>
> ![](img/std-50-expediente-sin-acceso.png)

### 7.2 El expediente de un paciente

![Detalle del expediente](img/std-43-expediente-detalle.png)
*1 Nuevo (consulta de seguimiento) · 3 Editar los datos del paciente · 4 Subir archivo / Archivos adjuntos · 5 Visitas.*

Arriba están los datos del paciente y sus botones:

- **+ Nuevo:** registra una **consulta de seguimiento** (apartado 7.4).
- **PDF:** imprime las visitas del paciente de Control de peso, Fisioterapia y Podología (el laboratorio se imprime por visita, apartado 7.7).
- **Editar** y **Eliminar:** corrigen los datos del paciente o lo dan de baja. Requieren privilegios de **edición** y **eliminación** de expedientes.
- **Documentos adjuntos:** **Subir archivo** agrega un documento al paciente y **Archivos adjuntos** los lista para verlos o descargarlos.

Más abajo, **Visitas** muestra una tarjeta por cada servicio en el que se atendió al paciente.

### 7.3 Las visitas y sus pestañas

![Pestañas de una visita](img/std-44-visitas-pestanas.png)
*1 Pestañas: Admisión, cada consulta y Progreso · 2 Acciones de la visita: Editar, Imprimir, Ficha.*

Cada visita tiene una pestaña **Admisión** (lo que se capturó el primer día) y una pestaña por cada **consulta de seguimiento** («Consulta 1», «Consulta 2»…). En Control de peso hay además **Progreso**.

![Una consulta de seguimiento](img/std-45-consulta-seguimiento.png)
*Una consulta de seguimiento de Control de peso: se ve la fecha, quién la capturó, las notas y los datos de la sesión.*

### 7.4 Registrar una consulta de seguimiento

![Nueva consulta](img/std-47-nueva-consulta.png)

1. En el expediente, pulsa **+ Nuevo**.
2. Elige el **episodio** (la visita de servicio a la que pertenece la consulta).
3. Captura los datos que pide ese servicio. En **Control de peso**, la **talla** viene de la admisión y **no se edita aquí**; el peso y el IMC se calculan con ella.
4. Escribe **Notas de evolución** (opcional pero recomendado).
5. Pulsa **Guardar consulta**.

**Control de peso trabaja en dos etapas.** La primera la captura quien toma las mediciones (enfermería, nutrición). Esa consulta queda marcada **«Pendiente médico»**. El **responsable asignado** (o un administrador) la abre y pulsa **Consolidar** para completar la **parte médica** (consulta médica y firma de conformidad). Hasta entonces la consulta se considera **incompleta**.

En **Fisioterapia** y **Podología**, Sirius te sugiere el **número de sesión** (las consultas previas del episodio más uno).

### 7.5 Ver el progreso (Control de peso)

![Progreso con gráficas](img/std-46-progreso-graficas.png)

La pestaña **Progreso** muestra:

- una **gráfica de evolución** de la medida que elijas en el selector (peso, IMC, perímetros, pliegues, grasa, músculo, agua, etc.), con el valor sobre cada punto y el **cambio desde la admisión** («−3.9 kg»);
- **tablas comparativas** por grupo (antropometría, bioimpedancia, signos vitales…) con una columna por visita y la columna **Cambio**.

En la columna **Cambio**, lo que **bajó** se muestra en **verde** y lo que **subió** en **ámbar**; Sirius no juzga si subir es bueno o malo (por ejemplo, subir masa muscular es deseable). Los valores se grafican en sus **unidades reales**. Una medida solo aparece en la gráfica cuando se ha capturado **al menos en dos visitas**.

### 7.6 Entrega de resultados (Laboratorio)

En la visita de laboratorio ves los **estudios realizados** con su monto, la historia clínica y los síntomas. Ahí mismo se ve la **Entrega estimada** y el botón **«Marcar como entregado»**; al pulsarlo se registra la entrega (y puedes **deshacerla** si te equivocaste).

![Expediente de laboratorio](img/std-48-expediente-laboratorio.png)
*1 Editar la admisión · 2 Imprimir (abre la ficha).*

### 7.7 Imprimir: la ficha y el consentimiento

**Laboratorio.** El botón **Imprimir** de la visita abre la **ficha de identificación** en PDF: **tres hojas**.

| Hoja 1 · Ficha | Hoja 2 · Consentimiento | Hoja 3 · Aviso de privacidad |
|---|---|---|
| ![](img/std-49-ficha-p1.png) | ![](img/std-49-ficha-p2.png) | ![](img/std-49-ficha-p3.png) |

1. **Ficha de identificación básica:** folio, datos del paciente, historia clínica, médico, síntomas, medicamentos, estudios, método de pago y monto, y **la firma del paciente**.
2. **Consentimiento informado** para la toma de muestra y los estudios de laboratorio, **con la misma firma**.
3. **Aviso de privacidad** completo, en hoja aparte, con el pie corporativo.

Imprímelo desde el visor de tu navegador (**Ctrl + P**). Una admisión de laboratorio **siempre se imprime sola**: nunca dentro de un historial con otras visitas.

**Otros servicios.** En Control de peso, Fisioterapia y Podología, la pestaña de la visita ofrece **Imprimir** (la visita completa con sus consultas) y **Ficha**; cada consulta tiene su propio **Imprimir**. El botón **PDF** del encabezado del paciente imprime sus visitas de estos servicios en un solo documento.

![Primera hoja del PDF de una visita de Control de peso](img/adm-142-expediente-visita-p1.png)

> **Correo con la ficha.** Si el correo saliente está activo, aparece **«Reenviar ficha»** en la visita de laboratorio, por si el envío automático falló o el paciente la perdió.

### 7.8 Dx Assist (apoyo diagnóstico con IA)

Si el administrador te dio el privilegio **Dx Assist**, el expediente muestra el botón **Dx Assist**. Abre un panel que **analiza el expediente** y propone un diagnóstico diferencial; puedes hacerle preguntas de seguimiento.

![Dx Assist](img/std-52-dx-assist.png)

> **Importante.** Dx Assist es un **apoyo**: la decisión clínica es siempre del médico tratante. Solo funciona si el administrador **activó el asistente de IA** (Admin Tools → API). Si no está activado, Sirius te lo dice con este mensaje.

---

## 8. Tareas

El módulo **Tareas** organiza el trabajo del equipo. Tiene tres pestañas.

![Mis tareas](img/std-60-tareas-mis-tareas.png)
*1 Mis tareas · 2 Proyectos · 3 Resultados · 5 Nueva tarea · 6 Filtro de estado · 7 Filtro de proyecto.*

### 8.1 Mis tareas

Muestra tus tareas **agrupadas por fecha límite**: prioridad alta, con fecha para hoy, para mañana y posteriores, con colores según urgencia. Con los filtros (6, 7) las acotas por estado y proyecto.

- **Completar una tarea:** pulsa el **círculo** de la izquierda. En una tarea frecuente, se marca como hecha **por este periodo** y volverá a aparecer en el siguiente.
- **Estados:** *Pendiente*, *En progreso* y *Completada*.
- **Prioridades:** *Baja*, *Media*, *Alta* y *Urgente*.
- **Tareas frecuentes:** pueden repetirse **a diario** o **cada semana** (en la semanal eliges el **día de corte**).
- **Subtareas:** el **+** de una tarea agrega una subtarea (solo un nivel).

### 8.2 Crear una tarea

![Nueva tarea](img/std-61-tarea-nueva.png)

Pulsa **Nueva tarea**, escribe el **título** y, si quieres, descripción, prioridad, fecha límite, repetición y proyecto. Como usuario estándar tus tareas son **personales** (quedan asignadas a ti). Quien tiene el privilegio de **gestionar tareas** puede asignarlas a otras personas.

> Solo puedes **editar o eliminar las tareas que tú creaste**. Lo que eliminas va a la **papelera** del administrador, que puede recuperarlo.

### 8.3 Proyectos

![Proyectos](img/std-62-tareas-proyectos.png)
![Detalle de un proyecto](img/std-63-proyecto-detalle.png)

Un **proyecto** agrupa varias tareas con una fecha límite y una **barra de avance**. Entra a uno para ver sus tareas y el porcentaje completado. Crear o editar proyectos requiere el privilegio de gestión de tareas.

### 8.4 Resultados por entregar

![Resultados por entregar](img/std-64-tareas-resultados.png)
*1 Nuevos resultados · 2 Tarjeta de un paciente con su lista de estudios.*

Es una **lista de verificación de entregas** de resultados de laboratorio: cada tarjeta es un paciente con sus estudios.

1. **Nuevos resultados** (1) y captura el **nombre del paciente** (puedes buscarlo entre los registrados), la **toma de muestra**, la **fecha de entrega** y los **estudios a enviar**.
2. Conforme tengas listo cada estudio, **marca su casilla**; la tarjeta muestra el avance (por ejemplo 2/3).
3. Si el paciente pidió factura, marca **Solicitar factura** y luego **Factura enviada**.
4. Agrega **observaciones** si hace falta («urgente, el pediatra espera el resultado»).

![Nuevos resultados](img/std-65-resultado-nuevo.png)

Las tarjetas se agrupan por **fecha de entrega** («mañana», «posteriores») para que sepas qué sale primero.

---

## 9. Inventario

Controla el material y los reactivos **por lote**, con aviso de caducidad y de stock bajo.

![Inventario](img/std-70-inventario.png)
*1 Alertas · 2 Buscador · 3 Categoría · 4 Escanear · 5 Salida de artículo · 6 Añadir artículo · 7 Nuevo artículo (solo quien administra el catálogo) · 8 Tarjetas de artículos.*

### 9.1 Leer la lista

Cada tarjeta muestra el artículo, su categoría y unidad, la **existencia** (número grande), el **mínimo** y la **caducidad más próxima**. Las etiquetas de color avisan:

- **Stock bajo:** la existencia está por debajo del mínimo.
- **Caduca en N d:** hay un lote que caduca en los **próximos 30 días**.
- **Caducado:** hay un lote vencido con existencia.

Las alertas (1) resumen cuántos artículos están en cada caso; **pulsa una para filtrar la lista** a esos artículos y **«Quitar filtro»** para volver a verla completa.

### 9.2 Registrar una salida (lo que más usarás)

![Salida de artículo](img/std-71-inventario-salida.png)

1. Pulsa **Salida de artículo**.
2. Elige el **motivo** (*Uso clínico*, *Merma*, *Caducado* o *Ajuste de conteo*). Se aplica a todo lo que registres hasta que lo cambies.
3. **Escanea** el código de barras con un lector USB (el lector escribe el código y pulsa Enter solo) o **busca manualmente** por nombre o código.
4. Cada registro se anota en **«Escaneado en esta sesión»**.

La salida descuenta del **lote que caduca primero** (método PEPS: «primero en caducar, primero en salir»), así no se te vence material.

### 9.3 Registrar una entrada

Con **Añadir artículo** registras mercancía que llega: eliges el artículo (por escaneo o búsqueda) y capturas la cantidad, la caducidad y, si quieres, número de lote, costo y proveedor.

![Entrada de artículo](img/std-72-inventario-entrada.png)

### 9.4 El detalle de un artículo

![Detalle de artículo](img/std-74-inventario-articulo.png)
*1 Entrada · 2 Salida · 3 Editar (solo con privilegio de gestión).*

Muestra la **existencia**, el mínimo, la **próxima caducidad**, los **lotes en orden PEPS** y los **movimientos recientes**.

> **Qué requiere privilegio de gestión del inventario:** crear artículos nuevos, editar el catálogo, desactivar artículos y corregir o borrar lotes. Sin él, **sí puedes registrar entradas y salidas**.

---

## 10. Pizarrón

Un lienzo libre de **notas adhesivas**, **listas** y **dibujos**. Tiene dos tableros:

- **Mi pizarrón:** privado, solo tú lo ves.
- **Pizarrón público:** lo ve todo el equipo. Cualquiera agrega; **solo el autor edita y borra lo suyo** (salvo quien tiene el privilegio de gestión del pizarrón).

![Pizarrón público](img/std-80-pizarron-publico.png)
*1 Mi pizarrón · 2 Pizarrón público · 3 Nota · 4 Dibujo · 5 Zoom · 6 Desplazamiento.*

### 10.1 Crear y mover

- **+ Nota** crea una nota adhesiva; **+ Dibujo**, un recuadro de dibujo a mano alzada.
- **Arrastra** una tarjeta desde su barra superior para moverla; arrastra la **esquina inferior derecha** para cambiar su tamaño.
- Cambia el **color** con el botón de color de la barra de la nota. Cada tarjeta se guarda **sola**.
- Con la barra de herramientas navegas: **cruceta** (mover tarjetas), **mano** (desplazar el lienzo), **lupa** (acercar); **−**/**+** para el zoom y las flechas para desplazarte.

### 10.2 Escribir en una nota

![Editor de notas](img/std-81-pizarron-nota-editor.png)

Haz clic dentro de la nota y escribe. Aparece una **barra de formato a la izquierda** con:

- **tipografía** y **color del texto**;
- **tamaño** (A− y A+);
- **negrita**, *cursiva* y subrayado;
- **lista de pendientes** con casillas;
- **alineación** (izquierda, centro, derecha, justificado);
- **insertar imagen** (también puedes **pegar una imagen** del portapapeles con **Ctrl + V**).

Para borrar una imagen, usa la **✕** que aparece sobre ella; Sirius te da unos segundos para **deshacerlo**.

### 10.3 Compartir una tarjeta como imagen

El icono de **compartir** de la barra de una tarjeta la convierte en una **imagen PNG**:

![Compartir como imagen](img/std-82-pizarron-compartir.png)

> **Cuidado.** Una imagen compartida **sale de Sirius** y **no se puede recoger** una vez enviada. Revisa que no incluya datos de pacientes u otra información que no deba salir. Sirius te lo recuerda en el aviso amarillo.

Puedes **Descargar**, **Copiar imagen** o **Compartir** (en teléfonos, con el menú de compartir de tu sistema).

Lo que elimines se va a la **papelera** del administrador.

---

## 11. Archivos

Gestor de archivos con dos áreas: **Mis archivos** (privada) y **Carpeta compartida** (todo el equipo).

![Archivos](img/std-90-archivos.png)
*1 Mis archivos · 2 Carpeta compartida · 3 Carpeta nueva · 4 Subir archivo · 5 Ruta de carpetas · 6 Modo de vista.*

![Dentro de una carpeta](img/std-91-archivos-carpeta.png)
*1 Archivo · 2 Ruta (clic en un nivel para subir).*

- **Subir archivo:** botón o **arrastrar y soltar** (límite de **25 MB** por archivo).
- **Carpeta:** crea carpetas anidadas.
- El menú **⋮** de cada archivo o carpeta permite **copiar, cortar, pegar, renombrar, borrar y compartir**. **Compartir** hace una **copia en la Carpeta compartida**, para que el resto del equipo la vea; tu original se queda en Mis archivos. Puedes **seleccionar varios** y operar en bloque.
- El **modo de vista** (lista, mosaicos…) se recuerda en tu navegador.
- Los archivos se guardan con seguridad: solo se abren **con tu sesión** y tus permisos.

> **Borrar en la carpeta compartida.** Cada quien borra lo suyo; borrar archivos ajenos requiere el privilegio correspondiente.

---

## 12. Calendario

La agenda del equipo, por **día**, **semana** o **mes**.

![Calendario del mes](img/std-100-calendario.png)
*1 Mes anterior · 2 Hoy · 3 Mes siguiente · 4 Vista (Día / Semana / Mes) · 5 Nueva cita · 6 Una cita.*

![Vista semanal](img/std-103-calendario-semana.png)

- **Citas** por servicio (cada servicio con su color): Laboratorio, Control de peso, Fisioterapia, Podología, Recolección u Otro.
- **Chips de tareas:** las tareas con fecha límite aparecen también en el calendario.
- Como usuario estándar ves **tus citas** y las generales; quien tiene privilegio de gestión del calendario ve y edita las de todos.

### 12.1 Crear una cita

![Nueva cita](img/std-101-cita-nueva.png)

1. Pulsa **Nueva cita**, o el **+** que aparece al pasar el cursor sobre un día del mes (la cita ya trae esa fecha).
2. Escribe el **título o motivo**, elige el **servicio** y el **responsable asignado**.
3. Indica **fecha**, **hora de inicio** y **hora de fin**.
4. Opcional: **ubicación** (por ejemplo, el domicilio de una toma), **paciente vinculado** (búscalo por nombre, folio o teléfono) y **notas**.
5. **Invitados externos:** agrega correos de personas sin cuenta en Sirius; reciben la invitación por **Google Calendar** (si el administrador conectó la cuenta de Google).
6. **Guardar.**

Al asignar una cita a otra persona, **a ella le llega una notificación**.

![Detalle de una cita](img/std-102-cita-detalle.png)

Una cita se puede **cancelar** desde su detalle. Si Google Calendar falla en un momento dado, **la cita se guarda igual en Sirius**.

---

## 13. WhatsApp

Bandeja **compartida** de los mensajes de WhatsApp de la clínica.

![WhatsApp](img/std-110-whatsapp.png)
*1 Buscador · 2 Filtros · 3 Lista de conversaciones · 4 Mensajes · 5 Escribir · 6 Adjuntar · 7 Enviar.*

- La lista muestra cada conversación con su **estatus**, **prioridad** y quién la atiende; el globo azul indica **mensajes sin leer**.
- Elige una conversación para ver el chat y **responder** (texto, emojis, archivos adjuntos y reacciones).
- Se actualiza sola cada pocos segundos.

![Panel de la conversación](img/std-111-whatsapp-panel.png)
*2 Estatus · 3 Prioridad · 4 Vincular paciente.*

- **Estatus** (por ejemplo: Pendiente de responder, Cita realizada, Resultados enviados) y **Prioridad**: ayudan a que nadie se quede sin respuesta.
- **Vincular paciente:** relaciona la conversación con un expediente.
- **Respuestas rápidas** (el icono de bandera junto al cuadro de texto): mensajes frecuentes para insertar con un clic.

![Respuestas rápidas](img/std-112-whatsapp-respuestas-rapidas.png)

![Vincular paciente](img/std-113-whatsapp-vincular-paciente.png)

> **Regla de WhatsApp de las 24 horas.** Solo puedes **responder texto libre dentro de las 24 horas siguientes al último mensaje del cliente**. Pasado ese tiempo, WhatsApp solo permite plantillas aprobadas por Meta (se envían desde Meta Business Manager). Si Sirius te dice «han pasado más de 24 h», espera a que el cliente vuelva a escribir.

Quien tiene el privilegio de gestión de WhatsApp ve y asigna las conversaciones de todos; sin él, ves las que te asignaron o que no tienen responsable.

---

## 14. Apps

**Apps** es un cajón con herramientas especializadas. Cada una requiere su propio privilegio; verás solo las que te habilitaron.

![Apps](img/std-120-apps.png)

### 14.1 Membretador

Emite **estudios y documentos con membrete** de la clínica (encabezado, pie, marca de agua y firma). Eliges el tipo de documento (**Análisis clínicos**, **Biología molecular** o **Documentos**) y luego el estudio.

![Membretador](img/std-127-membretador.png)
![Categoría del membretador](img/std-127b-membretador-categoria.png)

Los documentos pasan por **borrador**, **revisión** y **liberación**: quien tiene el privilegio de **revisar** puede liberarlos. Los estudios en borrador generan una alerta en el Dashboard de quien los revisa.

### 14.2 Cotizador

Arma **cotizaciones** con el catálogo de precios.

![Lista de cotizaciones](img/std-121-cotizador-lista.png)

1. **Nueva cotización.**
2. Opcional: busca a un **paciente registrado**, o escribe el nombre, teléfono y dirección del cliente (por defecto «Público en General»).
3. **Busca estudios** en el catálogo y agrégalos; ajusta las **cantidades**.
4. Aplica un **descuento (%)** si corresponde y agrega **notas**.
5. **Guardar.** Cada cotización tiene un **folio**; desde la lista puedes **verla** o **descargar el PDF**.

![Nueva cotización](img/std-122-cotizador-nueva.png)
![Buscar estudios](img/std-123-cotizador-buscar.png)

El PDF lleva el **membrete** configurado, las partidas con su cantidad y precio, el **subtotal**, el **descuento** y el **total**, y tus notas al pie:

![PDF de una cotización](img/adm-140-cotizacion-p1.png)

El **tiempo de entrega** y el **espécimen** de cada estudio quedan **copiados** en la cotización: si después cambia el catálogo, las cotizaciones ya entregadas **no cambian**.

### 14.3 Comisiones

Calcula lo que corresponde a los **médicos con convenio** y a su **concierge** por los estudios que refirieron.

![Comisiones](img/std-125-comisiones.png)

- La **tasa** del médico depende del tipo de estudio (**Biología molecular** o **Análisis clínicos**); el concierge gana un **porcentaje propio** sobre el mismo monto. Las tasas las define el administrador.
- **Nuevo estado de cuenta:** eliges médico (o concierge) y el **periodo**, pulsas **Vista previa**, revisas las líneas (puedes **incluir o excluir** una línea del cálculo) y **generas** el estado de cuenta, que queda con folio y se puede descargar en PDF.
- También puedes **pegar una lista en imagen** (la IA la lee y la cruza contra Sirius) o hacer un **registro manual**.

![Nuevo estado de cuenta](img/std-128-comisiones-nuevo.png)

### 14.4 Cobertura

Consulta pública para saber **si la unidad móvil llega a una zona**: escribe el **código postal**.

![Cobertura](img/std-124-cobertura.png)
*1 Código postal · 2 Resultado: municipio, colonias y si tiene cobertura, con el mapa.*

El resultado dice **«Con cobertura»**, **«Sin cobertura»** o si la zona tiene **costo extra**, y muestra las colonias del código postal y su ubicación.

### 14.5 Marketing

Panel para **planear las publicaciones en redes sociales** (no publica por sí mismo).

![Marketing](img/std-126-marketing.png)

Calendario en vistas **Mes**, **Semana** y **Día**, con filtros por red (Facebook, Instagram, TikTok, Google Ads), la vista **Lista** y el **Portafolio** de recursos. Cada publicación tiene fecha, categoría, estatus (*Idea*, *Diseño*, *Programada*, *Publicada*), redes, color y caption.

![Nueva publicación](img/std-129-marketing-nueva.png)

---

## 15. Asistente Sirius

La **burbuja** de abajo a la derecha abre un asistente de chat que responde preguntas sobre el uso del sistema y de tu trabajo en la clínica.

![Asistente Sirius](img/std-05-asistente.png)
*1 Panel del asistente · 2 Cuadro de mensaje.*

- Escribe tu pregunta o, si tu navegador lo permite, **dícsela por voz** (botón del micrófono). Las respuestas se pueden **escuchar** con el botón de bocina; nada se lee solo.
- La conversación **se conserva mientras no recargues la página**.
- El asistente existe **solo si el administrador lo activó** (Admin Tools → API). Si no, no responde.

> No escribas en el asistente datos que no deban salir de la clínica: sus respuestas las genera un servicio de inteligencia artificial externo.

---

## 16. Tu perfil y tu configuración

### 16.1 Perfil

![Perfil](img/std-130-perfil.png)

**Perfil** (menú de tu nombre) es **tu ficha de empleado**, solo de lectura: tus datos de contacto, correo institucional, fecha de inicio y **tiempo con la clínica**, tu **jornada laboral** y tus **vacaciones** (cuántos días te corresponden, cuántos has tomado con su desglose por fechas y cuántos te quedan).

- Lo captura y mantiene **el administrador**; si algo no es correcto, avísale.
- El administrador decide **qué datos ves**. Si algo no aparece, es porque no lo habilitó.
- Si aún no te han configurado el perfil, lo dice la propia pantalla.

### 16.2 Configuración

![Configuración](img/std-131-configuracion.png)

- **Personalización:** elige el **color** del menú lateral y de tu Dashboard entre ocho colores. Es solo para ti.
- **Logotipos de la aplicación:** los gestiona el administrador.
- **Instalar aplicación** y **Buscar actualizaciones** (siguientes apartados).

### 16.3 Instalar Sirius como app

- **Android / Chrome, Edge y computadora:** en **Configuración → Instalar aplicación**, pulsa el botón; el navegador te pedirá confirmar. Sirius aparecerá con su icono, sin barra de direcciones.
- **iPhone y iPad:** Apple no permite la instalación automática. Desde **Safari**: toca **Compartir** (el cuadro con la flecha hacia arriba) → **«Agregar a pantalla de inicio»** → **Agregar**.

### 16.4 Buscar actualizaciones

Sirius se mejora seguido. Para tener siempre la versión nueva, entra a **Configuración → Buscar actualizaciones**. Si hay una, Sirius la prepara y te pide confirmar para recargar. Hazlo **cuando no estés a media captura**.

---

## 17. Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| No veo un módulo | No tienes ese permiso. Pídeselo al administrador. |
| «No tienes acceso a este expediente» | Esa visita está asignada a otra persona. Pídele al administrador que la reasigne o la deje en «General». |
| La pantalla se ve vieja o falta algo nuevo | Pulsa **Actualizar** (arriba) y, si sigue, **Configuración → Buscar actualizaciones**. |
| Me sacó del sistema | La sesión caducó. Vuelve a entrar. Marca «Recuérdame» solo en tu propio equipo. |
| «Demasiados intentos. Espera 5 minutos» | Fallaste la contraseña 5 veces. Espera 5 minutos o pide que te la restablezcan. |
| No recibo notificaciones | Campana → **Activar notificaciones** y luego **Enviar notificación de prueba**. Revisa el permiso del sitio en el navegador. |
| No puedo responder en WhatsApp («más de 24 h») | Es una regla de WhatsApp: espera a que el cliente escriba de nuevo. |
| El paciente no recibió la ficha por correo | Revisa que el correo esté bien escrito. En la visita, pulsa **Reenviar ficha**. Si no aparece, el correo saliente no está activado: avisa al administrador. |
| Capturé algo mal en una admisión | Expediente → pestaña **Admisión** → **Editar** (con el privilegio de edición). |
| Borré algo por error (tarea, nota, archivo) | Avisa al administrador: puede **recuperarlo desde la papelera**. |
| El mapa de Cobertura no carga | Recarga la página; si continúa, avisa al administrador. |

---

## 18. Glosario

| Término | Significado |
|---|---|
| **Admisión** | El primer registro de un paciente en un servicio. Abre una *visita*. |
| **Visita (o episodio)** | Un servicio abierto para un paciente (por ejemplo, su Control de peso). Contiene la admisión y sus consultas. |
| **Consulta de seguimiento** | Una sesión posterior a la admisión, dentro de la misma visita. |
| **Ficha de identificación** | PDF con los datos de la admisión; en laboratorio incluye el consentimiento y el aviso de privacidad. |
| **Folio del paciente** | Número del expediente (`BP-AAAA-NNNN`). |
| **Folio de orden** | Número de la orden de laboratorio (`AAMMDD-NN`). |
| **Responsable asignado** | Persona que atiende al paciente y, junto con los administradores, ve su expediente. |
| **Módulo** | Cada sección del menú (Admisión, Expedientes, Tareas…). |
| **Privilegio** | Permiso extra dentro de un módulo (por ejemplo, «gestionar» el inventario). |
| **PEPS** | «Primero en caducar, primero en salir»: la salida de inventario descuenta del lote que caduca antes. |
| **Papelera** | Donde van las cosas eliminadas. Solo un administrador las recupera. |
| **PWA / app instalada** | Sirius instalado en el dispositivo como una aplicación. |
