// Next.js calls register() exactly once when the server process boots
// (https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
// This is what starts the autonomous paper-trading loop without any user
// action — see src/lib/botLoop.ts for why this only works on a persistent
// process (desktop app, Render) and not on serverless (Vercel).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBotLoop } = await import("@/lib/botLoop");
  startBotLoop();
}
