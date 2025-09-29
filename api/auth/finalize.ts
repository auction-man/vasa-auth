// api/auth/finalize.ts
export default async function handler(req: any, res: any) {
  const { ping, test } = req.query || {};

  if (ping) {
    res.status(200).send("finalize-pong");
    return;
  }

  if (test) {
    res.status(302).setHeader("Location", "https://vasaauktioner.se/post-login").end();
    return;
  }

  res.status(200).send("ok");
}
// redeploy ping
