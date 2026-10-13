// Local disposable PostgreSQL only. No provider network, Production identity or secrets.
import { createECDH, randomBytes } from "node:crypto";
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";
import { dispatch, type Rpc } from "./worker.ts";
function assert(ok:unknown){if(!ok)throw new Error('Local reminder integration failed');}
const socket=Deno.env.get('PNM_REMINDER_QA_SOCKET')||'';
if(!socket.includes('pnm-reminder-qa-')||!socket.startsWith('/'))throw new Error('LOCAL_SOCKET_REQUIRED');
async function sql(text:string){
 const result=await new Deno.Command('/opt/homebrew/opt/postgresql@18/bin/psql',{args:['-X','-h',socket,'-p','55593','-U','postgres','-d','postgres','-Atq','-v','ON_ERROR_STOP=1'],stdin:'piped',stdout:'piped',stderr:'piped'}).spawn();
 const writer=result.stdin.getWriter();await writer.write(new TextEncoder().encode(text));await writer.close();
 const out=await result.output();if(!out.success)throw new Error('LOCAL_SQL_FAILED');return new TextDecoder().decode(out.stdout).trim();
}
Deno.test('local PostgreSQL generation -> real encrypted Worker retry -> SENT; no provider request',async()=>{
 assert(await sql("SELECT inet_server_addr() IS NULL AND EXISTS(SELECT 1 FROM qa_local_guard WHERE tag='PNM_REMINDER_DISPOSABLE_LOCAL_QA');")==='t');
 const ecdh=createECDH('prime256v1');ecdh.generateKeys();
 const publicKey=ecdh.getPublicKey().toString('base64url'),auth=randomBytes(16).toString('base64url');
 await sql(`UPDATE push_subscriptions SET p256dh='${publicKey}',auth='${auth}' WHERE profile_id='90000000-0000-4000-8000-000000000001'; UPDATE notification_push_config SET enabled=true WHERE singleton; SELECT run_schedule_reminders_v1();`);
 const target=await sql("SELECT d.id FROM notification_schedule_reminders r JOIN notification_push_deliveries d ON d.notification_id=r.notification_id WHERE r.schedule_id='90000000-0000-4000-8000-000000000130';");
 assert(/^[0-9a-f-]{36}$/.test(target));
 // Isolate this fixture in the queue without touching any Production data.
 await sql(`UPDATE notification_push_deliveries SET available_at=now()+interval '1 day' WHERE id<>'${target}' AND status IN ('PENDING','FAILED');`);
 const rpc:Rpc=async<T>(name:string,args:Record<string,unknown>)=>{
  if(name==='claim_notification_push_deliveries_v1')return JSON.parse(await sql('SET ROLE service_role; SELECT coalesce(jsonb_agg(x),\'[]\'::jsonb) FROM claim_notification_push_deliveries_v1(10)x;')) as T;
  const id=String(args.p_delivery_id),token=String(args.p_token);
  assert(/^[0-9a-f-]{36}$/.test(id)&&/^[0-9a-f-]{36}$/.test(token));
  if(name==='get_notification_push_delivery_v1')return JSON.parse(await sql(`SET ROLE service_role; SELECT coalesce(get_notification_push_delivery_v1('${id}','${token}'),'null'::jsonb);`)) as T;
  assert(name==='finish_notification_push_delivery_v1');const result=String(args.p_result);assert(['SENT','RETRY','CANCELLED','PERMANENT','GONE'].includes(result));
  return (await sql(`SET ROLE service_role; SELECT finish_notification_push_delivery_v1('${id}','${token}','${result}',NULL);`)==='t') as T;
 };
 const vapid={...webpush.generateVAPIDKeys(),subject:'mailto:synthetic@example.invalid'};
 const first=await dispatch(rpc,vapid,async()=>{throw new Error('synthetic transient failure');});assert(first.RETRY===1);
 assert(await sql(`SELECT status='FAILED' AND attempt_count=1 FROM notification_push_deliveries WHERE id='${target}';`)==='t');
 await sql(`UPDATE notification_push_deliveries SET available_at=now() WHERE id='${target}';`);
 let sends=0;
 const second=await dispatch(rpc,vapid,async(_url,init)=>{sends++;assert(new Uint8Array(init?.body as Uint8Array).length>100);assert(Number((init?.headers as Record<string,string>).TTL)<=300);return new Response(null,{status:201});});
 assert(second.SENT===1&&sends===1);
 assert(await sql(`SELECT status='SENT' AND attempt_count=2 FROM notification_push_deliveries WHERE id='${target}';`)==='t');
 assert(await sql("SELECT count(*) FROM notification_schedule_reminders WHERE schedule_id='90000000-0000-4000-8000-000000000130';")==='1');
});
