// api/bitacora/index.js
//
// Endpoint único de Bitácora — reemplaza los 7 archivos separados que
// teníamos antes (crear-postulacion.js, actualizar-estado.js, etc.).
// El plan Hobby de Vercel permite máximo 12 funciones serverless por
// proyecto; tener un archivo por acción nos hizo pasarnos del límite.
// Acá, todas las acciones viven en una sola función y se distinguen
// por el campo `accion` (en el body para POST, o en la query ?accion=
// para GET).
//
// Rutas desde el frontend:
//   GET  /api/bitacora?accion=listar&estado=activo
//   POST /api/bitacora   body: { accion: 'crear_postulacion', ... }
//   POST /api/bitacora   body: { accion: 'actualizar_estado', ... }
//   POST /api/bitacora   body: { accion: 'agregar_objetivo', ... }
//   POST /api/bitacora   body: { accion: 'editar_postulacion', ... }
//   POST /api/bitacora   body: { accion: 'eliminar_postulacion', ... }
//   POST /api/bitacora   body: { accion: 'eliminar_evento', ... }

const { getSupabaseForRequest } = require('./_supabaseClient');

const ESTADOS_ACTIVOS = ['postule', 'me_contactaron', 'entrevista_rrhh', 'entrevista_tecnica', 'entrevista_final', 'evaluacion'];
const ESTADOS_ENTREVISTA = ['entrevista_rrhh', 'entrevista_tecnica', 'entrevista_final'];
const ESTADOS_CERRADOS = ['rechazado', 'cancele_proceso'];
const TIPOS_ESTADO = ['postule', 'me_contactaron', 'entrevista_rrhh', 'entrevista_tecnica', 'entrevista_final', 'evaluacion', 'oferta_recibida', 'rechazado', 'cancele_proceso'];
const CAMPOS_EDITABLES = ['empresa', 'cargo', 'modalidad', 'seniority', 'link_oferta', 'sitio_web', 'reclutador', 'sueldo', 'interes'];

module.exports = async (req, res) => {
  try {
    const { supabase, error: authError } = getSupabaseForRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    // ---------- GET: listar postulaciones ----------
    if (req.method === 'GET') {
      let query = supabase
        .from('postulaciones')
        .select('*, timeline_eventos ( * )')
        .order('fecha_ultima_actividad', { ascending: false });

      const estado = req.query?.estado;
      if (estado === 'activo') query = query.in('estado_actual', ESTADOS_ACTIVOS);
      if (estado === 'entrevistas') query = query.in('estado_actual', ESTADOS_ENTREVISTA);
      if (estado === 'oferta') query = query.eq('estado_actual', 'oferta_recibida');
      if (estado === 'cerrados') query = query.in('estado_actual', ESTADOS_CERRADOS);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const postulaciones = (data || []).map((p) => ({
        ...p,
        timeline_eventos: (p.timeline_eventos || []).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      }));

      const { data: objetivos, error: objError } = await supabase
        .from('bitacora_objetivos')
        .select('*')
        .eq('activo', true)
        .order('creado_en', { ascending: true });

      if (objError) return res.status(500).json({ error: objError.message });

      return res.status(200).json({ postulaciones, objetivos: objetivos || [] });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    const { accion } = req.body || {};
    if (!accion) return res.status(400).json({ error: 'Falta el campo "accion"' });

    // ---------- crear_postulacion ----------
    if (accion === 'crear_postulacion') {
      const {
        empresa, cargo, origen = 'manual', link_oferta = null, modalidad = null,
        seniority = null, compatibilidad = null, cv_usado_id = null,
        palabras_clave = null, objetivo_id = null
      } = req.body;

      if (!empresa || !cargo) return res.status(400).json({ error: 'empresa y cargo son obligatorios' });

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) return res.status(401).json({ error: userError?.message || 'Sesión inválida' });

      const { data, error } = await supabase.from('postulaciones').insert({
        usuario_id: userData.user.id, empresa, cargo, origen, link_oferta, modalidad,
        seniority, compatibilidad, cv_usado_id, palabras_clave, objetivo_id, estado_actual: 'postule'
      }).select().single();

      if (error) return res.status(500).json({ error: error.message });

      await supabase.from('timeline_eventos').insert({ postulacion_id: data.id, tipo_evento: 'postule' });
      return res.status(201).json({ postulacion: data });
    }

    // ---------- actualizar_estado ----------
    if (accion === 'actualizar_estado') {
      const { postulacion_id, tipo_evento, fecha = null, hora = null, modalidad = null, etiqueta_libre = null, nota = null } = req.body;

      if (!postulacion_id || !tipo_evento) return res.status(400).json({ error: 'postulacion_id y tipo_evento son obligatorios' });
      if (tipo_evento === 'otro_paso' && !etiqueta_libre) return res.status(400).json({ error: 'etiqueta_libre es obligatoria para "otro_paso"' });

      const insertPayload = { postulacion_id, tipo_evento, modalidad, etiqueta_libre, nota };
      if (fecha) insertPayload.fecha = fecha;
      if (hora) insertPayload.hora = hora;

      const { data, error } = await supabase.from('timeline_eventos').insert(insertPayload).select().single();
      if (error) {
        const status = error.code === '42501' ? 403 : 500;
        return res.status(status).json({ error: error.message });
      }
      return res.status(201).json({ evento: data });
    }

    // ---------- agregar_objetivo ----------
    if (accion === 'agregar_objetivo') {
      const { cargo_objetivo } = req.body;
      if (!cargo_objetivo || !cargo_objetivo.trim()) return res.status(400).json({ error: 'cargo_objetivo es obligatorio' });

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) return res.status(401).json({ error: userError?.message || 'Sesión inválida' });

      const { data, error } = await supabase.from('bitacora_objetivos')
        .insert({ usuario_id: userData.user.id, cargo_objetivo: cargo_objetivo.trim() }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ objetivo: data });
    }

    // ---------- editar_objetivo ----------
    if (accion === 'editar_objetivo') {
      const { objetivo_id, cargo_objetivo } = req.body;
      if (!objetivo_id) return res.status(400).json({ error: 'objetivo_id es obligatorio' });
      if (!cargo_objetivo || !cargo_objetivo.trim()) return res.status(400).json({ error: 'cargo_objetivo es obligatorio' });

      const { data, error } = await supabase.from('bitacora_objetivos')
        .update({ cargo_objetivo: cargo_objetivo.trim() }).eq('id', objetivo_id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ objetivo: data });
    }

    // ---------- eliminar_objetivo ----------
    // Las postulaciones que tenían este objetivo quedan con objetivo_id = null
    // (no se borran, solo pierden la etiqueta).
    if (accion === 'eliminar_objetivo') {
      const { objetivo_id } = req.body;
      if (!objetivo_id) return res.status(400).json({ error: 'objetivo_id es obligatorio' });

      await supabase.from('postulaciones').update({ objetivo_id: null }).eq('objetivo_id', objetivo_id);

      const { error } = await supabase.from('bitacora_objetivos').delete().eq('id', objetivo_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // ---------- editar_postulacion ----------
    if (accion === 'editar_postulacion') {
      const { postulacion_id, ...cambios } = req.body;
      if (!postulacion_id) return res.status(400).json({ error: 'postulacion_id es obligatorio' });

      const update = {};
      for (const campo of CAMPOS_EDITABLES) {
        if (cambios[campo] !== undefined) update[campo] = cambios[campo];
      }
      if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });
      if ('empresa' in update && !update.empresa.trim()) return res.status(400).json({ error: 'Empresa no puede quedar vacía' });
      if ('cargo' in update && !update.cargo.trim()) return res.status(400).json({ error: 'Cargo no puede quedar vacío' });

      const { data, error } = await supabase.from('postulaciones').update(update).eq('id', postulacion_id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ postulacion: data });
    }

    // ---------- eliminar_postulacion ----------
    if (accion === 'eliminar_postulacion') {
      const { postulacion_id } = req.body;
      if (!postulacion_id) return res.status(400).json({ error: 'postulacion_id es obligatorio' });

      const { error, count } = await supabase.from('postulaciones').delete({ count: 'exact' }).eq('id', postulacion_id);
      if (error) return res.status(500).json({ error: error.message });
      if (count === 0) return res.status(404).json({ error: 'Postulación no encontrada' });
      return res.status(200).json({ ok: true });
    }

    // ---------- eliminar_evento ----------
    if (accion === 'eliminar_evento') {
      const { evento_id } = req.body;
      if (!evento_id) return res.status(400).json({ error: 'evento_id es obligatorio' });

      const { data: evento, error: findError } = await supabase.from('timeline_eventos').select('postulacion_id').eq('id', evento_id).single();
      if (findError || !evento) return res.status(404).json({ error: 'Evento no encontrado' });
      const postulacionId = evento.postulacion_id;

      const { error: delError } = await supabase.from('timeline_eventos').delete().eq('id', evento_id);
      if (delError) return res.status(500).json({ error: delError.message });

      const { data: restantes } = await supabase.from('timeline_eventos')
        .select('tipo_evento, fecha, creado_en')
        .eq('postulacion_id', postulacionId)
        .in('tipo_evento', TIPOS_ESTADO)
        .order('fecha', { ascending: false })
        .order('creado_en', { ascending: false })
        .limit(1);

      if (restantes && restantes.length > 0) {
        await supabase.from('postulaciones').update({ estado_actual: restantes[0].tipo_evento }).eq('id', postulacionId);
      }
      return res.status(200).json({ ok: true });
    }

    // ---------- guardar_reflexion ----------
    // Notas opcionales sobre una entrevista puntual (con quién hablaste, cómo
    // te sentiste, qué salió bien, etc). Vive en el evento, no en la
    // postulación completa. Nunca es obligatorio.
    if (accion === 'guardar_reflexion') {
      const { evento_id, reflexion } = req.body;
      if (!evento_id) return res.status(400).json({ error: 'evento_id es obligatorio' });
      if (!reflexion || typeof reflexion !== 'object') return res.status(400).json({ error: 'reflexion es obligatoria' });

      const { data, error } = await supabase.from('timeline_eventos')
        .update({ reflexion }).eq('id', evento_id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ evento: data });
    }

    // ---------- generar_insight ----------
    if (accion === 'generar_insight') {
      // Traemos las postulaciones del usuario (mismo shape que el listado)
      const { data: postus, error: postuError } = await supabase
        .from('postulaciones')
        .select('empresa, cargo, modalidad, estado_actual, origen, timeline_eventos ( tipo_evento, fecha )')
        .order('fecha_ultima_actividad', { ascending: false });

      if (postuError) return res.status(500).json({ error: postuError.message });

      const postulaciones = postus || [];

      // Con pocos datos, no forzamos un "patrón" — devolvemos un mensaje
      // motivacional simple, sin llamar al modelo (cero costo, y evita
      // conclusiones prematuras/falsas con datos insuficientes).
      if (postulaciones.length < 3) {
        return res.status(200).json({
          texto: postulaciones.length === 0
            ? 'Aún no hay datos para mostrar un patrón — a medida que registres postulaciones, vas a empezar a ver qué te está funcionando mejor.'
            : `Vas construyendo tu bitácora 🌱 — con ${postulaciones.length} postulación${postulaciones.length === 1 ? '' : 'es'} registrada${postulaciones.length === 1 ? '' : 's'}, todavía es pronto para ver un patrón. Sigue registrando y vuelve a pedir el análisis más adelante.`,
          evidencia: [],
          esGenerico: true
        });
      }

      // Armamos un resumen compacto y verificable de los datos reales
      const resumen = postulaciones.map(p => {
        const entrevistas = (p.timeline_eventos || []).filter(e =>
          ['entrevista_rrhh', 'entrevista_tecnica', 'entrevista_final'].includes(e.tipo_evento)
        ).length;
        return `- ${p.empresa} · ${p.cargo} · modalidad: ${p.modalidad || 'sin especificar'} · estado actual: ${p.estado_actual} · eventos de entrevista: ${entrevistas} · origen: ${p.origen}`;
      }).join('\n');

      const prompt = `Estos son los datos reales de búsqueda de empleo de un usuario (${postulaciones.length} postulaciones):

${resumen}

Identifica UN patrón real y útil basado ÚNICAMENTE en estos datos (nunca inventes información que no esté aquí). Responde en JSON puro, sin texto adicional ni markdown, con este formato exacto:
{"texto": "una frase corta y cercana (máx 220 caracteres) describiendo el patrón, en español de Chile, tono cálido no corporativo", "evidencia": ["dato concreto 1 que respalda el patrón", "dato concreto 2", "dato concreto 3 (opcional)"]}

Los ítems de "evidencia" deben ser hechos verificables directamente de la lista de arriba (nombres de empresa, conteos, modalidades) — nunca opiniones ni suposiciones.`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error('Anthropic API error:', errText);
        return res.status(200).json({
          texto: 'No pudimos generar tu insight en este momento — inténtalo de nuevo en un rato.',
          evidencia: [],
          esGenerico: true
        });
      }

      const aiData = await aiRes.json();
      let textoRespuesta = aiData?.content?.[0]?.text || '{}';
      textoRespuesta = textoRespuesta.replace(/```json/gi, '').replace(/```/g, '').trim();

      let parsed;
      try {
        // Por si el modelo agrega texto extra alrededor del JSON
        const match = textoRespuesta.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(match ? match[0] : textoRespuesta);
      } catch (e) {
        console.error('No se pudo parsear la respuesta del modelo:', textoRespuesta);
        parsed = { texto: textoRespuesta.slice(0, 220), evidencia: [] };
      }

      return res.status(200).json({
        texto: parsed.texto || 'No pudimos generar un insight claro esta vez.',
        evidencia: Array.isArray(parsed.evidencia) ? parsed.evidencia : []
      });
    }

    return res.status(400).json({ error: 'Acción desconocida: ' + accion });

  } catch (err) {
    console.error('bitacora/index error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
