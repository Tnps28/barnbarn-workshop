// services/payment.js — เชื่อมต่อ Omise (บัตรเครดิต + พร้อมเพย์)
// Omise payment gateway integration via REST (no SDK dependency).
// If no keys are set, runs in DEMO mode: creates a fake charge so you can test the whole flow.

const SECRET = process.env.OMISE_SECRET_KEY || '';
const VAULT = 'https://vault.omise.co';
const API = 'https://api.omise.co';

export const paymentConfigured = () => Boolean(SECRET);

function authHeader() {
  return 'Basic ' + Buffer.from(SECRET + ':').toString('base64');
}

// Create a PromptPay charge. Returns { id, status, qrImage, amount, demo }
export async function createPromptPayCharge({ amount, registrationId, description }) {
  const satang = Math.round(amount * 100); // Omise uses smallest currency unit

  if (!paymentConfigured()) {
    // DEMO MODE — no real money moves. Lets you test end-to-end.
    return {
      id: 'demo_chrg_' + Date.now(),
      status: 'pending',
      qrImage:
        'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' +
        encodeURIComponent('DEMO-PROMPTPAY-' + amount + 'THB-' + registrationId),
      amount,
      demo: true
    };
  }

  // 1) create a promptpay source
  const srcRes = await fetch(API + '/sources', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'promptpay', amount: satang, currency: 'thb' })
  });
  const source = await srcRes.json();
  if (source.object === 'error') throw new Error(source.message);

  // 2) create a charge from the source
  const chgRes = await fetch(API + '/charges', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: satang,
      currency: 'thb',
      source: source.id,
      description,
      metadata: { registrationId }
    })
  });
  const charge = await chgRes.json();
  if (charge.object === 'error') throw new Error(charge.message);

  const qrImage =
    charge.source &&
    charge.source.scannable_code &&
    charge.source.scannable_code.image &&
    charge.source.scannable_code.image.download_uri;

  return { id: charge.id, status: charge.status, qrImage: qrImage || '', amount, demo: false };
}

// Charge a credit/debit card using a token created on the frontend (Omise.js).
export async function createCardCharge({ amount, token, registrationId, description }) {
  const satang = Math.round(amount * 100);

  if (!paymentConfigured()) {
    return { id: 'demo_chrg_' + Date.now(), status: 'successful', paid: true, amount, demo: true };
  }

  const res = await fetch(API + '/charges', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: satang,
      currency: 'thb',
      card: token,
      description,
      metadata: { registrationId }
    })
  });
  const charge = await res.json();
  if (charge.object === 'error') throw new Error(charge.message);
  return { id: charge.id, status: charge.status, paid: charge.paid, amount, demo: false };
}

// Poll a charge status (used to confirm PromptPay payment).
export async function getChargeStatus(chargeId) {
  if (!paymentConfigured() || String(chargeId).startsWith('demo_')) {
    // In demo mode we let the admin mark paid manually; report pending here.
    return { id: chargeId, status: 'pending', paid: false, demo: true };
  }
  const res = await fetch(API + '/charges/' + chargeId, {
    headers: { Authorization: authHeader() }
  });
  const charge = await res.json();
  return { id: charge.id, status: charge.status, paid: charge.paid, demo: false };
}
