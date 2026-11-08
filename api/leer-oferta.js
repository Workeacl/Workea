// api/leer-oferta.js — lee una oferta laboral desde su link
//
// Lo usa el botón "Analízala con Workea" de Workea Empleos (workea.cl/empleos):
// recibe ?url=<link de la oferta>, entra a la página y devuelve el texto de
// la oferta para dejarlo pegado en Workea Match. No usa IA ni guarda nada.
//
// Respuesta: { ok: true, titulo, empresa, texto, completo }  ó  { ok: false }
//   completo = true  → venía en formato estructurado (texto limpio de la oferta)
//   completo = false → texto aproximado de la página (conviene revisarlo)

const MAX_BYTES = 1500000;
const MAX_TEXTO = 8000;

function urlPermitida(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  // No permitir direcciones internas
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^(\d+\.){3}\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null;
  }
  if (h.includes(':')) return null; // IPv6 literal
  return u.toString();
}

function decodificar(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
}

// HTML → texto legible, conservando saltos de línea en listas y párrafos
function htmlATexto(html) {
  let s = String(html || '');
  if (/&lt;\/?[a-z]/i.test(s)) s = decodificar(s); // descripciones con HTML "escapado"
  return decodificar(
    s
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<(br|\/p|\/div|\/h\d|\/li|\/ul|\/ol|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buscarJobPosting(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = buscarJobPosting(x); if (r) return r; }
    return null;
  }
  const t = obj['@type'];
  if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return obj;
  if (obj['@graph']) return buscarJobPosting(obj['@graph']);
  return null;
}

function extraer(html) {
  // 1) Datos estructurados JobPosting (los usan LinkedIn, Laborum, Computrabajo, etc.)
  const bloques = html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const b of bloques) {
    try {
      const json = JSON.parse(b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim());
      const o = buscarJobPosting(json);
      if (!o) continue;
      const titulo = decodificar(o.title || o.name || '').trim();
      const org = o.hiringOrganization;
      const empresa = decodificar(typeof org === 'string' ? org : (org && org.name) || '').trim();
      let lugar = Array.isArray(o.jobLocation) ? o.jobLocation[0] : o.jobLocation;
      const dir = lugar && typeof lugar.address === 'object' ? lugar.address : null;
      const ubicacion = dir ? [dir.addressLocality, dir.addressRegion].filter(Boolean).join(', ') : '';
      const descripcion = htmlATexto(o.description || '');
      if (descripcion.length < 40) continue;
      const cabecera = [
        titulo && `Cargo: ${titulo}`,
        empresa && `Empresa: ${empresa}`,
        ubicacion && `Ubicación: ${decodificar(ubicacion)}`,
      ].filter(Boolean).join('\n');
      return { titulo, empresa, texto: (cabecera ? cabecera + '\n\n' : '') + descripcion, completo: true };
    } catch (e) { /* bloque inválido */ }
  }

  // 2) Sin datos estructurados: texto principal de la página
  const meta = (p) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)`, 'i'))
           || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, 'i'));
    return m ? decodificar(m[1]).trim() : '';
  };
  const titulo = (meta('og:title') || decodificar((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''))
    .split(/\s+\|\s+/)[0].trim();
  const zona = (html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<body[\s\S]*<\/body>/i) || [html])[0]
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const texto = htmlATexto(zona);
  if (texto.length < 200) return null; // casi vacío: probablemente bloqueado o requiere login
  return { titulo, empresa: '', texto: (titulo ? `Cargo: ${titulo}\n\n` : '') + texto, completo: false };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const url = urlPermitida(String((req.query && req.query.url) || ''));
  if (!url) return res.status(400).json({ ok: false, error: 'Link no válido' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CL,es;q=0.9',
      },
    });
    if (!r.ok) return res.status(200).json({ ok: false });
    const tipo = r.headers.get('content-type') || '';
    if (!/html/i.test(tipo)) return res.status(200).json({ ok: false });
    let html = await r.text();
    if (html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);

    const datos = extraer(html);
    if (!datos) return res.status(200).json({ ok: false });
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json({ ok: true, ...datos, texto: datos.texto.slice(0, MAX_TEXTO) });
  } catch (e) {
    return res.status(200).json({ ok: false });
  } finally {
    clearTimeout(timer);
  }
};
