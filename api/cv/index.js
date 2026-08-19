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

async function llamarClaude(prompt, maxTokens = 1000) {
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

  // Quitar bloques de código markdown si el modelo los agregó (```json ... ```)
  texto = texto.replace(/```json/gi, '').replace(/```/g, '').trim();

  // Si terminó por límite de tokens, avisamos algo más útil que un JSON roto
  if (data?.stop_reason === 'max_tokens') {
    console.error('Respuesta cortada por max_tokens. Texto parcial:', texto);
    throw new Error('La respuesta del modelo quedó incompleta — intenta de nuevo (puede que tu CV sea muy largo)');
  }

  try {
    return JSON.parse(texto);
  } catch (e) {
    const match = texto.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) { /* sigue al log de abajo */ }
    }
    console.error('No se pudo parsear la respuesta del modelo:', texto);
    throw new Error('No se pudo interpretar la respuesta del modelo');
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
      const { cv_original, plan, oferta_referencia = null, empresa_referencia = null } = req.body;
      if (!cv_original || !plan) return res.status(400).json({ error: 'cv_original y plan son obligatorios' });

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

    // ---------- generar_preguntas ----------
    // Detecta bullets/logros sin cifras o datos concretos, y genera
    // preguntas puntuales para pedírselos al usuario antes de optimizar
    // (nunca se inventan solos). Se salta si el plan es 'diagnostico'.
    if (accion === 'generar_preguntas') {
      if (orden.plan === 'diagnostico') {
        return res.status(403).json({ error: 'El plan Diagnóstico no incluye este paso' });
      }

      const prompt = `Lee este CV y detecta hasta 3 logros o bullets que serían más fuertes con un dato concreto (número de personas, porcentaje, monto, tiempo) que hoy no está escrito.

CV:
"""
${orden.cv_original}
"""

Para cada uno, genera una pregunta corta y directa para pedirle ese dato al usuario. Si el CV ya tiene suficientes datos cuantificados, devuelve una lista vacía — no fuerces preguntas innecesarias.

Responde en JSON puro:
{
  "preguntas": [
    {"contexto": "cita textual corta del bullet original", "pregunta": "pregunta directa y corta"}
  ]
}`;

      const resultado = await llamarClaude(prompt, 500);
      return res.status(200).json({ preguntas: resultado.preguntas || [] });
    }

    // ---------- diagnosticar ----------
    if (accion === 'diagnosticar') {
      const prompt = `Eres un experto en reclutamiento y sistemas ATS. Analiza este CV real y da un diagnóstico honesto, basado ÚNICAMENTE en el contenido que aparece abajo (nunca inventes datos que no estén ahí).

CV:
"""
${orden.cv_original}
"""
${orden.oferta_referencia ? `\nOferta de referencia:\n"""\n${orden.oferta_referencia}\n"""` : ''}

Responde en JSON puro, sin texto adicional, con este formato exacto:
{
  "score": <número 0-100, compatibilidad ATS estimada>,
  "fortalezas": ["punto fuerte real 1", "punto fuerte real 2"],
  "alertas": ["problema real detectado 1", "problema real detectado 2", "problema real detectado 3"],
  "keywords_faltantes": ["palabra clave relevante 1", "palabra clave relevante 2"]
}

El score y las alertas deben poder justificarse con el contenido real del CV. No inventes logros ni cifras que no estén en el texto.`;

      const diagnostico = await llamarClaude(prompt, 900);

      const { data, error } = await supabase.from('cv_ordenes')
        .update({ diagnostico, estado: 'diagnosticado' })
        .eq('id', orden_id).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ orden: data });
    }

    // ---------- optimizar ----------
    // Recibe las respuestas del usuario a las preguntas de datos faltantes
    // (o un array vacío si las omitió todas) y reescribe el CV con eso.
    if (accion === 'optimizar') {
      if (orden.plan === 'diagnostico') {
        return res.status(403).json({ error: 'El plan Diagnóstico no incluye optimización' });
      }
      const { respuestas = [] } = req.body;

      const respuestasTexto = respuestas.length
        ? respuestas.map(r => `- ${r.pregunta} → ${r.respuesta || '(sin responder, no usar cifra)'}`).join('\n')
        : '(el usuario no proporcionó datos adicionales)';

      const prompt = `Reescribe este CV de forma profesional y optimizada para ATS. Reglas estrictas:
- NUNCA inventes logros, cifras o experiencia que no estén en el CV original o en las respuestas del usuario.
- Si una respuesta del usuario da un dato concreto, úsalo. Si dice "sin responder", mejora la redacción sin agregar número.
- Mejora verbos de acción, claridad y estructura, pero el contenido factual debe venir siempre del usuario.

CV original:
"""
${orden.cv_original}
"""

Datos adicionales que el usuario confirmó:
${respuestasTexto}

Responde en JSON puro con este formato:
{
  "resumen_profesional": "texto reescrito del resumen",
  "experiencia": [
    {"cargo": "...", "empresa": "...", "periodo": "...", "bullets": ["bullet reescrito 1", "bullet reescrito 2"]}
  ],
  "habilidades": ["habilidad 1", "habilidad 2"]
}`;

      const cv_optimizado = await llamarClaude(prompt, 1400);

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

Responde en JSON puro:
{
  "mensaje": "el mensaje corto de presentación",
  "tips": ["tip concreto 1", "tip concreto 2"]
}

No inventes datos del candidato que no estén en el CV.`;

      const resultado = await llamarClaude(prompt, 600);

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
