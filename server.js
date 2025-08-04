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

// ===== НОВЫЕ GET ENDPOINTS ДЛЯ ПИНГА =====

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

// ===== СУЩЕСТВУЮЩИЕ ФУНКЦИИ =====

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

// Функция для получения данных о сделке
const getLeadDetails = async (leadId) => {
    try {
        const url = `https://${amoCRMSubdomain}.amocrm.ru/api/v4/leads/${leadId}`;
        console.log(`Запрос к AmoCRM API: ${url}`);
        
        const response = await axios.get(url, {
            headers: { 
                'Authorization': `Bearer ${amoCRMToken}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Ошибка получения данных сделки ${leadId}:`);
        console.error(`URL: https://${amoCRMSubdomain}.amocrm.ru/api/v4/leads/${leadId}`);
        console.error(`Status: ${error.response?.status}`);
        console.error(`Response:`, error.response?.data || error.message);
        
        if (error.response?.status === 403) {
            console.error('403 Forbidden - Проверьте ACCESS_TOKEN в переменных окружения');
            console.error('Токен может быть истекшим или недействительным');
        }
        
        throw new Error('Не удалось получить данные о сделке');
    }
};

// Функция для обновления сделки
const updateLead = async (leadId, customFieldsToUpdate, price) => {
    try {
        // Преобразуем значение `price` в целое число
        const priceAsInt = Math.round(price);

        await axios.patch(`https://${amoCRMSubdomain}.amocrm.ru/api/v4/leads/${leadId}`, {
            custom_fields_values: customFieldsToUpdate,
            price: priceAsInt
        }, {
            headers: {
                'Authorization': `Bearer ${amoCRMToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Сделка ${leadId} успешно обновлена с ценой ${priceAsInt}.`);
    } catch (error) {
        console.error(`Ошибка обновления сделки ${leadId}:`, error.response?.data || error.message);
        throw new Error('Не удалось обновить сделку');
    }
};

// Функция для обработки сделки
const processLead = async (leadId, usdRate, eurRate) => {
    const lead = await getLeadDetails(leadId);
    const customFields = lead.custom_fields_values || [];

    // Функция для получения текущих значений полей (может вернуть null)
    const getFieldValue = (fieldId) => {
        const field = customFields.find(f => f.field_id === fieldId);
        return field?.values?.[0]?.value ? field.values[0].value : null;
    };

    const currencyField = customFields.find(field => field.field_id === currencyFieldId);

    if (!currencyField || !currencyField.values || !currencyField.values[0]?.value) {
        console.log(`Поле Currency отсутствует в сделке ${leadId}.`);
        return;
    }

    const selectedCurrency = currencyField.values[0].value;
    console.log(`Определение основной валюты для сделки ${leadId}: ${selectedCurrency}`);

    // Получаем курсы валют из сделки
    const storedUsdRate = parseFloat(getFieldValue(usdRateFieldId));
    const storedEurRate = parseFloat(getFieldValue(eurRateFieldId));

    // Текущие курсы валют
    const currentUsdRate = parseFloat(usdRate.toFixed(4));
    const currentEurRate = parseFloat(eurRate.toFixed(4));

    const epsilonRate = 0.0001; // Допуск для сравнения курсов валют

    // Проверяем, изменились ли курсы валют
    if (Math.abs(storedUsdRate - currentUsdRate) < epsilonRate && Math.abs(storedEurRate - currentEurRate) < epsilonRate) {
        console.log(`Сделка ${leadId}: Курсы валют не изменились.`);
    } else {
        console.log(`Сделка ${leadId}: Курсы валют изменились или отсутствуют, требуется обновление.`);
    }

    let customFieldsToUpdate = [];
    let newPriceInRub = 0;

    if (selectedCurrency === 'Dollar') {
        const priceInUsd = parseFloat(getFieldValue(usdFieldId)) || 0;
        newPriceInRub = priceInUsd * usdRate;
        const budgetInEur = priceInUsd * (usdRate / eurRate);

        const calculatedEurValue = parseFloat(budgetInEur.toFixed(2));
        const storedEurValue = parseFloat(getFieldValue(eurFieldId)) || 0;

        const epsilonValue = 0.01; // Допуск для сравнения цен

        if (
            Math.abs(storedEurValue - calculatedEurValue) < epsilonValue &&
            Math.abs(storedUsdRate - currentUsdRate) < epsilonRate &&
            Math.abs(storedEurRate - currentEurRate) < epsilonRate
        ) {
            console.log(`Сделка ${leadId}: Значения не изменились, обработка не требуется.`);
            return;
        }

        customFieldsToUpdate.push({ field_id: eurFieldId, values: [{ value: calculatedEurValue }] });

        // Обновляем курсы валют
        customFieldsToUpdate.push(
            { field_id: eurRateFieldId, values: [{ value: currentEurRate }] },
            { field_id: usdRateFieldId, values: [{ value: currentUsdRate }] }
        );

        console.log(`Сделка ${leadId}: Пересчитанные значения - EUR = ${calculatedEurValue}, RUB = ${Math.round(newPriceInRub)}`);
    } else if (selectedCurrency === 'Euro') {
        const priceInEur = parseFloat(getFieldValue(eurFieldId)) || 0;
        newPriceInRub = priceInEur * eurRate;
        const budgetInUsd = priceInEur * (eurRate / usdRate);

        const calculatedUsdValue = parseFloat(budgetInUsd.toFixed(2));
        const storedUsdValue = parseFloat(getFieldValue(usdFieldId)) || 0;

        const epsilonValue = 0.01; // Допуск для сравнения цен

        if (
            Math.abs(storedUsdValue - calculatedUsdValue) < epsilonValue &&
            Math.abs(storedUsdRate - currentUsdRate) < epsilonRate &&
            Math.abs(storedEurRate - currentEurRate) < epsilonRate
        ) {
            console.log(`Сделка ${leadId}: Значения не изменились, обработка не требуется.`);
            return;
        }

        customFieldsToUpdate.push({ field_id: usdFieldId, values: [{ value: calculatedUsdValue }] });

        // Обновляем курсы валют
        customFieldsToUpdate.push(
            { field_id: eurRateFieldId, values: [{ value: currentEurRate }] },
            { field_id: usdRateFieldId, values: [{ value: currentUsdRate }] }
        );

        console.log(`Сделка ${leadId}: Пересчитанные значения - USD = ${calculatedUsdValue}, RUB = ${Math.round(newPriceInRub)}`);
    } else if (selectedCurrency === 'Рубли') {
        newPriceInRub = lead.price || 0;
        const budgetInUsd = newPriceInRub / usdRate;
        const budgetInEur = newPriceInRub / eurRate;

        const calculatedUsdValue = parseFloat(budgetInUsd.toFixed(2));
        const calculatedEurValue = parseFloat(budgetInEur.toFixed(2));
        const storedUsdValue = parseFloat(getFieldValue(usdFieldId)) || 0;
        const storedEurValue = parseFloat(getFieldValue(eurFieldId)) || 0;

        const epsilonValue = 0.01; // Допуск для сравнения цен

        if (
            Math.abs(storedUsdValue - calculatedUsdValue) < epsilonValue &&
            Math.abs(storedEurValue - calculatedEurValue) < epsilonValue &&
            Math.abs(storedUsdRate - currentUsdRate) < epsilonRate &&
            Math.abs(storedEurRate - currentEurRate) < epsilonRate
        ) {
            console.log(`Сделка ${leadId}: Значения не изменились, обработка не требуется.`);
            return;
        }

        customFieldsToUpdate.push(
            { field_id: usdFieldId, values: [{ value: calculatedUsdValue }] },
            { field_id: eurFieldId, values: [{ value: calculatedEurValue }] }
        );

        // Обновляем курсы валют
        customFieldsToUpdate.push(
            { field_id: eurRateFieldId, values: [{ value: currentEurRate }] },
            { field_id: usdRateFieldId, values: [{ value: currentUsdRate }] }
        );

        console.log(`Сделка ${leadId}: Пересчитанные значения - USD = ${calculatedUsdValue}, EUR = ${calculatedEurValue}`);
    } else {
        console.log(`Сделка ${leadId}: Неизвестная валюта, обработка не требуется.`);
        return;
    }

    console.log(`Сделка ${leadId}: Попытка обновления полей.`);

    // Обновляем сделку
    await updateLead(leadId, customFieldsToUpdate, newPriceInRub);
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

            // Обрабатываем сделку
            await processLead(leadId, usdRate, eurRate);
        }

        res.send('Webhook обработан успешно');
    } catch (error) {
        console.error('Ошибка обработки вебхука:', error.message, error.stack);
        
        // Всегда возвращаем 200, чтобы AmoCRM не повторял вебхук
        res.status(200).send('Webhook received with error');
    }
});

// Запуск сервера
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
} else {
    console.log('Переменные окружения загружены успешно');
    console.log(`SUBDOMAIN: ${amoCRMSubdomain}`);
    console.log(`ACCESS_TOKEN: ${amoCRMToken.substring(0, 10)}...${amoCRMToken.substring(amoCRMToken.length - 5)}`);
}

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Health check доступен по адресу: http://localhost:${PORT}/`);
    console.log(`Status endpoint: http://localhost:${PORT}/status`);
    console.log(`Test auth endpoint: http://localhost:${PORT}/test-auth`);
});
