// api/bitacora/listar-postulaciones.js
//
// GET — devuelve todas las postulaciones del usuario autenticado, junto
// con sus eventos de timeline (ordenados del más reciente al más
// antiguo, como se ve en la ficha). Pensado para poblar tanto el
// dashboard (KPIs se calculan en el frontend a partir de esta lista)
// como la vista de Procesos y el Calendario.
//
// Query params opcionales:
//   ?estado=activo | entrevistas | oferta | cerrados   (filtro por tab)

const { getSupabaseForRequest } = require('./_supabaseClient');

const ESTADOS_ACTIVOS = [
  'postule', 'me_contactaron', 'entrevista_rrhh',
  'entrevista_tecnica', 'entrevista_final', 'evaluacion'
];
const ESTADOS_ENTREVISTA = ['entrevista_rrhh', 'entrevista_tecnica', 'entrevista_final'];
const ESTADOS_CERRADOS = ['rechazado', 'cancele_proceso'];

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { supabase, error: authError } = getSupabaseForRequest(req);
  if (authError) return res.status(401).json({ error: authError });

  let query = supabase
    .from('postulaciones')
    .select(`
      *,
      timeline_eventos ( * )
    `)
    .order('fecha_ultima_actividad', { ascending: false });

  const { estado } = req.query || {};
  if (estado === 'activo') query = query.in('estado_actual', ESTADOS_ACTIVOS);
  if (estado === 'entrevistas') query = query.in('estado_actual', ESTADOS_ENTREVISTA);
  if (estado === 'oferta') query = query.eq('estado_actual', 'oferta_recibida');
  if (estado === 'cerrados') query = query.in('estado_actual', ESTADOS_CERRADOS);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Ordenar el timeline de cada postulación de más reciente a más antiguo
  const postulaciones = (data || []).map((p) => ({
    ...p,
    timeline_eventos: (p.timeline_eventos || []).sort(
      (a, b) => new Date(b.fecha) - new Date(a.fecha)
    )
  }));

  return res.status(200).json({ postulaciones });
};
