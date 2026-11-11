
// HK-AI Backend
// AI + Live Weather (Open-Meteo)

function isWeatherQuestion(text) {
  return /(آب\s*و\s*هوا|وضعیت هوا|هواشناسی|هوای|پیش.?بینی هوا|weather|forecast|temperature)/i.test(text);
}

function extractLocation(text) {
  const aliases = [
    { pattern: /فاریاب/i, name: "Faryab", search: "Maymana" },
    { pattern: /میمنه/i, name: "Maymana", search: "Maymana" },
    { pattern: /کابل/i, name: "Kabul", search: "Kabul" },
    { pattern: /هرات/i, name: "Herat", search: "Herat" },
    { pattern: /مزار(?:\s*شریف)?/i, name: "Mazar-e Sharif", search: "Mazar-i-Sharif" },
    { pattern: /قندهار/i, name: "Kandahar", search: "Kandahar" },
    { pattern: /جلال.?آباد/i, name: "Jalalabad", search: "Jalalabad" },
    { pattern: /بامیان/i, name: "Bamyan", search: "Bamyan" },
    { pattern: /کندز/i, name: "Kunduz", search: "Kunduz" },
    { pattern: /بلخ/i, name: "Balkh", search: "Balkh" },
    { pattern: /تاشکند/i, name: "Tashkent", search: "Tashkent" },
    { pattern: /تهران/i, name: "Tehran", search: "Tehran" },
    { pattern: /دبی/i, name: "Dubai", search: "Dubai" },
    { pattern: /اسلام.?آباد/i, name: "Islamabad", search: "Islamabad" },
    { pattern: /لندن/i, name: "London", search: "London" }
  ];

  for (const item of aliases) {
    if (item.pattern.test(text)) return item;
  }

  const englishMatch = text.match(/\bin\s+([a-zA-Z][a-zA-Z\s,-]{1,40})/i);

  if (englishMatch) {
    const search = englishMatch[1]
      .replace(/\b(tomorrow|today|weather|forecast)\b/gi, "")
      .trim();

    if (search) {
      return { name: search, search };
    }
  }

  const persianMatch = text.match(
    /(?:در|برای|شهر|ولایت)\s+([\p{L}\s-]{2,40}?)(?=\s+(?:فردا|امروز|را|ره|بگو|می‌خواهم)|[؟?،,.]|$)/u
  );

  if (persianMatch) {
    return {
      name: persianMatch[1].trim(),
      search: persianMatch[1].trim()
    };
  }

  return null;
}

function weatherDescription(code) {
  const descriptions = {
    0: "آسمان صاف",
    1: "عمدتاً صاف",
    2: "نیمه‌ابری",
    3: "ابری",
    45: "مه‌آلود",
    48: "مه یخ‌زده",
    51: "نم‌نم باران خفیف",
    53: "نم‌نم باران",
    55: "نم‌نم باران شدید",
    61: "باران خفیف",
    63: "باران",
    65: "باران شدید",
    71: "برف خفیف",
    73: "برف",
    75: "برف شدید",
    80: "رگبار خفیف",
    81: "رگبار",
    82: "رگبار شدید",
    85: "رگبار برف",
    86: "برف شدید",
    95: "رعد و برق",
    96: "رعد و برق همراه ژاله",
    99: "رعد و برق و ژاله شدید"
  };

  return descriptions[code] || "وضعیت نامشخص";
}

async function getWeather(text) {
  const location = extractLocation(text);

  if (!location) {
    return {
      error: "نام شهر مشخص نیست. از کاربر بخواه نام شهر یا ولایت را بگوید."
    };
  }

  const geoUrl =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({
      name: location.search,
      count: "5",
      language: "en",
      format: "json"
    });

  const geoResponse = await fetch(geoUrl);

  if (!geoResponse.ok) {
    throw new Error("Weather location search failed.");
  }

  const geoData = await geoResponse.json();

  if (!geoData.results || geoData.results.length === 0) {
    return {
      error: `موقعیت ${location.name} پیدا نشد. از کاربر بخواه نام شهر را واضح‌تر بنویسد.`
    };
  }

  let place = geoData.results[0];

  if (/افغانستان|afghanistan/i.test(text)) {
    const afghanPlace = geoData.results.find(
      item => item.country_code === "AF"
    );

    if (afghanPlace) place = afghanPlace;
  }

  const weatherUrl =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      hourly: "temperature_2m,precipitation_probability,weather_code",
      timezone: "auto",
      forecast_days: "7"
    });

  const weatherResponse = await fetch(weatherUrl);

  if (!weatherResponse.ok) {
    throw new Error("Weather forecast service is unavailable.");
  }

  const weather = await weatherResponse.json();

  if (!weather.daily || !weather.daily.time) {
    throw new Error("Weather forecast data is unavailable.");
  }

  const wantsTomorrow = /(فردا|tomorrow)/i.test(text);
  const dayIndex = wantsTomorrow ? 1 : 0;

  if (!weather.daily.time[dayIndex]) {
    throw new Error("Requested forecast date is unavailable.");
  }

  const date = weather.daily.time[dayIndex];

  const hourly = [];

  for (let i = 0; i < weather.hourly.time.length; i++) {
    if (weather.hourly.time[i].startsWith(date)) {
      const hour = Number(weather.hourly.time[i].slice(11, 13));

      if ([6, 9, 12, 15, 18, 21].includes(hour)) {
        hourly.push({
          time: `${String(hour).padStart(2, "0")}:00`,
          temperature: weather.hourly.temperature_2m[i],
          rainChance: weather.hourly.precipitation_probability[i],
          condition: weatherDescription(
            weather.hourly.weather_code[i]
          )
        });
      }
    }
  }

  return {
    location: location.name,
    matchedPlace: place.name,
    country: place.country,
    date,
    timezone: weather.timezone,
    maxTemperature: weather.daily.temperature_2m_max[dayIndex],
    minTemperature: weather.daily.temperature_2m_min[dayIndex],
    rainChance:
      weather.daily.precipitation_probability_max[dayIndex],
    condition: weatherDescription(
      weather.daily.weather_code[dayIndex]
    ),
    hourly
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) {
      return Response.json(
        { error: "Workers AI binding is not configured." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const messages = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Please send a message." },
        { status: 400 }
      );
    }

    // Keep only valid recent messages.
    const safeMessages = messages
      .filter(message =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      )
      .slice(-20)
      .map(message => ({
        role: message.role,
        content: message.content.slice(0, 5000)
      }));

    if (
      safeMessages.length === 0 ||
      safeMessages[safeMessages.length - 1].role !== "user"
    ) {
      return Response.json(
        { error: "A user message is required." },
        { status: 400 }
      );
    }

    const lastUserMessage =
      safeMessages[safeMessages.length - 1].content;

    const systemPrompt = {
      role: "system",
      content: `تو HK AI هستی؛ یک دستیار هوشمند، دقیق و دوستانه.

قوانین مهم:
1. اگر کاربر به دری نوشت، به دری افغانستان جواب بده.
2. از کلمات ساده و طبیعی دری استفاده کن، نه فارسی رسمی ایران.
3. جواب‌ها را روشن، درست و تا حد امکان کوتاه بده.
4. اگر جواب چیزی را نمی‌دانی، صادقانه بگو که مطمئن نیستی.
5. هیچ‌وقت معلومات، خبر، آمار یا منبع جعلی نساز.
6. قبل از جواب، سوال کاربر را درست درک کن.
7. اگر سوال مبهم است، یک سوال کوتاه برای روشن شدن موضوع بپرس.
8. اگر کاربر انگلیسی نوشت، انگلیسی جواب بده.
9. دوستانه و با احترام صحبت کن.
10. از تکرار بی‌مورد خودداری کن.
11. اگر اطلاعات زنده هواشناسی در پیام سیستم داده شده، فقط بر اساس همان اطلاعات جواب بده.
12. درجه حرارت را به سانتی‌گراد بیان کن.
13. اگر اطلاعات هواشناسی موجود نیست، ادعای بررسی آب‌وهوا نکن.
14. تاریخ پیش‌بینی را واضح بگو.`
    };

    const aiMessages = [systemPrompt];

    // Get live weather when the user asks about weather.
    if (isWeatherQuestion(lastUserMessage)) {
      try {
        const weatherData = await getWeather(lastUserMessage);

        aiMessages.push({
          role: "system",
          content:
            "اطلاعات زنده هواشناسی که از سرویس هواشناسی دریافت شده است:\n" +
            JSON.stringify(weatherData) +
            "\nاین اطلاعات را به زبان کاربر، ساده و دقیق توضیح بده. اگر فیلد error موجود است، مطابق آن از کاربر معلومات بیشتر بخواه."
        });
      } catch (weatherError) {
        aiMessages.push({
          role: "system",
          content:
            "دریافت اطلاعات زنده هواشناسی فعلاً با مشکل روبه‌رو شد. " +
            "صادقانه به کاربر بگو که فعلاً نتوانستی پیش‌بینی را دریافت کنی. " +
            "هیچ درجه حرارت یا پیش‌بینی‌ای را حدس نزن."
        });
      }
    }

    aiMessages.push(...safeMessages);

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        messages: aiMessages,
        max_completion_tokens: 900,
        chat_template_kwargs: {
          enable_thinking: false
        },
        temperature: 0.4
      }
    );

    const reply =
      result?.response ||
      result?.choices?.[0]?.message?.content ||
      result?.result?.response;

    if (!reply) {
      return Response.json(
        { error: "The AI returned an empty response." },
        { status: 502 }
      );
    }

    return Response.json({ reply });

  } catch (error) {
    return Response.json(
      {
        error: "HK AI error: " + String(error.message || error)
      },
      { status: 500 }
    );
  }
}
