// api/recruiter.js — Workea Recruiter (herramienta interna)
// Archivo independiente de analizar.js — no afecta a Workea candidatos

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { texto, imagenes, pais, codigo } = req.body || {};

  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Código de acceso inválido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en Vercel' });

  const textoRec = String(texto || '').trim();
  const listaImagenes = Array.isArray(imagenes) ? imagenes.slice(0, 2) : [];
  if (!textoRec && !listaImagenes.length) {
    return res.status(400).json({ error: 'Falta el descriptor del cargo' });
  }

  const system = `Eres el motor de Workea Recruiter, herramienta interna para una especialista en reclutamiento de perfiles tecnológicos y digitales en Latinoamérica. Analiza el descriptor (puede ser formal, un correo o apuntes desordenados) y genera una estrategia completa de búsqueda de talento para el país indicado.

Responde ÚNICAMENTE con JSON válido, sin markdown ni texto adicional:
{
  "cargo": "",
  "empresa": "",
  "pais": "",
  "seniority": "Junior|Semi Senior|Senior|Lead|Manager",
  "entendimiento": "qué hace esta persona, en qué contexto, qué impacto tiene (3-4 líneas simples, sin tecnicismos)",
  "criticos": [{"requisito": "", "nota": "por qué es crítico"}],
  "deseables": [{"requisito": ""}],
  "competencias_tecnicas": [""],
  "competencias_conductuales": [""],
  "palabras_clave": {
    "titulos_principales": [""],
    "titulos_alternativos": [""],
    "terminos_tecnicos": [""],
    "booleana_sugerida": "búsqueda booleana lista para usar en LinkedIn Recruiter"
  },
  "donde_buscar": {
    "empresas": [{"nombre": "", "razon": "por qué suelen estar aquí"}],
    "sectores_afines": [""],
    "comunidades": [""],
    "plataformas": [""]
  },
  "benchmark_salarial": {
    "rango_min": 0,
    "rango_max": 0,
    "moneda": "CLP|COP|ARS|MXN|PEN|USD",
    "fuente_referencial": "plataforma o encuesta consultada",
    "lectura": "si hay salario propuesto: bajo/alineado/sobre mercado. Si no hay: rango sugerido",
    "argumento_cliente": "qué decirle al cliente si el salario es bajo o no está definido"
  },
  "preguntas_entrevista": [
    {
      "pregunta": "",
      "tipo": "técnica|competencia|situacional",
      "que_evalua": "",
      "respuesta_ideal": "qué debería responder un buen candidato"
    }
  ],
  "alertas": ["señales de alerta: requisitos contradictorios, expectativas irreales, cosas que el cliente no dice pero implica"],
  "estrategia_resumen": "3-4 líneas con el foco recomendado, qué va a ser difícil y cómo abordarlo"
}

Incluye 3-5 críticos, 2-4 deseables, 5-8 títulos principales, 3-5 alternativos, 5-8 empresas donde buscar, benchmark en moneda local del país, y 5-6 preguntas de entrevista (mix técnicas y competencias). Si el descriptor es informal o incompleto, infiere con criterio experto y marca las inferencias en alertas.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system,
        messages: [{
          role: 'user',
          content: [
            ...listaImagenes.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
            ...(listaImagenes.length ? [{ type: 'text', text: 'La imagen es el descriptor del cargo.' }] : []),
            { type: 'text', text: `DESCRIPTOR:\n${textoRec}\n\nPAÍS DEL PROCESO: ${pais || 'Chile'}\n\nGenera la estrategia en JSON.` }
          ]
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'Error del servicio de análisis' });

    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = txt.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
    return res.status(200).json(JSON.parse(clean.slice(start, end + 1)));
  } catch(e) {
    console.error('Recruiter error:', e);
    return res.status(500).json({ error: 'No se pudo generar la estrategia. Intenta de nuevo.' });
  }
}
