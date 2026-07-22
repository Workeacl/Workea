// api/cv-check.js — Revisión de CV de candidato vs descriptor
// Genera sugerencias puntuales + mail listo para enviar

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { descriptor, cv, nombre, codigo } = req.body || {};

  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Codigo de acceso invalido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  const dcStr = String(descriptor || '').trim();
  const cvStr = String(cv || '').trim();
  const nombreStr = String(nombre || 'el candidato').trim();

  if (!dcStr || !cvStr) {
    return res.status(400).json({ error: 'Faltan el descriptor o el CV' });
  }

  const system = 'Eres una especialista en reclutamiento con amplia experiencia en seleccion de perfiles tecnologicos y digitales en Latinoamerica. ' +
    'Tu tarea es revisar el CV de un candidato comparandolo con el descriptor del cargo para identificar si refleja bien su experiencia. ' +
    'El objetivo NO es reescribir el CV sino dar 2-3 sugerencias puntuales y accionables para que el candidato agregue palabras clave o ajuste el enfoque. ' +
    'Responde UNICAMENTE con JSON valido, sin markdown: ' +
    '{"evaluacion_general":"1-2 lineas destacando que el candidato tiene fit y por que valen la pena las sugerencias",' +
    '"sugerencias":[{"titulo":"nombre corto de la sugerencia","descripcion":"que hacer y por que en 2-3 lineas","ejemplo":"ejemplo concreto de como redactarlo, si aplica"}],' +
    '"mail":"el mail completo listo para copiar y enviar"}. ' +
    'Maximo 3 sugerencias. Las sugerencias deben ser especificas, no genericas. ' +
    'El mail debe tener este tono exacto: cercano pero profesional, directo, constructivo, con urgencia si aplica. ' +
    'Estructura del mail: saludo con nombre, frase positiva de fit, "te sugiero hacer unos ajustes a tu CV:", las sugerencias numeradas con titulo y descripcion (incluir ejemplo cuando ayude), cierre motivador, firma "Quedamos atentas" o similar segun contexto. ' +
    'Sin comillas escapadas, sin saltos de linea especiales dentro del JSON.';

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
        max_tokens: 2000,
        system,
        messages: [{
          role: 'user',
          content: 'DESCRIPTOR DEL CARGO:\n' + dcStr + '\n\nCV DEL CANDIDATO (' + nombreStr + '):\n' + cvStr + '\n\nNombre del candidato: ' + nombreStr + '\n\nGenera la revision en JSON.'
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 200));
      return res.status(502).json({ error: 'Error del servicio' });
    }

    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let jsonStr = txt.replace(/```json|```/g, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'Respuesta inesperada. Intenta de nuevo.' });
    }
    jsonStr = jsonStr.slice(start, end + 1)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');

    try {
      return res.status(200).json(JSON.parse(jsonStr));
    } catch(e) {
      console.error('Parse error:', e.message);
      return res.status(500).json({ error: 'Error procesando la respuesta. Intenta de nuevo.' });
    }
  } catch(e) {
    console.error('CV check error:', e.message);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
}
