// api/relato.js — Workea Relato
//
// Ayuda a la persona a construir cómo contar una parte compleja de su
// trayectoria laboral (vacío, despido, cambio de carrera, pausa, etc.)
// en una entrevista, sin inventar ni sobreexplicarse.
//
// Dos niveles:
//   accion: 'vista_previa'  → gratis, sin código. Lectura del reclutador
//                             + relato breve (20-30 seg).
//   accion: 'completo'      → exige código RL-. Tres versiones del relato,
//                             preguntas difíciles con cómo encararlas, y
//                             qué no necesita sobreexplicar.

const SUPABASE_URL = 'https://pqelcrlxarendwearcwl.supabase.co';

// Control de abuso de la versión gratis (mismo criterio que el Esencial
// de Match): una vista previa por IP cada 24 horas. Nunca bloquea si algo
// falla del lado del servidor.
async function verificarLimiteGratis(ip) {
  if (!ip) return { ok: true };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { ok: true };

  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const UN_DIA_MS = 24 * 60 * 60 * 1000;

  try {
    const url = `${SUPABASE_URL}/rest/v1/relato_usos?ip=eq.${encodeURIComponent(ip)}&select=ip,ultimo_uso`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      const fila = Array.isArray(rows) ? rows[0] : null;
      if (fila?.ultimo_uso && (Date.now() - new Date(fila.ultimo_uso).getTime()) < UN_DIA_MS) {
        return { ok: false, error: 'Ya usaste tu vista previa gratuita hoy. Vuelve mañana, o accede al relato completo para tener las tres versiones y las preguntas difíciles de tu caso.' };
      }
    }
    await fetch(`${SUPABASE_URL}/rest/v1/relato_usos`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ip, ultimo_uso: new Date().toISOString() })
    });
    return { ok: true };
  } catch (e) {
    console.error('Error verificando límite de Relato:', e);
    return { ok: true };
  }
}

async function validarCodigoRelato(codigoLimpio) {
  if (codigoLimpio.toUpperCase() === 'WORKEA2026') return { ok: true };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { ok: false, status: 500, error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel' };
  }

  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const url = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&select=codigo,plan,estado`;
  const r = await fetch(url, { headers });
  if (!r.ok) return { ok: false, status: 502, error: 'No se pudo verificar el código. Intenta de nuevo.' };

  const rows = await r.json();
  const fila = Array.isArray(rows) ? rows[0] : null;
  if (!fila) return { ok: false, status: 401, error: 'Código de acceso inválido' };
  if (String(fila.plan || '').trim() !== 'relato') {
    return { ok: false, status: 401, error: 'Este código no corresponde a Workea Relato' };
  }
  if (fila.estado === 'usado') {
    return { ok: false, status: 401, error: 'Este código ya fue utilizado. Cada código sirve para un relato.' };
  }

  const patchUrl = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&estado=eq.libre`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ estado: 'usado' })
  });
  if (!patchRes.ok) return { ok: false, status: 502, error: 'No se pudo activar el código. Intenta de nuevo.' };
  const actualizadas = await patchRes.json().catch(() => []);
  if (!Array.isArray(actualizadas) || actualizadas.length === 0) {
    return { ok: false, status: 401, error: 'Este código ya fue utilizado. Cada código sirve para un relato.' };
  }
  return { ok: true };
}

// Base metodológica común a ambos niveles. Define el criterio de
// selección de personas que diferencia esto de un generador genérico.
const SISTEMA = `Eres una psicóloga laboral chilena con más de 7 años en selección de personal. Has entrevistado a cientos de candidatos y has estado del otro lado de la mesa evaluando trayectorias con vacíos, despidos, cambios de rubro y pausas de todo tipo.

Tu tarea es ayudar a una persona a ordenar cómo contar una parte compleja de su historia laboral en una entrevista.

REGLAS INNEGOCIABLES:
- Nunca inventes actividades, cursos, proyectos ni aprendizajes que la persona no haya mencionado. Si estuvo buscando trabajo y nada más, el relato debe poder decir eso con naturalidad.
- Nunca patologices una pausa laboral ni asumas que es negativa. Tampoco la disfraces de oportunidad maravillosa.
- Nada de falsa positividad ni clichés de coaching. Prohibido: "tuve la oportunidad de", "me permitió crecer personal y profesionalmente", "estoy sumamente motivada para aportar", "todo pasa por algo".
- El relato debe sonar HABLADO, como lo diría una persona real en una entrevista. Frases cortas. Lenguaje natural chileno neutro, sin modismos marcados.
- Háblale siempre a la persona de «tú» (tuteo): nunca uses voseo ni formas como «decí», «tenés», «podés», «contá», «mirá»; escribe «di», «tienes», «puedes», «cuenta», «mira».
- Distingue siempre entre lo que ocurrió y cómo se comunica. No se trata de mentir, se trata de contextualizar.
- Si detectas un problema real de empleabilidad, dilo con honestidad y sin dramatizar.
- Al hablar de lo que podría pensar un reclutador, usa lenguaje probabilístico: "podría surgir la duda", "es probable que te pregunten". Nunca afirmes que el reclutador pensará algo negativo.

IMPORTANTE SOBRE EL FORMATO: ningún texto dentro del JSON puede contener comillas dobles (") en su interior. Si necesitas citar algo, usa comillas simples.`;

function construirContexto(datos) {
  const d = datos || {};
  const partes = [];
  if (d.situacion) partes.push(`Situación que quiere preparar: ${d.situacion}`);
  if (d.ultimo_cargo) partes.push(`Último cargo: ${d.ultimo_cargo}`);
  if (d.tiempo) partes.push(`Tiempo transcurrido: ${d.tiempo}`);
  if (d.que_hizo) partes.push(`Qué hizo durante ese período: ${d.que_hizo}`);
  if (d.busca) partes.push(`Qué busca ahora: ${d.busca}`);
  if (d.oferta) partes.push(`Oferta a la que postula:\n"""\n${d.oferta}\n"""`);
  if (d.reservado) partes.push(`La persona prefiere NO entrar en detalles sobre: ${d.reservado}. Respeta eso: ayúdala a dar contexto profesional sin revelar lo que quiere mantener privado.`);
  return partes.join('\n');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  try {
    const { accion, datos, codigo } = req.body || {};
    const contexto = construirContexto(datos);

    if (!datos || !datos.situacion) {
      return res.status(400).json({ error: 'Falta indicar la situación que quieres preparar' });
    }

    // ---------- VISTA PREVIA (gratis) ----------
    if (accion === 'vista_previa') {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
      const limite = await verificarLimiteGratis(ip);
      if (!limite.ok) return res.status(429).json({ error: limite.error });

      const prompt = `${SISTEMA}

Esta es una VISTA PREVIA gratuita. Entrega solo dos cosas, bien hechas.

Datos de la persona:
${contexto}

Responde en JSON puro:
{
  "lectura_reclutador": {
    "resumen": "una frase honesta sobre qué requiere contexto en esta trayectoria, sin dramatizar",
    "dudas": ["3 o 4 preguntas concretas que podrían surgirle a quien revise su perfil, redactadas como se las preguntaría de verdad"],
    "nota": "una frase que baje la ansiedad sin falsa positividad, explicando que esto no es necesariamente negativo pero conviene tener claridad"
  },
  "relato_breve": "la versión de 20-30 segundos, hablada y natural, lista para decir en una entrevista. Sin preámbulos ni frases de relleno."
}`;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await r.json();
      if (!r.ok) {
        console.error('Anthropic error:', JSON.stringify(data).substring(0, 300));
        return res.status(502).json({ error: 'No pudimos generar tu relato en este momento. Intenta de nuevo en un rato.' });
      }
      if (data?.stop_reason === 'max_tokens') {
        return res.status(502).json({ error: 'La respuesta quedó incompleta — intenta de nuevo' });
      }

      let texto = (data?.content?.[0]?.text || '{}').replace(/```json/gi, '').replace(/```/g, '').trim();
      let resultado;
      try {
        resultado = JSON.parse(texto);
      } catch (e) {
        const match = texto.match(/\{[\s\S]*\}/);
        if (match) { try { resultado = JSON.parse(match[0]); } catch (e2) {} }
        if (!resultado) {
          console.error('No se pudo parsear la vista previa:', texto.substring(0, 300));
          return res.status(502).json({ error: 'No se pudo interpretar la respuesta. Intenta de nuevo.' });
        }
      }
      return res.status(200).json(resultado);
    }

    // ---------- RELATO COMPLETO (pagado) ----------
    if (accion === 'completo') {
      const codigoLimpio = (codigo || '').trim();
      if (!codigoLimpio) return res.status(401).json({ error: 'Necesitas un código de acceso' });
      if (codigoLimpio.toUpperCase() !== 'WORKEA2026' && !codigoLimpio.toUpperCase().startsWith('RL-')) {
        return res.status(401).json({ error: 'Este código no corresponde a Workea Relato' });
      }
      const validacion = await validarCodigoRelato(codigoLimpio.toUpperCase());
      if (!validacion.ok) return res.status(validacion.status).json({ error: validacion.error });

      const prompt = `${SISTEMA}

Datos de la persona:
${contexto}

Genera el relato completo. Responde en JSON puro:
{
  "lectura_reclutador": {
    "resumen": "una frase honesta sobre qué requiere contexto en esta trayectoria",
    "dudas": ["3 o 4 preguntas concretas que podrían surgir al revisar su perfil"],
    "nota": "una frase que baje la ansiedad sin falsa positividad"
  },
  "relato_breve": "versión de 20-30 segundos, hablada y natural",
  "relato_entrevista": "versión de 45-60 segundos: contexto, qué hizo, qué rescata, qué busca ahora y por qué este tipo de cargo tiene sentido. Hablada, sin sonar ensayada",
  "relato_ampliado": "versión para cuando el entrevistador profundiza. Más detalle, pero sin volverse una justificación larga",
  "preguntas_dificiles": [
    {
      "pregunta": "la pregunta tal como se la harían en la entrevista",
      "transmitir": "qué conviene que quede claro al responder",
      "evitar": "qué conviene no hacer al responder esta pregunta en particular",
      "respuesta_ejemplo": "una respuesta posible, hablada y breve",
      "por_que_funciona": "por qué esa respuesta funciona, desde la mirada de quien selecciona"
    }
  ],
  "no_sobreexplicar": {
    "principio": "una frase sobre dónde está el límite entre dar contexto y sobreexplicarse en este caso",
    "puntos": ["2 o 3 cosas concretas que esta persona NO necesita detallar, con una alternativa profesional para cada una"]
  },
  "mensaje_central": "la única idea que esta persona debería lograr transmitir sobre su transición, en una frase",
  "recomendacion_final": "un consejo de comunicación para esta persona en particular, directo y sin clichés"
}

Genera entre 5 y 7 preguntas difíciles, solo las que apliquen de verdad a este caso. No incluyas preguntas genéricas que no correspondan a su situación.`;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await r.json();
      if (!r.ok) {
        console.error('Anthropic error:', JSON.stringify(data).substring(0, 300));
        return res.status(502).json({ error: 'No pudimos generar tu relato en este momento. Intenta de nuevo en un rato.' });
      }
      if (data?.stop_reason === 'max_tokens') {
        return res.status(502).json({ error: 'El relato quedó incompleto — intenta de nuevo' });
      }

      let texto = (data?.content?.[0]?.text || '{}').replace(/```json/gi, '').replace(/```/g, '').trim();
      let resultado;
      try {
        resultado = JSON.parse(texto);
      } catch (e) {
        const match = texto.match(/\{[\s\S]*\}/);
        if (match) { try { resultado = JSON.parse(match[0]); } catch (e2) {} }
        if (!resultado) {
          console.error('No se pudo parsear el relato:', texto.substring(0, 300));
          return res.status(502).json({ error: 'No se pudo interpretar la respuesta. Intenta de nuevo.' });
        }
      }
      return res.status(200).json(resultado);
    }

    return res.status(400).json({ error: 'Acción desconocida' });
  } catch (err) {
    console.error('relato error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
