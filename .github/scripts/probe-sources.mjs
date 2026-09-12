/**
 * Разовая проверка: отвечают ли источники цен из дата-центра GitHub.
 * Запросы повторяют то, что делают скрипты приложения, — тот же fetch, те же адреса.
 * После проверки файл и workflow удаляются.
 */

const LOTS = [5606433, 3652858, 4424828, 3540361, 3681755];

const SOURCES = [
  {
    name: 'Zaka-Zaka · фид',
    url: 'https://feed.zaka-zaka.com/api/getlist/type/json/',
    timeout: 30_000,
    check: json => {
      const count = json?.offers?.length;
      return count ? `позиций: ${count}` : null;
    },
  },
  {
    name: 'Plati · список лотов',
    url: `https://api.digiseller.com/api/products/list?ids=${LOTS.join(',')}&lang=ru-RU`,
    check: json => (Array.isArray(json) && json.length ? `лотов: ${json.length}` : null),
  },
  {
    name: 'Plati · карточка лота',
    url: 'https://api.digiseller.com/api/products/5606433/data?lang=ru-RU&currency=RUB',
    headers: { Accept: 'application/json' },
    check: json => {
      const variants = json?.product?.options?.[0]?.variants?.length;
      return variants ? `вариантов издания: ${variants}` : null;
    },
  },
  {
    name: 'Steam · Казахстан',
    url: 'https://store.steampowered.com/api/appdetails?appids=2050650&cc=kz&filters=price_overview',
    check: json => {
      const price = json?.['2050650']?.data?.price_overview?.final_formatted;
      return price ? `цена: ${price}` : null;
    },
  },
  {
    name: 'Steam · Россия',
    url: 'https://store.steampowered.com/api/appdetails?appids=2050650&cc=ru&filters=price_overview',
    // Для игр Capcom Россия отвечает success:false — это штатный ответ, а не сбой.
    check: json => (json?.['2050650'] ? `success: ${json['2050650'].success} (false — норма)` : null),
  },
  {
    name: 'Steam · пакет издания',
    url: 'https://store.steampowered.com/api/packagedetails?packageids=994065&cc=kz',
    check: json => (json?.['994065'] ? `success: ${json['994065'].success}` : null),
  },
  {
    name: 'ЦБ РФ · курсы',
    url: 'https://www.cbr.ru/scripts/XML_daily.asp',
    text: true,
    check: body => (body.includes('KZT') ? 'курс тенге на месте' : null),
  },
];

function formatSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
}

// Как fetchWithRetry в приложении: разовый сбой соединения не должен выглядеть как блокировка.
const ATTEMPTS = 3;
const RETRY_DELAY = 1500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function describeError(e) {
  const cause = e.cause?.code ? ` (${e.cause.code})` : '';
  return `${e.name === 'TimeoutError' ? 'таймаут' : e.message}${cause}`;
}

async function fetchOnce({ url, headers, timeout }) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  return { res, body: await res.text() };
}

async function probe({ name, url, headers, timeout = 15_000, text = false, check }) {
  const started = Date.now();
  const errors = [];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { res, body } = await fetchOnce({ url, headers, timeout });
      const took = `${Date.now() - started} мс`;
      const retried = attempt > 1 ? `, с ${attempt}-й попытки` : '';

      if (!res.ok) return { ok: false, line: `✗ ${name} — HTTP ${res.status}, ${took}${retried}` };

      const detail = check(text ? body : JSON.parse(body));
      const summary = `HTTP ${res.status}, ${formatSize(body.length)}, ${took}${retried}`;

      return detail
        ? { ok: true, line: `✓ ${name} — ${summary} — ${detail}` }
        : { ok: false, line: `✗ ${name} — ${summary} — ответ пришёл, но не той формы` };
    } catch (e) {
      errors.push(describeError(e));
      if (attempt < ATTEMPTS) await sleep(RETRY_DELAY * attempt);
    }
  }

  return { ok: false, line: `✗ ${name} — все ${ATTEMPTS} попытки: ${errors.join('; ')}, ${Date.now() - started} мс` };
}

const results = [];
for (const source of SOURCES) {
  const result = await probe(source);
  console.log(result.line);
  results.push(result);
}

const failed = results.filter(result => !result.ok).length;
console.log(failed ? `\n❌ Не ответили: ${failed} из ${results.length}` : `\n✅ Все ${results.length} источников ответили`);
process.exit(failed ? 1 : 0);
