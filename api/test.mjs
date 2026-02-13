export default function handler(req, res) {
  res.json({ 
    status: 'ok',
    env: {
      url: process.env.TURSO_URL,
      tokenLen: process.env.TURSO_TOKEN?.length
    }
  });
}
