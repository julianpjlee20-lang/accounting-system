export default function handler(req, res) {
  res.json({ 
    status: 'ok',
    env: {
      hasUrl: !!process.env.TURSO_URL,
      hasToken: !!process.env.TURSO_TOKEN
    }
  });
}
