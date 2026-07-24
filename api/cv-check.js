// api/cv-check.js — Revision de CV de candidato vs descriptor
// Usa Anthropic tool use para garantizar JSON valido sin parseo manual

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
    'Tu tarea es revisar el CV de un candidato comparandolo con el descriptor del cargo, usando la herramienta generar_revision. ' +
    'El objetivo NO es reescribir el CV sino dar 2-3 sugerencias puntuales y accionables para que el candidato agregue palabras clave o ajuste el enfoque. ' +
    'El mail debe tener este tono exacto: cercano pero profesional, directo, constructivo, con urgencia si aplica. ' +
    'Estructura del mail: saludo con nombre, frase positiva de fit, "te sugiero hacer unos ajustes a tu CV:", las sugerencias numeradas con titulo y descripcion (incluir ejemplo cuando ayude), cierre motivador, firma "Quedamos atentas" o similar segun contexto.';

  const tool = {
    name: 'generar_revision',
    description: 'Genera la revision del CV del candidato con sugerencias y el mail listo para enviar',
    input_schema: {
      type: 'object',
      properties: {
        evaluacion_general: { type: 'string', description: '1-2 lineas destacando que el candidato tiene fit y por que valen la pena las sugerencias' },
        sugerencias: {
          type: 'array',
          description: 'Maximo 3 sugerencias especificas y accionables, no genericas',
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string', description: 'nombre corto de la sugerencia' },
              descripcion: { type: 'string', description: 'que hacer y por que, en 2-3 lineas' },
              ejemplo: { type: 'string', description: 'ejemplo concreto de como redactarlo, si aplica, string vacio si no aplica' }
            },
            required: ['titulo', 'descripcion', 'ejemplo']
          }
        },
        mail: { type: 'string', description: 'el mail completo listo para copiar y enviar al candidato, siguiendo el tono indicado' }
      },
      required: ['evaluacion_general', 'sugerencias', 'mail']
    }
  };

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
        tools: [tool],
        tool_choice: { type: 'tool', name: 'generar_revision' },
        messages: [{
          role: 'user',
          content: 'DESCRIPTOR DEL CARGO:\n' + dcStr + '\n\nCV DEL CANDIDATO (' + nombreStr + '):\n' + cvStr + '\n\nNombre del candidato: ' + nombreStr
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 300));
      return res.status(502).json({ error: 'Error del servicio' });
    }

    const toolUse = (data.content || []).find(b => b.type === 'tool_use');
    if (!toolUse || !toolUse.input) {
      console.error('Sin tool_use en respuesta:', JSON.stringify(data).substring(0, 300));
      return res.status(500).json({ error: 'Respuesta inesperada. Intenta de nuevo.' });
    }

    return res.status(200).json(toolUse.input);
  } catch(e) {
    console.error('CV check error:', e.message);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
}
