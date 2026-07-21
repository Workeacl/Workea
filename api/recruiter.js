// api/recruiter.js — Workea Recruiter (herramienta interna)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { texto, imagenes, pais, codigo } = req.body || {};

  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Codigo de acceso invalido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  const textoRec = String(texto || '').trim();
  const listaImagenes = Array.isArray(imagenes) ? imagenes.slice(0, 1) : [];
  if (!textoRec && !listaImagenes.length) {
    return res.status(400).json({ error: 'Falta el descriptor del cargo' });
  }

  const system = 'Eres un experto en reclutamiento de perfiles tecnologicos y digitales en Latinoamerica. ' +
    'Analiza el descriptor de cargo (puede ser formal, un correo o apuntes) y genera una estrategia de busqueda para el pais indicado. ' +
    'Responde UNICAMENTE con JSON valido sin markdown. Esquema exacto: ' +
    '{"cargo":"","empresa":"","pais":"","seniority":"","entendimiento":"descripcion simple del rol en 3 lineas",' +
    '"criticos":[{"requisito":"","nota":""}],"deseables":[{"requisito":""}],' +
    '"competencias_tecnicas":[""],"competencias_conductuales":[""],' +
    '"palabras_clave":{"titulos_principales":[""],"titulos_alternativos":[""],"terminos_tecnicos":[""],"booleana_sugerida":""},' +
    '"donde_buscar":{"empresas":[{"nombre":"","razon":""}],"sectores_afines":[""],"comunidades":[""],"plataformas":[""]},' +
    '"benchmark_salarial":{"rango_min":0,"rango_max":0,"moneda":"","fuente_referencial":"","lectura":"","argumento_cliente":""},' +
    '"preguntas_entrevista":[{"pregunta":"","tipo":"tecnica|competencia","que_evalua":"","respuesta_ideal":""}],' +
    '"alertas":[""],"estrategia_resumen":""}. ' +
    'Incluye 3-4 criticos, 2-3 deseables, 5 titulos principales, 3 alternativos, 5 empresas, benchmark en moneda local, 4 preguntas.';

  try {
    const content = [
      ...listaImagenes.map(im => ({
        type: 'image',
        source: { type: 'base64', media_type: im.media_type, data: im.data }
      })),
      ...(listaImagenes.length ? [{ type: 'text', text: 'La imagen es el descriptor del cargo.' }] : []),
      {
        type: 'text',
        text: 'DESCRIPTOR:\n' + textoRec + '\n\nPAIS: ' + (pais || 'Chile') + '\n\nGenera la estrategia en JSON.'
      }
    ];

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system,
        messages: [{ role: 'user', content }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Error del servicio de analisis: ' + (data.error?.message || 'desconocido') });
    }

    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = txt.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) {
      console.error('JSON no encontrado en respuesta:', clean.substring(0, 200));
      return res.status(500).json({ error: 'Respuesta inesperada del servicio' });
    }
    return res.status(200).json(JSON.parse(clean.slice(start, end + 1)));
  } catch (e) {
    console.error('Recruiter error:', e.message);
    return res.status(500).json({ error: 'No se pudo generar la estrategia: ' + e.message });
  }
}
