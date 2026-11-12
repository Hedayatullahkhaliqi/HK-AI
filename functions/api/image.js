const MAX_PROMPT_LENGTH=1200;
const MAX_IMAGE_LENGTH=8*1024*1024;

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}

export async function onRequestPost({request,env}){
  try{
    if(!env.AI)return json({error:"سرویس ساخت و ویرایش تصویر در این پروژه فعال نیست."},503);
    const body=await request.json();
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
    const inputImage=typeof body.image==="string"?body.image:"";

    if(!prompt||prompt.length>MAX_PROMPT_LENGTH){
      return json({error:"توضیح تصویر خالی یا بیش از حد طولانی است."},400);
    }

    if(inputImage){
      if(inputImage.length>MAX_IMAGE_LENGTH){
        return json({error:"حجم تصویر زیاد است. لطفاً عکس کوچک‌تری انتخاب کن."},413);
      }
      if(!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(inputImage)){
        return json({error:"فرمت تصویر برای ویرایش پشتیبانی نمی‌شود."},400);
      }

      const result=await env.AI.run("black-forest-labs/flux-1-kontext-pro",{
        prompt,
        input_image:inputImage.split(",")[1],
        output_format:"jpeg"
      });

      const imageUrl=result?.image||result?.result?.image;
      if(typeof imageUrl!=="string"||!imageUrl){
        throw new Error("مدل ویرایش تصویر خروجی معتبری برنگرداند.");
      }

      if(imageUrl.startsWith("data:image/")){
        const match=imageUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
        if(!match)throw new Error("فرمت تصویر خروجی معتبر نیست.");
        const binary=atob(match[2]);
        const bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        return new Response(bytes,{headers:{"Content-Type":"image/"+(match[1]==="jpg"?"jpeg":match[1]),"Cache-Control":"no-store"}});
      }

      const imageResponse=await fetch(imageUrl);
      if(!imageResponse.ok)throw new Error("دریافت تصویر ویرایش‌شده از سرویس ناموفق بود.");
      const contentType=imageResponse.headers.get("content-type")||"image/jpeg";
      return new Response(imageResponse.body,{headers:{"Content-Type":contentType,"Cache-Control":"no-store"}});
    }

    const image=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{
      prompt,
      num_steps:4
    });

    if(image instanceof Response)return image;
    if(image instanceof ArrayBuffer||ArrayBuffer.isView(image)){
      return new Response(image,{headers:{"Content-Type":"image/png","Cache-Control":"no-store"}});
    }
    if(typeof image==="string"&&image.startsWith("data:image/")){
      const match=image.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
      if(!match)throw new Error("فرمت تصویر خروجی معتبر نیست.");
      const binary=atob(match[2]),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      return new Response(bytes,{headers:{"Content-Type":"image/"+(match[1]==="jpg"?"jpeg":match[1]),"Cache-Control":"no-store"}});
    }
    if(image?.image){
      const generated=await fetch(image.image);
      if(!generated.ok)throw new Error("دریافت تصویر ساخته‌شده ناموفق بود.");
      return new Response(generated.body,{headers:{"Content-Type":generated.headers.get("content-type")||"image/png","Cache-Control":"no-store"}});
    }
    throw new Error("مدل ساخت تصویر خروجی قابل استفاده برنگرداند.");
  }catch(error){
    return json({error:"عملیات تصویر انجام نشد: "+String(error?.message||error)},500);
  }
}
