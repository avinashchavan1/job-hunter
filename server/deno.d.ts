// Minimal Deno globals used by the edge function (the real runtime provides them).
declare const Deno: {
  env: { get(k: string): string | undefined }
  serve: (h: (r: Request) => Response | Promise<Response>) => void
}
