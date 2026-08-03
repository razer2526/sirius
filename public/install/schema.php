<?php
/**
 * Esquema de Sirius: creación de tablas + migraciones idempotentes.
 * Compartido por el asistente visual (index.php, primera instalación) y por
 * setup.php (?key=..., para aplicar cambios de esquema en actualizaciones).
 * Todo aquí es seguro de volver a ejecutar: CREATE TABLE IF NOT EXISTS y
 * ALTER TABLE envueltos en try/catch (fallan en silencio si la columna ya existe).
 */

/** Crea las tablas (MySQL o SQLite) e índices. Devuelve líneas de log. */
function sirius_schema_tables(PDO $pdo, bool $isMysql): array
{
    $log = [];

    if ($isMysql) {
        $suffix = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        $tables = [
            'users' => "CREATE TABLE IF NOT EXISTS users (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(120) NOT NULL,
                role ENUM('estandar','administrador','developper') NOT NULL DEFAULT 'estandar',
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                assignable TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )$suffix",
            'user_permissions' => "CREATE TABLE IF NOT EXISTS user_permissions (
                user_id INT UNSIGNED NOT NULL,
                module_key VARCHAR(40) NOT NULL,
                flags JSON NULL,
                granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, module_key),
                CONSTRAINT fk_perm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )$suffix",
            'patients' => "CREATE TABLE IF NOT EXISTS patients (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                file_number VARCHAR(20) NOT NULL UNIQUE,
                first_name VARCHAR(80) NOT NULL,
                paternal_surname VARCHAR(80) NOT NULL,
                maternal_surname VARCHAR(80) NULL,
                birth_date DATE NULL,
                sex VARCHAR(1) NULL,
                curp VARCHAR(18) NULL,
                phone VARCHAR(20) NULL,
                mobile VARCHAR(20) NULL,
                email VARCHAR(120) NULL,
                street VARCHAR(150) NULL,
                colonia VARCHAR(100) NULL,
                postal_code VARCHAR(5) NULL,
                city VARCHAR(80) NULL,
                state VARCHAR(60) NULL DEFAULT 'Ciudad de México',
                marital_status VARCHAR(30) NULL,
                occupation VARCHAR(100) NULL,
                nationality VARCHAR(60) NULL,
                religion VARCHAR(60) NULL,
                blood_type VARCHAR(5) NULL,
                guardian_name VARCHAR(120) NULL,
                guardian_phone VARCHAR(20) NULL,
                guardian_relationship VARCHAR(60) NULL,
                emergency_contact_name VARCHAR(120) NULL,
                emergency_contact_phone VARCHAR(20) NULL,
                allergies TEXT NULL,
                chronic_conditions TEXT NULL,
                family_history TEXT NULL,
                current_medications TEXT NULL,
                notes TEXT NULL,
                is_deleted TINYINT(1) NOT NULL DEFAULT 0,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_patient_names (paternal_surname, maternal_surname, first_name),
                INDEX idx_patient_deleted (is_deleted),
                CONSTRAINT fk_patient_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'episodes' => "CREATE TABLE IF NOT EXISTS episodes (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                patient_id INT UNSIGNED NOT NULL,
                service ENUM('laboratorio','control_peso','fisioterapia','podologia') NOT NULL,
                service_folio VARCHAR(20) NULL,
                admission_date DATETIME NOT NULL,
                reason TEXT NULL,
                referring_doctor VARCHAR(120) NULL,
                assigned_user_id INT UNSIGNED NULL,
                service_data JSON NULL,
                status ENUM('activo','cerrado') NOT NULL DEFAULT 'activo',
                expected_delivery_date DATE NULL,
                results_delivered_at DATETIME NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_episode_patient (patient_id, service),
                INDEX idx_episode_date (admission_date),
                INDEX idx_episode_assigned (assigned_user_id),
                INDEX idx_episode_delivery (expected_delivery_date),
                CONSTRAINT fk_episode_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
                CONSTRAINT fk_episode_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_episode_assigned FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'consultations' => "CREATE TABLE IF NOT EXISTS consultations (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                episode_id INT UNSIGNED NOT NULL,
                consult_date DATETIME NOT NULL,
                notes TEXT NULL,
                params JSON NULL,
                created_by INT UNSIGNED NULL,
                nurse_closed_at DATETIME NULL,
                nurse_closed_by INT UNSIGNED NULL,
                doctor_closed_at DATETIME NULL,
                doctor_closed_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_consult_episode (episode_id, consult_date),
                CONSTRAINT fk_consult_episode FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
                CONSTRAINT fk_consult_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_consult_nurse FOREIGN KEY (nurse_closed_by) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_consult_doctor FOREIGN KEY (doctor_closed_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'activity_log' => "CREATE TABLE IF NOT EXISTS activity_log (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                user_id INT UNSIGNED NULL,
                username VARCHAR(50) NULL,
                module_key VARCHAR(40) NOT NULL,
                action VARCHAR(60) NOT NULL,
                detail VARCHAR(500) NULL,
                entity_type VARCHAR(30) NULL,
                entity_id INT UNSIGNED NULL,
                ip VARCHAR(45) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_log_user (user_id, created_at),
                INDEX idx_log_module (module_key, created_at)
            )$suffix",
            'settings' => "CREATE TABLE IF NOT EXISTS settings (
                skey VARCHAR(60) NOT NULL PRIMARY KEY,
                svalue TEXT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )$suffix",
            'projects' => "CREATE TABLE IF NOT EXISTS projects (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                description TEXT NULL,
                due_date DATE NULL,
                status ENUM('activo','completado','archivado') NOT NULL DEFAULT 'activo',
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_project_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'tasks' => "CREATE TABLE IF NOT EXISTS tasks (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                project_id INT UNSIGNED NULL,
                parent_id INT UNSIGNED NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT NULL,
                assigned_to INT UNSIGNED NULL,
                priority ENUM('baja','media','alta','urgente') NOT NULL DEFAULT 'media',
                due_date DATE NULL,
                recurrence ENUM('diaria','semanal') NULL,
                status ENUM('pendiente','en_progreso','completada') NOT NULL DEFAULT 'pendiente',
                completed_at DATETIME NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_task_assignee (assigned_to, status),
                INDEX idx_task_project (project_id),
                INDEX idx_task_parent (parent_id),
                CONSTRAINT fk_task_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                CONSTRAINT fk_task_parent FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE,
                CONSTRAINT fk_task_assignee FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_task_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'task_completions' => "CREATE TABLE IF NOT EXISTS task_completions (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                task_id INT UNSIGNED NOT NULL,
                period_key VARCHAR(10) NOT NULL,
                completed_by INT UNSIGNED NULL,
                completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_completion (task_id, period_key),
                CONSTRAINT fk_completion_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                CONSTRAINT fk_completion_user FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'documents' => "CREATE TABLE IF NOT EXISTS documents (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                doc_type VARCHAR(40) NOT NULL,
                folio VARCHAR(30) NULL,
                patient_id INT UNSIGNED NULL,
                patient_name VARCHAR(200) NOT NULL,
                patient_data JSON NULL,
                clinical_data JSON NULL,
                results JSON NULL,
                notes TEXT NULL,
                status ENUM('borrador','revisado') NOT NULL DEFAULT 'borrador',
                pdf_file VARCHAR(120) NULL,
                created_by INT UNSIGNED NULL,
                reviewed_by INT UNSIGNED NULL,
                reviewed_at DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_doc_type (doc_type, created_at),
                INDEX idx_doc_patient (patient_id),
                CONSTRAINT fk_doc_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
                CONSTRAINT fk_doc_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_doc_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'lab_tests' => "CREATE TABLE IF NOT EXISTS lab_tests (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                slug VARCHAR(150) NOT NULL,
                aliases TEXT NULL,
                unit VARCHAR(40) NULL,
                technique VARCHAR(80) NULL,
                notes TEXT NULL,
                times_used INT UNSIGNED NOT NULL DEFAULT 0,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_lab_test_slug (slug),
                CONSTRAINT fk_labtest_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'lab_reference_ranges' => "CREATE TABLE IF NOT EXISTS lab_reference_ranges (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                test_id INT UNSIGNED NOT NULL,
                sex ENUM('A','F','M') NOT NULL DEFAULT 'A',
                age_min DECIMAL(5,1) NULL,
                age_max DECIMAL(5,1) NULL,
                condition_label VARCHAR(80) NULL,
                min_value DECIMAL(12,4) NULL,
                max_value DECIMAL(12,4) NULL,
                text_value VARCHAR(120) NULL,
                unit VARCHAR(40) NULL,
                sort_order INT NOT NULL DEFAULT 0,
                INDEX idx_range_test (test_id, sort_order),
                CONSTRAINT fk_range_test FOREIGN KEY (test_id) REFERENCES lab_tests(id) ON DELETE CASCADE
            )$suffix",
            'inventory_items' => "CREATE TABLE IF NOT EXISTS inventory_items (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                barcode VARCHAR(64) NULL,
                category VARCHAR(80) NULL,
                unit VARCHAR(30) NOT NULL DEFAULT 'pieza',
                min_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
                notes TEXT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_item_barcode (barcode),
                INDEX idx_item_active (is_active, name),
                CONSTRAINT fk_item_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'inventory_lots' => "CREATE TABLE IF NOT EXISTS inventory_lots (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                item_id INT UNSIGNED NOT NULL,
                lot_code VARCHAR(60) NULL,
                quantity_received DECIMAL(10,2) NOT NULL,
                quantity_remaining DECIMAL(10,2) NOT NULL,
                expiry_date DATE NULL,
                received_date DATE NOT NULL,
                unit_cost DECIMAL(10,2) NULL,
                supplier VARCHAR(120) NULL,
                notes TEXT NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_lot_item (item_id, received_date),
                INDEX idx_lot_expiry (expiry_date),
                CONSTRAINT fk_lot_item FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
                CONSTRAINT fk_lot_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'inventory_movements' => "CREATE TABLE IF NOT EXISTS inventory_movements (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                item_id INT UNSIGNED NOT NULL,
                lot_id INT UNSIGNED NULL,
                type ENUM('entrada','salida','ajuste') NOT NULL,
                quantity DECIMAL(10,2) NOT NULL,
                reason VARCHAR(150) NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_move_item (item_id, created_at),
                CONSTRAINT fk_move_item FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
                CONSTRAINT fk_move_lot FOREIGN KEY (lot_id) REFERENCES inventory_lots(id) ON DELETE SET NULL,
                CONSTRAINT fk_move_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'board_items' => "CREATE TABLE IF NOT EXISTS board_items (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                scope ENUM('private','public') NOT NULL,
                owner_id INT UNSIGNED NULL,
                type ENUM('note','checklist','drawing') NOT NULL,
                title VARCHAR(120) NULL,
                content JSON NULL,
                color VARCHAR(20) NOT NULL DEFAULT 'amber',
                pos_x INT NOT NULL DEFAULT 40,
                pos_y INT NOT NULL DEFAULT 40,
                width INT NOT NULL DEFAULT 240,
                height INT NOT NULL DEFAULT 200,
                z_index INT NOT NULL DEFAULT 1,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_board_scope (scope, owner_id),
                CONSTRAINT fk_board_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_board_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'file_folders' => "CREATE TABLE IF NOT EXISTS file_folders (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                scope ENUM('private','public') NOT NULL,
                owner_id INT UNSIGNED NULL,
                parent_id INT UNSIGNED NULL,
                name VARCHAR(150) NOT NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_folder_scope (scope, owner_id, parent_id),
                CONSTRAINT fk_folder_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_folder_parent FOREIGN KEY (parent_id) REFERENCES file_folders(id) ON DELETE CASCADE,
                CONSTRAINT fk_folder_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'files' => "CREATE TABLE IF NOT EXISTS files (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                scope ENUM('private','public') NOT NULL,
                owner_id INT UNSIGNED NULL,
                folder_id INT UNSIGNED NULL,
                name VARCHAR(200) NOT NULL,
                stored_name VARCHAR(80) NOT NULL,
                mime VARCHAR(120) NULL,
                size BIGINT UNSIGNED NOT NULL DEFAULT 0,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_file_scope (scope, owner_id, folder_id),
                CONSTRAINT fk_file_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_file_folder FOREIGN KEY (folder_id) REFERENCES file_folders(id) ON DELETE CASCADE,
                CONSTRAINT fk_file_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'appointments' => "CREATE TABLE IF NOT EXISTS appointments (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                service ENUM('laboratorio','control_peso','fisioterapia','podologia','recoleccion','otro') NOT NULL DEFAULT 'otro',
                patient_id INT UNSIGNED NULL,
                location VARCHAR(200) NULL,
                start_at DATETIME NOT NULL,
                end_at DATETIME NOT NULL,
                assigned_user_id INT UNSIGNED NULL,
                attendees JSON NULL,
                notes TEXT NULL,
                status ENUM('programada','confirmada','cancelada','completada') NOT NULL DEFAULT 'programada',
                google_event_id VARCHAR(255) NULL,
                google_updated_at DATETIME NULL,
                source ENUM('sirius','google') NOT NULL DEFAULT 'sirius',
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_appt_start (start_at),
                INDEX idx_appt_assigned (assigned_user_id),
                INDEX idx_appt_patient (patient_id),
                UNIQUE KEY uq_appt_google_event (google_event_id),
                CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
                CONSTRAINT fk_appt_assigned FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_appt_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'quote_studies' => "CREATE TABLE IF NOT EXISTS quote_studies (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                category VARCHAR(100) NULL,
                public_price DECIMAL(10,2) NOT NULL DEFAULT 0,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_qstudy_active (is_active, name),
                INDEX idx_qstudy_category (category),
                CONSTRAINT fk_qstudy_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'quotes' => "CREATE TABLE IF NOT EXISTS quotes (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                folio VARCHAR(20) NOT NULL UNIQUE,
                patient_id INT UNSIGNED NULL,
                client_name VARCHAR(200) NOT NULL DEFAULT 'Público en General',
                client_phone VARCHAR(20) NULL,
                client_address VARCHAR(255) NULL,
                quote_date DATE NOT NULL,
                items JSON NOT NULL,
                subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
                discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
                discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                total DECIMAL(10,2) NOT NULL DEFAULT 0,
                notes TEXT NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_quote_date (quote_date),
                CONSTRAINT fk_quote_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
                CONSTRAINT fk_quote_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
            'patient_documents' => "CREATE TABLE IF NOT EXISTS patient_documents (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                patient_id INT UNSIGNED NOT NULL,
                name VARCHAR(200) NOT NULL,
                stored_name VARCHAR(80) NOT NULL,
                mime VARCHAR(120) NULL,
                size BIGINT UNSIGNED NOT NULL DEFAULT 0,
                notes VARCHAR(255) NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_pdoc_patient (patient_id, created_at),
                CONSTRAINT fk_pdoc_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
                CONSTRAINT fk_pdoc_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )$suffix",
        ];
    } else {
        // SQLite (desarrollo): ENUM/JSON => TEXT, AUTO_INCREMENT => AUTOINCREMENT.
        $tables = [
            'users' => "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'estandar',
                is_active INTEGER NOT NULL DEFAULT 1,
                assignable INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'user_permissions' => "CREATE TABLE IF NOT EXISTS user_permissions (
                user_id INTEGER NOT NULL,
                module_key TEXT NOT NULL,
                flags TEXT NULL,
                granted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                PRIMARY KEY (user_id, module_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )",
            'patients' => "CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_number TEXT NOT NULL UNIQUE,
                first_name TEXT NOT NULL,
                paternal_surname TEXT NOT NULL,
                maternal_surname TEXT NULL,
                birth_date TEXT NULL,
                sex TEXT NULL,
                curp TEXT NULL,
                phone TEXT NULL,
                mobile TEXT NULL,
                email TEXT NULL,
                street TEXT NULL,
                colonia TEXT NULL,
                postal_code TEXT NULL,
                city TEXT NULL,
                state TEXT NULL DEFAULT 'Ciudad de México',
                marital_status TEXT NULL,
                occupation TEXT NULL,
                nationality TEXT NULL,
                religion TEXT NULL,
                blood_type TEXT NULL,
                guardian_name TEXT NULL,
                guardian_phone TEXT NULL,
                guardian_relationship TEXT NULL,
                emergency_contact_name TEXT NULL,
                emergency_contact_phone TEXT NULL,
                allergies TEXT NULL,
                chronic_conditions TEXT NULL,
                family_history TEXT NULL,
                current_medications TEXT NULL,
                notes TEXT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'episodes' => "CREATE TABLE IF NOT EXISTS episodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                service TEXT NOT NULL,
                service_folio TEXT NULL,
                admission_date TEXT NOT NULL,
                reason TEXT NULL,
                referring_doctor TEXT NULL,
                assigned_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                service_data TEXT NULL,
                status TEXT NOT NULL DEFAULT 'activo',
                expected_delivery_date TEXT NULL,
                results_delivered_at TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'consultations' => "CREATE TABLE IF NOT EXISTS consultations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
                consult_date TEXT NOT NULL,
                notes TEXT NULL,
                params TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                nurse_closed_at TEXT NULL,
                nurse_closed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                doctor_closed_at TEXT NULL,
                doctor_closed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'activity_log' => "CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NULL,
                username TEXT NULL,
                module_key TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NULL,
                entity_type TEXT NULL,
                entity_id INTEGER NULL,
                ip TEXT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'settings' => "CREATE TABLE IF NOT EXISTS settings (
                skey TEXT NOT NULL PRIMARY KEY,
                svalue TEXT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'projects' => "CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NULL,
                due_date TEXT NULL,
                status TEXT NOT NULL DEFAULT 'activo',
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'tasks' => "CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NULL REFERENCES projects(id) ON DELETE CASCADE,
                parent_id INTEGER NULL REFERENCES tasks(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT NULL,
                assigned_to INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                priority TEXT NOT NULL DEFAULT 'media',
                due_date TEXT NULL,
                recurrence TEXT NULL,
                status TEXT NOT NULL DEFAULT 'pendiente',
                completed_at TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'task_completions' => "CREATE TABLE IF NOT EXISTS task_completions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                period_key TEXT NOT NULL,
                completed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                completed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                UNIQUE (task_id, period_key)
            )",
            'documents' => "CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_type TEXT NOT NULL,
                folio TEXT NULL,
                patient_id INTEGER NULL REFERENCES patients(id) ON DELETE SET NULL,
                patient_name TEXT NOT NULL,
                patient_data TEXT NULL,
                clinical_data TEXT NULL,
                results TEXT NULL,
                notes TEXT NULL,
                status TEXT NOT NULL DEFAULT 'borrador',
                pdf_file TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                reviewed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                reviewed_at TEXT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'lab_tests' => "CREATE TABLE IF NOT EXISTS lab_tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                aliases TEXT NULL,
                unit TEXT NULL,
                technique TEXT NULL,
                notes TEXT NULL,
                times_used INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'lab_reference_ranges' => "CREATE TABLE IF NOT EXISTS lab_reference_ranges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_id INTEGER NOT NULL REFERENCES lab_tests(id) ON DELETE CASCADE,
                sex TEXT NOT NULL DEFAULT 'A',
                age_min REAL NULL,
                age_max REAL NULL,
                condition_label TEXT NULL,
                min_value REAL NULL,
                max_value REAL NULL,
                text_value TEXT NULL,
                unit TEXT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )",
            'inventory_items' => "CREATE TABLE IF NOT EXISTS inventory_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                barcode TEXT NULL UNIQUE,
                category TEXT NULL,
                unit TEXT NOT NULL DEFAULT 'pieza',
                min_stock REAL NOT NULL DEFAULT 0,
                notes TEXT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'inventory_lots' => "CREATE TABLE IF NOT EXISTS inventory_lots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
                lot_code TEXT NULL,
                quantity_received REAL NOT NULL,
                quantity_remaining REAL NOT NULL,
                expiry_date TEXT NULL,
                received_date TEXT NOT NULL,
                unit_cost REAL NULL,
                supplier TEXT NULL,
                notes TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'inventory_movements' => "CREATE TABLE IF NOT EXISTS inventory_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
                lot_id INTEGER NULL REFERENCES inventory_lots(id) ON DELETE SET NULL,
                type TEXT NOT NULL,
                quantity REAL NOT NULL,
                reason TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'board_items' => "CREATE TABLE IF NOT EXISTS board_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL,
                owner_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                title TEXT NULL,
                content TEXT NULL,
                color TEXT NOT NULL DEFAULT 'amber',
                pos_x INTEGER NOT NULL DEFAULT 40,
                pos_y INTEGER NOT NULL DEFAULT 40,
                width INTEGER NOT NULL DEFAULT 240,
                height INTEGER NOT NULL DEFAULT 200,
                z_index INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'file_folders' => "CREATE TABLE IF NOT EXISTS file_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL,
                owner_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
                parent_id INTEGER NULL REFERENCES file_folders(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'files' => "CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scope TEXT NOT NULL,
                owner_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
                folder_id INTEGER NULL REFERENCES file_folders(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                mime TEXT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'appointments' => "CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                service TEXT NOT NULL DEFAULT 'otro',
                patient_id INTEGER NULL REFERENCES patients(id) ON DELETE SET NULL,
                location TEXT NULL,
                start_at TEXT NOT NULL,
                end_at TEXT NOT NULL,
                assigned_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                attendees TEXT NULL,
                notes TEXT NULL,
                status TEXT NOT NULL DEFAULT 'programada',
                google_event_id TEXT NULL,
                google_updated_at TEXT NULL,
                source TEXT NOT NULL DEFAULT 'sirius',
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'quote_studies' => "CREATE TABLE IF NOT EXISTS quote_studies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NULL,
                public_price REAL NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'quotes' => "CREATE TABLE IF NOT EXISTS quotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folio TEXT NOT NULL UNIQUE,
                patient_id INTEGER NULL REFERENCES patients(id) ON DELETE SET NULL,
                client_name TEXT NOT NULL DEFAULT 'Público en General',
                client_phone TEXT NULL,
                client_address TEXT NULL,
                quote_date TEXT NOT NULL,
                items TEXT NOT NULL,
                subtotal REAL NOT NULL DEFAULT 0,
                discount_pct REAL NOT NULL DEFAULT 0,
                discount_amount REAL NOT NULL DEFAULT 0,
                total REAL NOT NULL DEFAULT 0,
                notes TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
            'patient_documents' => "CREATE TABLE IF NOT EXISTS patient_documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                mime TEXT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                notes TEXT NULL,
                created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            )",
        ];
    }

    foreach ($tables as $name => $sql) {
        $pdo->exec($sql);
        $log[] = "Tabla $name: OK";
    }

    if (!$isMysql) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_patient_names ON patients (paternal_surname, maternal_surname, first_name)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_patient_deleted ON patients (is_deleted)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_episode_patient ON episodes (patient_id, service)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_episode_date ON episodes (admission_date)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_consult_episode ON consultations (episode_id, consult_date)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_log_user ON activity_log (user_id, created_at)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_log_module ON activity_log (module_key, created_at)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_task_assignee ON tasks (assigned_to, status)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_task_project ON tasks (project_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_task_parent ON tasks (parent_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_item_active ON inventory_items (is_active, name)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_lot_item ON inventory_lots (item_id, received_date)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_lot_expiry ON inventory_lots (expiry_date)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_move_item ON inventory_movements (item_id, created_at)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_board_scope ON board_items (scope, owner_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_folder_scope ON file_folders (scope, owner_id, parent_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_file_scope ON files (scope, owner_id, folder_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments (start_at)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_appt_assigned ON appointments (assigned_user_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments (patient_id)');
        $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_google_event ON appointments (google_event_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_qstudy_active ON quote_studies (is_active, name)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_qstudy_category ON quote_studies (category)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_quote_date ON quotes (quote_date)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_pdoc_patient ON patient_documents (patient_id, created_at)');
        $log[] = 'Índices SQLite: OK';
    }

    return $log;
}

/** Aplica migraciones ALTER TABLE idempotentes (fallan en silencio si la columna ya existe). */
function sirius_schema_migrations(PDO $pdo, bool $isMysql): array
{
    $varchar = static fn(int $n) => $isMysql ? "VARCHAR($n) NULL" : 'TEXT NULL';
    $migrations = [
        "ALTER TABLE patients ADD COLUMN marital_status {$varchar(30)}",
        "ALTER TABLE patients ADD COLUMN occupation {$varchar(100)}",
        "ALTER TABLE patients ADD COLUMN nationality {$varchar(60)}",
        "ALTER TABLE patients ADD COLUMN religion {$varchar(60)}",
        "ALTER TABLE patients ADD COLUMN blood_type {$varchar(5)}",
        "ALTER TABLE patients ADD COLUMN guardian_name {$varchar(120)}",
        "ALTER TABLE patients ADD COLUMN guardian_phone {$varchar(20)}",
        "ALTER TABLE patients ADD COLUMN guardian_relationship {$varchar(60)}",
        "ALTER TABLE episodes ADD COLUMN service_folio {$varchar(20)}",
        "ALTER TABLE users ADD COLUMN assignable " . ($isMysql ? 'TINYINT(1) NOT NULL DEFAULT 0' : 'INTEGER NOT NULL DEFAULT 0'),
        "ALTER TABLE episodes ADD COLUMN assigned_user_id " . ($isMysql ? 'INT UNSIGNED NULL' : 'INTEGER NULL'),
        "ALTER TABLE consultations ADD COLUMN nurse_closed_at " . ($isMysql ? 'DATETIME NULL' : 'TEXT NULL'),
        "ALTER TABLE consultations ADD COLUMN nurse_closed_by " . ($isMysql ? 'INT UNSIGNED NULL' : 'INTEGER NULL'),
        "ALTER TABLE consultations ADD COLUMN doctor_closed_at " . ($isMysql ? 'DATETIME NULL' : 'TEXT NULL'),
        "ALTER TABLE consultations ADD COLUMN doctor_closed_by " . ($isMysql ? 'INT UNSIGNED NULL' : 'INTEGER NULL'),
        "ALTER TABLE episodes ADD COLUMN expected_delivery_date " . ($isMysql ? 'DATE NULL' : 'TEXT NULL'),
        "ALTER TABLE episodes ADD COLUMN results_delivered_at " . ($isMysql ? 'DATETIME NULL' : 'TEXT NULL'),
    ];
    $applied = 0;
    foreach ($migrations as $sql) {
        try {
            $pdo->exec($sql);
            $applied++;
        } catch (Throwable $e) {
            // columna ya existe
        }
    }

    if (!$isMysql) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_episode_assigned ON episodes (assigned_user_id)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_episode_delivery ON episodes (expected_delivery_date)');
    }

    return ["Migraciones aplicadas: $applied"];
}

/** Siembra los valores por defecto de settings si no existen ya. */
function sirius_seed_settings(PDO $pdo, string $clinicName = 'Laboratorio y Clínica Bosques Polanco'): array
{
    $defaults = [
        'clinic_name'    => $clinicName,
        'gemini_api_key' => '',
        'gemini_model'   => 'gemini-2.0-flash',
        'assistant_name' => 'Sirius',
    ];
    $check = $pdo->prepare('SELECT skey FROM settings WHERE skey = ?');
    $ins = $pdo->prepare('INSERT INTO settings (skey, svalue) VALUES (?, ?)');
    foreach ($defaults as $k => $v) {
        $check->execute([$k]);
        if (!$check->fetch()) {
            $ins->execute([$k, $v]);
        }
    }
    return ['Settings: OK'];
}

/**
 * Crea el usuario administrador SOLO si la tabla users está vacía — así nunca
 * duplica un Admin en un sitio que ya tiene usuarios reales.
 * Devuelve ['created' => bool, 'log' => string[]].
 */
function sirius_seed_admin(PDO $pdo, string $username, string $password, string $fullName): array
{
    $count = (int)$pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
    if ($count > 0) {
        return ['created' => false, 'log' => ['Ya existen usuarios; no se creó un Admin nuevo']];
    }
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $pdo->prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
        ->execute([$username, $hash, $fullName, 'administrador']);
    return ['created' => true, 'log' => ["Usuario administrador \"$username\" creado"]];
}

/** Crea tablas + migraciones + settings por defecto. No toca usuarios. */
function sirius_install_schema(PDO $pdo, bool $isMysql, string $clinicName = 'Laboratorio y Clínica Bosques Polanco'): array
{
    return array_merge(
        sirius_schema_tables($pdo, $isMysql),
        sirius_schema_migrations($pdo, $isMysql),
        sirius_seed_settings($pdo, $clinicName)
    );
}
