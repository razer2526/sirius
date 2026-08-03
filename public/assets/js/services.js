/**
 * Metadatos de los servicios clínicos + carga del catálogo de formularios.
 * La definición completa de campos vive en services_catalog.json
 * (misma fuente que valida el servidor en includes/services.php).
 */

export const SERVICES = {
  laboratorio: {
    label: 'Laboratorio',
    icon: 'flask',
    color: 'bg-sky-100 text-sky-700',
    accent: 'bg-sky-600',
  },
  control_peso: {
    label: 'Control de peso',
    icon: 'scale',
    color: 'bg-emerald-100 text-emerald-700',
    accent: 'bg-emerald-600',
  },
  fisioterapia: {
    label: 'Fisioterapia',
    icon: 'activity',
    color: 'bg-orange-100 text-orange-700',
    accent: 'bg-orange-600',
  },
  podologia: {
    label: 'Podología',
    icon: 'footprints',
    color: 'bg-violet-100 text-violet-700',
    accent: 'bg-violet-600',
  },
};

let catalogPromise = null;

/** Catálogo de secciones por servicio: { <servicio>: { admission: [...], session: [...] } } */
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('assets/js/services_catalog.json')
      .then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar el catálogo de formularios');
        return r.json();
      })
      .catch((e) => { catalogPromise = null; throw e; });
  }
  return catalogPromise;
}

/** Datos generales del paciente (comunes a todos los servicios). */
export const PATIENT_FIELDS = [
  { key: 'first_name', label: 'Nombre(s)', type: 'text', required: true },
  { key: 'paternal_surname', label: 'Apellido paterno', type: 'text', required: true },
  { key: 'maternal_surname', label: 'Apellido materno', type: 'text' },
  { key: 'birth_date', label: 'Fecha de nacimiento', type: 'date' },
  { key: 'sex', label: 'Sexo', type: 'select', options: [['F', 'Femenino'], ['M', 'Masculino'], ['O', 'Otro']] },
  { key: 'blood_type', label: 'Grupo sanguíneo', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { key: 'marital_status', label: 'Estado civil', type: 'select', options: ['Soltero(a)', 'Casado(a)', 'Unión libre', 'Divorciado(a)', 'Viudo(a)'] },
  { key: 'occupation', label: 'Ocupación', type: 'text' },
  { key: 'nationality', label: 'Nacionalidad', type: 'text' },
  { key: 'religion', label: 'Religión', type: 'text' },
  { key: 'mobile', label: 'Celular', type: 'tel' },
  { key: 'phone', label: 'Teléfono fijo', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'street', label: 'Calle y número', type: 'text', span: 'sm:col-span-2' },
  { key: 'colonia', label: 'Colonia', type: 'text' },
  { key: 'postal_code', label: 'Código postal', type: 'text' },
  { key: 'city', label: 'Ciudad', type: 'text' },
  { key: 'state', label: 'Estado', type: 'text' },
  { key: 'emergency_contact_name', label: 'Contacto de emergencia', type: 'text' },
  { key: 'emergency_contact_phone', label: 'Tel. de emergencia', type: 'tel' },
  { key: 'guardian_name', label: 'Persona a cargo o titular: nombre', type: 'text' },
  { key: 'guardian_phone', label: 'Titular: teléfono', type: 'tel' },
  { key: 'guardian_relationship', label: 'Titular: parentesco', type: 'text' },
];

/** Resumen clínico a nivel paciente (se edita desde Expedientes > Editar). */
export const CLINICAL_FIELDS = [
  { key: 'allergies', label: 'Alergias', type: 'textarea', rows: 2 },
  { key: 'chronic_conditions', label: 'Antecedentes personales patológicos', type: 'textarea', rows: 2 },
  { key: 'family_history', label: 'Antecedentes heredofamiliares', type: 'textarea', rows: 2 },
  { key: 'current_medications', label: 'Medicamentos actuales', type: 'textarea', rows: 2 },
  { key: 'notes', label: 'Notas generales', type: 'textarea', rows: 2 },
];
