const ALLOWED_ORIGINS = new Set(["https://hk-ai.pages.dev","capacitor://localhost","https://localhost","http://localhost"]);
const BODY_LIMITS = {"/api/chat":11*1024*1024,"/api/image":11*1024*1024,"/api/transcribe":16*1024*1024,"/api/tts":64*1024};
function secure(h){h.set("X-Content-Type-Options","nosniff");h.set("Referrer-Policy","no-referrer");h.set("X-Frame-Options","DENY");h.set("Permissions-Policy","camera=(), geolocation=(), payment=()");h.set("Cache-Control","no-store");return h;}
function reply(data,status,cors){const h=new Headers(cors);h.set("Content-Type","application/json; charset=utf-8");secure(h);return new Response(JSON.stringify(data),{status,headers:h});}
export async function onRequest({request,env,next}){
 const url=new URL(request.url); if(!url.pathname.startsWith("/api/")) return next();
 const origin=request.headers.get("Origin");
 if(origin&&!ALLOWED_ORIGINS.has(origin)) return reply({error:"Origin not allowed"},403);
 const cors=new Headers();
 if(origin){cors.set("Access-Control-Allow-Origin",origin);cors.set("Vary","Origin");}
 cors.set("Access-Control-Allow-Methods","POST, OPTIONS");cors.set("Access-Control-Allow-Headers","Content-Type");cors.set("Access-Control-Max-Age","86400");
 if(request.method==="OPTIONS"){secure(cors);return new Response(null,{status:204,headers:cors});}
 if(request.method!=="POST"){cors.set("Allow","POST, OPTIONS");return reply({error:"Method not allowed"},405,cors);}
 const max=BODY_LIMITS[url.pathname];if(!max)return reply({error:"Not found"},404,cors);
 const size=Number(request.headers.get("Content-Length")||0);if(size>max)return reply({error:"Request body too large"},413,cors);
 if(!request.headers.get("Content-Type")?.toLowerCase().includes("application/json"))return reply({error:"Content-Type must be application/json"},415,cors);
 // Approximate per-IP rate limiting backed by a Cloudflare KV namespace.
 // Create and bind the namespace as HK_RATE_LIMITS in the Pages project.
 if(env.HK_RATE_LIMITS){
   const ip=request.headers.get("CF-Connecting-IP")||"unknown";
   const isImage=url.pathname==="/api/image";
   const maxRequests=isImage?5:30;
   const bucket=Math.floor(Date.now()/60000);
   const key="api-rate:"+url.pathname+":"+ip+":"+bucket;
   const current=Number(await env.HK_RATE_LIMITS.get(key)||0);
   if(current>=maxRequests){
     cors.set("Retry-After","60");
     return reply({error:"تعداد درخواست‌ها زیاد است. کمی بعد دوباره کوشش کن."},429,cors);
   }
   await env.HK_RATE_LIMITS.put(key,String(current+1),{expirationTtl:120});
 }
 const response=await next();const headers=new Headers(response.headers);for(const [k,v] of cors)headers.set(k,v);secure(headers);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
