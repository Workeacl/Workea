// api/cv/index.js
//
// Endpoint único de Workea CV — mismo patrón que api/bitacora/index.js:
// todas las acciones en un solo archivo para no sumar funciones nuevas
// al conteo del plan Hobby de Vercel (hoy: 7 raíz + bitacora/index.js +
// este = 9, con margen).
//
// Rutas:
//   POST /api/cv   { accion: 'crear_orden', cv_original, plan, oferta_referencia?, empresa_referencia? }
//   POST /api/cv   { accion: 'diagnosticar', orden_id }
//   POST /api/cv   { accion: 'optimizar', orden_id, respuestas: [{pregunta, respuesta}] }
//   POST /api/cv   { accion: 'generar_mensaje', orden_id }
//   POST /api/cv   { accion: 'elegir_plantilla', orden_id, plantilla }
//   GET  /api/cv?orden_id=...   (trae una orden completa)

const { getSupabaseForRequest } = require('../bitacora/_supabaseClient');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const SUPABASE_URL = 'https://pqelcrlxarendwearcwl.supabase.co';

// Valida un código de acceso de Workea CV contra la tabla "codigos"
// de Supabase (mismo patrón que api/analizar.js para Match).
// El código debe existir, tener plan === el plan pedido, y no estar vencido.
async function validarCodigoCv(codigoLimpio, planPedido, usuarioId) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { ok: false, status: 500, error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel' };
  }

  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const url = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&select=codigo,plan,estado,vence,usado_por`;
  const r = await fetch(url, { headers });
  if (!r.ok) return { ok: false, status: 502, error: 'No se pudo verificar el código. Intenta de nuevo.' };

  const rows = await r.json();
  const fila = Array.isArray(rows) ? rows[0] : null;
  if (!fila) return { ok: false, status: 401, error: 'Código de acceso inválido' };

  const planCodigo = String(fila.plan || '').trim();
  // El plan en Supabase se guarda con el mismo código corto que usa el
  // resto del sitio ('diagnostico'/'optimizado'/'pro'), igual convención
  // que usa Match ('match'/'experto') — no un texto largo.
  if (planCodigo !== String(planPedido).trim()) {
    return { ok: false, status: 401, error: 'Este código no corresponde al plan "' + planPedido + '"' };
  }

  // Si el código ya fue activado antes, solo la MISMA cuenta que lo
  // activó puede seguir usándolo (necesario porque el plan Optimizado/Pro
  // se trabaja en varias sesiones). Cualquier otra cuenta queda bloqueada
  // — esto es lo que evita que un código se comparta con más gente.
  if (fila.estado === 'usado') {
    if (fila.usado_por !== usuarioId) {
      return { ok: false, status: 401, error: 'Este código ya fue activado por otra cuenta.' };
    }
    if (fila.vence && new Date(fila.vence).getTime() < Date.now()) {
      return { ok: false, status: 401, error: 'Tu acceso venció. Adquiere un nuevo plan para continuar.' };
    }
    return { ok: true };
  }

  // Primer uso real: lo marcamos 'usado' y lo atamos a esta cuenta,
  // de forma atómica (el filtro estado=eq.libre evita que 2 personas
  // ganen la carrera si intentan usarlo en el mismo instante).
  const vence = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const patchUrl = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&estado=eq.libre`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ estado: 'usado', usado_por: usuarioId, vence: vence.toISOString() })
  });

  if (!patchRes.ok) {
    return { ok: false, status: 502, error: 'No se pudo activar el código. Intenta de nuevo.' };
  }
  const actualizadas = await patchRes.json().catch(() => []);
  if (!Array.isArray(actualizadas) || actualizadas.length === 0) {
    // Alguien más ganó la carrera justo en este instante.
    return { ok: false, status: 401, error: 'Este código ya fue activado por otra cuenta.' };
  }

  return { ok: true };
}

async function llamarClaudeUnaVez(prompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Anthropic API error: ' + errText);
  }
  const data = await res.json();
  let texto = data?.content?.[0]?.text || '{}';
  texto = texto.replace(/```json/gi, '').replace(/```/g, '').trim();

  if (data?.stop_reason === 'max_tokens') {
    console.error('Respuesta cortada por max_tokens. Texto parcial:', texto);
    throw new Error('__INCOMPLETA__');
  }

  try {
    return JSON.parse(texto);
  } catch (e) {
    const match = texto.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) { /* sigue abajo */ }
    }
    console.error('No se pudo parsear la respuesta del modelo:', texto);
    throw new Error('__MAL_FORMADO__');
  }
}

// Reintenta una vez si la respuesta vino incompleta o mal formada — en la
// práctica, un segundo intento casi siempre sale limpio, y evita mostrarle
// el error al usuario por un problema pasajero del modelo.
async function llamarClaude(prompt, maxTokens = 1000) {
  try {
    return await llamarClaudeUnaVez(prompt, maxTokens);
  } catch (e) {
    if (e.message === '__INCOMPLETA__' || e.message === '__MAL_FORMADO__') {
      console.error('Primer intento falló (' + e.message + '), reintentando una vez…');
      try {
        return await llamarClaudeUnaVez(prompt, maxTokens);
      } catch (e2) {
        if (e2.message === '__INCOMPLETA__') {
          throw new Error('La respuesta del modelo quedó incompleta — intenta de nuevo (puede que tu CV sea muy largo)');
        }
        throw new Error('No se pudo interpretar la respuesta del modelo, incluso tras reintentar');
      }
    }
    throw e;
  }
}

module.exports = async (req, res) => {
  try {
    const { supabase, error: authError } = getSupabaseForRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
    const usuarioId = userData.user.id;

    // ---------- GET: traer una orden ----------
    if (req.method === 'GET') {
      const { orden_id } = req.query || {};
      if (!orden_id) return res.status(400).json({ error: 'orden_id es obligatorio' });

      const { data, error } = await supabase.from('cv_ordenes').select('*').eq('id', orden_id).single();
      if (error) return res.status(404).json({ error: 'Orden no encontrada' });
      return res.status(200).json({ orden: data });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const { accion } = req.body || {};
    if (!accion) return res.status(400).json({ error: 'Falta el campo "accion"' });

    // ---------- extraer_texto ----------
    // El frontend sube el archivo como base64 (sin necesidad de un
    // servicio de storage aparte — para el volumen de un CV es liviano).
    if (accion === 'extraer_texto') {
      const { archivo_base64, tipo } = req.body;
      if (!archivo_base64 || !tipo) return res.status(400).json({ error: 'archivo_base64 y tipo son obligatorios' });

      const buffer = Buffer.from(archivo_base64, 'base64');
      let texto = '';

      try {
        if (tipo === 'pdf') {
          const resultado = await pdfParse(buffer);
          texto = resultado.text;
        } else if (tipo === 'docx') {
          const resultado = await mammoth.extractRawText({ buffer });
          texto = resultado.value;
        } else {
          return res.status(400).json({ error: 'Tipo de archivo no soportado (usa pdf o docx)' });
        }
      } catch (e) {
        return res.status(422).json({ error: 'No pudimos leer ese archivo. ¿Está dañado o protegido con contraseña?' });
      }

      texto = texto.trim();
      if (!texto || texto.length < 40) {
        return res.status(422).json({ error: 'El archivo no parece tener texto legible (¿es una imagen escaneada?)' });
      }

      return res.status(200).json({ texto });
    }

    // ---------- crear_orden ----------
    if (accion === 'crear_orden') {
      const { cv_original, plan, codigo, oferta_referencia = null, empresa_referencia = null } = req.body;
      if (!cv_original || !plan) return res.status(400).json({ error: 'cv_original y plan son obligatorios' });

      // Código maestro (para pruebas internas), igual que en Match.
      const esMaestro = String(codigo || '').trim().toUpperCase() === 'WORKEA2026';
      if (!esMaestro) {
        const codigoLimpio = String(codigo || '').trim();
        if (!codigoLimpio) return res.status(401).json({ error: 'Necesitas un código de acceso válido para este plan' });
        if (!codigoLimpio.toUpperCase().startsWith('WC-')) {
          return res.status(401).json({ error: 'Este código no corresponde a Workea CV' });
        }
        const resultado = await validarCodigoCv(codigoLimpio.toUpperCase(), plan, usuarioId);
        if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
      }

      const { data, error } = await supabase.from('cv_ordenes').insert({
        usuario_id: usuarioId, cv_original, plan, oferta_referencia, empresa_referencia
      }).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ orden: data });
    }

    // A partir de acá, todas las acciones operan sobre una orden existente
    const { orden_id } = req.body;
    if (!orden_id) return res.status(400).json({ error: 'orden_id es obligatorio' });

    const { data: orden, error: ordenError } = await supabase.from('cv_ordenes').select('*').eq('id', orden_id).single();
    if (ordenError || !orden) return res.status(404).json({ error: 'Orden no encontrada' });

    // ---------- generar_insight_cv (Workea Insight, paso 1) ----------
    // En vez de preguntar por cifras sueltas, detecta fortalezas que el CV
    // insinúa pero no comunica con claridad, y arma UNA pregunta cerrada
    // (opción múltiple o sí/no) por cada una — rápido de responder, nunca
    // un formulario largo.
    if (accion === 'generar_insight_cv') {
      if (orden.plan === 'diagnostico') {
        return res.status(403).json({ error: 'El plan Diagnóstico no incluye Workea Insight' });
      }

      const prompt = `Eres una psicóloga laboral especializada en reclutamiento. Lee este CV y detecta entre 3 y 4 fortalezas reales que probablemente existen en la experiencia de esta persona, pero que el CV no comunica con claridad (quedan implícitas, minimizadas, o mezcladas con otras tareas).

CV:
"""
${orden.cv_original}
"""
${orden.oferta_referencia ? `\nOferta de referencia:\n"""\n${orden.oferta_referencia}\n"""` : ''}

Para cada fortaleza detectada, escribe una explicación breve de por qué crees que está ahí pero no se ve, y UNA pregunta cerrada (opción múltiple con 2-4 alternativas, o sí/no) que permita confirmarla con un solo tap — nunca pidas texto libre.

No inventes fortalezas que no tengan ninguna base en el CV — cada una debe poder señalarse a una frase o dato real del texto.

IMPORTANTE sobre el formato: ningún texto dentro del JSON puede contener comillas dobles (") en su interior.

Responde en JSON puro:
{
  "areas": [
    {
      "titulo": "nombre corto de la fortaleza, ej: Gestión de clientes",
      "contexto": "por qué crees que está ahí pero no se ve, en 1-2 frases, citando algo real del CV",
      "pregunta": "la pregunta cerrada para confirmarlo",
      "opciones": ["opción 1", "opción 2", "opción 3 (si aplica)"]
    }
  ]
}`;

      const resultado = await llamarClaude(prompt, 1400);
      return res.status(200).json({ areas: resultado.areas || [] });
    }

    // ---------- sintetizar_insight (Workea Insight, paso 2) ----------
    // Con las respuestas ya confirmadas por el usuario, arma los hallazgos
    // finales + una simulación de cómo un reclutador leería el perfil hoy.
    if (accion === 'sintetizar_insight') {
      if (orden.plan === 'diagnostico') {
        return res.status(403).json({ error: 'El plan Diagnóstico no incluye Workea Insight' });
      }
      const { respuestas = [] } = req.body;

      const respuestasTexto = respuestas.length
        ? respuestas.map(r => `- ${r.titulo}: pregunta "${r.pregunta}" → respuesta confirmada: ${r.respuesta}`).join('\n')
        : '(el usuario no confirmó ninguna)';

      const prompt = `Con base en este CV y en las fortalezas que el usuario acaba de confirmar (nunca inventes nada fuera de esto), genera:

1. Un resumen de los hallazgos confirmados — solo los que el usuario efectivamente confirmó, no los que quedaron sin responder.
2. Una simulación honesta de cómo un reclutador leería este perfil HOY, antes de optimizarlo — sé real, no artificialmente positivo.

CV:
"""
${orden.cv_original}
"""

Fortalezas exploradas y respuesta del usuario:
${respuestasTexto}

IMPORTANTE sobre el formato: ningún texto dentro del JSON puede contener comillas dobles (") en su interior.

Responde en JSON puro:
{
  "hallazgos": [
    {"titulo": "nombre de la fortaleza confirmada", "descripcion": "explicación breve de qué revela y por qué es valiosa"}
  ],
  "lectura_reclutador": {
    "primera_impresion": "una frase de cómo se percibe el perfil a primera vista",
    "nivel_percibido": "ej: Semi Senior con potencial a Senior",
    "atractivo": "lo más atractivo del perfil tal como está hoy",
    "dudas": "qué podría generar dudas o preguntas en un reclutador",
    "reforzar": "qué es lo más importante a reforzar"
  }
}`;

      const resultado = await llamarClaude(prompt, 1200);
      return res.status(200).json({
        hallazgos: resultado.hallazgos || [],
        lectura_reclutador: resultado.lectura_reclutador || null
      });
    }

    // ---------- diagnosticar ----------
    if (accion === 'diagnosticar') {
      const prompt = `Eres un experto en reclutamiento y sistemas ATS. Analiza este CV real y da un diagnóstico honesto, basado ÚNICAMENTE en el contenido que aparece abajo (nunca inventes datos que no estén ahí).

CV:
"""
${orden.cv_original}
"""
${orden.oferta_referencia ? `\nOferta de referencia:\n"""\n${orden.oferta_referencia}\n"""` : ''}

IMPORTANTE sobre el formato: ningún texto dentro del JSON puede contener comillas dobles (") en su interior — si necesitas nombrar una alternativa o sinónimo, sepáralo con "o" o "/" sin comillas (ejemplo correcto: RRHH o Recursos Humanos — NO: "RRHH" o "Recursos Humanos").

Responde en JSON puro, sin texto adicional, con este formato exacto:
{
  "score": <número 0-100, compatibilidad ATS estimada>,
  "fortalezas": ["punto fuerte real 1", "punto fuerte real 2"],
  "alertas": ["problema real detectado 1", "problema real detectado 2", "problema real detectado 3"],
  "keywords_faltantes": ["palabra clave relevante 1", "palabra clave relevante 2"]
}

El score y las alertas deben poder justificarse con el contenido real del CV. No inventes logros ni cifras que no estén en el texto.`;

      const diagnostico = await llamarClaude(prompt, 1300);

      const { data, error } = await supabase.from('cv_ordenes')
        .update({ diagnostico, estado: 'diagnosticado' })
        .eq('id', orden_id).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ orden: data });
    }

    // ---------- optimizar ----------
    // Recibe los hallazgos confirmados en Workea Insight (o respuestas del
    // formato anterior, por compatibilidad) y reescribe el CV con eso.
    if (accion === 'optimizar') {
      if (orden.plan === 'diagnostico') {
        return res.status(403).json({ error: 'El plan Diagnóstico no incluye optimización' });
      }
      const { respuestas = [], hallazgos = [] } = req.body;

      const respuestasTexto = respuestas.length
        ? respuestas.map(r => `- ${r.pregunta} → ${r.respuesta || '(sin responder, no usar cifra)'}`).join('\n')
        : '';
      const hallazgosTexto = hallazgos.length
        ? hallazgos.map(h => `- ${h.titulo}: ${h.descripcion}`).join('\n')
        : '';
      const infoConfirmada = [respuestasTexto, hallazgosTexto].filter(Boolean).join('\n') || '(el usuario no confirmó información adicional)';

      const prompt = `Reescribe este CV de forma profesional y optimizada para ATS. Reglas estrictas:
- NUNCA inventes logros, cifras o experiencia que no estén en el CV original o en la información confirmada por el usuario abajo.
- Si hay un hallazgo confirmado (una fortaleza que el CV no comunicaba con claridad), incorpóralo de forma natural en el resumen profesional y/o en el bullet de experiencia correspondiente — esa información SÍ está autorizada a usarse, porque el propio usuario la confirmó.
- Mejora verbos de acción, claridad y estructura, pero el contenido factual debe venir siempre del usuario.
- Revisa el CV completo y no omitas ninguna sección que tenga: cursos/certificaciones, herramientas o software específico, e idiomas — cada una va en su propio campo del JSON, no las mezcles ni las dejes fuera.

CV original:
"""
${orden.cv_original}
"""

Información adicional confirmada por el usuario:
${infoConfirmada}

IMPORTANTE sobre el formato: ningún texto dentro del JSON puede contener comillas dobles (") en su interior.

Responde en JSON puro con este formato:
{
  "resumen_profesional": "texto reescrito del resumen",
  "experiencia": [
    {"cargo": "...", "empresa": "...", "periodo": "...", "bullets": ["bullet reescrito 1", "bullet reescrito 2"]}
  ],
  "habilidades": ["habilidad 1", "habilidad 2"],
  "herramientas": ["herramienta o software mencionado, ej: LinkedIn Recruiter, Excel avanzado — solo si el CV original las menciona"],
  "idiomas": ["idioma y nivel, ej: Inglés avanzado — solo si el CV original los menciona"],
  "cursos_certificaciones": ["nombre del curso o certificación (institución, año) — solo si el CV original los menciona"]
}`;

      const cv_optimizado = await llamarClaude(prompt, 3200);

      const { data, error } = await supabase.from('cv_ordenes')
        .update({
          cv_optimizado,
          preguntas_respuestas: respuestas,
          estado: 'optimizado'
        })
        .eq('id', orden_id).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ orden: data });
    }

    // ---------- generar_mensaje ----------
    // Mensaje corto de presentación + tips de postulación (vive dentro
    // de Workea CV, no es un producto aparte — ver decisión de diseño).
    if (accion === 'generar_mensaje') {
      if (orden.plan === 'diagnostico') {
        return res.status(403).json({ error: 'El plan Diagnóstico no incluye mensaje de presentación' });
      }
      if (!orden.cv_optimizado) {
        return res.status(400).json({ error: 'Primero optimiza el CV antes de generar el mensaje' });
      }

      const prompt = `Con base en este CV ya optimizado${orden.oferta_referencia ? ' y esta oferta laboral' : ''}, escribe:
1. Un mensaje corto de presentación (2-4 líneas, tono profesional pero cercano, para LinkedIn o un formulario de postulación — NO es una carta formal larga).
2. 2-3 tips concretos de estrategia de postulación para este caso específico.

CV optimizado:
"""
${JSON.stringify(orden.cv_optimizado)}
"""
${orden.oferta_referencia ? `\nOferta:\n"""\n${orden.oferta_referencia}\n"""\nEmpresa: ${orden.empresa_referencia || 'no especificada'}` : ''}

IMPORTANTE sobre el formato: ningún texto dentro del JSON puede contener comillas dobles (") en su interior.

Responde en JSON puro:
{
  "mensaje": "el mensaje corto de presentación",
  "tips": ["tip concreto 1", "tip concreto 2"]
}

No inventes datos del candidato que no estén en el CV.`;

      const resultado = await llamarClaude(prompt, 1000);

      const { data, error } = await supabase.from('cv_ordenes')
        .update({
          mensaje_presentacion: resultado.mensaje || '',
          tips_postulacion: resultado.tips || [],
          estado: 'completo'
        })
        .eq('id', orden_id).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ orden: data });
    }

    // ---------- generar_banco_historias ----------
    // Extrae 3-4 experiencias reales del CV en formato STAR, para que
    // Entrevistas deje de usar preguntas genéricas y use la experiencia
    // real de la persona como base de práctica.
    if (accion === 'generar_banco_historias') {
      if (orden.plan === 'diagnostico') {
        return res.status(403).json({ error: 'El plan Diagnóstico no incluye Banco de Historias' });
      }
      if (!orden.cv_optimizado) {
        return res.status(400).json({ error: 'Primero optimiza tu CV antes de generar el banco de historias' });
      }

      const prompt = `Eres una psicóloga laboral. Lee este CV y extrae entre 3 y 4 experiencias reales que se puedan contar como historias completas en formato STAR (Situación, Desafío, Acción, Resultado) — útiles para practicar entrevistas.

CV:
"""
${orden.cv_original}
"""

Usa ÚNICAMENTE información real del CV — si un elemento STAR no está claro en el texto, complétalo de forma genérica pero honesta (ej. "Resultado no especificado en el CV — te recomendamos cuantificarlo antes de tu entrevista"), nunca inventes cifras o detalles que no estén ahí.

IMPORTANTE sobre el formato: ningún texto dentro del JSON puede contener comillas dobles (") en su interior.

Responde en JSON puro:
{
  "historias": [
    {
      "titulo": "nombre corto de la historia, ej: Liderazgo de equipo en Fintech X",
      "situacion": "qué estaba pasando",
      "desafio": "qué problema o reto había",
      "accion": "qué hizo la persona específicamente",
      "resultado": "qué ocurrió (o nota honesta si el CV no lo especifica)",
      "competencias": ["competencia 1", "competencia 2"]
    }
  ]
}`;

      const resultado = await llamarClaude(prompt, 3000);
      const historias = resultado.historias || [];

      const { data, error } = await supabase.from('cv_ordenes')
        .update({ banco_historias: historias })
        .eq('id', orden_id).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ orden: data });
    }

    // ---------- elegir_plantilla ----------
    if (accion === 'elegir_plantilla') {
      if (orden.plan !== 'pro') {
        return res.status(403).json({ error: 'Elegir plantilla es exclusivo del plan Pro' });
      }
      const { plantilla } = req.body;
      const validas = ['minimal', 'professional', 'harvard', 'executive', 'tech', 'creative'];
      if (!validas.includes(plantilla)) return res.status(400).json({ error: 'Plantilla inválida' });

      const { data, error } = await supabase.from('cv_ordenes')
        .update({ plantilla_elegida: plantilla })
        .eq('id', orden_id).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ orden: data });
    }

    return res.status(400).json({ error: 'Acción desconocida: ' + accion });

  } catch (err) {
    console.error('cv/index error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
