// Asks Flutterwave whether a payment really succeeded.
module.exports = async (req, res) => {
  const key = process.env.FLW_SECRET_KEY;
  const ref = req.query && req.query.tx_ref;
  if (!key || !ref) return res.status(400).json({ ok: false });
  try {
    const r = await fetch('https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(ref), {
      headers: { Authorization: `Bearer ${key}` }
    });
    const d = await r.json();
    const ok = d.status === 'success' && d.data && d.data.status === 'successful';
    return res.status(200).json({ ok, amount: d.data && d.data.amount, currency: d.data && d.data.currency });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
