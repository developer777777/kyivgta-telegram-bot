const { Telegraf, Markup } = require('telegraf');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Захист від падіння процесу
process.on('uncaughtException', (err) => {
    console.error('⚠️ [Uncaught Exception]:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [Unhandled Rejection]:', reason);
});

// Простий HTTP сервер для Render Web Service (health check)
const http = require('http');
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('KYIV GTA 2FA Telegram Bot is Running 🟢');
}).listen(PORT, () => {
    console.log(`🌐 Health check сервер запущено на порту ${PORT}`);
});

// Завантаження конфігурації
let fileConfig = {};
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    try {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {}
}

const config = {
    BOT_TOKEN: process.env.BOT_TOKEN || fileConfig.BOT_TOKEN,
    DB_HOST: process.env.DB_HOST || fileConfig.DB_HOST || '51.210.223.180',
    DB_PORT: parseInt(process.env.DB_PORT) || fileConfig.DB_PORT || 3306,
    DB_USER: process.env.DB_USER || fileConfig.DB_USER || 'gs112661',
    DB_PASSWORD: process.env.DB_PASSWORD || fileConfig.DB_PASSWORD || 'OJifVDbDq5LJbMBLD4Xuxpx',
    DB_NAME: process.env.DB_NAME || fileConfig.DB_NAME || 'gs112661',
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS) || fileConfig.POLL_INTERVAL_MS || 1000,
    ADMIN_IDS: process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : (fileConfig.ADMIN_IDS || ['2073246087']),
    WEBSITE_URL: process.env.WEBSITE_URL || fileConfig.WEBSITE_URL || 'https://kyivgta.netlify.app',
    FORUM_URL: process.env.FORUM_URL || fileConfig.FORUM_URL || 'https://kyivgta.netlify.app',
    SHOP_URL: process.env.SHOP_URL || fileConfig.SHOP_URL || 'https://kyivgta.netlify.app',
    CABINET_URL: process.env.CABINET_URL || fileConfig.CABINET_URL || 'https://kyivgta.netlify.app',
    DRAW_URL: process.env.DRAW_URL || fileConfig.DRAW_URL || 'https://kyivgta.netlify.app',
    RESTORE_PASSWORD_URL: process.env.RESTORE_PASSWORD_URL || fileConfig.RESTORE_PASSWORD_URL || 'https://kyivgta.netlify.app',
    IMAGES: fileConfig.IMAGES || {
        TICKET_CLOSED: 'images/ticket_closed.png'
    }
};

if (!config.BOT_TOKEN || config.BOT_TOKEN === 'ВАШ_ТОКЕН_ВІД_BOTFATHER') {
    console.error('❌ Помилка: Вкажіть дійсний BOT_TOKEN у файлі config.json!');
    process.exit(1);
}

// Посилання для кнопок
const WEBSITE_URL = config.WEBSITE_URL || 'https://kyiv-rp.ua';
const FORUM_URL = config.FORUM_URL || 'https://forum.kyiv-rp.ua';
const SHOP_URL = config.SHOP_URL || 'https://kyiv-rp.ua/shop';
const CABINET_URL = config.CABINET_URL || 'https://kyiv-rp.ua/cabinet';
const DRAW_URL = config.DRAW_URL || 'https://t.me';
const RESTORE_PASSWORD_URL = config.RESTORE_PASSWORD_URL || 'https://kyiv-rp.ua/restore';
const ADMIN_IDS = Array.isArray(config.ADMIN_IDS) ? config.ADMIN_IDS.map(String) : [];

// Зображення
const IMAGES = config.IMAGES || {};
const TICKET_CLOSED_IMG = path.resolve(__dirname, IMAGES.TICKET_CLOSED || 'images/ticket_closed.png');

// Внутрішнє надійне сховище активних тікетів (працює завжди, навіть при збоях БД)
let nextTicketId = 1;
const activeTickets = new Map(); // ticketId -> { id, userId, username, firstName, text, status, adminId, rating, createdAt }
const userActiveTicketMap = new Map(); // userId -> ticketId
const userStates = new Map(); // userId -> state

// Підключення до БД
let dbPool = null;
let dbConnected = false;

async function initDB() {
    try {
        dbPool = mysql.createPool({
            host: config.DB_HOST || '51.75.44.14',
            port: config.DB_PORT || 3306,
            user: config.DB_USER || 'gs112484',
            password: config.DB_PASSWORD || 'z5c22aiu',
            database: config.DB_NAME || 'gs112484',
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0,
            connectTimeout: 5000,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });

        const connection = await dbPool.getConnection();

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ugta_tickets (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                username VARCHAR(64) NULL,
                first_name VARCHAR(64) NULL,
                text TEXT NOT NULL,
                status VARCHAR(24) NOT NULL DEFAULT 'open',
                admin_id VARCHAR(64) NULL,
                rating TINYINT UNSIGNED NULL,
                created_at INT UNSIGNED NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        try {
            await connection.query(`ALTER TABLE ugta_tickets ADD COLUMN rating TINYINT UNSIGNED NULL;`);
        } catch (e) {}

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ugta_player_telegram2fa_requests (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                token VARCHAR(96) NOT NULL,
                player_id INT(11) UNSIGNED NOT NULL,
                nickname VARCHAR(64) NULL,
                mode VARCHAR(24) NOT NULL,
                reward TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                status VARCHAR(24) NOT NULL DEFAULT 'pending',
                telegram_id VARCHAR(64) NULL,
                ip VARCHAR(45) NULL,
                created_at INT(11) UNSIGNED NOT NULL,
                expires_at INT(11) UNSIGNED NOT NULL,
                processed TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_token (token),
                KEY idx_player (player_id),
                KEY idx_status (status, processed)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        try {
            const checkColumns = [
                { table: 'ugta_player_telegram2fa_requests', name: 'ip', sql: 'ALTER TABLE ugta_player_telegram2fa_requests ADD COLUMN ip VARCHAR(45) NULL' },
                { table: 'ugta_players', name: 'telegram_id', sql: 'ALTER TABLE ugta_players ADD COLUMN telegram_id VARCHAR(64) NULL' },
                { table: 'ugta_players', name: 'telegram_2fa_enabled', sql: 'ALTER TABLE ugta_players ADD COLUMN telegram_2fa_enabled TINYINT(1) UNSIGNED NOT NULL DEFAULT 0' },
                { table: 'ugta_players', name: 'telegram_2fa_bonus', sql: 'ALTER TABLE ugta_players ADD COLUMN telegram_2fa_bonus TINYINT(2) UNSIGNED NOT NULL DEFAULT 0' }
            ];
            for (const col of checkColumns) {
                const [c] = await connection.query(`
                    SELECT 1 FROM information_schema.COLUMNS 
                    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
                `, [config.DB_NAME, col.table, col.name]);
                if (c.length === 0) {
                    await connection.query(col.sql);
                }
            }
        } catch (colErr) {
            console.warn('⚠️ Колонка check error:', colErr.message);
        }

        // Завантаження останнього ID тікета з БД
        const [rows] = await connection.query('SELECT MAX(id) as maxId FROM ugta_tickets');
        if (rows && rows[0] && rows[0].maxId) {
            nextTicketId = rows[0].maxId + 1;
        }

        // Завантаження відкритих тікетів
        const [openRows] = await connection.query('SELECT * FROM ugta_tickets WHERE status = "open"');
        for (const r of openRows) {
            activeTickets.set(r.id, r);
            userActiveTicketMap.set(String(r.user_id), r.id);
        }

        connection.release();
        dbConnected = true;
        console.log(`🟢 Успішно підключено до бази даних MySQL (${config.DB_HOST})`);
    } catch (err) {
        dbConnected = false;
        console.warn('⚠️ Тимчасове попередження: БД хостингу очікує дозволу IP (%):', err.message);
    }
}

const bot = new Telegraf(config.BOT_TOKEN);
const notifiedLoginRequests = new Set();

function isAdmin(userId) {
    return ADMIN_IDS.includes(String(userId));
}

function formatDate(timestampSec) {
    const date = timestampSec ? new Date(timestampSec * 1000) : new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function extractTokenFromPayload(payload) {
    if (!payload) return null;
    const parts = payload.split('_');
    if (parts.length >= 4) {
        return parts.slice(3).join('_');
    }
    return payload;
}

// Головне меню
function getMainMenuKeyboard(userId) {
    const buttons = [
        [Markup.button.callback('🔐 Прив\'язати акаунт (Нікнейм, Пароль, Пошта)', 'bind_account_manual')],
        [Markup.button.callback('💼 Підключити до кабінету', 'menu_cabinet')],
        [Markup.button.callback('👨‍💻 Технічна підтримка / Live Чат', 'menu_support')],
        [Markup.button.url('🔑 Відновити пароль до аккаунту', RESTORE_PASSWORD_URL)],
        [
            Markup.button.url('🌐 Сайт', WEBSITE_URL),
            Markup.button.url('📁 Форум', FORUM_URL),
            Markup.button.url('🛒 Магазин', SHOP_URL)
        ],
        [Markup.button.url('🎁 РОЗІГРАШ', DRAW_URL)]
    ];

    if (userId && isAdmin(userId)) {
        buttons.unshift([Markup.button.callback('🛠️ АДМІН ПАНЕЛЬ', 'admin_panel')]);
    }

    return Markup.inlineKeyboard(buttons);
}

// Клавіатура закриття тікета з оцінкою 1-5 зі скріншота
function getTicketClosedRatingKeyboard(ticketId) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('1', `rate_op_${ticketId}_1`),
            Markup.button.callback('2', `rate_op_${ticketId}_2`),
            Markup.button.callback('3', `rate_op_${ticketId}_3`),
            Markup.button.callback('4', `rate_op_${ticketId}_4`),
            Markup.button.callback('5', `rate_op_${ticketId}_5`)
        ],
        [Markup.button.callback('◀️ Повернутись в головне меню', 'back_to_main')],
        [Markup.button.callback('👨‍💻 Зв\'язок з службою підтримки', 'menu_support')]
    ]);
}

bot.catch((err, ctx) => {
    console.error(`🔴 Telegraf error:`, err.message);
});

// /start
bot.start(async (ctx) => {
    try {
        const payload = ctx.startPayload;
        const firstName = ctx.from.first_name || '';
        const username = ctx.from.username ? `@${ctx.from.username}` : `ID ${ctx.from.id}`;
        const userId = ctx.from.id;

        userStates.delete(userId);
        console.log(`📩 Отримано /start від ${username} (Payload: ${payload || 'відсутній'})`);

        if (payload && dbPool && dbConnected) {
            const token = extractTokenFromPayload(payload);
            try {
                const [rows] = await dbPool.execute(
                    'SELECT * FROM ugta_player_telegram2fa_requests WHERE (token = ? OR token = ?) AND status = "pending" LIMIT 1',
                    [token, payload]
                );

                if (rows && rows.length > 0) {
                    const reqData = rows[0];
                    const now = Math.floor(Date.now() / 1000);

                    if (reqData.expires_at && reqData.expires_at < now) {
                        await dbPool.execute('UPDATE ugta_player_telegram2fa_requests SET status = "expired" WHERE id = ?', [reqData.id]);
                        return ctx.replyWithHTML('❌ <b>Термін дії запиту вичерпано.</b> Спробуйте ще раз у грі.');
                    }

                    const nickname = reqData.nickname || 'Невідомий';
                    const playerId = reqData.player_id;
                    const dbToken = reqData.token;

                    const text = 
`🛡️ <b>KYIV GTA | Захист акаунту</b>

👋 Вітаємо, <b>${nickname}</b>!
Ви розпочали процес прив'язки вашого Telegram до ігрового акаунту.

🎮 <b>Сервер:</b> KYIV GTA
👤 <b>Акаунт:</b> ${nickname} (ID: #${playerId})
🕒 <b>Час створення:</b> ${formatDate(reqData.created_at)}

<i>Натисніть кнопку нижче, щоб підтвердити прив'язку:</i>`;

                    return ctx.replyWithHTML(
                        text,
                        Markup.inlineKeyboard([
                            [
                                Markup.button.callback('✅ Підтвердити прив\'язку', `approve_bind_${dbToken}`),
                                Markup.button.callback('❌ Відхилити', `reject_bind_${dbToken}`)
                            ]
                        ])
                    );
                }
            } catch (err) {}
        }

        let welcomeMsg = `Вітаю, ${firstName}!\n\nЯ — твій віртуальний помічник у світі <b>KYIV GTA</b>.\n\nДля початку, обери бажану дію:`;
        if (isAdmin(userId)) {
            welcomeMsg += `\n\n👑 <b>Ви авторизовані як Адміністратор/Оператор KYIV GTA!</b>`;
        }

        console.log(`📤 Відправляємо відповідь для ${userId}...`);
        await ctx.replyWithHTML(welcomeMsg, getMainMenuKeyboard(userId));
        console.log(`✅ Відповідь успішно надіслано для ${userId}!`);
    } catch (e) {
        console.error('🔴 Помилка в /start:', e.message);
    }
});

// АДМІН ПАНЕЛЬ
bot.command(['admin', 'tickets'], async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.replyWithHTML('❌ <b>У вас немає прав адміністратора.</b>');
    return showAdminPanel(ctx);
});

bot.action('admin_panel', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('❌ Немає доступу.', { show_alert: true }).catch(() => {});
    await ctx.answerCbQuery().catch(() => {});
    return showAdminPanel(ctx);
});

async function showAdminPanel(ctx) {
    let openCount = 0;
    for (const t of activeTickets.values()) {
        if (t.status === 'open') openCount++;
    }

    const text = 
`🛠️ <b>KYIV GTA | Панель Управління Адміністратора</b>

👑 **Адміністратор:** ${ctx.from.first_name} (ID: <code>${ctx.from.id}</code>)

📊 **Статистика підтримки:**
• 📩 Активних відкритих діалогів: <b>${openCount}</b>
• 📋 Загальна кількість звернень: <b>${activeTickets.size}</b>

Оберіть необхідну дію:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`📋 Активні діалоги (${openCount})`, 'admin_list_tickets')],
        [Markup.button.callback('⬅️ Повернутися в головне меню', 'back_to_main')]
    ]);

    if (ctx.callbackQuery) {
        return ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
        return ctx.replyWithHTML(text, keyboard);
    }
}

bot.action('admin_list_tickets', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('Немає доступу').catch(() => {});
    await ctx.answerCbQuery().catch(() => {});

    const openList = [];
    for (const t of activeTickets.values()) {
        if (t.status === 'open') openList.push(t);
    }

    if (openList.length === 0) {
        return ctx.editMessageText(
            '📋 <b>Наразі відкритих діалогів немає! Усі запити опрацьовані.</b>',
            { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ В адмін панель', 'admin_panel')]]) }
        ).catch(() => {});
    }

    let msg = `📋 <b>KYIV GTA | Активні діалоги з підтримкою (${openList.length}):</b>\n\n`;
    const buttons = [];

    for (const ticket of openList.slice(-10).reverse()) {
        msg += `📌 <b>Тікет #${ticket.id}</b> від <b>${ticket.first_name || 'Гравця'}</b> (@${ticket.username || 'без_юзернейму'}):\n`;
        msg += `💬 <i>"${(ticket.text || '').slice(0, 90)}"</i>\n\n`;

        buttons.push([
            Markup.button.callback(`💬 Написати в #${ticket.id}`, `reply_ticket_${ticket.id}`),
            Markup.button.callback(`🔒 Закрити #${ticket.id}`, `close_ticket_${ticket.id}`)
        ]);
    }

    buttons.push([Markup.button.callback('⬅️ В адмін панель', 'admin_panel')]);

    return ctx.editMessageText(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }).catch(() => {});
});

// Меню підтримки
bot.action('menu_support', async (ctx) => {
    try {
        const firstName = ctx.from.first_name || '';
        const userId = ctx.from.id;

        const ticketId = userActiveTicketMap.get(String(userId));
        const activeTicket = ticketId ? activeTickets.get(ticketId) : null;

        if (activeTicket && activeTicket.status === 'open') {
            await ctx.answerCbQuery().catch(() => {});
            return ctx.replyWithHTML(
                `🟢 <b>У вас уже відкрито активний діалог з підтримкою (Тікет #${activeTicket.id})!</b>\n\nВи можете писати <b>нескінченну кількість повідомлень</b> прямо сюди в чат — оператор отримує кожне з них.`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('🔒 Завершити цей діалог', `user_close_ticket_${activeTicket.id}`)],
                    [Markup.button.callback('⬅️ В головне меню', 'back_to_main')]
                ])
            ).catch(() => {});
        }

        const supportMsg = 
`Вітаю, ${firstName}!

Якщо у Вас виникли <i>питання</i> або <i>проблеми</i>, які пов'язані з грою, служба підтримки **KYIV GTA** завжди на зв'язку!

💬 **Режим живого чату:**
Ви можете надсилати **нескінченну кількість повідомлень** оператору прямо у цьому чаті.

<b>Графік роботи:</b> з 10:00 до 23:00

Натисніть кнопку нижче, щоб розпочати діалог:`;

        await ctx.answerCbQuery().catch(() => {});
        return ctx.replyWithHTML(
            supportMsg,
            Markup.inlineKeyboard([
                [Markup.button.callback('💬 Розпочати діалог з оператором', 'create_ticket')],
                [Markup.button.callback('⬅️ Назад у головне меню', 'back_to_main')]
            ])
        ).catch(() => {});
    } catch (e) {
        console.error('Помилка в menu_support:', e.message);
    }
});

// Розпочати діалог
bot.action('create_ticket', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const ticketId = userActiveTicketMap.get(String(userId));
        const activeTicket = ticketId ? activeTickets.get(ticketId) : null;

        if (activeTicket && activeTicket.status === 'open') {
            await ctx.answerCbQuery().catch(() => {});
            return ctx.replyWithHTML(
                `🟢 <b>Ваш діалог #${activeTicket.id} вже активний!</b>\nПросто пишіть ваші повідомлення у цей чат.`,
                Markup.inlineKeyboard([[Markup.button.callback('🔒 Завершити діалог', `user_close_ticket_${activeTicket.id}`)]])
            );
        }

        userStates.set(userId, { step: 'awaiting_ticket_text' });
        await ctx.answerCbQuery().catch(() => {});

        const msg = 
`📩 <b>Технічна Підтримка KYIV GTA | Живий Діалог</b>

Напишіть ваше перше питання або опишіть проблему:
<i>(Після цього ви зможете писати скільки завгодно повідомлень оператору)</i>`;

        return ctx.replyWithHTML(
            msg,
            Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати', 'cancel_action')]])
        );
    } catch (e) {
        console.error('Помилка в create_ticket:', e.message);
    }
});

// Відповісти на тікет від адміна
bot.action(/^reply_ticket_(\d+)$/, async (ctx) => {
    try {
        const ticketId = parseInt(ctx.match[1], 10);
        const adminId = ctx.from.id;

        if (!isAdmin(adminId)) {
            return ctx.answerCbQuery('❌ У вас немає прав оператора.', { show_alert: true }).catch(() => {});
        }

        userStates.set(adminId, { step: 'replying_to_ticket', ticketId: ticketId });
        await ctx.answerCbQuery().catch(() => {});

        return ctx.replyWithHTML(
            `💬 <b>Оператор (${ctx.from.first_name}), введіть повідомлення для Тікета #${ticketId}:</b>\n<i>(Діалог залишиться відкритим, ви зможете писати далі)</i>`,
            Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати введення', 'cancel_action')]])
        );
    } catch (e) {
        console.error('Помилка в reply_ticket:', e.message);
    }
});

// Закрити тікет адміном (надсилає фото + опитування оцінки 1-5 зі скріншота)
bot.action(/^close_ticket_(\d+)$/, async (ctx) => {
    try {
        const ticketId = parseInt(ctx.match[1], 10);
        const adminId = ctx.from.id;

        if (!isAdmin(adminId)) {
            return ctx.answerCbQuery('❌ У вас немає прав оператора.', { show_alert: true }).catch(() => {});
        }

        const ticket = activeTickets.get(ticketId);
        if (!ticket) {
            return ctx.answerCbQuery('Тікет не знайдено', { show_alert: true }).catch(() => {});
        }

        ticket.status = 'closed';
        ticket.admin_id = String(adminId);
        activeTickets.set(ticketId, ticket);
        userActiveTicketMap.delete(String(ticket.user_id));

        if (dbPool && dbConnected) {
            try {
                await dbPool.execute('UPDATE ugta_tickets SET status = "closed", admin_id = ? WHERE id = ?', [String(adminId), ticketId]);
            } catch (e) {}
        }

        await ctx.answerCbQuery(`Тікет #${ticketId} закрито`).catch(() => {});

        const closeCaption = 
`Вітаю, ${ticket.first_name || 'Гравець'}!

Звернення було зачинено оператором.

Оцініть, будь ласка, роботу оператора:`;

        const ratingKeyboard = getTicketClosedRatingKeyboard(ticketId);

        // Відправляємо фото якщо існує
        try {
            if (fs.existsSync(TICKET_CLOSED_IMG)) {
                await bot.telegram.sendPhoto(
                    ticket.user_id,
                    { source: TICKET_CLOSED_IMG },
                    {
                        caption: closeCaption,
                        parse_mode: 'HTML',
                        ...ratingKeyboard
                    }
                );
            } else {
                await bot.telegram.sendMessage(
                    ticket.user_id,
                    closeCaption,
                    {
                        parse_mode: 'HTML',
                        ...ratingKeyboard
                    }
                );
            }
        } catch (e) {
            console.error('Помилка доставки сповіщення про закриття гравцю:', e.message);
        }

        return ctx.editMessageText(
            `✅ <b>Діалог #${ticketId} успішно закрито оператором ${ctx.from.first_name}.</b>\n<i>Гравцю надіслано опитування щодо оцінки роботи оператора (1-5 зірок).</i>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ В адмін панель', 'admin_panel')]])
            }
        ).catch(() => {});
    } catch (err) {
        console.error('Помилка закриття тікета:', err.message);
    }
});

// Гравець оцінює оператора (1-5 зірок)
bot.action(/^rate_op_(\d+)_([1-5])$/, async (ctx) => {
    try {
        const ticketId = parseInt(ctx.match[1], 10);
        const score = parseInt(ctx.match[2], 10);
        const userId = ctx.from.id;

        const ticket = activeTickets.get(ticketId);
        if (ticket) {
            ticket.rating = score;
            activeTickets.set(ticketId, ticket);
        }

        if (dbPool && dbConnected) {
            try {
                await dbPool.execute('UPDATE ugta_tickets SET rating = ? WHERE id = ?', [score, ticketId]);
            } catch (e) {}
        }

        const stars = '⭐️'.repeat(score);
        await ctx.answerCbQuery(`Ви поставили оцінку ${score}/5!`).catch(() => {});

        const thanksText = 
`⭐️ <b>Дякуємо за вашу оцінку: ${stars} (${score}/5)!</b>

Ваш відгук допомагає команді **KYIV GTA** покращувати якість обслуговування.

Оберіть дію:`;

        const afterRatingKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback('◀️ Повернутись в головне меню', 'back_to_main')],
            [Markup.button.callback('👨‍💻 Зв\'язок з службою підтримки', 'menu_support')]
        ]);

        if (ctx.callbackQuery.message && ctx.callbackQuery.message.caption) {
            await ctx.editMessageCaption(thanksText, { parse_mode: 'HTML', ...afterRatingKeyboard }).catch(() => {});
        } else {
            await ctx.editMessageText(thanksText, { parse_mode: 'HTML', ...afterRatingKeyboard }).catch(() => {});
        }

        // Сповіщаємо адмінів
        const adminScoreNotify = `⭐️ <b>Гравець (${ctx.from.first_name}) оцінив роботу оператора по Тікету #${ticketId} на ${score}/5 ${stars}!</b>`;
        for (const adminId of ADMIN_IDS) {
            try {
                await bot.telegram.sendMessage(adminId, adminScoreNotify, { parse_mode: 'HTML' });
            } catch (e) {}
        }
    } catch (e) {
        console.error('Помилка в rate_op:', e.message);
    }
});

// Гравець завершує діалог сам
bot.action(/^user_close_ticket_(\d+)$/, async (ctx) => {
    try {
        const ticketId = parseInt(ctx.match[1], 10);
        const userId = ctx.from.id;

        const ticket = activeTickets.get(ticketId);
        if (ticket) {
            ticket.status = 'closed';
            activeTickets.set(ticketId, ticket);
        }
        userActiveTicketMap.delete(String(userId));
        userStates.delete(userId);

        if (dbPool && dbConnected) {
            try {
                await dbPool.execute('UPDATE ugta_tickets SET status = "closed" WHERE id = ?', [ticketId]);
            } catch (e) {}
        }

        await ctx.answerCbQuery('Діалог завершено').catch(() => {});
        await ctx.replyWithHTML(
            `🔒 <b>Ви завершили діалог з підтримкою (Тікет #${ticketId}).</b>\nЯкщо виникнуть нові питання — завжди раді допомогти!`,
            getMainMenuKeyboard(userId)
        ).catch(() => {});

        const notifyAdminMsg = `ℹ️ <b>Гравець (${ctx.from.first_name}) завершив діалог Тікета #${ticketId}.</b>`;
        for (const adminId of ADMIN_IDS) {
            try {
                await bot.telegram.sendMessage(adminId, notifyAdminMsg, { parse_mode: 'HTML' });
            } catch (e) {}
        }
    } catch (e) {
        console.error('Помилка в user_close_ticket:', e.message);
    }
});

// Підключення до кабінету
bot.action('menu_cabinet', async (ctx) => {
    try {
        const userId = ctx.from.id;
        await ctx.answerCbQuery().catch(() => {});

        // Шукаємо гравця по telegram_id
        const [rows] = await dbPool.execute(
            'SELECT id, nickname, email, password FROM ugta_players WHERE telegram_id = ? LIMIT 1',
            [String(userId)]
        );

        if (rows.length > 0) {
            const p = rows[0];
            const msg =
`💼 <b>Особистий Кабінет | KYIV GTA</b>

✅ Ваш акаунт прив'язаний!

🆔 <b>ID:</b> <code>${p.id}</code>
👤 <b>Нікнейм:</b> <code>${p.nickname}</code>
📧 <b>Пошта:</b> <code>${p.email}</code>
🔑 <b>Пароль:</b> <code>${p.password}</code>`;

            return ctx.replyWithHTML(
                msg,
                Markup.inlineKeyboard([
                    [Markup.button.url('🌐 Перейти в Особистий Кабінет', CABINET_URL)],
                    [Markup.button.callback('🔓 Відв\'язати акаунт', 'unbind_cabinet')],
                    [Markup.button.callback('⬅️ Повернутись в головне меню', 'back_to_main')]
                ])
            );
        } else {
            // Акаунт не прив'язаний — просимо ввести дані
            userStates.set(userId, { step: 'cabinet_awaiting_id' });

            const msg =
`💼 <b>Підключення до кабінету | KYIV GTA</b>

❌ Ваш Telegram ще не прив'язаний до акаунту.

Для підключення введіть ваш <b>ID гравця</b> (цифри, наприклад: <code>12345</code>):`;

            return ctx.replyWithHTML(
                msg,
                Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Скасувати', 'cancel_cabinet_bind')]
                ])
            );
        }
    } catch (e) {
        console.error('Помилка в menu_cabinet:', e.message);
    }
});

// Ручна прив'язка
bot.action('bind_account_manual', async (ctx) => {
    const userId = ctx.from.id;
    userStates.set(userId, { step: 'awaiting_nickname' });
    await ctx.answerCbQuery().catch(() => {});

    const msg = 
`🔐 <b>Прив'язка акаунту KYIV GTA</b>

Крок 1/3: Введіть ваш **ігровий нікнейм** (наприклад: <code>Ivan_Petrov</code> або <code>Вася Ахмедік</code>):`;

    return ctx.replyWithHTML(
        msg,
        Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати прив\'язку', 'cancel_manual_bind')]])
    );
});

bot.action('cancel_action', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);
    await ctx.answerCbQuery('Дію скасовано').catch(() => {});
    return ctx.replyWithHTML(`Дію скасовано. Оберіть дію:`, getMainMenuKeyboard(userId));
});

bot.action('cancel_manual_bind', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);
    await ctx.answerCbQuery('Прив\'язку скасовано').catch(() => {});
    return ctx.replyWithHTML(`Прив'язку скасовано.\nОберіть дію:`, getMainMenuKeyboard(userId));
});

bot.action('cancel_cabinet_bind', async (ctx) => {
    const userId = ctx.from.id;
    userStates.delete(userId);
    await ctx.answerCbQuery('Скасовано').catch(() => {});
    return ctx.replyWithHTML(`Підключення скасовано.\nОберіть дію:`, getMainMenuKeyboard(userId));
});

bot.action('unbind_cabinet', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery().catch(() => {});
    try {
        await dbPool.execute(
            'UPDATE ugta_players SET telegram_id = NULL, telegram_2fa_enabled = 0 WHERE telegram_id = ?',
            [String(userId)]
        );
        return ctx.replyWithHTML(
            `🔓 <b>Акаунт відв'язано від Telegram.</b>\n\nТепер ви можете підключити інший акаунт через кнопку 💼.`,
            getMainMenuKeyboard(userId)
        );
    } catch (e) {
        console.error('Помилка unbind_cabinet:', e.message);
        return ctx.replyWithHTML(`❌ Помилка: <code>${e.message}</code>`);
    }
});

bot.action('back_to_main', async (ctx) => {
    const firstName = ctx.from.first_name || '';
    const userId = ctx.from.id;

    let welcomeMsg = `Вітаю, ${firstName}!\n\nЯ — твій віртуальний помічник у світі <b>KYIV GTA</b>.\n\nДля початку, обери бажану дію:`;
    if (isAdmin(userId)) {
        welcomeMsg += `\n\n👑 <b>Ви авторизовані як Адміністратор/Оператор KYIV GTA!</b>`;
    }

    await ctx.answerCbQuery().catch(() => {});
    return ctx.replyWithHTML(welcomeMsg, getMainMenuKeyboard(userId)).catch(() => {});
});

// ОБРОБКА ВСІХ ТЕКСТОВИХ ПОВІДОМЛЕНЬ
bot.on('text', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const text = ctx.message.text ? ctx.message.text.trim() : '';
        const state = userStates.get(userId);
        const now = Math.floor(Date.now() / 1000);

        // 1. Відповідь оператора
        if (state && state.step === 'replying_to_ticket' && isAdmin(userId)) {
            const ticketId = state.ticketId;
            userStates.delete(userId);

            const ticket = activeTickets.get(ticketId);
            if (!ticket) {
                return ctx.replyWithHTML('❌ Тікет не знайдено.');
            }

            ticket.admin_id = String(userId);

            const replyMsgToPlayer = 
`👨‍💻 <b>KYIV GTA | Повідомлення від оператора підтримки (Тікет #${ticketId}):</b>

${text}

---
💬 <i>Ви можете відразу писати відповідь у цей чат — діалог залишається відкритим!</i>`;

            const playerKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🔒 Завершити діалог', `user_close_ticket_${ticketId}`)]
            ]);

            try {
                await bot.telegram.sendMessage(ticket.user_id, replyMsgToPlayer, { parse_mode: 'HTML', ...playerKeyboard });
            } catch (e) {
                return ctx.replyWithHTML(`❌ Не вдалося доставити повідомлення гравцю: ${e.message}`);
            }

            await ctx.replyWithHTML(
                `✅ <b>Повідомлення надіслано гравцю!</b>\n<i>(Діалог #${ticketId} залишається активним)</i>`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback(`💬 Написати ще в #${ticketId}`, `reply_ticket_${ticketId}`),
                        Markup.button.callback(`🔒 Закрити діалог #${ticketId}`, `close_ticket_${ticketId}`)
                    ]
                ])
            );

            const adminNotifyText = `ℹ️ <b>Оператор (${ctx.from.first_name}) надіслав повідомлення у Тікет #${ticketId}:</b>\n<i>"${text}"</i>`;
            for (const adminId of ADMIN_IDS) {
                if (String(adminId) !== String(userId)) {
                    try {
                        await bot.telegram.sendMessage(adminId, adminNotifyText, { parse_mode: 'HTML' });
                    } catch (e) {}
                }
            }
            return;
        }

        // 2. Підключення до кабінету (крок 1 — ID)
        if (state && state.step === 'cabinet_awaiting_id') {
            if (!/^\d+$/.test(text)) {
                return ctx.replyWithHTML(
                    `❌ ID має складатися тільки з цифр. Спробуйте ще раз:`,
                    Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати', 'cancel_cabinet_bind')]])
                );
            }
            state.cabinet_id = text;
            state.step = 'cabinet_awaiting_nickname';
            userStates.set(userId, state);
            return ctx.replyWithHTML(
                `🆔 ID: <b>${text}</b>\n\nКрок 2/4: Введіть ваш <b>нікнейм</b> (як у грі):`,
                Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати', 'cancel_cabinet_bind')]])
            );
        }

        // Підключення до кабінету (крок 2 — нікнейм)
        if (state && state.step === 'cabinet_awaiting_nickname') {
            state.cabinet_nickname = text;
            state.step = 'cabinet_awaiting_email';
            userStates.set(userId, state);
            return ctx.replyWithHTML(
                `👤 Нікнейм: <b>${text}</b>\n\nКрок 3/4: Введіть вашу <b>пошту</b> (Email):`,
                Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати', 'cancel_cabinet_bind')]])
            );
        }

        // Підключення до кабінету (крок 3 — пошта)
        if (state && state.step === 'cabinet_awaiting_email') {
            state.cabinet_email = text;
            state.step = 'cabinet_awaiting_password';
            userStates.set(userId, state);
            return ctx.replyWithHTML(
                `📧 Пошта: <b>${text}</b>\n\nКрок 4/4: Введіть ваш <b>пароль</b>:`,
                Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати', 'cancel_cabinet_bind')]])
            );
        }

        // Підключення до кабінету (крок 4 — пароль → прив'язка)
        if (state && state.step === 'cabinet_awaiting_password') {
            const { cabinet_id, cabinet_nickname, cabinet_email } = state;
            const cabinet_password = text;
            userStates.delete(userId);

            if (dbPool && dbConnected) {
                try {
                    const [rows] = await dbPool.execute(
                        'SELECT * FROM ugta_players WHERE id = ? AND LOWER(TRIM(nickname)) = LOWER(TRIM(?)) AND LOWER(TRIM(email)) = LOWER(TRIM(?)) AND password = ? LIMIT 1',
                        [cabinet_id, cabinet_nickname, cabinet_email, cabinet_password]
                    );

                    if (!rows || rows.length === 0) {
                        return ctx.replyWithHTML(
                            `❌ <b>Дані не збігаються.</b>\nПеревірте ID, нікнейм, пошту та пароль і спробуйте ще раз.\n\nНатисніть <b>💼 Підключити до кабінету</b> щоб почати знову.`,
                            getMainMenuKeyboard(userId)
                        );
                    }

                    const player = rows[0];
                    await dbPool.execute(
                        'UPDATE ugta_players SET telegram_id = ?, telegram_2fa_enabled = 1 WHERE id = ?',
                        [String(userId), player.id]
                    );

                    return ctx.replyWithHTML(
                        `✅ <b>Акаунт успішно підключено до Telegram!</b>\n\n🆔 <b>ID:</b> <code>${player.id}</code>\n👤 <b>Нікнейм:</b> <code>${player.nickname}</code>\n📧 <b>Пошта:</b> <code>${player.email}</code>\n🔑 <b>Пароль:</b> <code>${player.password}</code>`,
                        getMainMenuKeyboard(userId)
                    );
                } catch (err) {
                    console.error('🔴 Помилка при підключенні кабінету:', err.message);
                    return ctx.replyWithHTML(`🔴 <b>Помилка БД:</b> <code>${err.message}</code>`);
                }
            } else {
                return ctx.replyWithHTML('🔴 <b>Немає підключення до БД.</b>');
            }
        }

        // 3. Ручна прив'язка
        if (state && state.step === 'awaiting_nickname') {
            state.nickname = text;
            state.step = 'awaiting_password';
            userStates.set(userId, state);
            return ctx.replyWithHTML(
                `👤 Нікнейм: <b>${text}</b>\n\nКрок 2/3: Тепер введіть ваш **пароль** від акаунту:`,
                Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати', 'cancel_manual_bind')]])
            );
        }

        if (state && state.step === 'awaiting_password') {
            state.password = text;
            state.step = 'awaiting_email';
            userStates.set(userId, state);
            return ctx.replyWithHTML(
                `🔑 Пароль отримано.\n\nКрок 3/3: Введіть вашу **електронну пошту** (Email), прив'язану до акаунту:`,
                Markup.inlineKeyboard([[Markup.button.callback('❌ Скасувати', 'cancel_manual_bind')]])
            );
        }

        if (state && state.step === 'awaiting_email') {
            state.email = text;
            const nickname = state.nickname;
            const email = state.email;
            const telegramId = String(userId);
            userStates.delete(userId);

            if (dbPool && dbConnected) {
                try {
                    const [rows] = await dbPool.execute(
                        'SELECT * FROM ugta_players WHERE (LOWER(TRIM(nickname)) = LOWER(TRIM(?)) OR LOWER(TRIM(login)) = LOWER(TRIM(?))) LIMIT 1',
                        [nickname, nickname]
                    );

                    if (!rows || rows.length === 0) {
                        return ctx.replyWithHTML(`❌ <b>Акаунт з нікнеймом "${nickname}" не знайдено.</b>\nПеревірте правильність написання нікнейму у грі.`);
                    }

                    const playerAcc = rows[0];
                    await dbPool.execute('UPDATE ugta_players SET telegram_id = ?, telegram_2fa_enabled = 1 WHERE id = ?', [telegramId, playerAcc.id]);

                    return ctx.replyWithHTML(
                        `✅ <b>Акаунт успішно прив'язано до Telegram!</b>\n\n👤 <b>Нікнейм:</b> ${playerAcc.nickname || nickname} (ID: #${playerAcc.id})\n📧 <b>Пошта:</b> ${email}\n🛡️ <b>Статус 2FA:</b> Активовано`,
                        getMainMenuKeyboard(userId)
                    );
                } catch (err) {
                    console.error('🔴 Помилка при прив\'язці акаунту:', err.message);
                    return ctx.replyWithHTML(`🔴 <b>Помилка бази даних:</b> <code>${err.message}</code>`);
                }
            } else {
                return ctx.replyWithHTML('🔴 <b>Немає підключення до БД хостингу. Дозвольте % у панелі хостингу.</b>');
            }
        }

        // 3. Перше повідомлення створення нового тікета
        if (state && state.step === 'awaiting_ticket_text') {
            userStates.delete(userId);

            const user = ctx.from;
            const ticketId = nextTicketId++;

            const ticketObj = {
                id: ticketId,
                user_id: String(user.id),
                username: user.username || '',
                first_name: user.first_name || 'Гравець',
                text: text,
                status: 'open',
                created_at: now
            };

            activeTickets.set(ticketId, ticketObj);
            userActiveTicketMap.set(String(user.id), ticketId);

            if (dbPool && dbConnected) {
                try {
                    await dbPool.execute(
                        'INSERT INTO ugta_tickets (id, user_id, username, first_name, text, status, created_at) VALUES (?, ?, ?, ?, ?, "open", ?)',
                        [ticketId, String(user.id), user.username || '', user.first_name || 'Гравець', text, now]
                    );
                } catch (e) {}
            }

            await ctx.replyWithHTML(
                `🟢 <b>Діалог з технічною підтримкою розпочато (Тікет #${ticketId})!</b>\n\nВаше повідомлення передано операторам. Ви можете продовжувати надсилати сюди нові повідомлення у будь-який момент.`,
                Markup.inlineKeyboard([[Markup.button.callback('🔒 Завершити діалог', `user_close_ticket_${ticketId}`)]])
            );

            const alertText = 
`📩 <b>KYIV GTA | Нове звернення в тех. підтримку (Тікет #${ticketId})</b>

👤 <b>Гравець:</b> ${user.first_name || 'Гравець'} (${user.username ? '@' + user.username : 'без юзернейму'})
🆔 <b>Telegram ID:</b> <code>${user.id}</code>
🕒 <b>Час:</b> ${formatDate(now)}

💬 <b>Повідомлення:</b>
<i>"${text}"</i>`;

            const adminKeyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(`💬 Відповісти на #${ticketId}`, `reply_ticket_${ticketId}`),
                    Markup.button.callback(`🔒 Закрити #${ticketId}`, `close_ticket_${ticketId}`)
                ]
            ]);

            for (const adminId of ADMIN_IDS) {
                try {
                    await bot.telegram.sendMessage(adminId, alertText, { parse_mode: 'HTML', ...adminKeyboard });
                } catch (e) {}
            }
            return;
        }

        // 4. НЕОБМЕЖЕНІ ПОВІДОМЛЕННЯ В АКТИВНИЙ ДІАЛОГ
        const existingTicketId = userActiveTicketMap.get(String(userId));
        const activeTicket = existingTicketId ? activeTickets.get(existingTicketId) : null;

        if (activeTicket && activeTicket.status === 'open') {
            const ticketId = activeTicket.id;
            const user = ctx.from;

            await ctx.replyWithHTML(
                `📨 <i>Повідомлення надіслано оператору в Тікет #${ticketId}.</i>`,
                Markup.inlineKeyboard([[Markup.button.callback('🔒 Завершити діалог', `user_close_ticket_${ticketId}`)]])
            );

            const alertText = 
`💬 <b>KYIV GTA | Додаткове повідомлення в Тікет #${ticketId}</b>

👤 <b>Гравець:</b> ${user.first_name || 'Гравець'} (${user.username ? '@' + user.username : 'без юзернейму'})
🕒 <b>Час:</b> ${formatDate(now)}

📝 <b>Текст:</b>
<i>"${text}"</i>`;

            const adminKeyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(`💬 Відповісти на #${ticketId}`, `reply_ticket_${ticketId}`),
                    Markup.button.callback(`🔒 Закрити #${ticketId}`, `close_ticket_${ticketId}`)
                ]
            ]);

            for (const adminId of ADMIN_IDS) {
                try {
                    await bot.telegram.sendMessage(adminId, alertText, { parse_mode: 'HTML', ...adminKeyboard });
                } catch (e) {}
            }
            return;
        }

        // За замовчуванням
        const firstName = ctx.from.first_name || '';
        return ctx.replyWithHTML(`Вітаю, ${firstName}!\nОберіть бажану дію:`, getMainMenuKeyboard(userId));

    } catch (e) {
        console.error('Помилка в text handler:', e.message);
    }
});

// 2FA підтвердження прив'язки
bot.action(/^approve_bind_(.+)$/, async (ctx) => {
    try {
        const token = ctx.match[1];
        const telegramId = String(ctx.from.id);

        if (!dbPool || !dbConnected) {
            return ctx.answerCbQuery('Помилка БД хостингу').catch(() => {});
        }

        const [rows] = await dbPool.execute('SELECT * FROM ugta_player_telegram2fa_requests WHERE token = ? AND status = "pending" LIMIT 1', [token]);
        if (!rows || rows.length === 0) {
            return ctx.editMessageText('❌ <b>Запит недійсний або вже оброблений.</b>', { parse_mode: 'HTML' }).catch(() => {});
        }

        const reqData = rows[0];
        await dbPool.execute('UPDATE ugta_player_telegram2fa_requests SET status = "approved", telegram_id = ? WHERE id = ?', [telegramId, reqData.id]);
        await dbPool.execute('UPDATE ugta_players SET telegram_id = ?, telegram_2fa_enabled = 1 WHERE id = ?', [telegramId, reqData.player_id]);

        await ctx.answerCbQuery('✅ Акаунт успішно прив’язано!').catch(() => {});
        return ctx.editMessageText(`✅ <b>Акаунт успішно прив'язано до Telegram!</b>\n\n👤 <b>Акаунт:</b> ${reqData.nickname || 'Гравець'} (ID: #${reqData.player_id})\n🛡️ <b>Захист 2FA:</b> Активовано\n\n🎉 <i>Поверніться в гру для отримання підтвердження!</i>`, { parse_mode: 'HTML' }).catch(() => {});
    } catch (err) {
        return ctx.answerCbQuery('Помилка обробки!').catch(() => {});
    }
});

bot.action(/^reject_bind_(.+)$/, async (ctx) => {
    try {
        const token = ctx.match[1];
        if (dbPool && dbConnected) {
            await dbPool.execute('UPDATE ugta_player_telegram2fa_requests SET status = "rejected" WHERE token = ? AND status = "pending"', [token]);
        }
        await ctx.answerCbQuery('Прив\'язку скасовано').catch(() => {});
        return ctx.editMessageText('❌ <b>Прив\'язку акаунту до Telegram скасовано.</b>', { parse_mode: 'HTML' }).catch(() => {});
    } catch (err) {}
});

// 2FA підтвердження входу
bot.action(/^approve_login_(.+)$/, async (ctx) => {
    try {
        const token = ctx.match[1];
        let isCabinet = false;

        if (dbPool && dbConnected) {
            const [rows] = await dbPool.execute('SELECT mode FROM ugta_player_telegram2fa_requests WHERE token = ? LIMIT 1', [token]);
            if (rows && rows.length > 0) {
                isCabinet = rows[0].mode === 'cabinet_login' || rows[0].mode === 'cabinet';
            }
            await dbPool.execute('UPDATE ugta_player_telegram2fa_requests SET status = "approved" WHERE token = ? AND status = "pending"', [token]);
        }
        await ctx.answerCbQuery('✅ Вхід дозволено!').catch(() => {});

        const text = isCabinet 
            ? `✅ <b>Вхід до Особистого Кабінету підтверджено!</b>\n\n💼 <b>Статус:</b> Дозвіл надано\n🕒 <b>Час:</b> ${formatDate()}\n\n<i>Ви можете перейти до вкладки кабінету.</i>`
            : `✅ <b>Вхід у гру успішно підтверджено!</b>\n\n🎮 <b>Статус:</b> Дозвіл надано\n🕒 <b>Час:</b> ${formatDate()}\n\n<i>Приємної гри на сервері KYIV GTA!</i>`;

        return ctx.editMessageText(text, { parse_mode: 'HTML' }).catch(() => {});
    } catch (err) {}
});

bot.action(/^reject_login_(.+)$/, async (ctx) => {
    try {
        const token = ctx.match[1];
        let isCabinet = false;

        if (dbPool && dbConnected) {
            const [rows] = await dbPool.execute('SELECT mode FROM ugta_player_telegram2fa_requests WHERE token = ? LIMIT 1', [token]);
            if (rows && rows.length > 0) {
                isCabinet = rows[0].mode === 'cabinet_login' || rows[0].mode === 'cabinet';
            }
            await dbPool.execute('UPDATE ugta_player_telegram2fa_requests SET status = "rejected" WHERE token = ? AND status = "pending"', [token]);
        }
        await ctx.answerCbQuery('🚨 Вхід відхилено!').catch(() => {});

        const text = isCabinet
            ? `🚨 <b>Вхід до Особистого Кабінету відхилено!</b>\n\nЯкщо це були не ви — негайно змініть пароль від вашого акаунту!`
            : `🚨 <b>Вхід у гру відхилено!</b>\n\nЯкщо ви не намагалися увійти в акаунт — <b>негайно змініть пароль</b> від ігрового акаунту!`;

        return ctx.editMessageText(text, { parse_mode: 'HTML' }).catch(() => {});
    } catch (err) {}
});

async function checkPendingLoginRequests() {
    if (!dbPool || !dbConnected) return;

    try {
        const now = Math.floor(Date.now() / 1000);
        await dbPool.execute('UPDATE ugta_player_telegram2fa_requests SET status = "expired" WHERE status = "pending" AND expires_at <= ?', [now]);

        const [rows] = await dbPool.execute(
            'SELECT * FROM ugta_player_telegram2fa_requests WHERE (mode = "login" OR mode = "cabinet_login") AND status = "pending" AND telegram_id IS NOT NULL AND telegram_id != ""'
        );

        for (const req of rows) {
            if (notifiedLoginRequests.has(req.id)) continue;
            notifiedLoginRequests.add(req.id);

            const telegramId = req.telegram_id;
            const token = req.token;
            const nickname = req.nickname || 'Гравець';
            const playerId = req.player_id;

            const ip = req.ip || 'Невідомо';
            const isCabinet = req.mode === 'cabinet_login' || req.mode === 'cabinet';

            try {
                const headerText = isCabinet 
                    ? 'УВАГА! Підтвердіть вхід до особистого кабінета.' 
                    : 'УВАГА! Підтвердіть вхід до ігрового акаунта.';

                const msg = 
`<b>${headerText}</b>

IP: <i>${ip}</i>`;

                await bot.telegram.sendMessage(
                    telegramId,
                    msg,
                    {
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [
                                Markup.button.callback('✅ Дозволити', `approve_login_${token}`),
                                Markup.button.callback('❌ Відхилити', `reject_login_${token}`)
                            ]
                        ])
                    }
                );
            } catch (sendErr) {}
        }
    } catch (err) {}
}

async function main() {
    console.log('⏳ Ініціалізація підключення...');
    await initDB();

    setInterval(checkPendingLoginRequests, 2000);

    try {
        await bot.launch();
        console.log('🤖 Telegram 2FA & Support Бот успішно запущено (KYIV GTA)!');
        console.log(`👑 Додано Адміністраторів: ${ADMIN_IDS.join(', ')}`);
    } catch (err) {
        console.error('🔴 Помилка запуску бота:', err.message);
    }

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main();
