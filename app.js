"use strict";

const crypto = require('crypto');
const { urlencoded, json } = require('body-parser');
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const OpenAI = require('openai');

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessionControl = new Map();

// Variables de Configuración (Usa las de tu .env)
const config = {
    verifyToken: process.env.META_VERIFY_TOKEN,
    accessToken: process.env.META_JWT_TOKEN,
    appSecret: process.env.APP_SECRET,
    port: process.env.PORT || 8080,
    version: 'v22.0'
};

app.use(urlencoded({ extended: true }));
app.use(json({ verify: verifyRequestSignature }));

/* =========================
    LUNA IA (Lógica de Negocio)
========================= */
const chatGPTControl = async (text, history = []) => {
    const systemPrompt = `Sos "Luna", la IA de "Selfie Mirror". 
    Bienvenida: "Gracias por comunicarte con nosotros, este es el lugar indicado si lo que busca es innovación para eventos".
    RATONEANDO: Si el cliente cuestiona el precio de USD 2300, respondé con altura: "Este equipo no es un gasto, es una Unidad de Negocio que se amortiza en 10 eventos. Vendemos rentabilidad y soporte profesional, no solo un producto."
    REGLA: No repitas el saludo si la charla ya inició. JSON: { "reply": "texto" }`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: text }],
            response_format: { type: "json_object" }
        });
        return JSON.parse(response.choices[0].message.content);
    } catch (e) {
        return { reply: "Contame, ¿estás buscando un equipo para vos o para alquilar?" };
    }
}

/* =========================
    FUNCIÓN DE ENVÍO (META API)
========================= */
async function sendMessage(phoneNumberId, to, text) {
    try {
        await axios({
            method: "POST",
            url: `https://graph.facebook.com/${config.version}/${phoneNumberId}/messages`,
            data: {
                messaging_product: "whatsapp",
                to: to,
                text: { body: text },
            },
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.accessToken}`,
            },
        });
    } catch (error) {
        console.error("Error enviando mensaje:", error.response ? error.response.data : error.message);
    }
}

/* =========================
    WEBHOOKS
========================= */

app.get("/webhook", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.verifyToken) {
        res.status(200).send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
        for (const entry of body.entry) {
            for (const change of entry.changes) {
                const value = change.value;
                if (value.messages) {
                    const msg = value.messages[0];
                    const from = msg.from;
                    const senderPhoneNumberId = value.metadata.phone_number_id; // Variable original
                    const txt = msg.text ? msg.text.body : "Interacción de Flow"; // Variable txt mantenida

                    let session = sessionControl.get(from) || { sent: 0, history: [] };

                    // 🚩 APRENDIZAJE AL 6TO MENSAJE
                    if (session.sent >= 5) {
                        fs.appendFileSync('aprendizaje.txt', `[APRENDER] ${from}: ${txt}\n`);
                        continue;
                    }

                    // IA Luna procesa la respuesta
                    const aiResponse = await chatGPTControl(txt, session.history);
                    session.history.push({ role: "user", content: txt }, { role: "assistant", content: aiResponse.reply });

                    // Enviar respuesta a WhatsApp
                    await sendMessage(senderPhoneNumberId, from, aiResponse.reply);

                    session.sent += 1;
                    sessionControl.set(from, session);
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

/* =========================
    UTILIDADES
========================= */

function verifyRequestSignature(req, res, buf) {
    const signature = req.headers["x-hub-signature-256"];
    if (!signature) {
        console.warn(`No se encontró la firma en headers.`);
    } else {
        const elements = signature.split("=");
        const signatureHash = elements[1];
        const expectedHash = crypto.createHmac("sha256", config.appSecret).update(buf).digest("hex");
        if (signatureHash !== expectedHash) {
            throw new Error("No se pudo validar la firma de la petición.");
        }
    }
}

app.listen(config.port, () => {
    console.log(`Luna está escuchando en el puerto ${config.port}`);
});
