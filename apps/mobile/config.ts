/**
 * The one thing this native shell actually points at: the deployed Kimo
 * web app. Loading the live site (rather than bundling a static copy
 * inside the app, the way apps/desktop does) means UI changes ship
 * instantly to everyone with no app-store review cycle — the tradeoff
 * is that the app needs network access to load its own UI, not just to
 * transfer files. See apps/mobile/README.md for the bundled-static-copy
 * alternative if you'd rather trade that away.
 *
 * TODO: replace with your real deployed domain before building for
 * real users — this placeholder matches the one used in
 * apps/web/app/page.tsx and apps/web/.env.production.example.
 */
export const WEB_URL = "https://ifrit-eight.vercel.app";
