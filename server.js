// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const amoCRMToken = process.env.ACCESS_TOKEN;
const amoCRMSubdomain = process.env.SUBDOMAIN;
const exchangeRateApiUrl = "https://www.cbr-xml-daily.ru/daily_json.js";

// Поля и их ID
const usdFieldId = 600679;           // "Price $"
const eurFieldId = 600681;           // "Price €"
const currencyFieldId = 602137;      // "Currency"
const eurRateFieldId = 600167;       // Курс EUR
const usdRateFieldId = 600169;       // Курс USD

// ===== GET ENDPOINTS ДЛЯ ПИНГА И МОНИТОРИНГА =====
// Главная страница - для пинга от UptimeRobot
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'AmoCRM Currency Converter is running',
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        service: 'amocrm-currency-converter',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Status endpoint с дополнительной информацией
app.get('/status', async (req, res) => {
    try {
        // Попробуем получить текущие курсы для проверки
        const { usdRate, eurRate } = await getExchangeRates();
        res.status(200).json({
            status: 'operational',
            service: 'amocrm-currency-converter',
            rates: {
                USD: usdRate,
                EUR: eurRate,
                source: 'cbr-xml-daily.ru',
                timestamp: new Date().toISOString()
            },
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'production'
        });
    } catch (error) {
        // Даже если не удалось получить курсы, отвечаем 200 для пинга
        res.status(200).json({
            status: 'operational',
            service: 'amocrm-currency-converter',
            rates: {
                error: 'Unable to fetch rates',
                message: error.message
            },
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'production'
        });
    }
});

// Test endpoint для проверки авторизации AmoCRM
app.get('/test-auth', async (req, res) => {
    try {
        console.log('Тестирование авторизации AmoCRM...');
        // Проверяем переменные окружения
        if (!amoCRMToken || !amoCRMSubdomain) {
            return res.status(500).json({
                error: 'Missing environment variables',
                details: {
                    ACCESS_TOKEN: amoCRMToken ? 'Set' : 'NOT SET',
                    SUBDOMAIN: amoCRMSubdomain ? 'Set' : 'NOT SET'
                }
            });
        }
        // Пробуем получить информацию об аккаунте
        const accountUrl = `https://${amoCRMSubdomain}.amocrm.ru/api/v4/account`;
        console.log(`Запрос к: ${accountUrl}`);
        const response = await axios.get(accountUrl, {
            headers: {
                'Authorization': `Bearer ${amoCRMToken}`,
                'Content-Type': 'application/json'
            }
        });
        res.status(200).json({
            status: 'success',
            message: 'AmoCRM authorization successful',
            account: {
                id: response.data.id,
                name: response.data.name,
                subdomain: response.data.subdomain
            }
        });
    } catch (error) {
        console.error('Ошибка тестирования авторизации:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            status: 'error',
            message: 'AmoCRM authorization failed',
            error: {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            },
            hint: error.response?.status === 403 ?
                'Check if ACCESS_TOKEN is valid and not expired' :
                'Check environment variables and network connectivity'
        });
    }
});

// Test endpoint для проверки прав на обновление сделок
app.get('/test-update-permission', async (req, res) => {
    try {
        console.log('Тестирование прав на обновление сделок...');
        // Сначала проверяем авторизацию
        const accountUrl = `https://${amoCRMSubdomain}.amocrm.ru/api/v4/account`;
        const accountResponse = await axios.get(accountUrl, {
            headers: {
                'Authorization': `Bearer ${amoCRMToken}`,
                'Content-Type': 'application/json'
            }
        });
        // Проверяем права доступа через account endpoint
        const rights = accountResponse.data._embedded?.users?.find(user => user.id === accountResponse.data.current_user_id)?.rights;
        res.status(200).json({
            status: 'success',
            message: 'Authorization check completed',
            account: {
                id: accountResponse.data.id,
                name: accountResponse.data.name,
                subdomain: accountResponse.data.subdomain,
                current_user_id: accountResponse.data.current_user_id
            },
            rights: rights || 'Unable to determine rights',
            note: 'To fully test update permissions, use the /test-update-lead/{leadId} endpoint'
        });
    } catch (error) {
        console.error('Ошибка проверки прав:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            status: 'error',
            message: 'Permission check failed',
            error: {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            },
            hints: [
                'Ensure ACCESS_TOKEN has permission to edit leads',
                'Check integration settings in AmoCRM',
                'Token may need to be regenerated with proper permissions'
            ]
        });
    }
});

// Test endpoint для проверки доступа к сделкам
app.get('/test-leads-access', async (req, res) => {
    try {
        console.log('Тестирование доступа к сделкам...');
        // Пробуем получить список сделок (первые 3)
        const leadsUrl = `https://${amoCRMSubdomain}.amocrm.ru/api/v4/leads?limit=3`;
        console.log(`Запрос к: ${leadsUrl}`);
        const response = await axios.get(leadsUrl, {
            headers: {
                'Authorization': `Bearer ${amoCRMToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'amoCRM-oAuth-client/1.0'
            }
        });
        const leads = response.data._embedded?.leads || [];
        res.status(200).json({
            status: 'success',
            message: 'Successfully accessed leads',
            leads_count: leads.length,
            sample_lead: leads[0] ? {
                id: leads[0].id,
                name: leads[0].name,
                price: leads[0].price
            } : null,
            permissions: {
                read_leads: true,
                update_leads: 'To test update, try modifying a lead'
            }
        });
    } catch (error) {
        console.error('Ошибка доступа к сделкам:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            status: 'error',
            message: 'Failed to access leads',
            error: {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            },
            hint: 'If you can\'t read leads, you likely can\'t update them either'
        });
    }
});

// ===== ЛОГИКА РАБОТЫ С ДАННЫМИ =====

// Функция для получения курса валют
const getExchangeRates = async () => {
    try {
        const response = await axios.get(exchangeRateApiUrl);
        const rates = response.data.Valute;
        const usdRate = rates.USD.Value;
        const eurRate = rates.EUR.Value;
        console.log(`Получение курсов валют: USD = ${usdRate}, EUR = ${eurRate}`);
        return { usdRate, eurRate };
    } catch (error) {
        console.error('Ошибка получения курсов валют:', error);
        throw new Error('Не удалось получить курс валют');
    }
};

// Функция для обновления сделки
// ИСПРАВЛЕНО: url объявлен в начале функции
const updateLead = async (leadId, customFieldsToUpdate, price) => {
    // Объявляем url в начале функции, чтобы он был доступен везде, включая блок catch
    let url;
    try {
        // Преобразуем значение `price` в целое число
        const priceAsInt = Math.round(price);
        url = `https://${amoCRMSubdomain}.amocrm.ru/api/v4/leads/${leadId}`; // Присваиваем значение

        // Создаем объект данных для обновления
        const updateData = {
            price: priceAsInt
        };
        // Добавляем custom_fields_values только если есть что обновлять
        if (customFieldsToUpdate && customFieldsToUpdate.length > 0) {
            updateData.custom_fields_values = customFieldsToUpdate;
        }

        if (Object.keys(updateData).length === 0) {
             console.log(`Сделка ${leadId}: Нет данных для обновления.`);
             return;
        }

        console.log(`Обновление сделки ${leadId}:`);
        console.log(`URL: ${url}`);
        console.log(`Данные для обновления:`, JSON.stringify(updateData, null, 2));

        const response = await axios.patch(url, updateData, {
            headers: {
                'Authorization': `Bearer ${amoCRMToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'amoCRM-oAuth-client/1.0'
            }
        });
        console.log(`Сделка ${leadId} успешно обновлена с ценой ${priceAsInt}. Статус: ${response.status}`);
    } catch (error) {
        console.error(`Ошибка обновления сделки ${leadId}:`);
        // Теперь url будет доступен в блоке catch, даже если он undefined
        console.error(`URL: ${url || 'URL was not constructed due to an earlier error'}`);
        console.error(`Status: ${error.response?.status}`);
        console.error(`Status Text: ${error.response?.statusText}`);
        console.error(`Response:`, error.response?.data || error.message);
        
        if (error.response?.status === 403) {
            console.error('403 Forbidden при обновлении - возможные причины:');
            console.error('1. Токен не имеет прав на изменение сделок');
            console.error('2. Интеграция отключена или токен истек');
            console.error('3. Проверьте права доступа интеграции в AmoCRM');
            console.error('4. Возможно, сделка заблокирована или у пользователя нет прав на её изменение');
        }
        
        // Логируем заголовки запроса для отладки (без токена)
        console.error('Заголовки запроса:', {
            'Authorization': `Bearer ${amoCRMToken ? amoCRMToken.substring(0, 10) + '...' : 'NOT SET'}`,
            'Content-Type': 'application/json',
            'User-Agent': 'amoCRM-oAuth-client/1.0'
        });
        
        throw new Error(`Не удалось обновить сделку ${leadId}`);
    }
};

// Функция для обработки сделки (использует только данные из вебхука)
const processLead = async (leadData, usdRate, eurRate) => {
    // Теперь используем данные напрямую из вебхука
    const leadId = leadData.id;
    const lead = {
        id: leadData.id,
        price: parseInt(leadData.price, 10) || 0,  // Преобразуем строку в число
        custom_fields_values: leadData.custom_fields ? leadData.custom_fields.map(field => ({
            field_id: parseInt(field.id, 10),  // Преобразуем ID в число
            values: field.values
        })) : []
    };

    const customFields = lead.custom_fields_values || [];

    // Функция для получения текущих значений полей из данных вебхука
    const getFieldValue = (fieldId) => {
        const field = customFields.find(f => f.field_id === fieldId);
        if (!field || !field.values || field.values.length === 0) return null;
        const firstValue = field.values[0];
        let value;
        if (typeof firstValue === 'object' && firstValue.value !== undefined) {
            value = firstValue.value;
        } else {
            value = firstValue;
        }
        if (typeof value === 'string' && /^\d[\d\s]*$/.test(value)) {
            value = value.replace(/\s/g, '');
        }
        return value;
    };

    // Проверка наличия поля валюты
    const currencyField = customFields.find(field => field.field_id === currencyFieldId);
    if (!currencyField || !currencyField.values || currencyField.values.length === 0) {
        console.log(`Поле Currency отсутствует в сделке ${leadId}.`);
        return;
    }

    // Получаем значение валюты из формата вебхука
    const selectedCurrency = currencyField.values[0].value || currencyField.values[0];
    console.log(`Определение основной валюты для сделки ${leadId}: ${selectedCurrency}`);

    // Получаем курсы валют из сделки
    const storedUsdRate = parseFloat(getFieldValue(usdRateFieldId)) || 0;
    const storedEurRate = parseFloat(getFieldValue(eurRateFieldId)) || 0;

    // Текущие курсы валют
    const currentUsdRate = parseFloat(usdRate.toFixed(4));
    const currentEurRate = parseFloat(eurRate.toFixed(4));

    const epsilonRate = 0.0001;

    // Проверяем, изменились ли курсы валют
    const ratesChanged = Math.abs(storedUsdRate - currentUsdRate) >= epsilonRate ||
        Math.abs(storedEurRate - currentEurRate) >= epsilonRate;

    if (!ratesChanged) {
        console.log(`Сделка ${leadId}: Курсы валют не изменились.`);
        return; // Если курсы не изменились, ничего не делаем
    }

    console.log(`Сделка ${leadId}: Курсы валют изменились или отсутствуют, требуется обновление.`);
    console.log(`  Старые курсы: USD=${storedUsdRate}, EUR=${storedEurRate}`);
    console.log(`  Новые курсы: USD=${currentUsdRate}, EUR=${currentEurRate}`);

    let newPriceInRub = 0;
    let calculatedUsdValue = null;
    let calculatedEurValue = null;

    if (selectedCurrency === 'Dollar') {
        const priceInUsd = parseFloat(getFieldValue(usdFieldId)) || 0;
        newPriceInRub = priceInUsd * usdRate;
        const budgetInEur = priceInUsd * (usdRate / eurRate);
        calculatedEurValue = parseFloat(budgetInEur.toFixed(2));

        const storedEurValue = parseFloat(getFieldValue(eurFieldId)) || 0;
        const epsilonValue = 0.01;

        if (Math.abs(storedEurValue - calculatedEurValue) < epsilonValue) {
            console.log(`Сделка ${leadId}: Значения не изменились, обработка не требуется.`);
            return;
        }

        // Подготовка обновления полей
        let customFieldsToUpdate = [];
        customFieldsToUpdate.push({ field_id: eurFieldId, values: [{ value: calculatedEurValue }] });
        // ВАЖНО: Не обновляем курсы валют напрямую - они могут быть readonly
        /*
        customFieldsToUpdate.push(
            { field_id: eurRateFieldId, values: [{ value: currentEurRate }] },
            { field_id: usdRateFieldId, values: [{ value: currentUsdRate }] }
        );
        */
        console.log(`Сделка ${leadId}: Пересчитанные значения - EUR = ${calculatedEurValue}, RUB = ${Math.round(newPriceInRub)}`);

        // Обновляем сделку
        try {
            // Сначала обновляем только цену
            await updateLead(leadId, [], newPriceInRub);
            console.log(`Сделка ${leadId}: Цена обновлена успешно до ${Math.round(newPriceInRub)}.`);

            // Затем обновляем custom fields если есть что обновлять
            if (customFieldsToUpdate.length > 0) {
                await updateLead(leadId, customFieldsToUpdate, newPriceInRub);
                console.log(`Сделка ${leadId}: Кастомные поля обновлены успешно.`);
            }
        } catch (error) {
            console.error(`Сделка ${leadId}: Ошибка при обновлении.`, error.message);
            throw error;
        }

    } else if (selectedCurrency === 'Euro') {
        const priceInEur = parseFloat(getFieldValue(eurFieldId)) || 0;
        newPriceInRub = priceInEur * eurRate;
        const budgetInUsd = priceInEur * (eurRate / usdRate);
        calculatedUsdValue = parseFloat(budgetInUsd.toFixed(2));

        const storedUsdValue = parseFloat(getFieldValue(usdFieldId)) || 0;
        const epsilonValue = 0.01;

        if (Math.abs(storedUsdValue - calculatedUsdValue) < epsilonValue) {
            console.log(`Сделка ${leadId}: Значения не изменились, обработка не требуется.`);
            return;
        }

        // Подготовка обновления полей
        let customFieldsToUpdate = [];
        customFieldsToUpdate.push({ field_id: usdFieldId, values: [{ value: calculatedUsdValue }] });
        // ВАЖНО: Не обновляем курсы валют напрямую - они могут быть readonly
        /*
        customFieldsToUpdate.push(
            { field_id: eurRateFieldId, values: [{ value: currentEurRate }] },
            { field_id: usdRateFieldId, values: [{ value: currentUsdRate }] }
        );
        */
        console.log(`Сделка ${leadId}: Пересчитанные значения - USD = ${calculatedUsdValue}, RUB = ${Math.round(newPriceInRub)}`);

        // Обновляем сделку
        try {
            // Сначала обновляем только цену
            await updateLead(leadId, [], newPriceInRub);
            console.log(`Сделка ${leadId}: Цена обновлена успешно до ${Math.round(newPriceInRub)}.`);

            // Затем обновляем custom fields если есть что обновлять
            if (customFieldsToUpdate.length > 0) {
                await updateLead(leadId, customFieldsToUpdate, newPriceInRub);
                console.log(`Сделка ${leadId}: Кастомные поля обновлены успешно.`);
            }
        } catch (error) {
            console.error(`Сделка ${leadId}: Ошибка при обновлении.`, error.message);
            throw error;
        }

    } else if (selectedCurrency === 'Рубли') {
        newPriceInRub = lead.price || 0;
        const budgetInUsd = newPriceInRub / usdRate;
        const budgetInEur = newPriceInRub / eurRate;

        calculatedUsdValue = parseFloat(budgetInUsd.toFixed(2));
        calculatedEurValue = parseFloat(budgetInEur.toFixed(2));

        const storedUsdValue = parseFloat(getFieldValue(usdFieldId)) || 0;
        const storedEurValue = parseFloat(getFieldValue(eurFieldId)) || 0;

        const epsilonValue = 0.01;

        if (
            Math.abs(storedUsdValue - calculatedUsdValue) < epsilonValue &&
            Math.abs(storedEurValue - calculatedEurValue) < epsilonValue
        ) {
            console.log(`Сделка ${leadId}: Значения не изменились, обработка не требуется.`);
            return;
        }

        // Подготовка обновления полей
        let customFieldsToUpdate = [];
        if(calculatedUsdValue !== null) {
            customFieldsToUpdate.push({ field_id: usdFieldId, values: [{ value: calculatedUsdValue }] });
            console.log(`Сделка ${leadId}: Подготовлено обновление USD = ${calculatedUsdValue}`);
        }
        if(calculatedEurValue !== null) {
            customFieldsToUpdate.push({ field_id: eurFieldId, values: [{ value: calculatedEurValue }] });
            console.log(`Сделка ${leadId}: Подготовлено обновление EUR = ${calculatedEurValue}`);
        }
        // ВАЖНО: Не обновляем курсы валют напрямую - они могут быть readonly
        /*
        customFieldsToUpdate.push(
            { field_id: eurRateFieldId, values: [{ value: currentEurRate }] },
            { field_id: usdRateFieldId, values: [{ value: currentUsdRate }] }
        );
        */

        // Обновляем сделку
        try {
            // Сначала обновляем только цену
            await updateLead(leadId, [], newPriceInRub);
            console.log(`Сделка ${leadId}: Цена обновлена успешно до ${Math.round(newPriceInRub)}.`);

            // Затем обновляем custom fields если есть что обновлять
            if (customFieldsToUpdate.length > 0) {
                await updateLead(leadId, customFieldsToUpdate, newPriceInRub);
                console.log(`Сделка ${leadId}: Кастомные поля обновлены успешно.`);
            } else {
                 console.log(`Сделка ${leadId}: Нет кастомных полей для обновления.`);
            }
        } catch (error) {
            console.error(`Сделка ${leadId}: Ошибка при обновлении.`, error.message);
            throw error;
        }

    } else {
        console.log(`Сделка ${leadId}: Неизвестная валюта, обработка не требуется.`);
        return;
    }
};

// Обработка вебхука
app.post('/webhook', async (req, res) => {
    try {
        console.log('Получен вебхук:', JSON.stringify(req.body, null, 2));

        // Проверяем наличие данных о сделках
        if (!req.body || !req.body.leads || !req.body.leads.update) {
            console.log('Вебхук не содержит данных об обновлении сделок');
            return res.status(200).send('OK - No leads to process');
        }

        const leadUpdates = req.body.leads.update;

        if (!Array.isArray(leadUpdates) || leadUpdates.length === 0) {
            console.log('Массив обновлений сделок пуст');
            return res.status(200).send('OK - Empty updates array');
        }

        for (const leadUpdate of leadUpdates) {
            const leadId = leadUpdate.id;
            console.log(`Обработка вебхука для сделки ${leadId}`);

            // Получаем текущие курсы валют
            const { usdRate, eurRate } = await getExchangeRates();

            // Обрабатываем сделку, передавая полные данные из вебхука
            await processLead(leadUpdate, usdRate, eurRate);
        }

        res.send('Webhook обработан успешно');
    } catch (error) {
        console.error('Ошибка обработки вебхука:', error.message, error.stack);
        // Всегда возвращаем 200, чтобы AmoCRM не повторял вебхук
        res.status(200).send('Webhook received with error');
    }
});

// ===== ЗАПУСК СЕРВЕРА =====

const PORT = process.env.PORT || 3000;

// Проверка переменных окружения при запуске
if (!amoCRMToken || !amoCRMSubdomain) {
    console.error('ОШИБКА: Отсутствуют необходимые переменные окружения!');
    console.error(`ACCESS_TOKEN: ${amoCRMToken ? 'Установлен' : 'НЕ УСТАНОВЛЕН'}`);
    console.error(`SUBDOMAIN: ${amoCRMSubdomain ? 'Установлен' : 'НЕ УСТАНОВЛЕН'}`);
    if (!amoCRMToken) {
        console.error('Необходимо установить ACCESS_TOKEN в переменных окружения Render');
    }
    if (!amoCRMSubdomain) {
        console.error('Необходимо установить SUBDOMAIN в переменных окружения Render');
    }
    // Не останавливаем сервер, так как тестовые эндпоинты могут быть полезны для диагностики
    // process.exit(1);
} else {
    console.log('Переменные окружения загружены успешно');
    console.log(`SUBDOMAIN: ${amoCRMSubdomain}`);
    // Безопасно скрываем большую часть токена
    console.log(`ACCESS_TOKEN: ${amoCRMToken.substring(0, 10)}...${amoCRMToken.substring(amoCRMToken.length - 5)}`);
}

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`
Доступные endpoints:`);
    console.log(`- Health check: http://localhost:${PORT}/`);
    console.log(`- Status: http://localhost:${PORT}/status`);
    console.log(`- Test auth: http://localhost:${PORT}/test-auth`);
    console.log(`- Test permissions: http://localhost:${PORT}/test-update-permission`);
    console.log(`- Test leads access: http://localhost:${PORT}/test-leads-access`);
});
