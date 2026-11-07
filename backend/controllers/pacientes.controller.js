const { createUserClient } = require('../config/supabase')

const fields = 'id_mascota, nombre, especie, raza, sexo, fecha_nacimiento, peso_actual, observaciones, id_dueno, propietario:dueno(id_dueno, nombre)'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const validarPaciente = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Los datos del paciente no son válidos.' }
  if (typeof body.nombre !== 'string' || !body.nombre.trim() || body.nombre.trim().length > 100) {
    return { error: 'El nombre es obligatorio y debe tener hasta 100 caracteres.' }
  }
  if (typeof body.id_dueno !== 'string' || !uuid.test(body.id_dueno)) return { error: 'Selecciona un propietario válido.' }
  const data = { nombre: body.nombre.trim(), id_dueno: body.id_dueno }
  for (const [field, max] of [['especie', 100], ['raza', 100], ['sexo', 50], ['observaciones', 5000]]) {
    const value = body[field]
    if (value != null && (typeof value !== 'string' || value.trim().length > max)) {
      return { error: `El campo ${field} debe ser un texto de hasta ${max} caracteres.` }
    }
    data[field] = value?.trim() || null
  }
  const birth = body.fecha_nacimiento
  if (birth != null && birth !== '') {
    if (typeof birth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return { error: 'La fecha de nacimiento no es válida.' }
    const date = new Date(`${birth}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birth || birth < '0001-01-01') {
      return { error: 'La fecha de nacimiento no es válida.' }
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tijuana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    if (birth > today) return { error: 'La fecha de nacimiento no puede ser futura.' }
  }
  data.fecha_nacimiento = birth || null
  const weight = body.peso_actual
  if (weight != null && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0.001 || weight > 99999.999)) {
    return { error: 'El peso debe ser un número entre 0.001 y 99999.999 kg.' }
  }
  data.peso_actual = weight ?? null
  // Explicit allowlist: ignore tenant, role, identity, legacy age and photo input.
  return { data }
}

const obtenerPacientes = async (req, res) => {
  try {
    const supabase = req.supabase || createUserClient(req.accessToken)
    const { data, error } = await supabase.from('mascota').select(fields).order('nombre')
    if (error) return res.status(500).json({ error: 'No se pudieron cargar los pacientes.' })
    if (req.clinicAccess && !req.clinicAccess.permisos.includes('propietarios.ver')) {
      const owners = await supabase.rpc('vettrack_propietarios_pacientes')
      if (owners.error) return res.status(500).json({ error: 'No se pudieron cargar los propietarios de los pacientes.' })
      const byId = new Map(owners.data.map(owner => [owner.id_dueno, owner]))
      return res.json(data.map(patient => ({ ...patient, propietario: byId.get(patient.id_dueno) || null })))
    }
    return res.json(data)
  } catch {
    return res.status(500).json({ error: 'No se pudieron cargar los pacientes.' })
  }
}

// Patient relationships expose only the tenant's owner identifiers and names.
// A user may work with patients without permission to read owner contact data.
const obtenerPropietariosPacientes = async (req, res) => {
  try {
    const { data, error } = await req.supabase.rpc('vettrack_propietarios_pacientes')
    if (error) return res.status(500).json({ error: 'No se pudieron cargar los propietarios disponibles.' })
    return res.json(data)
  } catch {
    return res.status(500).json({ error: 'No se pudieron cargar los propietarios disponibles.' })
  }
}

const guardarPaciente = (update) => async (req, res) => {
  const message = update ? 'No se pudo actualizar el paciente.' : 'No se pudo registrar el paciente.'
  try {
    if (update && !uuid.test(req.params.id)) return res.status(400).json({ error: 'El identificador del paciente no es válido.' })
    const validated = validarPaciente(req.body)
    if (validated.error) return res.status(400).json({ error: validated.error })
    const supabase = req.supabase || createUserClient(req.accessToken)
    if (update) {
      const existing = await supabase.from('mascota').select('id_mascota').eq('id_mascota', req.params.id).maybeSingle()
      if (existing.error) return res.status(500).json({ error: message })
      if (!existing.data) return res.status(404).json({ error: 'Paciente no encontrado.' })
    }
    // RLS filters the owner; it also enforces WITH CHECK on the final write.
    const owner = req.clinicAccess && !req.clinicAccess.permisos.includes('propietarios.ver')
      ? await supabase.rpc('vettrack_propietarios_pacientes').eq('id_dueno', validated.data.id_dueno).maybeSingle()
      : await supabase.from('dueno').select('id_dueno').eq('id_dueno', validated.data.id_dueno).maybeSingle()
    if (owner.error) return res.status(500).json({ error: message })
    if (!owner.data) return res.status(400).json({ error: 'El propietario seleccionado no está disponible.' })
    const query = update
      ? supabase.from('mascota').update(validated.data).eq('id_mascota', req.params.id)
      : supabase.from('mascota').insert(validated.data)
    const { data, error } = await query.select(fields).maybeSingle()
    if (error) {
      if (['23503', '42501'].includes(error.code)) return res.status(400).json({ error: 'El propietario seleccionado no está disponible.' })
      return res.status(500).json({ error: message })
    }
    if (!data) return res.status(update ? 404 : 500).json({ error: update ? 'Paciente no encontrado.' : message })
    return res.status(update ? 200 : 201).json(data)
  } catch {
    return res.status(500).json({ error: message })
  }
}

const eliminarPaciente = async (req, res) => {
  try {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'El identificador del paciente no es válido.' })
    // The migration makes incoming FKs RESTRICT. No closed-module privileges or
    // preflight dependency queries are needed, avoiding a check/delete race.
    const { data, error } = await createUserClient(req.accessToken).from('mascota').delete()
      .eq('id_mascota', req.params.id).select('id_mascota').maybeSingle()
    if (error?.code === '23503') return res.status(409).json({ error: 'No se puede eliminar el paciente porque tiene información relacionada.' })
    if (error) return res.status(500).json({ error: 'No se pudo eliminar el paciente.' })
    if (!data) return res.status(404).json({ error: 'Paciente no encontrado.' })
    return res.json({ mensaje: 'Paciente eliminado correctamente.' })
  } catch {
    return res.status(500).json({ error: 'No se pudo eliminar el paciente.' })
  }
}

module.exports = { obtenerPacientes, obtenerPropietariosPacientes, crearPaciente: guardarPaciente(false), actualizarPaciente: guardarPaciente(true), eliminarPaciente }
