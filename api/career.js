// api/career.js — Workea Career (Ruta Profesional)
// Independiente de los demás endpoints
//
// CAMBIO: se agregó búsqueda web real (tool nativo de Anthropic) para
// incluir 3-5 ofertas laborales REALES y actuales en el informe, bajo
// el campo "oportunidades_reales". No se guarda nada, no se mantiene
// una base de datos propia de ofertas — se busca fresco en cada informe.
//
// CAMBIO: la validación de código ahora usa la misma tabla "codigos"
// de Supabase que Match y CV (antes usaba una variable de entorno
// simple sin control de vencimiento ni de reutilización — cualquiera
// con un código CAR- podía compartirlo sin límite).

const SUPABASE_URL = 'https://pqelcrlxarendwearcwl.supabase.co';

async function validarCodigoCareer(codigoLimpio) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { ok: false, status: 500, error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel' };
  }

  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const url = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&select=codigo,plan,estado,vence`;
  const r = await fetch(url, { headers });
  if (!r.ok) return { ok: false, status: 502, error: 'No se pudo verificar el código. Intenta de nuevo.' };

  const rows = await r.json();
  const fila = Array.isArray(rows) ? rows[0] : null;
  if (!fila) return { ok: false, status: 401, error: 'Código de acceso inválido' };

  // El plan en Supabase se guarda corto ('career'), igual convención
  // que usa Match ('match'/'experto') — no un texto largo.
  if (String(fila.plan || '').trim() !== 'career') {
    return { ok: false, status: 401, error: 'Este código no corresponde a Workea Career' };
  }

  if (fila.vence) {
    if (new Date(fila.vence).getTime() < Date.now()) {
      return { ok: false, status: 401, error: 'Tu acceso venció. Adquiere un nuevo informe para continuar.' };
    }
    return { ok: true };
  }

  // Primer uso real: fijamos "vence" ahora mismo (30 días de acceso).
  const vence = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const patchUrl = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&vence=is.null`;
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ vence: vence.toISOString() })
  }).catch(() => console.error('No se pudo fijar "vence" para', codigoLimpio));

  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { cv, contexto, codigo } = req.body || {};

  const codigoLimpio = (codigo || '').trim();
  const esMaestro = codigoLimpio.toUpperCase() === 'WORKEA2026';

  if (!esMaestro) {
    if (!codigoLimpio) return res.status(401).json({ error: 'Código de acceso inválido' });
    if (!codigoLimpio.toUpperCase().startsWith('CAR-')) {
      return res.status(401).json({ error: 'Este código no corresponde a Workea Career' });
    }
    const resultado = await validarCodigoCareer(codigoLimpio.toUpperCase());
    if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  const cvStr = String(cv || '').trim();
  if (!cvStr || cvStr.length < 80) {
    return res.status(400).json({ error: 'El CV ingresado es muy breve para construir tu ruta' });
  }

  const ctx = contexto || {};
  const ctxLines = [];
  if (ctx.orientacion) ctxLines.push('ORIENTACION BUSCADA: ' + ctx.orientacion);
  if (ctx.cargo_actual) ctxLines.push('Cargo actual: ' + ctx.cargo_actual);
  if (ctx.cargo_ideal) ctxLines.push('Cargo ideal en 3-5 anios: ' + ctx.cargo_ideal);
  if (ctx.industria) ctxLines.push('Industria de interes: ' + ctx.industria);
  if (ctx.especializar_liderar) ctxLines.push('Preferencia: ' + ctx.especializar_liderar);
  if (ctx.habilidades_faltantes) ctxLines.push('Habilidades que siente que le faltan: ' + ctx.habilidades_faltantes);
  if (ctx.prioridades && ctx.prioridades.length) ctxLines.push('Prioridades: ' + ctx.prioridades.join(', '));
  if (ctx.ingles) ctxLines.push('Nivel de ingles: ' + ctx.ingles);
  if (ctx.dispuesto_estudiar) ctxLines.push('Disposicion a estudiar este anio: ' + ctx.dispuesto_estudiar);
  const ctxStr = ctxLines.length ? ctxLines.join('\n') : 'Sin cuestionario adicional — inferir todo desde el CV.';

  const systemParts = [
    'Eres una especialista en seleccion y desarrollo de carrera con anios de experiencia como reclutadora en Latinoamerica.',
    'Tu tarea: analizar el CV (y contexto opcional) de una persona y construir su ruta profesional completa.',
    'Tono: honesto, calido, concreto. Como una reclutadora experimentada que quiere genuinamente ayudar.',
    'IMPORTANTE sobre la orientacion de la persona: si el contexto indica ORIENTACION BUSCADA, ajusta TODO el informe segun corresponda:',
    'Si es Crecer en mi area actual: enfoca el mapa_carrera en crecimiento vertical o lateral dentro de su area, brechas para el siguiente nivel, cargos_hoy y simulaciones dentro de su trayectoria natural.',
    'Si es Cambiar de area o industria: enfoca el mapa_carrera en 2 caminos de TRANSICION hacia areas distintas, identifica explicitamente que competencias de su experiencia actual son transferibles y por que, las brechas deben priorizar lo minimo necesario para cruzar al area nueva, cargos_hoy debe incluir roles puente que faciliten la transicion, y el consejo_reclutadora debe abordar honestamente que tan realista es el cambio y en cuanto tiempo aproximado.',
    'Si es Aun no lo se quiero explorar: el mapa_carrera debe presentar 2-3 direcciones bien distintas, incluyendo al menos una fuera de su area actual, basadas en sus fortalezas reales, sin asumir que quiere quedarse ni que quiere irse.',
    'Si no hay orientacion indicada, infierela del CV: senales de busqueda de cambio (industrias muy distintas, gaps, mensajes explicitos) sugieren tratar el caso como cambio o exploracion; una trayectoria lineal y consistente sugiere tratarlo como crecimiento.',
    'IMPORTANTE sobre datos de mercado: cuando fundamentes una recomendacion, usa formulaciones honestas como "la gran mayoria de las ofertas para este cargo piden..." o "es uno de los requisitos mas frecuentes del mercado" — NUNCA inventes porcentajes especificos.',
    'Los rangos salariales son referenciales del mercado chileno en CLP salvo que el CV indique otro pais.',
    'IMPORTANTE sobre oportunidades_reales: usa la herramienta de busqueda web para encontrar entre 3 y 5 ofertas laborales REALES y vigentes ahora mismo que calcen con el perfil (basadas en cargos_hoy y mapa_carrera). Busca UNICAMENTE en portales laborales reconocidos y confiables (LinkedIn, Laborum, Trabajando.com, Computrabajo, GetOnBoard, Indeed, o el sitio oficial de carreras de una empresa conocida) — nunca en sitios desconocidos, foros, o paginas sin reputacion establecida, para evitar recomendar publicaciones fraudulentas o de baja calidad. Cada una debe tener un link real que hayas encontrado en la busqueda — NUNCA inventes una oferta, una empresa o un link que no hayas visto realmente en los resultados de busqueda. Si no encuentras suficientes ofertas relevantes, vigentes y de fuentes confiables, incluye menos (incluso 0) — es preferible una lista corta y real que una larga con datos inventados o de fuentes dudosas.',
    'Responde UNICAMENTE con JSON valido, sin markdown. Estructura exacta:',
    'REGLA CRITICA DE FORMATO: dentro de cualquier valor de texto del JSON, nunca uses comillas dobles ("). Si necesitas citar una palabra o frase (ej: el cargo "senior"), usa comillas simples (\'senior\') o simplemente omite las comillas. Comillas dobles sin escapar dentro de un valor de texto rompen el JSON completo.',
    '{"titulo":"frase de 1 linea sobre el momento profesional de la persona",',
    '"resumen":"2-3 lineas sobre su situacion y potencial",',
    '"nivel_preparacion":0,',
    '"diagnostico":{"seniority":"","area":"","fortaleza_principal":"","experiencia":"X anios","competencias_fuertes":["max 5"],"competencias_debiles":["max 4"]},',
    '"cargos_hoy":[{"cargo":"","salario_ref":"$X.XXX.XXX - $X.XXX.XXX CLP aprox"}],',
    '"mapa_carrera":[{"nombre":"nombre del camino ej Camino de especializacion","descripcion":"1-2 lineas","cargos":["cargo1","cargo2","cargo3"]}],',
    '"brechas":[{"habilidad":"","nivel":"alto|medio|largo","razon":"por que importa, con contexto de mercado honesto"}],',
    '"simulaciones":[{"habilidad":"","beneficios":["beneficio concreto 1","beneficio 2","beneficio 3"]}],',
    '"riesgos":["riesgo concreto detectado en el CV, ej anios haciendo lo mismo, falta de logros cuantificables"],',
    '"oportunidades_ocultas":["camino lateral que la persona probablemente no ha considerado, con fundamento"],',
    '"oportunidades_reales":[{"cargo":"","empresa":"","portal":"nombre del sitio donde esta publicada, ej LinkedIn, Laborum, GetOnBoard","link":"URL real encontrada en la busqueda"}],',
    '"oportunidades_reales_aviso":"Estas ofertas se encontraron mediante busqueda en el momento. Verifica que sigan vigentes y confirma la legitimidad de la empresa antes de postular o compartir tus datos.",',
    '"plan_12_meses":[{"trimestre":"Q1","acciones":["accion 1","accion 2"]},{"trimestre":"Q2","acciones":[""]},{"trimestre":"Q3","acciones":[""]},{"trimestre":"Q4","acciones":[""]}],',
    '"consejo_reclutadora":"parrafo natural de 5-7 lineas, en primera persona, como si la persona estuviera sentada frente a ti. Menciona al menos un detalle CONCRETO de su CV o trayectoria (una empresa, un logro, un patron que viste). Prioriza lo que mas impacto tendria. Prohibido sonar generico o como plantilla."}',
    'Personaliza TODO al caso especifico de esta persona: usa detalles concretos de su CV (nombres de empresas, tecnologias, anios, logros) en vez de generalidades. Incluye: 3 cargos_hoy con salarios referenciales, 2 caminos en mapa_carrera bien diferenciados segun el perfil real, 5-6 brechas repartidas en niveles con razones especificas a su trayectoria, 2-3 simulaciones de las habilidades de MAYOR impacto con beneficios concretos, 2 riesgos basados en patrones reales de SU CV, 1-2 oportunidades ocultas conectadas a su experiencia real, 3-5 oportunidades_reales encontradas por busqueda web (o menos si no hay suficientes reales), y 2-3 acciones especificas por trimestre. Cada texto puede tener 2-3 lineas si aporta especificidad real — evita el relleno generico pero no sacrifiques el detalle que hace que la persona sienta que es SU informe.',
    'El consejo_reclutadora es la joya del informe: debe sentirse escrito para ESTA persona, no una plantilla.'
  ];
  const system = systemParts.join(' ');

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
        max_tokens: 7500,
        system,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: 'CV DE LA PERSONA:\n' + cvStr + '\n\nCONTEXTO ADICIONAL:\n' + ctxStr + '\n\nConstruye la ruta profesional en JSON, incluyendo oportunidades_reales encontradas por busqueda web.'
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 200));
      return res.status(502).json({ error: 'Error del servicio: ' + (data.error?.message || 'desconocido') });
    }

    if (data.stop_reason === 'max_tokens') {
      console.error('Respuesta cortada por max_tokens');
      return res.status(500).json({ error: 'Tu ruta quedo muy extensa. Intenta con un CV mas resumido.' });
    }
    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let jsonStr = txt.replace(/```json|```/g, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'Respuesta inesperada. Intenta de nuevo.' });
    }
    jsonStr = jsonStr.slice(start, end + 1);

    try {
      return res.status(200).json(JSON.parse(jsonStr));
    } catch(e1) {
      try {
        const clean = jsonStr
          .replace(/[\u0000-\u001F\u007F]/g, ' ')
          .replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
        return res.status(200).json(JSON.parse(clean));
      } catch(e2) {
        console.error('Parse error:', e2.message);
        return res.status(500).json({ error: 'Error procesando tu ruta. Intenta de nuevo.' });
      }
    }
  } catch(e) {
    console.error('Career error:', e.message);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
}
