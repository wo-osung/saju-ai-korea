import "dotenv/config";
import express from "express";
import cors from "cors";
import { Solar, Lunar } from "lunar-javascript";
import crypto from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.static("public"));

/* =========================
   한국 주요 도시 좌표
========================= */

const LOCATIONS = {
  서울: [126.9780, 37.5665],
  수원: [127.0286, 37.2636],
  인천: [126.7052, 37.4563],
  부산: [129.0756, 35.1796],
  대구: [128.6014, 35.8714],
  광주: [126.8526, 35.1595],
  대전: [127.3845, 36.3504],
  울산: [129.3114, 35.5384],
  제주: [126.5312, 33.4996],
  춘천: [127.7298, 37.8813],
  강릉: [128.8761, 37.7519],
  전주: [127.1480, 35.8242],
  청주: [127.4890, 36.6424],
  포항: [129.3435, 36.0190],
  창원: [128.6811, 35.2281],
  성남: [127.1267, 37.4200],
  고양: [126.8320, 37.6584],
  용인: [127.1776, 37.2411]
};

function getCoords(place = "") {
  const text = String(place).trim();

  for (const [name, coords] of Object.entries(LOCATIONS)) {
    if (text.includes(name)) {
      return {
        name,
        lon: coords[0],
        lat: coords[1]
      };
    }
  }

  return {
    name: "서울",
    lon: 126.9780,
    lat: 37.5665
  };
}

/* =========================
   한국 시간대
========================= */

function getKoreaOffsetMinutes(date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      timeZoneName: "longOffset",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);

    const tz =
      parts.find((part) => part.type === "timeZoneName")?.value || "";

    const match = tz.match(
      /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/
    );

    if (!match) {
      return 540;
    }

    const sign = match[1] === "-" ? -1 : 1;

    return sign * (
      Number(match[2]) * 60 +
      Number(match[3] || 0)
    );
  } catch {
    return 540;
  }
}

/* =========================
   한국 현지시간 → UTC
========================= */

function localKoreaToUtc(year, month, day, hour, minute) {
  const desired = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    0
  );

  let utc = desired - 9 * 60 * 60 * 1000;

  for (let i = 0; i < 4; i++) {
    const offset = getKoreaOffsetMinutes(new Date(utc));

    utc =
      desired -
      offset * 60 * 1000;
  }

  return utc;
}

/* =========================
   출생시간 보정
   한국 표준시 + 출생지 경도
========================= */

function normalizeBirth({
  year,
  month,
  day,
  hour,
  minute,
  place
}) {
  const location = getCoords(place);

  const utc = localKoreaToUtc(
    year,
    month,
    day,
    hour,
    minute
  );

  const offsetMinutes =
    getKoreaOffsetMinutes(new Date(utc));

  /*
    UTC offset × 15도 = 표준 자오선
    경도 1도 = 약 4분
  */

  const standardMeridian =
    (offsetMinutes / 60) * 15;

  const longitudeCorrection =
    (location.lon - standardMeridian) * 4;

  const normalizedUtc =
    utc + longitudeCorrection * 60 * 1000;

  const date = new Date(normalizedUtc);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      "출생시간 정규화에 실패했습니다."
    );
  }

  return {
    date: date.toISOString().slice(0, 10),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),

    longitude: location.lon,
    latitude: location.lat,

    longitudeCorrectionMinutes:
      Math.round(longitudeCorrection),

    utcOffsetMinutes: offsetMinutes,

    timezone: "Asia/Seoul",
    city: location.name
  };
}

/* =========================
   날짜 검증
========================= */

function validateDate(year, month, day) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(
      "생년월일 형식이 올바르지 않습니다."
    );
  }

  if (
    year < 1 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error(
      "지원하지 않는 생년월일입니다."
    );
  }
}

/* =========================
   사주 계산
========================= */

function calculateSaju({
  birthDate,
  birthTime,
  calendar,
  place,
  gender
}) {
  console.log("BIRTH DATE RECEIVED:", birthDate);
  console.log("BIRTH TIME RECEIVED:", birthTime);
  console.log("CALENDAR RECEIVED:", calendar);
  console.log("PLACE RECEIVED:", place);

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    String(birthDate)
  );

  if (!dateMatch) {
    throw new Error("생년월일 형식이 올바르지 않습니다.");
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  validateDate(year, month, day);

  const timeUnknown =
    !birthTime ||
    birthTime === "unknown" ||
    birthTime === "모름";

  // 출생시각을 모르는 경우 정오를 계산용 기준으로 사용한다.
  // 실제 시주를 추정하지 않고, 결과에는 시주 미상으로 표시한다.
  const timeMatch = timeUnknown
    ? ["12", "00"]
    : /^(\d{2}):(\d{2})$/.exec(String(birthTime));

  if (!timeMatch) {
    throw new Error("출생시간 형식이 올바르지 않습니다.");
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("출생시간 값이 올바르지 않습니다.");
  }

  let solar;

  if (calendar === "음력") {
    const lunar = Lunar.fromYmd(year, month, day);
    if (!lunar) {
      throw new Error("음력 날짜 변환에 실패했습니다.");
    }
    solar = lunar.getSolar();
  } else {
    solar = Solar.fromYmd(year, month, day);
  }

  if (!solar) {
    throw new Error("양력 날짜 생성에 실패했습니다.");
  }

  const normalized = normalizeBirth({
    year: solar.getYear(),
    month: solar.getMonth(),
    day: solar.getDay(),
    hour,
    minute,
    place
  });

  const correctedSolar = Solar.fromYmdHms(
    Number(normalized.date.slice(0, 4)),
    Number(normalized.date.slice(5, 7)),
    Number(normalized.date.slice(8, 10)),
    normalized.hour,
    normalized.minute,
    0
  );

  if (!correctedSolar) {
    throw new Error("보정된 출생시간 생성에 실패했습니다.");
  }

  const lunar = correctedSolar.getLunar();
  if (!lunar) {
    throw new Error("음력 변환에 실패했습니다.");
  }

  const eightChar = lunar.getEightChar();
  if (!eightChar) {
    throw new Error("사주 원국 생성에 실패했습니다.");
  }

  if (typeof eightChar.setSect === "function") {
    eightChar.setSect(2);
  }

  const safe = (fn, fallback = "") => {
    try {
      return typeof fn === "function" ? fn() : fallback;
    } catch {
      return fallback;
    }
  };

  const yearPillar = eightChar.getYear();
  const monthPillar = eightChar.getMonth();
  const dayPillar = eightChar.getDay();
  const timePillar = timeUnknown ? "" : eightChar.getTime();

  const pillars = [
    {
      name: "년주",
      pillar: yearPillar,
      gan: safe(() => eightChar.getYearGan()),
      zhi: safe(() => eightChar.getYearZhi()),
      hideGan: safe(() => eightChar.getYearHideGan(), [])
    },
    {
      name: "월주",
      pillar: monthPillar,
      gan: safe(() => eightChar.getMonthGan()),
      zhi: safe(() => eightChar.getMonthZhi()),
      hideGan: safe(() => eightChar.getMonthHideGan(), [])
    },
    {
      name: "일주",
      pillar: dayPillar,
      gan: safe(() => eightChar.getDayGan()),
      zhi: safe(() => eightChar.getDayZhi()),
      hideGan: safe(() => eightChar.getDayHideGan(), [])
    },
    {
      name: "시주",
      pillar: timePillar,
      gan: timeUnknown ? "" : safe(() => eightChar.getTimeGan()),
      zhi: timeUnknown ? "" : safe(() => eightChar.getTimeZhi()),
      hideGan: timeUnknown ? [] : safe(() => eightChar.getTimeHideGan(), [])
    }
  ];

  // 명리에서 실제로 활용되는 기본 구조 데이터
  const visibleElements = {};
  const elementMap = {
    甲: "목", 乙: "목", 丙: "화", 丁: "화", 戊: "토", 己: "토",
    庚: "금", 辛: "금", 壬: "수", 癸: "수",
    子: "수", 丑: "토", 寅: "목", 卯: "목", 辰: "토", 巳: "화",
    午: "화", 未: "토", 申: "금", 酉: "금", 戌: "토", 亥: "수"
  };

  for (const p of pillars) {
    for (const ch of [p.gan, p.zhi]) {
      const element = elementMap[ch];
      if (element) visibleElements[element] = (visibleElements[element] || 0) + 1;
    }
  }

  const zhi = pillars.map(p => p.zhi).filter(Boolean);
  const relations = [];
  const clash = new Map([
    ["子", "午"], ["丑", "未"], ["寅", "申"], ["卯", "酉"], ["辰", "戌"], ["巳", "亥"]
  ]);
  const sixCombine = new Map([
    ["子", "丑"], ["寅", "亥"], ["卯", "戌"], ["辰", "酉"], ["巳", "申"], ["午", "未"]
  ]);
  const harm = new Map([
    ["子", "未"], ["丑", "午"], ["寅", "巳"], ["卯", "辰"], ["申", "亥"], ["酉", "戌"]
  ]);

  for (let i = 0; i < zhi.length; i++) {
    for (let j = i + 1; j < zhi.length; j++) {
      const a = zhi[i], b = zhi[j];
      if (clash.get(a) === b || clash.get(b) === a) {
        relations.push(`${pillars[i].name}-${pillars[j].name}: 충`);
      }
      if (sixCombine.get(a) === b || sixCombine.get(b) === a) {
        relations.push(`${pillars[i].name}-${pillars[j].name}: 육합`);
      }
      if (harm.get(a) === b || harm.get(b) === a) {
        relations.push(`${pillars[i].name}-${pillars[j].name}: 해`);
      }
    }
  }

  // 삼합/방합은 원국에 실제 해당 지지가 모두 있을 때만 표시한다.
  const groups = [
    ["申", "子", "辰", "삼합 수국"],
    ["亥", "卯", "未", "삼합 목국"],
    ["寅", "午", "戌", "삼합 화국"],
    ["巳", "酉", "丑", "삼합 금국"],
    ["寅", "卯", "辰", "방합 목국"],
    ["巳", "午", "未", "방합 화국"],
    ["申", "酉", "戌", "방합 금국"],
    ["亥", "子", "丑", "방합 수국"]
  ];

  for (const [a, b, c, label] of groups) {
    if ([a, b, c].every(x => zhi.includes(x))) {
      relations.push(label);
    }
  }

  /* =========================
     대운·세운 계산
     lunar-javascript의 Yun/DaYun/LiuNian을 사용한다.
     남성=1, 여성=0. 출생시각 미상이어도 날짜 기반 대운/세운은 계산한다.
  ========================= */

  let fortuneFlow = {
    available: false,
    reason: ""
  };

  try {
    const yunGender = gender === "남성" ? 1 : 0;
    const yun = typeof eightChar.getYun === "function"
      ? eightChar.getYun(yunGender)
      : null;

    if (yun) {
      const startSolar = typeof yun.getStartSolar === "function"
        ? yun.getStartSolar()
        : null;
      const daYunList = typeof yun.getDaYun === "function"
        ? yun.getDaYun()
        : [];
      const currentYear = new Date().getFullYear();

      const daewoon = daYunList
        .map((dy) => {
          const startYear = safe(() => dy.getStartYear(), null);
          const startAge = safe(() => dy.getStartAge(), null);
          const ganZhi = safe(() => dy.getGanZhi(), "");
          const gan = safe(() => dy.getGan(), "");
          const zhi = safe(() => dy.getZhi(), "");
          const liuNian = typeof dy.getLiuNian === "function"
            ? safe(() => dy.getLiuNian(), [])
            : [];

          const years = liuNian.slice(0, 12).map((ln) => ({
            year: safe(() => ln.getYear(), null),
            age: safe(() => ln.getAge(), null),
            ganZhi: safe(() => ln.getGanZhi(), "")
          }));

          return {
            startYear,
            startAge,
            endYear: startYear == null ? null : startYear + 9,
            ganZhi,
            gan,
            zhi,
            liuNian: years
          };
        })
        .filter((x) => x.ganZhi);

      const currentDaYun = daewoon.find((dy) =>
        Number.isFinite(dy.startYear) &&
        currentYear >= dy.startYear &&
        currentYear <= dy.endYear
      ) || null;

      const currentLiuNian = currentDaYun?.liuNian?.find(
        (ln) => ln.year === currentYear
      ) || null;

      fortuneFlow = {
        available: true,
        startAge: safe(() => yun.getStartYear(), null),
        startMonth: safe(() => yun.getStartMonth(), null),
        startDay: safe(() => yun.getStartDay(), null),
        startSolar: startSolar && typeof startSolar.toYmd === "function"
          ? startSolar.toYmd()
          : "",
        direction: daewoon.length >= 2
          ? (daewoon[1].startYear > daewoon[0].startYear ? "순행" : "역행")
          : "",
        currentYear,
        currentDaYun,
        currentLiuNian,
        daewoon: daewoon.slice(0, 9)
      };
    }
  } catch (fortuneError) {
    console.warn("FORTUNE FLOW CALC WARNING:", fortuneError?.message || fortuneError);
    fortuneFlow = {
      available: false,
      reason: "대운 계산을 제공하지 않는 경우 기본 원국 분석만 표시합니다."
    };
  }

  const result = {
    solarDate: correctedSolar.toYmd(),
    lunarDate:
      `${String(lunar.getYear()).padStart(4, "0")}-${String(Math.abs(lunar.getMonth())).padStart(2, "0")}-${String(lunar.getDay()).padStart(2, "0")}`,
    year: yearPillar,
    month: monthPillar,
    day: dayPillar,
    time: timePillar,
    timeUnknown,
    yearGan: pillars[0].gan,
    monthGan: pillars[1].gan,
    dayGan: pillars[2].gan,
    timeGan: pillars[3].gan,
    yearZhi: pillars[0].zhi,
    monthZhi: pillars[1].zhi,
    dayZhi: pillars[2].zhi,
    timeZhi: pillars[3].zhi,
    yearHideGan: pillars[0].hideGan,
    monthHideGan: pillars[1].hideGan,
    dayHideGan: pillars[2].hideGan,
    timeHideGan: pillars[3].hideGan,
    yearWuXing: safe(() => eightChar.getYearWuXing()),
    monthWuXing: safe(() => eightChar.getMonthWuXing()),
    dayWuXing: safe(() => eightChar.getDayWuXing()),
    timeWuXing: timeUnknown ? "" : safe(() => eightChar.getTimeWuXing()),
    dayShiShen: safe(() => eightChar.getDayShiShenGan()),
    tenGods: {
      year: safe(() => eightChar.getYearShiShenGan()),
      month: safe(() => eightChar.getMonthShiShenGan()),
      day: "일주",
      time: timeUnknown ? "" : safe(() => eightChar.getTimeShiShenGan()),
      yearZhi: safe(() => eightChar.getYearShiShenZhi(), []),
      monthZhi: safe(() => eightChar.getMonthShiShenZhi(), []),
      dayZhi: safe(() => eightChar.getDayShiShenZhi(), []),
      timeZhi: timeUnknown ? [] : safe(() => eightChar.getTimeShiShenZhi(), [])
    },
    diShi: {
      year: safe(() => eightChar.getYearDiShi()),
      month: safe(() => eightChar.getMonthDiShi()),
      day: safe(() => eightChar.getDayDiShi()),
      time: timeUnknown ? "" : safe(() => eightChar.getTimeDiShi())
    },
    naYin: {
      year: safe(() => eightChar.getYearNaYin()),
      month: safe(() => eightChar.getMonthNaYin()),
      day: safe(() => eightChar.getDayNaYin()),
      time: timeUnknown ? "" : safe(() => eightChar.getTimeNaYin())
    },
    mingGong: safe(() => eightChar.getMingGong()),
    shenGong: safe(() => eightChar.getShenGong()),
    visibleFiveElements: visibleElements,
    relations,
    xunKong: {
      day: safe(() => eightChar.getDayXunKong()),
      year: safe(() => eightChar.getYearXunKong())
    },
    fortuneFlow,
    correction: normalized
  };

  // 출생시각을 모르는 경우 시주를 추정하지 않는다.
  const requiredPillars = [result.year, result.month, result.day];
  if (!requiredPillars.every(v => typeof v === "string" && v.length >= 2)) {
    throw new Error("사주 원국 계산 결과가 비정상입니다.");
  }

  return result;
}

/* =========================
   AI 비용 최적화 / 캐시 / 요청 제한
========================= */

const AI_CACHE_TTL_MS =
  Number(process.env.AI_CACHE_TTL_MS || 24 * 60 * 60 * 1000);

const AI_RATE_WINDOW_MS =
  Number(process.env.AI_RATE_WINDOW_MS || 10 * 60 * 1000);

const AI_RATE_LIMIT =
  Number(process.env.AI_RATE_LIMIT || 3);

const aiCache = new Map();
const aiRate = new Map();

function cleanupAiCache() {
  const now = Date.now();

  for (const [key, item] of aiCache.entries()) {
    if (item.expiresAt <= now) {
      aiCache.delete(key);
    }
  }
}

function cleanupAiRate() {
  const now = Date.now();

  for (const [key, item] of aiRate.entries()) {
    if (item.resetAt <= now) {
      aiRate.delete(key);
    }
  }
}

function getClientIp(req) {
  const forwarded =
    req.headers["x-forwarded-for"];

  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : String(forwarded || "")
        .split(",")[0]
        .trim();

  return (
    ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function checkAiRateLimit(req) {
  cleanupAiRate();

  const now = Date.now();
  const ip = getClientIp(req);

  let item = aiRate.get(ip);

  if (!item || item.resetAt <= now) {
    item = {
      count: 0,
      resetAt:
        now + AI_RATE_WINDOW_MS
    };
  }

  item.count += 1;
  aiRate.set(ip, item);

  if (item.count > AI_RATE_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds:
        Math.ceil(
          (item.resetAt - now) / 1000
        )
    };
  }

  return {
    allowed: true
  };
}

function createAiCacheKey(profile, eight) {
  const payload = {
    version: 2,

    gender:
      String(profile?.gender || ""),

    focus:
      String(
        profile?.focus || "전체"
      ),

    eight: {
      solarDate:
        eight?.solarDate || "",

      lunarDate:
        eight?.lunarDate || "",

      year:
        eight?.year || "",

      month:
        eight?.month || "",

      day:
        eight?.day || "",

      time:
        eight?.time || "",

      yearGan:
        eight?.yearGan || "",

      monthGan:
        eight?.monthGan || "",

      dayGan:
        eight?.dayGan || "",

      timeGan:
        eight?.timeGan || "",

      yearWuXing:
        eight?.yearWuXing || "",

      monthWuXing:
        eight?.monthWuXing || "",

      dayWuXing:
        eight?.dayWuXing || "",

      timeWuXing:
        eight?.timeWuXing || "",

      dayShiShen:
        eight?.dayShiShen || "",

      tenGods:
        eight?.tenGods || {},

      mingGong:
        eight?.mingGong || "",

      shenGong:
        eight?.shenGong || ""
    }
  };

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(payload)
    )
    .digest("hex");
}

function getCachedAiResult(key) {
  cleanupAiCache();

  const item =
    aiCache.get(key);

  if (!item) {
    return null;
  }

  if (
    item.expiresAt <=
    Date.now()
  ) {
    aiCache.delete(key);
    return null;
  }

  return item.result;
}

function setCachedAiResult(
  key,
  result
) {
  aiCache.set(key, {
    result,
    expiresAt:
      Date.now() +
      AI_CACHE_TTL_MS
  });
}
/* =========================
   AI JSON Schema
========================= */

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    personality: { type: "string" },
    overall: { type: "string" },
    wealth: { type: "string" },
    career: { type: "string" },
    love: { type: "string" },
    health: { type: "string" },
    flow: { type: "string" },
    advice: { type: "string" },
    caution: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        overall: { type: "integer" },
        wealth: { type: "integer" },
        career: { type: "integer" },
        love: { type: "integer" }
      },
      required: ["overall", "wealth", "career", "love"]
    },
    currentFlow: {
      type: "string"
    },
    currentYearHighlights: {
      type: "array",
      items: { type: "string" }
    },
    yearFlow: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          year: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" }
        },
        required: ["year", "title", "description"]
      }
    }
  },
  required: [
    "headline", "summary", "personality", "overall", "wealth", "career",
    "love", "health", "flow", "advice", "caution", "keywords", "scores",
    "currentFlow", "currentYearHighlights", "yearFlow"
  ]
};

/* =========================
   Health Check
========================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "saju-ai",
      time: new Date().toISOString()
    });
  }
);

/* =========================
   사주 계산 API
========================= */

app.post(
  "/api/calculate",
  (req, res) => {
    try {
      const {
        birthDate,
        birthTime,
        calendar = "양력",
        place = "서울",
        gender,
        name,
        focus
      } = req.body || {};

      if (
        !birthDate ||
        !birthTime ||
        !gender
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "필수 입력값이 부족합니다."
        });
      }

      const eight =
        calculateSaju({
          birthDate,
          birthTime,
          calendar,
          place,
          gender
        });

      return res.json({
        ok: true,
        name,
        birthDate,
        birthTime,
        calendar,
        place,
        gender,
        focus,
        eight
      });

    } catch (error) {
      console.error(
        "========== SAJU CALC ERROR =========="
      );

      console.error(error);

      console.error(
        "======================================"
      );

      return res.status(400).json({
        ok: false,
        error: "사주 계산 실패",
        detail:
          error?.message ||
          String(error)
      });
    }
  }
);

/* =========================
   AI 분석 API
========================= */

function buildAiProfile(profile) {
  return {
    gender: String(profile?.gender || ""),
    focus: String(profile?.focus || "전체")
  };
}

app.post(
  "/api/analyze",
  async (req, res) => {
    try {
      // OpenAI API Key 확인
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          ok: false,
          error: "OPENAI_API_KEY가 설정되지 않았습니다."
        });
      }

      const { profile, eight } = req.body || {};

      // 필수 데이터 확인
      if (!profile || !eight) {
        return res.status(400).json({
          ok: false,
          error: "AI 분석 데이터가 없습니다."
        });
      }

      /*
       * AI에 전달하는 정보 최소화
       *
       * 이름
       * 원본 생년월일
       * 원본 출생시간
       *
       * 은 AI에 전달하지 않고,
       * 이미 계산된 사주 명식만 해석하도록 한다.
       */
      const aiProfile = buildAiProfile(profile);

      /*
       * 캐시 키 생성
       *
       * 같은 사주 + 성별 + 관심분야라면
       * OpenAI를 다시 호출하지 않는다.
       */
      const cacheKey = createAiCacheKey(
        aiProfile,
        eight
      );

      const cached =
        getCachedAiResult(cacheKey);

      if (cached) {
        console.log(
          "AI CACHE HIT:",
          cacheKey
        );

        return res.json({
          ok: true,
          cached: true,
          ...cached
        });
      }

      /*
       * AI 요청 횟수 제한
       *
       * 기본값:
       * IP 기준 10분에 3회
       */
      const rate =
        checkAiRateLimit(req);

      if (!rate.allowed) {
        return res.status(429).json({
          ok: false,
          error:
            "AI 분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
          retryAfterSeconds:
            rate.retryAfterSeconds
        });
      }

      /*
       * AI에게 전달할 프롬프트
       */
      const prompt = `
당신은 전통 한국 명리학의 구조를 설명하는
AI 해설자입니다.

초자연적 능력이나 무속인 자격을 주장하지 않습니다.

계산된 사주 원국을 참고하여
사용자의 자기이해에 도움을 주는
참고용 콘텐츠를 작성합니다.

[사용자 정보]
${JSON.stringify(aiProfile)}

[계산 완료된 사주 원국]
${JSON.stringify(eight)}

[해석에 활용할 명리 구조]
- 월령과 월주를 우선적으로 고려하세요.
- 일간을 기준으로 천간·지지의 십신 구조를 살펴보세요.
- 지지의 지장간, 십신, 십이운성(지세), 납음은 보조 근거로 사용하세요.
- 원국에 실제 존재하는 충·육합·해·삼합·방합 관계가 제공되면 그 구조를 구체적으로 설명하세요.
- 오행 분포는 제공된 실제 계산값을 사용하고, 단순 개수만으로 용신을 확정하지 마세요.
- 명궁·신궁은 보조 참고자료로 활용하세요.
- 출생시각이 미상이라면 시주·시주 십신·시주 지장간을 추정하지 말고, 연주·월주·일주 중심으로 해석하세요.
- 용신·희신·기신을 언급할 때는 충분한 근거가 있는 경우에만 설명하고, 단순 오행 개수만으로 단정하지 마세요.
- fortuneFlow에 계산된 대운·세운 데이터가 있으면 반드시 그것을 운의 흐름 해석의 근거로 사용하세요.
- 현재 대운과 현재 연도(세운)를 구분하여 설명하세요.
- 대운/세운의 간지 자체를 다시 계산하거나 임의로 만들지 마세요.
- 대운이 계산되지 않은 경우 대운을 추정하지 말고 원국 중심으로 설명하세요.

반드시 다음 원칙을 지키세요.

1. 전달받은 사주 원국의
   년주/월주/일주/시주를 그대로 사용하세요.

2. 생년월일이나 출생시간을 이용하여
   사주를 다시 계산하거나 수정하지 마세요.

3. 전달받은 명식의
   일간, 오행, 십신을 중심으로
   구체적으로 설명하세요.

4. 생극제화, 합충형해파는
   전달된 데이터로 근거를 확인할 수 있을 때만
   언급하세요.

5. 계산 결과에 없는 사실을
   임의로 만들어내지 마세요.

6. 초자연적 능력이나
   객관적인 과학적 정확도를 주장하지 마세요.

7. 미래의 사건을 확정적으로 단정하지 마세요.

8. 사망, 중대한 질병, 범죄,
   재난 등을 예측하지 마세요.

9. 투자 수익이나 금전적 결과를
   보장하지 마세요.

10. 건강, 재정, 법률 관련 내용은
    참고용이라고 표현하세요.

11. 사용자의 관심 분야는
    ${aiProfile.focus}입니다.

12. 관심 분야를 결과에 자연스럽게 반영하세요.

13. 한국어로 작성하세요.

14. 모바일에서 읽기 쉽게
    짧은 문단으로 작성하세요.

[결과 작성 기준]

중요: 결과는 명리학 전문가용 보고서가 아니라 일반 사용자가 모바일에서 읽는 콘텐츠입니다.
첫 화면부터 전문용어를 보여주면 사용자가 이탈할 수 있으므로, 결과의 본문에는 한자 간지나 전문 명리 용어를 최대한 숨기고 생활 언어로 번역하세요.
사용자가 읽자마자 “그래서 나는 어떤 사람이고, 지금 내 삶에서 어떤 의미가 있는지” 이해할 수 있어야 합니다.
특히 대운·세운의 간지(예: 戊子, 丙午)를 일반 결과 문장에 절대 그대로 쓰지 마세요.
"그래서?"라는 생각이 들지 않도록 성격·연애·돈·직업·올해의 변화처럼 실제 생활과 연결해서 설명하세요.
전문적인 계산 근거는 결과 하단의 "전문 분석 보기"에서 별도로 확인할 수 있다고 가정하고, 본문은 흥미롭고 읽기 쉬운 콘텐츠로 작성하세요.
모든 문자열에는 HTML 태그(<strong>, <br>, <span>, <b> 등)를 넣지 마세요. 순수 텍스트만 반환하세요.

- headline: 1문장. 사주 용어보다 사용자가 공감할 만한 핵심 특징을 한 문장으로 표현하세요.
- summary: 2~3문장. 이 사람의 핵심 성향과 전체적인 흐름을 쉬운 말로 요약하세요.
- personality: 3~5문장. 실제 생활에서 어떤 모습으로 나타나는지 예시를 섞어 설명하세요.
- overall: 3~5문장. 강점과 주의점을 균형 있게 설명하세요.
- wealth: 3~5문장. 돈을 벌고 쓰고 관리하는 성향을 현실적인 말로 설명하세요. 투자 수익을 약속하지 마세요.
- career: 3~5문장. 어떤 환경이나 업무 방식에서 장점이 살아나는지 설명하세요.
- love: 3~5문장. 연애와 인간관계에서 나타날 수 있는 패턴을 쉽게 설명하세요.
- health: 2~4문장. 건강을 진단하지 말고 생활 습관 관점의 참고 내용으로 작성하세요.
- flow: 3~5문장. 특정 사건을 확정하지 말고 앞으로의 흐름을 참고용으로 설명하세요.
- advice: 2~4문장. 사용자가 실제로 적용할 수 있는 행동 조언으로 작성하세요.
- caution: 2~4문장. 지나치게 무섭거나 부정적인 표현 없이 주의할 점을 설명하세요.
- keywords: 3~5개. 일반 사용자가 바로 이해할 수 있는 단어를 사용하세요.
- currentFlow: 현재 대운과 올해 세운을 일반인이 이해하기 쉽게 3~5문장으로 설명하세요.
- currentYearHighlights: 올해에 참고할 포인트를 3개 작성하세요. 각 항목은 1문장으로 짧게 작성하세요.
- yearFlow: 현재 연도를 포함해 5년치 흐름을 작성하세요. 각 연도는 {year, title, description} 구조로 작성하세요.
  title은 "새로운 기회가 들어오는 해", "속도를 조절하면 좋은 해"처럼 일반인이 바로 이해할 수 있는 문장으로 작성하세요.
  description은 1~2문장으로 실제 생활에서 어떤 점을 살펴보면 좋을지 설명하세요.
  간지(예: 丙午, 戊子)는 절대 출력하지 마세요.

scores:
overall / wealth / career / love 각각 0~100 사이의 정수.
점수는 과학적 측정값이 아니라 콘텐츠상 참고 지표입니다. 점수만으로 운이 좋다/나쁘다고 단정하지 마세요.

문체 예시:
“자기주장이 강합니다”보다 “내가 납득한 일은 끝까지 밀어붙이는 편이에요.”처럼 작성하세요.
“재성의 작용이 강합니다”처럼 전문 용어만으로 문장을 끝내지 말고, 필요한 경우 용어를 괄호로 짧게 설명한 뒤 일반적인 말로 풀어쓰세요.
“합충으로 인해 변화가 많습니다”보다 “사람이나 환경이 바뀌는 상황에서 오히려 새로운 기회를 잡는 편이에요.”처럼 사용자에게 의미가 전달되게 작성하세요.

JSON Schema를 정확하게 준수하세요.
`;

      /*
       * AI 모델
       *
       * .env에서 설정하지 않았으면
       * 기본적으로 gpt-5-mini 사용
       */
      const model =
        process.env.OPENAI_MODEL ||
        "gpt-5-mini";

      console.log(
        "AI ANALYZE START:",
        model
      );

      /*
       * OpenAI Responses API 호출
       */
      const response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${process.env.OPENAI_API_KEY}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            model,

            input: prompt,

            store: false,

            reasoning: {
              effort:
                process.env.OPENAI_REASONING_EFFORT ||
                "low"
            },

            text: {
              verbosity:
                process.env.OPENAI_VERBOSITY ||
                "low",

              format: {
                type: "json_schema",

                name: "saju_report",

                strict: true,

                schema
              }
            },

            max_output_tokens:
              Number(
                process.env.OPENAI_MAX_OUTPUT_TOKENS ||
                2200
              )
          })
        }
      );

      /*
       * OpenAI 응답을 먼저 text로 받는다.
       * JSON 응답이 비어 있거나 형식이 잘못된 경우에도
       * 실제 오류를 확인할 수 있도록 한다.
       */
      const raw =
        await response.text();

      let data = {};

      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(
            `OpenAI 응답을 JSON으로 읽지 못했습니다: ${raw.slice(
              0,
              300
            )}`
          );
        }
      }

      /*
       * OpenAI API 오류
       */
      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
          `OpenAI API 오류: HTTP ${response.status}`
        );
      }

      /*
       * Responses API에서
       * 실제 텍스트 결과 추출
       */
      const outputText =
        data.output_text ||
        data.output
          ?.flatMap(
            (item) =>
              item.content || []
          )
          ?.find(
            (item) =>
              typeof item.text ===
              "string"
          )
          ?.text;

      if (!outputText) {
        throw new Error(
          "OpenAI에서 분석 결과를 받지 못했습니다."
        );
      }

      /*
       * AI가 반환한 JSON 파싱
       */
      let result;

      try {
        result =
          JSON.parse(outputText);
      } catch {
        throw new Error(
          "AI 분석 결과 JSON 파싱에 실패했습니다."
        );
      }

      /*
       * 실제 AI 결과를 캐시에 저장
       *
       * 다음 동일 요청부터는
       * OpenAI API를 호출하지 않는다.
       */
      setCachedAiResult(
        cacheKey,
        result
      );

      console.log(
        "AI ANALYZE SUCCESS"
      );

      /*
       * 프론트로 결과 전달
       */
      return res.json({
        ok: true,

        cached: false,

        ...result
      });

    } catch (error) {

      /*
       * 실제 오류를 Terminal에 표시
       */
      console.error(
        "========== AI ANALYZE ERROR =========="
      );

      console.error(error);

      console.error(
        "======================================"
      );

      /*
       * 프론트에도 실제 오류 원인을 전달
       */
      return res.status(500).json({
        ok: false,

        error:
          "AI 분석 중 문제가 발생했습니다.",

        detail:
          error?.message ||
          String(error)
      });
    }
  }
);
/* =========================
   Server
========================= */

app.listen(
  PORT,
  () => {
    console.log(
      `SajuAI Korea Verified http://localhost:${PORT}`
    );
  }
);