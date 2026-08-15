# Архитектура Chanlyst

## Общая схема

```text
Browser
  │
  ├── Marketing / Auth / Dashboard
  │
  ▼
Next.js + React + vinext
  │
  ├── API routes
  ├── session and workspace isolation
  ├── usage limits
  └── encrypted integration storage
  │
  ├── Cloudflare D1 / local persistent SQLite
  ├── OpenRouter
  ├── Google OAuth + Gmail API
  ├── Lemon Squeezy
  └── optional Smartlead
```

## Основные каталоги

- `app/` — страницы, dashboard, API и серверная логика.
- `app/dashboard/` — общий dashboard shell и рабочий интерфейс.
- `app/api/` — API routes.
- `app/lib/` — auth, billing, планы, лимиты, шифрование и вспомогательная логика.
- `db/schema.ts` — Drizzle-схема основных таблиц.
- `drizzle/` — последовательные SQL-миграции.
- `tests/` — проверки собранного workflow.
- `worker/` — Cloudflare worker entry.
- `.openai/hosting.json` — конфигурация Sites и D1 binding.
- `dist/` — результат `vinext build`, не является исходным кодом.

## Главные компоненты интерфейса

- `app/page.tsx` — landing page.
- `app/login/login-screen.tsx` — вход и регистрация.
- `app/dashboard/dashboard-shell.tsx` — оболочка и маршрутизация dashboard.
- `app/dashboard/signalist-dashboard.tsx` — основной рабочий интерфейс.
- `app/globals.css` — общие стили.

Dashboard разделён на:

- workspace;
- agent;
- integrations;
- billing.

## API

### Продукты и стратегия

- `POST /api/analyze` — AI-анализ продукта.
- `GET/POST /api/products` — продукты workspace.
- `POST /api/discover` — web search и классификация каналов.
- `GET/POST/PATCH /api/prospects` — найденные возможности и этапы.
- `POST /api/contacts/enrich` — поиск и проверка публичного контакта.

### Аутрич

- `POST /api/outreach` — генерация сообщения.
- `/api/messages` — очередь сообщений.
- `POST /api/send` — Gmail или Smartlead.
- `/api/outreach-sequences` — нативные цепочки.
- `POST /api/outreach-engine/run` — отправка следующего шага и проверка ответа.
- `/api/smartlead/sequences` — чтение и сохранение Smartlead sequence.

### Агент

- `/api/agent/schedule` — настройки расписания.
- `/api/agent/run` — агентный поиск.

### Авторизация

- `/api/auth/google/start`
- `/api/auth/google/callback`
- `/api/auth/apple/start`
- `/api/auth/apple/callback`
- `/api/auth/password`
- `/api/auth/session`

### Интеграции и платежи

- `/api/integrations`
- `/api/integrations/gmail/start`
- `/api/integrations/gmail/callback`
- `/api/billing`
- `/api/billing/webhook`
- `/api/providers`

## Модель данных

Основные таблицы:

- `users` — пользователи;
- `workspaces` — рабочие пространства;
- `workspace_members` — роли пользователей;
- `oauth_accounts` — Google/Apple identities;
- `sessions` — серверные сессии;
- `oauth_states` — OAuth state, nonce и verifier;
- `auth_attempts` — ограничение попыток входа;
- `products` — продукты и коммерческий бриф;
- `prospects` — найденные каналы, контакты, условия и воронка;
- `outbound_messages` — очередь исходящих сообщений;
- `workspace_integrations` — зашифрованные пользовательские интеграции;
- `subscriptions` — подписки Lemon Squeezy;
- `ai_usage` — использование AI и стоимость;
- `agent_schedules` — расписание агента;
- `agent_runs` — история запусков;
- `outreach_sequences` — нативные цепочки;
- `outreach_events` — события цепочек;
- `suppression_list` — запрет дальнейшей рассылки;
- `contact_requests` — заявки с маркетингового сайта;
- `campaigns` и legacy `integrations` — ранние сущности, пока сохранены для совместимости.

## Prospect

Ключевые группы полей:

- идентификация: company, domain, url;
- оценка: score, reason, source, channel type;
- возможность: opportunity type, action type, next action, action URL;
- размещение: engagement mode, commercial model, pricing summary, requirements, usage terms, registration URL;
- контакт: name, role, email, Telegram, LinkedIn, evidence, confidence;
- решение: review, approved, rejected;
- воронка: discovered, queued, contacted, replied, meeting, won, lost;
- результат: revenue и outcome note;
- происхождение: curated или discovered.

## Изоляция данных

Запросы к пользовательским сущностям фильтруются по `workspace_id`. После OAuth новый пользователь получает собственный workspace. Интеграции также связаны с workspace.

## Секреты

Глобальные секреты поступают через runtime environment. Пользовательские ключи шифруются перед сохранением в `workspace_integrations`. Шифрование использует `INTEGRATION_ENCRYPTION_KEY`.

## Поиск каналов

`/api/discover` использует OpenRouter Responses API с `openrouter:web_search` и строгой JSON Schema.

Каждый результат получает:

- проверяемый URL;
- score от 0 до 100;
- opportunity type;
- action type;
- engagement mode;
- public commercial conditions;
- direct action URL;
- outreach eligibility.

Результаты без достаточного score или подтверждённого домена отбрасываются.

## Миграции

Текущая последняя миграция: `drizzle/0015_secret_epoch.sql`.

Важное правило: `db/schema.ts` и SQL-миграции необходимо проверять вместе. Часть ранних полей добавлялась ручными миграциями, поэтому нельзя автоматически применять сгенерированный SQL без просмотра diff.
