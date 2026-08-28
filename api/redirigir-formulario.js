// api/redirigir-formulario.js — Puente entre Mercado Pago y el formulario
// correspondiente. Toma el payment_id que entrega Mercado Pago al
// redirigir, y arma la URL del formulario con el número de operación
// ya prellenado.
//
// Maneja 2 formularios en un solo endpoint (para no sumar funciones
// nuevas al plan Hobby de Vercel):
//   /api/redirigir-formulario                     → formulario de Match (sin cambios)
//   /api/redirigir-formulario?producto=cv&plan=X  → formulario de Workea CV

// ⚠️ PENDIENTE: reemplazar estos 2 valores por los reales una vez que
// dupliques el formulario de Match para Workea CV (ver instrucciones).
const FORM_CV_BASE = 'https://docs.google.com/forms/d/e/PENDIENTE_REEMPLAZAR/viewform';
const FORM_CV_ENTRY_OPERACION = 'entry.PENDIENTE_REEMPLAZAR';
const FORM_CV_ENTRY_PLAN = 'entry.PENDIENTE_REEMPLAZAR'; // opcional, si prellenas también el plan

const FORM_CAREER_BASE = 'https://docs.google.com/forms/d/e/PENDIENTE_REEMPLAZAR/viewform';
const FORM_CAREER_ENTRY_OPERACION = 'entry.PENDIENTE_REEMPLAZAR';

const FORM_MATCH_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLSe9UDo4wpX6gPw0rFjdl4_Jyr9gB5AUwckhuhOsoF5Gk_gv6g/viewform';
const FORM_MATCH_ENTRY_OPERACION = 'entry.1915985991';

// Mapeo del plan interno (usado en el código) al texto exacto que debe
// aparecer en la pregunta "Plan comprado" del formulario de CV.
const PLAN_CV_LABEL = {
  diagnostico: 'Workea CV Diagnóstico',
  optimizado: 'Workea CV Optimizado',
  pro: 'Workea CV Pro'
};

export default async function handler(req, res) {
  const fullUrl = new URL(req.url, `https://${req.headers.host}`);
  const paymentId = fullUrl.searchParams.get('payment_id') || fullUrl.searchParams.get('collection_id') || '';
  const producto = fullUrl.searchParams.get('producto') || '';
  const plan = fullUrl.searchParams.get('plan') || '';

  let url;

  if (producto === 'cv') {
    const params = new URLSearchParams({ usp: 'pp_url' });
    if (paymentId) params.set(FORM_CV_ENTRY_OPERACION, paymentId);
    if (plan && PLAN_CV_LABEL[plan]) params.set(FORM_CV_ENTRY_PLAN, PLAN_CV_LABEL[plan]);
    url = `${FORM_CV_BASE}?${params.toString()}`;
  } else if (producto === 'career') {
    url = paymentId
      ? `${FORM_CAREER_BASE}?usp=pp_url&${FORM_CAREER_ENTRY_OPERACION}=${encodeURIComponent(paymentId)}`
      : FORM_CAREER_BASE;
  } else {
    // ---------- Comportamiento original de Match, sin ningún cambio ----------
    url = paymentId
      ? `${FORM_MATCH_BASE}?usp=pp_url&${FORM_MATCH_ENTRY_OPERACION}=${encodeURIComponent(paymentId)}`
      : FORM_MATCH_BASE;
  }

  res.writeHead(302, { Location: url });
  res.end();
}
