<?php
/**
 * Registro central de módulos de Sirius.
 * Agregar un módulo en fases futuras = 1 entrada aquí + 1 JS en assets/js/modules/
 * + (si aplica) 1 handler en api/handlers/. El núcleo no se toca.
 *
 * 'flags' declara privilegios extra configurables por usuario en la matriz de permisos.
 * 'group' => 'admin_tools' agrupa el módulo bajo Admin Tools en el sidebar.
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
            'review'      => 'Revisar y liberar estudios',
            'delete'      => 'Eliminar estudios membretados',
        ],
    ],
    'usuarios' => [
        'label' => 'Usuarios',
        'icon'  => 'users',
        'phase' => 1,
        'group' => 'admin_tools',
    ],
    'membretes' => [
        'label' => 'Membretes',
        'icon'  => 'image',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
    'log' => [
        'label' => 'Log',
        'icon'  => 'list',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
    'backup' => [
        'label' => 'Backup',
        'icon'  => 'database',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
    'api' => [
        'label' => 'API',
        'icon'  => 'sparkles',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
    'catalogo_estudios' => [
        'label' => 'Catálogo de Estudios',
        'icon'  => 'flask',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
    'vinculacion' => [
        'label' => 'Vinculación',
        'icon'  => 'link',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
    'plantillas_estudios' => [
        'label' => 'Plantillas de Estudios',
        'icon'  => 'clipboard',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
    'whatsapp_config' => [
        'label' => 'WhatsApp: Configuración',
        'icon'  => 'settings',
        'phase' => 2,
        'group' => 'admin_tools',
    ],
];
