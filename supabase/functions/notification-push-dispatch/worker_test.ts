import { createECDH, randomBytes, hkdfSync, createDecipheriv } from "node:crypto";
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from "web-push";
import { Buffer } from "node:buffer";
import { dispatch, encryptedRequest, handler, pushTemplate, resultForStatus, safeEndpoint, type Delivery, type Rpc } from "./worker.ts";
function assert(value: unknown) { if (!value) throw new Error("Assertion failed"); }
const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
const vapid = { ...webpush.generateVAPIDKeys(), subject: "mailto:qa@example.com" };
const delivery: Delivery = { notification_id: "00000000-0000-4000-8000-000000000001", deep_link_type: "ANNOUNCEMENT", deep_link_id: "00000000-0000-4000-8000-000000000002", category: "ANNOUNCEMENT", endpoint: "https://fcm.googleapis.com/fcm/send/fake", p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
Deno.test("actual Deno VAPID / aes128gcm encryption / fake endpoint receives ciphertext", async () => {
  const req = encryptedRequest(delivery, vapid);
  assert(req.headers.Authorization?.toString().startsWith("vapid t="));
  assert(req.headers["Content-Encoding"] === "aes128gcm");
  const body = Buffer.from(req.body as Uint8Array);
  const salt = body.subarray(0,16), senderKey = body.subarray(21,21+body[20]);
  const ikm = hkdfSync("sha256",ecdh.computeSecret(senderKey),Buffer.from(delivery.auth,"base64url"),Buffer.concat([Buffer.from("WebPush: info\0"),ecdh.getPublicKey(),senderKey]),32);
  const cek=hkdfSync("sha256",Buffer.from(ikm),salt,Buffer.from("Content-Encoding: aes128gcm\0"),16);
  const nonce=hkdfSync("sha256",Buffer.from(ikm),salt,Buffer.from("Content-Encoding: nonce\0"),12);
  const cipher=body.subarray(21+body[20]);
  const decipher=createDecipheriv("aes-128-gcm",Buffer.from(cek),Buffer.from(nonce));decipher.setAuthTag(cipher.subarray(-16));
  const plain=Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]);
  assert(plain.at(-1)===2);
  const decoded=JSON.parse(plain.subarray(0,-1).toString());
  assert(decoded.notification_id===delivery.notification_id && Object.keys(decoded).length===5 && decoded.event_type==="ANNOUNCEMENT");
  const jwt=String(req.headers.Authorization).match(/t=([^, ]+)/)![1];const [head,payload,signature]=jwt.split(".");
  const pub=Buffer.from(vapid.publicKey,"base64url");
  const publicObject=await crypto.subtle.importKey("raw",new Uint8Array(pub),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  assert(await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},publicObject,new Uint8Array(Buffer.from(signature,"base64url")),new TextEncoder().encode(`${head}.${payload}`)));
  assert(JSON.parse(Buffer.from(payload,"base64url").toString()).aud==="https://fcm.googleapis.com");
  let received = 0;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async r => {
    const body = new Uint8Array(await r.arrayBuffer()); received = body.length;
    assert(!new TextDecoder().decode(body).includes(delivery.notification_id));
    return new Response(null, { status: 201 });
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.addr.port}`, { method: "POST", headers: req.headers as Record<string,string>, body: new Uint8Array(req.body as Uint8Array) });
    assert(response.status === 201 && received > 100); await response.body?.cancel();
  } finally { await server.shutdown(); }
});
Deno.test("SSRF, credentials, port, external host and redirect targets rejected", () => {
  for (const url of ["http://127.0.0.1/x", "https://fcm.googleapis.com.evil.org/x", "https://a@fcm.googleapis.com/x", "https://fcm.googleapis.com:444/x", "https://fcm.googleapis.com/x#y"]) assert(!safeEndpoint(url));
});
Deno.test("worker results cover success/gone/retry/permanent and preserve lease token", async () => {
  for (const status of [201,404,410,429,500,503,400,403]) {
    let finished: Record<string, unknown> = {};
    const rpc: Rpc = async <T>(name: string,args: Record<string,unknown>) => {
      if (name.startsWith("claim")) return [{delivery_id:"delivery",token:"lease"}] as T;
      if (name.startsWith("get")) return delivery as T;
      finished=args; return true as T;
    };
    await dispatch(rpc,vapid,async (_input,init) => { assert(init?.redirect === "error"); return new Response(null,{status,headers:{"retry-after":"120"}}); });
    assert(finished.p_result===resultForStatus(status) && finished.p_token==="lease");
  }
});
Deno.test("deleted/retracted/expired canonical null never sends", async () => {
  let sent=0;
  const rpc: Rpc=async <T>(name:string) => (name.startsWith("claim")?[{delivery_id:"d",token:"t"}]:name.startsWith("get")?null:true) as T;
  await dispatch(rpc,vapid,async()=>{sent++;return new Response();}); assert(sent===0);
});
Deno.test("network retry and invocation secret authorization", async()=>{
  let result="";
  const rpc: Rpc=async <T>(name:string,args:Record<string,unknown>)=>{
    if(name.startsWith("claim"))return [{delivery_id:"d",token:"t"}] as T;
    if(name.startsWith("get"))return delivery as T;
    result=String(args.p_result);return true as T;
  };
  await dispatch(rpc,vapid,async()=>{throw Error("private endpoint error must not escape");});assert(result==="RETRY");
  const response=await handler(rpc,vapid,"x".repeat(40))(new Request("https://worker.invalid",{method:"POST"}));assert(response.status===401);
});

Deno.test("schedule template whitelist rejects arbitrary bodies/categories/counts", () => {
  for (const kind of ["SCHEDULE_ASSIGNED","SCHEDULE_UPDATED","SCHEDULE_COMPLETED","SCHEDULE_CANCELLED"]) {
    const d = { ...delivery, category:"SCHEDULE", event_type:kind, title:"PRIVATE DOG", message:"PRIVATE PHONE" };
    assert(JSON.stringify(pushTemplate(d))===JSON.stringify({event_type:kind}));
    const req=encryptedRequest(d,vapid); assert(req.headers["Content-Encoding"]==="aes128gcm");
  }
  assert(pushTemplate({...delivery,category:"SCHEDULE",event_type:"DAILY_SCHEDULE_SUMMARY",summary_count:4}).summary_count===4);
  for (const d of [ {...delivery,category:"SALE"}, {...delivery,category:"SCHEDULE",event_type:"arbitrary"}, ...[0,-1,1.5,NaN].map(n=>({...delivery,category:"SCHEDULE",event_type:"DAILY_SCHEDULE_SUMMARY",summary_count:n})) ]) {
    let rejected=false;try {pushTemplate(d);}catch{rejected=true;}assert(rejected);
  }
});
Deno.test("Task generic templates contain no content or identity and preserve legacy templates", () => {
  for (const event_type of ["TASK_REQUEST_ASSIGNED","TASK_REQUEST_OVERDUE","TASK_REQUEST_COMPLETED","TASK_REQUEST_CANCELLED"]) {
    for (const task_audience of ["target","requester"]) {
      const template = pushTemplate({category:"TASK_REQUEST",event_type,task_audience});
      assert(JSON.stringify(template)===JSON.stringify({event_type,task_audience}));
    }
  }
  assert(JSON.stringify(pushTemplate({category:"ANNOUNCEMENT"}))==='{"event_type":"ANNOUNCEMENT"}');
  assert(JSON.stringify(pushTemplate({category:"SCHEDULE",event_type:"DAILY_SCHEDULE_SUMMARY",summary_count:2}))==='{"event_type":"DAILY_SCHEDULE_SUMMARY","summary_count":2}');
  let rejected=false;try{pushTemplate({category:"TASK_REQUEST",event_type:"TASK_REQUEST_OVERDUE",task_audience:"other"});}catch{rejected=true;}assert(rejected);
});
