<?php
/**
 * Registro central de módulos de Sirius.
 * Agregar un módulo en fases futuras = 1 entrada aquí + 1 JS en assets/js/modules/
 * + (si aplica) 1 handler en api/handlers/. El núcleo no se toca.
 *
 * 'flags' declara privilegios extra configurables por usuario en la matriz de permisos.
 * 'group' => 'admin_tools' lo agrupa bajo Admin Tools: una sola entrada del sidebar que abre un panel
 * de tarjetas (assets/js/modules/admin_tools.js). 'description' es el texto de su tarjeta.
 */
return [
    'dashboard' => [
        'label' => 'Dashboard',
        'icon'  => 'home',
        'phase' => 1,
    ],
    'admision' => [
        'label' => 'Admisión',
        'icon'  => 'user-plus',
        'phase' => 1,
        'flags' => [
            // Pensado para los recolectores a domicilio: una pregunta por pantalla
            // y sólo los campos indispensables, en vez del formulario completo.
            'wizard' => 'Formulario simplificado paso a paso (recolectores)',
        ],
        // 'wizard' recorta la interfaz en vez de ampliarla, así que no se hereda
        // por el rol: un administrador quedaría encerrado en el asistente.
        'mode_flags' => ['wizard'],
    ],
    'expedientes' => [
        'label' => 'Expedientes',
        'icon'  => 'folder',
        'phase' => 1,
        'flags' => [
            'dx_assist' => 'Dx Assist',
            'edit'      => 'Editar expedientes',
            'delete'    => 'Eliminar expedientes',
        ],
    ],
    'inventario' => [
        'label' => 'Inventario',
        'icon'  => 'package',
        'phase' => 2,
        'flags' => [
            'manage' => 'Gestionar catálogo, lotes y ajustes',
        ],
    ],
    'tareas' => [
        'label' => 'Tareas',
        'icon'  => 'check-square',
        'phase' => 2,
        'flags' => [
            'manage' => 'Gestionar y asignar tareas',
        ],
    ],
    'pizarron' => [
        'label' => 'Pizarrón',
        'icon'  => 'clipboard',
        'phase' => 2,
        'flags' => [
            'manage' => 'Editar o borrar notas de cualquiera en el pizarrón público',
        ],
    ],
    'archivos' => [
        'label' => 'Archivos',
        'icon'  => 'folder-open',
        'phase' => 2,
        'flags' => [
            'delete_shared' => 'Eliminar archivos de la carpeta compartida',
        ],
    ],
    'calendario' => [
        'label' => 'Calendario',
        'icon'  => 'calendar',
        'phase' => 2,
        'flags' => [
            'manage' => 'Gestionar y cancelar citas de cualquier usuario',
        ],
    ],
    'whatsapp' => [
        'label' => 'WhatsApp',
        'icon'  => 'chat',
        'phase' => 2,
        'flags' => [
            'manage' => 'Ver y reasignar todas las conversaciones',
        ],
    ],
    'apps' => [
        'label' => 'Apps',
        'icon'  => 'grid',
        'phase' => 2,
        'flags' => [
            'membretador' => 'Usar el Membretador',
            'cotizador'   => 'Usar el Cotizador',
            'comisiones'  => 'Usar Comisiones',
            'cobertura'   => 'Usar Cobertura',
            'marketing'   => 'Usar Marketing',
            'review'      => 'Revisar y liberar estudios',
            'delete'      => 'Eliminar estudios membretados',
        ],
    ],
    'usuarios' => [
        'label' => 'Usuarios',
        'icon'  => 'users',
        'phase' => 1,
        'group' => 'admin_tools',
        'description' => 'Crea usuarios, asigna roles y define a qué módulos accede cada persona.',
    ],
    'empleados' => [
        'label' => 'Empleados',
        'icon'  => 'briefcase',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Fichas del personal: contacto, jornada, antigüedad y vacaciones.',
    ],
    'membretes' => [
        'label' => 'Membretes',
        'icon'  => 'image',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Encabezado, pie, marca de agua y firmas de los PDF que se imprimen.',
    ],
    'log' => [
        'label' => 'Log',
        'icon'  => 'list',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Bitácora de actividad: quién hizo qué y cuándo.',
    ],
    'backup' => [
        'label' => 'Backup',
        'icon'  => 'database',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Exporta y restaura respaldos de la base de datos.',
    ],
    'api' => [
        'label' => 'API',
        'icon'  => 'sparkles',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Conexiones externas: inteligencia artificial, correo, calendario y WhatsApp.',
    ],
    'catalogo_estudios' => [
        'label' => 'Catálogo de Estudios',
        'icon'  => 'flask',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Lista de precios de los estudios, con importación y exportación.',
    ],
    'vinculacion' => [
        'label' => 'Vinculación',
        'icon'  => 'link',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Médicos con convenio, concierges y tasas de comisión.',
    ],
    'cobertura' => [
        'label' => 'Cobertura',
        'icon'  => 'map-pin',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Zonas y códigos postales donde llega el servicio a domicilio.',
    ],
    'papelera' => [
        'label' => 'Papelera',
        'icon'  => 'trash',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Recupera o elimina definitivamente lo que se borró.',
    ],
    'plantillas_estudios' => [
        'label' => 'Plantillas de Estudios',
        'icon'  => 'clipboard',
        'phase' => 2,
        'group' => 'admin_tools',
        'description' => 'Qué determinaciones lleva cada estudio y sus rangos de referencia.',
    ],
    'whatsapp_config' => [
        'label'  => 'WhatsApp: Configuración',
        'icon'   => 'settings',
        'phase'  => 2,
        'group'  => 'admin_tools',
        // Se alcanza desde una tarjeta en Admin Tools > API, no como entrada propia
        // del sidebar — mismos "servicios externos" que ya agrupa esa pantalla.
        'hidden' => true,
    ],
    'configuracion' => [
        'label'  => 'Configuración',
        'icon'   => 'settings',
        'phase'  => 2,
        // Se alcanza desde el menú del avatar, no del sidebar — y ver ALWAYS_AVAILABLE_MODULES
        // en permissions.php: disponible para cualquier usuario, sin fila de permiso.
        'hidden' => true,
    ],
    'perfil' => [
        'label'  => 'Perfil',
        'icon'   => 'user',
        'phase'  => 2,
        // Se alcanza desde el menú del avatar (como 'configuracion') y está en
        // ALWAYS_AVAILABLE_MODULES: cada persona ve su propia ficha sin fila de permiso.
        'hidden' => true,
    ],
];
