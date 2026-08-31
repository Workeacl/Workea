// api/redirigir-formulario.js — Puente entre Mercado Pago y el
// formulario único de activación (compartido por Match, CV y Career).
// Toma el payment_id que entrega Mercado Pago, y arma la URL del
// formulario con el número de operación Y el plan comprado ya
// prellenados, para que la persona no tenga que copiarlos a mano.

const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLSe9UDo4wpX6gPw0rFjdl4_Jyr9gB5AUwckhuhOsoF5Gk_gv6g/viewform';
const ENTRY_OPERACION = 'entry.1915985991';

// entry.XXXXX real de la pregunta "Plan comprado" del formulario.
const ENTRY_PLAN = 'entry.1648320375';

export default async function handler(req, res) {
  const fullUrl = new URL(req.url, `https://${req.headers.host}`);
  const paymentId = fullUrl.searchParams.get('payment_id') || fullUrl.searchParams.get('collection_id') || '';
  const plan = fullUrl.searchParams.get('plan') || '';

  const params = new URLSearchParams({ usp: 'pp_url' });
  if (paymentId) params.set(ENTRY_OPERACION, paymentId);
  if (plan) params.set(ENTRY_PLAN, plan);

  const url = `${FORM_BASE}?${params.toString()}`;

  res.writeHead(302, { Location: url });
  res.end();
}
