// api/redirigir-formulario.js — Puente entre Mercado Pago y el formulario.
// Toma el payment_id que entrega Mercado Pago al redirigir, y arma
// la URL del formulario con el número de operación ya prellenado.

export default async function handler(req, res) {
  const fullUrl = new URL(req.url, `https://${req.headers.host}`);
  const paymentId = fullUrl.searchParams.get('payment_id') || fullUrl.searchParams.get('collection_id') || '';

  const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLSe9UDo4wpX6gPw0rFjdl4_Jyr9gB5AUwckhuhOsoF5Gk_gv6g/viewform';
  const ENTRY_OPERACION = 'entry.1915985991';

  const url = paymentId
    ? `${FORM_BASE}?usp=pp_url&${ENTRY_OPERACION}=${encodeURIComponent(paymentId)}`
    : FORM_BASE;

  res.writeHead(302, { Location: url });
  res.end();
}
