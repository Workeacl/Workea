// api/analizar.js — Función serverless de Workea (Vercel)
// Recibe {oferta, cv, codigo} y devuelve el análisis Workea en JSON.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { oferta, cv, codigo } = req.body || {};

  // Código de acceso (opcional): si defines WORKEA_CODIGO en Vercel, se exige.
  const codigoRequerido = process.env.WORKEA_CODIGO;
  if (codigoRequerido && codigo !== codigoRequerido) {
    return res.status(401).json({ error: 'Código de acceso inválido' });
  }

  if (!oferta || !cv || oferta.length < 40 || cv.length < 40) {
    return res.status(400).json({ error: 'Falta la oferta o el CV (o son muy breves)' });
  }
  if (oferta.length > 20000 || cv.length > 20000) {
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
 "recomendacion": {"nivel": "verde|amarillo|naranjo|rojo", "titulo": "", "detalle": ""}
}
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
        max_tokens: 4000,
        system,
        messages: [{
          role: 'user',
          content: `OFERTA LABORAL:\n${oferta}\n\n---\n\nCV DE LA PERSONA:\n${cv}\n\nGenera el análisis Workea en JSON.`
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
