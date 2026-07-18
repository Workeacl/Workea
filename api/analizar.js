// api/analizar.js — Función serverless de Workea (Vercel)
// Recibe {oferta, cv, codigo} y devuelve el análisis Workea en JSON.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { oferta, ofertas, cv, codigo } = req.body || {};

  // Códigos de acceso: WORKEA_CODIGO acepta uno o varios separados por coma.
  // Ej: "ANA-7GK2, PEDRO-9XL4, PILOTO1" — cada cliente puede tener el suyo.
  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Código de acceso inválido' });
  }

  // Normaliza: acepta una oferta (texto) o hasta 3 ofertas (lista)
  let listaOfertas = Array.isArray(ofertas) ? ofertas : (oferta ? [oferta] : []);
  listaOfertas = listaOfertas.map(o => String(o || '').trim()).filter(o => o.length >= 40).slice(0, 3);

  if (!listaOfertas.length || !cv || cv.length < 40) {
    return res.status(400).json({ error: 'Falta la oferta o el CV (o son muy breves)' });
  }
  if (listaOfertas.some(o => o.length > 20000) || cv.length > 20000) {
    return res.status(400).json({ error: 'El texto es demasiado largo' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en Vercel' });
  }

  const system = `Eres el motor de análisis de Workea (by Tu Partner Laboral), una plataforma chilena de empleabilidad creada por especialistas en selección. Tu tarea: analizar una oferta laboral y compararla con el CV de la persona, siguiendo la metodología Workea.

PRINCIPIOS OBLIGATORIOS:
- La explicación cualitativa importa más que el porcentaje.
- NUNCA inventes experiencia, logros, habilidades o certificaciones que no estén en el CV.
- NUNCA asumas que la persona tiene una habilidad solo porque la oferta la pide.
- Para las brechas usa lenguaje cuidadoso: "no se identifica claramente en tu CV", nunca afirmes que la persona carece de algo.
- Nunca digas "no postules": la recomendación más baja es "revisa antes de postular".
- No recomiendes keyword stuffing: solo sugiere términos que describan experiencia real.
- Si la oferta tiene señales relevantes (contratación vía consultora externa, condiciones inusuales, información faltante), menciónalo en "observacion".
- Tono: cercano, claro, profesional, humano. Trata a la persona de "tú". Español de Chile neutro.

Responde ÚNICAMENTE con un objeto JSON válido, sin markdown ni texto adicional, con esta estructura exacta:
{
 "info": {"cargo": "", "empresa": "", "ubicacion": "", "modalidad": "", "seniority": ""},
 "compatibilidad": {"porcentaje": 0, "titulo": "frase resumen de una línea", "lectura": "párrafo explicativo de 3-5 líneas"},
 "observacion": "señal relevante sobre la oportunidad misma, o null",
 "fortalezas": [{"titulo": "", "detalle": ""}],
 "oportunidades": [{"titulo": "", "detalle": ""}],
 "brechas": [{"titulo": "", "detalle": ""}],
 "insuficiente": [{"titulo": "", "detalle": ""}],
 "claves": [{"palabra": "", "estado": "presente|relacionada|no", "nota": ""}],
 "cv": [{"seccion": "", "actual": "", "recomendacion": "", "porque": ""}],
 "entrevista": [{"pregunta": "", "evalua": "", "preparar": ""}],
 "recomendacion": {"nivel": "verde|amarillo|naranjo|rojo", "titulo": "", "detalle": ""},
 "comparacion": [{"oferta": "cargo — empresa", "porcentaje": 0, "veredicto": "1-2 líneas: por qué este orden de prioridad"}]
}
Si recibes UNA sola oferta, omite "comparacion" (o déjala como lista vacía). Si recibes VARIAS ofertas: incluye "comparacion" ordenada de mayor a menor prioridad de postulación, y desarrolla TODO el análisis detallado sobre la oferta prioritaria, indicando en compatibilidad.titulo a qué oferta corresponde.
Incluye 3-6 fortalezas, 2-4 oportunidades, 0-3 brechas, 0-3 insuficiente, 8-12 claves, 3-4 recomendaciones de CV y 5-6 preguntas de entrevista. Los campos de "info" que no aparezcan en la oferta déjalos como string vacío.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 5000,
        system,
        messages: [{
          role: 'user',
          content: listaOfertas.map((o, i) => `OFERTA LABORAL ${i + 1}:\n${o}`).join('\n\n---\n\n')
            + `\n\n---\n\nCV DE LA PERSONA:\n${cv}\n\nGenera el análisis Workea en JSON.`
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Error Anthropic:', data);
      return res.status(502).json({ error: 'El servicio de análisis no respondió correctamente' });
    }

    const texto = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const limpio = texto.replace(/```json|```/g, '').trim();
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    const json = JSON.parse(limpio.slice(inicio, fin + 1));

    return res.status(200).json(json);
  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: 'No se pudo generar el análisis. Intenta de nuevo.' });
  }
}
