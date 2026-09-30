// Only run from notification_web_push_sprint2_qa.py against its isolated Unix socket.
import { createECDH, randomBytes } from "node:crypto";
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";
import { dispatch, type Rpc } from "./worker.ts";
const socket = Deno.env.get("PNM_PUSH_QA_SOCKET") || "";
if (!socket.includes("pnm-notification-qa-") || !socket.startsWith("/")) throw Error("ISOLATED_QA_SOCKET_REQUIRED");
const psql = Deno.env.get("PNM_PUSH_QA_PSQL") || "";
async function sql(query: string) {
  const command = new Deno.Command(psql, { args: ["-X", "-h", socket, "-p", "55581", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", query], stdout: "piped", stderr: "piped" });
  const out = await command.output(); if (!out.success) throw Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).trim();
}
const user = (n: number) => `SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-4000-8000-${String(n).padStart(12,"0")}';`;
const key = createECDH("prime256v1"); key.generateKeys();
await sql(user(2)+`SELECT register_web_push_subscription_v1('https://fcm.googleapis.com/fcm/send/e2e','${key.getPublicKey().toString("base64url")}','${randomBytes(16).toString("base64url")}');`);
await sql(user(1)+"SELECT publish_announcement_v1('00000000-0000-4000-8000-000000999999','QA','body','NORMAL',false,'ALL');");
const rpc: Rpc = async <T>(name: string,args: Record<string,unknown>) => {
  if (!/^(claim_notification_push_deliveries_v1|get_notification_push_delivery_v1|finish_notification_push_delivery_v1)$/.test(name)) throw Error("QA_RPC_DENIED");
  const values = Object.values(args).map(v=>v===null?"NULL":typeof v==="number"?String(v):`'${String(v).replaceAll("'","''")}'`).join(",");
  return JSON.parse(await sql(name.startsWith("claim")?`SELECT coalesce(jsonb_agg(x),'[]') FROM ${name}(${values}) x;`:`SELECT coalesce(to_jsonb(${name}(${values})),'null'::jsonb);`)) as T;
};
let sent = 0;
const server = Deno.serve({ hostname:"127.0.0.1",port:0,onListen:()=>{} },async request=>{
  if ((await request.arrayBuffer()).byteLength<100) throw Error("NOT_ENCRYPTED"); sent++;return new Response(null,{status:201});
});
try {
  const send: typeof fetch = (_input,init)=>fetch(`http://127.0.0.1:${server.addr.port}`,init);
  const vapid={...webpush.generateVAPIDKeys(),subject:"mailto:qa@example.com"};
  await Promise.all([dispatch(rpc,vapid,send),dispatch(rpc,vapid,send)]);
  if(sent!==1)throw Error(`E2E duplicate/missing send: ${sent}`);
  console.log("PASS: actual Announcement publish -> transactional queue -> concurrent Deno workers -> encrypted fake HTTP send exactly once -> SENT");
} finally { await server.shutdown(); }
