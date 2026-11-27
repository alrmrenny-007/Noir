// Starts a Flutterwave payment. The price is worked out HERE on the server,
// so nobody can change what they pay from their browser.
const { sql, ensure, getUser } = require('./_lib');
const RATE = 1500; // 1 USD = 1500 NGN (keep the same as RATE in index.html)
const SHOES = new Set([57015167025457,57015167058225,57015167090993,57015167123761,57015167156529,57015167189297,57015167222065,57015166730545,57015166763313,57015166796081,57015166828849,57015166861617,57015166894385,57015166927153,57015176364337,57015176397105,57015176429873,57015176462641,57015176495409,57015176528177,57015176560945]);
const APPAREL = new Set([56835911582001,56835911614769,56835911647537,56835911680305,56835806396721,56835806429489,56835806462257,56835806495025,56836143743281,56836143776049,56836143808817,56836143841585,56836002185521,56836002218289,56836002251057,56836002283825,56836251681073,56836251713841,56836251746609,56836251779377]);

const NEWP = { 1: 79, 2: 129, 3: 169, 4: 189, 5: 189, 6: 139, 7: 159, 8: 179 }; // USD prices of the newer products

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.FLW_SECRET_KEY;
  if (!key) return res.status(500).json({ error: 'Payment is not set up yet' });

  const { items, customer, currency } = req.body || {};
  if (!Array.isArray(items) || !items.length || !customer || !customer.email) {
    return res.status(400).json({ error: 'Missing details' });
  }
  let usd = 0;
  for (const it of items) {
    const id = Number(it.id), q = Math.floor(Number(it.quantity));
    if (!(q >= 1 && q <= 20)) return res.status(400).json({ error: 'Bad quantity' });
    if (SHOES.has(id)) usd += 149 * q;
    else if (APPAREL.has(id)) usd += 199 * q;
    else {
      // Newer products: id = 7000000 + productNumber*10 + sizeNumber
      const n = Math.floor((id - 7000000) / 10), j = (id - 7000000) % 10;
      if (NEWP[n] && j < (n >= 6 ? 7 : 4)) usd += NEWP[n] * q;
      else return res.status(400).json({ error: 'Unknown item' });
    }
  }
  const cur = currency === 'NGN' ? 'NGN' : 'USD';
  const amount = cur === 'NGN' ? Math.round(usd * RATE) : usd;
  const tx_ref = `runway-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await ensure();
    const u = await getUser(req);
    await sql`INSERT INTO orders (tx_ref, user_id, email, items, amount, currency, address, status) VALUES (${tx_ref}, ${u ? u.id : null}, ${customer.email}, ${JSON.stringify(items)}::jsonb, ${amount}, ${cur}, ${customer.addr || ''}, 'pending')`;
  } catch (e) {
    console.error('order save failed', e); // do not block payment if the database is unavailable
  }

  try {
    const r = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref, amount, currency: cur,
        redirect_url: `https://${req.headers.host}/`,
        customer: { email: customer.email, name: customer.name, phonenumber: customer.phone },
        customizations: { title: 'The Runway' },
        meta: { address: customer.addr, items: JSON.stringify(items) }
      })
    });
    const d = await r.json();
    if (d.status !== 'success') return res.status(502).json({ error: d.message || 'Could not start payment' });
    return res.status(200).json({ link: d.data.link });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Flutterwave' });
  }
};
