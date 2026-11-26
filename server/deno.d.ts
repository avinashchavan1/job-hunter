// Minimal Deno globals used by the edge function (the real runtime provides them).
declare const Deno: {
  env: { get(k: string): string | undefined }
  serve: (h: (r: Request) => Response | Promise<Response>) => void
}
/** Supabase edge runtime: keep working after the response is sent (within the platform's time limit). */
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }
