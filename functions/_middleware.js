const ALLOWED_ORIGINS = new Set(["https://hk-ai.pages.dev","https://feature-chat-image-generatio.hk-ai.pages.dev","capacitor://localhost","https://localhost","http://localhost"]);
const BODY_LIMITS = {"/api/chat":11*1024*1024,"/api/image":11*1024*1024,"/api/transcribe":16*1024*1024,"/api/tts":64*1024};
function isAllowedOrigin(origin){return ALLOWED_ORIGINS.has(origin);}
function secure(h){h.set("X-Content-Type-Options","nosniff");h.set("Referrer-Policy","no-referrer");h.set("X-Frame-Options","DENY");h.set("Permissions-Policy","camera=(), geolocation=(), payment=()");h.set("Cache-Control","no-store");return h;}
function reply(data,status,cors){const h=new Headers(cors);h.set("Content-Type","application/json; charset=utf-8");secure(h);return new Response(JSON.stringify(data),{status,headers:h});}
export async function onRequest({request,env,next}){
 const url=new URL(request.url); if(!url.pathname.startsWith("/api/")) return next();
 const origin=request.headers.get("Origin");
 if(origin&&!isAllowedOrigin(origin)) return reply({error:"Origin not allowed"},403);
 const cors=new Headers();
 if(origin){cors.set("Access-Control-Allow-Origin",origin);cors.set("Vary","Origin");}
 cors.set("Access-Control-Allow-Methods","POST, OPTIONS");cors.set("Access-Control-Allow-Headers","Content-Type");cors.set("Access-Control-Max-Age","86400");
 if(request.method==="OPTIONS"){secure(cors);return new Response(null,{status:204,headers:cors});}
 if(request.method!=="POST"){cors.set("Allow","POST, OPTIONS");return reply({error:"Method not allowed"},405,cors);}
 const max=BODY_LIMITS[url.pathname];if(!max)return reply({error:"Not found"},404,cors);
 const contentLength=request.headers.get("Content-Length");
 if(contentLength!==null){
   const size=Number(contentLength);
   if(!Number.isSafeInteger(size)||size<0)return reply({error:"Invalid Content-Length header."},400,cors);
   if(size>max)return reply({error:"Request body too large."},413,cors);
 }
 if(!request.headers.get("Content-Type")?.toLowerCase().includes("application/json"))return reply({error:"Content-Type must be application/json"},415,cors);
 // Fail closed: never bypass rate limiting when KV is unavailable.
 if(!env.HK_RATE_LIMITS){
   console.error("HK rate limit: KV binding missing");
   return reply({error:"The KV binding is not configured for the preview environment.",code:"KV_BINDING_MISSING"},503,cors);
 }
 const ip=request.headers.get("CF-Connecting-IP");
 if(!ip){
   return reply({error:"The request could not be security-validated."},503,cors);
 }
 const isImage=url.pathname==="/api/image";
 const maxRequests=isImage?5:30;
 const bucket=Math.floor(Date.now()/60000);
 const key="api-rate:"+url.pathname+":"+ip+":"+bucket;
 let stored;
 try{
   stored=await env.HK_RATE_LIMITS.get(key);
 }catch(error){
   console.error("HK rate limit: KV read failed");
   return reply({error:"Could not read the KV counter.",code:"KV_READ_FAILED"},503,cors);
 }
 const current=stored===null?0:Number(stored);
 if(!Number.isSafeInteger(current)||current<0){
   console.error("HK rate limit: invalid KV counter");
   return reply({error:"The KV counter value is invalid.",code:"KV_COUNTER_INVALID"},503,cors);
 }
 if(current>=maxRequests){
   cors.set("Retry-After","60");
   return reply({error:"Too many requests. Please try again later."},429,cors);
 }
 try{
   await env.HK_RATE_LIMITS.put(key,String(current+1),{expirationTtl:120});
 }catch(error){
   console.error("HK rate limit: KV write failed");
   return reply({error:"Could not write the KV counter.",code:"KV_WRITE_FAILED"},503,cors);
 }
 const response=await next();const headers=new Headers(response.headers);for(const [k,v] of cors)headers.set(k,v);secure(headers);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
