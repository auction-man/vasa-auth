// api/auth/start.ts
export default async function handler(req: any, res: any) {
  const { ping } = req.query || {};
  if (ping) {
    res.status(200).send("start-pong");
    return;
  }

  // Tillfällig test-redirect – vi byter till riktig Criipto-URL senare
  const returnUrl = "https://vasaauktioner.se/post-login";
  res.status(302).setHeader("Location", returnUrl).end();
}
