# Documentación de arquitectura de Sirius

Esta carpeta documenta **qué es Sirius, cómo está construido y qué se rescata de él** para un producto nuevo.

No es documentación de usuario ni referencia de API. Está escrita para una audiencia muy concreta: alguien (o algo) que llega sin contexto y necesita entender la arquitectura sin leer 38,000 líneas de código.

> Estos documentos viven fuera de `public/`, así que **no se despliegan**. `.cpanel.yml` solo sincroniza `public/` al servidor.

---

## Por qué existe esta carpeta

Sirius se construyó como el sistema de gestión de un laboratorio y clínica específicos (Bosques Polanco). Pero después de 38,000 líneas resultó que **la mayor parte de lo construido no tiene nada de clínico**: tareas, archivos, pizarrón, inventario por lotes, bandeja de WhatsApp, calendario, permisos, papelera, respaldos, auditoría, planeación de contenido.

La idea es construir desde cero una versión comercial, vendida por suscripción, para distintos giros — restaurantes, hospitales, clínicas, tiendas, librerías, cualquier negocio chico que necesite un ERP ligero. Ese trabajo arranca en un proyecto nuevo y limpio, pero **rescatando las bases que aquí ya funcionan y están probadas en producción**.

Esta documentación es el puente entre las dos cosas.

---

## Los documentos

Están numerados porque el orden de lectura importa.

| # | Documento | Qué contiene | Léelo si… |
|---|---|---|---|
| 01 | [Arquitectura](01-arquitectura.md) | El núcleo: configuración, sesión, permisos, papelera genérica, capa de IA, front controller, SPA. Con firmas de función reales. | Siempre. Es la base de todo lo demás. |
| 02 | [Modelo de datos](02-modelo-de-datos.md) | Las 47 tablas por dominio, y los tres patrones de esquema (doble motor, migraciones, seeds). | Vas a diseñar el esquema nuevo. |
| 03 | [Módulos](03-modulos.md) | Los 23 módulos: qué hace cada uno, sus acciones, sus permisos, y **qué tan rescatable es**. | Quieres saber qué ya existe y no reinventar. |
| 04 | [Patrones reusables](04-patrones-reusables.md) | Los 23 patrones transversales, cada uno con el archivo donde mejor se ve. | **El documento más valioso.** Son decisiones ya validadas. |
| 05 | [Operación y despliegue](05-operacion-y-despliegue.md) | Build sin Node, CI, service worker, instalador, seguridad de archivos, y qué restricciones vienen del hosting compartido. | Vas a montar la infraestructura del producto nuevo. |
| 06 | [El producto nuevo](06-producto-nuevo.md) | **Propuesta, no descripción.** Qué rescatar, multi-tenant, multi-giro, suscripciones, y los errores conocidos que no hay que repetir. | Siempre, junto con el 01. |

**Del 01 al 05 son descriptivos**: describen lo que Sirius *es* hoy, y son verificables contra el código.
**El 06 es prescriptivo**: es una propuesta de diseño, con opiniones. Está marcado como tal en el propio documento.

---

## Cómo usar esto en un chat nuevo

Copia y pega algo así al arrancar:

```
Voy a construir un ERP comercial multi-giro (restaurantes, clínicas, tiendas,
cualquier negocio chico) vendido por suscripción. No parto de cero conceptualmente:
ya tengo un sistema en producción llamado Sirius del que quiero rescatar las bases.

Antes de proponer nada, lee docs/01-arquitectura.md y docs/06-producto-nuevo.md.
Si vas a tocar el esquema, lee también docs/02-modelo-de-datos.md.
Si vas a construir pantallas, lee docs/04-patrones-reusables.md.

Lo que quiero conservar de Sirius es el enfoque, no el código literal: sin
frameworks pesados, sin dependencias externas de JS, un núcleo chico y módulos
encima. Lo que NO quiero repetir está listado en la última sección del 06.
```

Un detalle importante para ese chat: **estos documentos son un retrato de un momento**. Si Sirius sigue cambiando, el código manda sobre lo que aquí se diga.

---

## Sirius en cifras

Todas verificadas contra el código, no estimadas.

| | |
|---|---|
| **PHP** (sin `vendor/`) | 20,999 líneas |
| **JavaScript** | 17,525 líneas |
| **Total** | ~38,500 líneas |
| Tablas en el esquema | 47 (definidas dos veces: MySQL y SQLite) |
| Módulos registrados | 23 |
| Handlers de API | 32 archivos, 33 rutas |
| Archivos de módulo JS | 24 (23 módulos + `wizard_admision.js`, variante de Admisión) |
| Dependencias de backend | **0** — sin Composer, sin framework |
| Dependencias de frontend | **0** — sin bundler, sin librerías, sin CDN |

### El dato que enmarca todo lo demás

El "framework" completo de Sirius son **1,382 líneas**:

| Capa | Archivos | Líneas |
|---|---|---|
| Núcleo JS | `app.js` + `router.js` + `api.js` + `ui.js` | 796 |
| Núcleo PHP | `db` + `auth` + `permissions` + `csrf` + `response` + `log` + `api/index.php` | 586 |

Las otras ~37,000 líneas son módulos construidos encima. Todo módulo nuevo cuesta **tres archivos y cero cambios al núcleo**.

Eso es lo que se rescata: no el código clínico, sino la forma.
