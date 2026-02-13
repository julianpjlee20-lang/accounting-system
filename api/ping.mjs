export default async function handler(req, res) {
  res.json({ ok: true, time: new Date().toISOString() });
}
