// Returns the logged-in customer's orders.
const { sql, ensure, getUser } = require('./_lib');
module.exports = async (req, res) => {
  try {
    await ensure();
    const u = await getUser(req);
    if (!u) return res.status(401).json({ error: 'Please log in' });
    const orders = await sql`SELECT tx_ref, items, amount, currency, status, created_at FROM orders WHERE (user_id = ${u.id} OR email = ${u.email}) AND status = 'paid' ORDER BY created_at DESC LIMIT 50`;
    return res.status(200).json({ orders });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Could not load orders' });
  }
};
