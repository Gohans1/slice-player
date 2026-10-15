const activeMutations = new Set<Promise<Response | undefined>>();
let pauseDepth = 0;

export function pauseLibraryMutations(): () => void {
  pauseDepth++;
  return () => { pauseDepth--; };
}

export async function drainLibraryMutations(): Promise<void> {
  await Promise.allSettled([...activeMutations]);
}

/** Track the whole admitted HTTP mutation, including body reads and cancellation awaits. */
export async function runLibraryRequest(request: Request, handle: () => Promise<Response | undefined>): Promise<Response | undefined> {
  const { method } = request;
  const isRestore = method === "POST" && new URL(request.url).pathname === "/api/library/import";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || isRestore) return handle();
  if (pauseDepth > 0) {
    return Response.json({ error: "Thư viện đang được khôi phục, vui lòng thử lại sau giây lát." },
      { status: 503, headers: { "Retry-After": "5" } });
  }
  const pending = handle();
  activeMutations.add(pending);
  try {
    return await pending;
  } finally {
    activeMutations.delete(pending);
  }
}
