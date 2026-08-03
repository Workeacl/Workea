// api/bitacora/actualizar-estado.js
//
// POST — agrega un evento al timeline de una postulación. El trigger
// SQL (fn_actualizar_postulacion_desde_evento) ya definido en el esquema
// se encarga de actualizar estado_actual y fecha_ultima_actividad de la
// postulación automáticamente — este endpoint solo inserta el evento.
//
// Body esperado (JSON):
// {
//   postulacion_id: string,      (obligatorio)
//   tipo_evento: string,         (obligatorio — uno del enum bitacora_tipo_evento)
//   fecha?: string,              (YYYY-MM-DD, default: hoy)
//   hora?: string,               (HH:MM, solo entrevista/evaluación)
//   modalidad?: 'presencial'|'remoto'|'hibrido',
//   etiqueta_libre?: string,     (solo si tipo_evento = 'otro_paso')
//   nota?: string
// }

const { getSupabaseForRequest } = require('./_supabaseClient');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { supabase, error: authError } = getSupabaseForRequest(req);
  if (authError) return res.status(401).json({ error: authError });

  const {
    postulacion_id,
    tipo_evento,
    fecha = null,
    hora = null,
    modalidad = null,
    etiqueta_libre = null,
    nota = null
  } = req.body || {};

  if (!postulacion_id || !tipo_evento) {
    return res.status(400).json({ error: 'postulacion_id y tipo_evento son obligatorios' });
  }

  if (tipo_evento === 'otro_paso' && !etiqueta_libre) {
    return res.status(400).json({ error: 'etiqueta_libre es obligatoria cuando tipo_evento es "otro_paso"' });
  }

  const insertPayload = { postulacion_id, tipo_evento, modalidad, etiqueta_libre, nota };
  if (fecha) insertPayload.fecha = fecha;
  if (hora) insertPayload.hora = hora;

  const { data, error } = await supabase
    .from('timeline_eventos')
    .insert(insertPayload)
    .select()
    .single();

  // RLS rechaza silenciosamente si la postulación no le pertenece al
  // usuario del token — llega como error de política, no como 404, así
  // que lo devolvemos como 403 para que el frontend lo distinga de un
  // error de validación normal.
  if (error) {
    const status = error.code === '42501' ? 403 : 500;
    return res.status(status).json({ error: error.message });
  }

  return res.status(201).json({ evento: data });
};
