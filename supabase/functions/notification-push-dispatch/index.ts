import { handler, type Rpc } from "./worker.ts";
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`Missing ${name}`); return value; };
const url = required("SUPABASE_URL");
const key = required("SUPABASE_SERVICE_ROLE_KEY");
const rpc: Rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("PUSH_RPC_UNAVAILABLE");
  return await response.json() as T;
};
Deno.serve(handler(rpc, { publicKey: required("VAPID_PUBLIC_KEY"), privateKey: required("VAPID_PRIVATE_KEY"),
  subject: required("VAPID_SUBJECT") }, required("PUSH_WORKER_SECRET")));
