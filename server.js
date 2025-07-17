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
// Убираем lastUpdateFieldId, так как больше не используем поле даты обновления

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
        const response = await axios.get(`https://${amoCRMSubdomain}.amocrm.ru/api/v4/leads/${leadId}`, {
            headers: { 'Authorization': `Bearer ${amoCRMToken}` }
        });
        return response.data;
    } catch (error) {
        console.error(`Ошибка получения данных сделки ${leadId}:`, error.response?.data || error.message);
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
        const leadUpdates = req.body.leads.update;

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
        res.status(500).send('Ошибка обработки вебхука');
    }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});