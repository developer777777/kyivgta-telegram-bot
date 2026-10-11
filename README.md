# 🛡️ Telegram 2FA Бот для MTA (GHOST GTA)

Автономний бот для обробки двофакторної автентифікації (2FA) та прив'язки акаунтів Telegram для сервера MTA (`ugta_serverAPI`).

---

## 🚀 Покрокова інструкція із запуску:

### Крок 1. Встановлення Node.js
Переконайтеся, що на вашому ПК або сервері встановлено **Node.js** (версія 16 або новіша).
* Завантажити можна з офіційного сайту: [nodejs.org](https://nodejs.org)

---

### Крок 2. Встановлення залежностей
Відкрийте консоль (PowerShell / CMD / Terminal) у папці `Bot`:

```bash
cd c:\Users\user\Desktop\ugta_serverAPI\Bot
npm install
```

---

### Крок 3. Налаштування `config.json`
Відкрийте файл `Bot/config.json` та вкажіть свої дані:

```json
{
  "BOT_TOKEN": "1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ",
  "DB_HOST": "127.0.0.1",
  "DB_PORT": 3306,
  "DB_USER": "root",
  "DB_PASSWORD": "ваш_пароль_БД",
  "DB_NAME": "назва_бази_даних_MTA",
  "POLL_INTERVAL_MS": 1500
}
```

* **`BOT_TOKEN`**: Отримайте у Telegram бота `@BotFather` (створіть нового бота та скопіюйте токен).
* **`DB_...`**: Доступи до MySQL бази даних, яку використовує ваш MTA сервер.

---

### Крок 4. Запуск бота

Для швидкого запуску:
```bash
npm start
```
або
```bash
node bot.js
```

При успішному запуску ви побачите:
```text
🟢 Успішно підключено до бази даних MySQL
🤖 Telegram 2FA Бот успішно запущено (GHOST GTA)!
```

---

### 💡 Постійний запуск 24/7 (Автозапуск у фоновому режимі)

Щоб бот працював безперервно навіть після закриття консолі, рекомендується використовувати **PM2**:

```bash
npm install -g pm2
pm2 start bot.js --name "tg-2fa-bot"
pm2 save
```
