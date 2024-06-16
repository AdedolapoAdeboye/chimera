import { Telegraf } from 'telegraf';
import { PDFDocument, rgb } from 'pdf-lib';
import fetch from 'node-fetch';
import sqlite3 from 'sqlite3';
import schedule from 'node-schedule';
import fs from 'fs/promises'; // Use fs/promises for async file operations
import { TFAutoModelWithLMHead, AutoTokenizer } from '@transformers/huggingface';

// Initialize Telegraf bot instance
const bot = new Telegraf('YOUR_TELEGRAM_BOT_TOKEN');

// Initialize SQLite database
const db = new sqlite3.Database('bot_data.db');

// Foul language list
const foulLanguage = ["fuck", "shit", "bitch", "asshole", "bastard", "damn"];

// Dictionary to keep track of user warnings
let warnings = {};

// Function to generate a PDF file with greeting messages
async function generateGreetingPDF() {
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();

    // Add a page to the PDF
    const page = pdfDoc.addPage();

    // Set up text content for greetings
    const greetings = [
        "Hello! How are you today?",
        "Good morning!",
        "Greetings everyone!",
        "Hi there!",
        "Welcome to our group!",
        "Hope you're having a great day!",
        "Good afternoon!",
        "Hey! How's it going?",
        "Nice to meet you!",
        "Hello, world!"
    ];

    // Add greetings to the PDF
    const textOptions = { font: await pdfDoc.embedFont(PDFDocument.Font.Helvetica), fontSize: 12, color: rgb(0, 0, 0) };
    greetings.forEach((greeting, index) => {
        const y = page.getHeight() - (index + 1) * 20;
        page.drawText(greeting, { x: 50, y, ...textOptions });
    });

    // Save the PDF to a file
    const pdfBytes = await pdfDoc.save();
    await fs.writeFile('greetings.pdf', pdfBytes);
    console.log('PDF file generated: greetings.pdf');
}

// Function to generate a response using the language model
async function generateResponse(text) {
    const model = await TFAutoModelWithLMHead.fromPretrained('gpt2');
    const tokenizer = await AutoTokenizer.fromPretrained('gpt2');

    const inputs = tokenizer.encode(text, { return_tensors: 'tf' });
    const outputs = await model.generate(inputs, { max_length: 50 });
    const response = tokenizer.decode(outputs[0].slice(1).dataSync());
    return response;
}

// Function to detect questions using a basic approach
function isQuestion(text) {
    return text.includes('?');
}

// Function to look up answers on the internet
function internetSearch(query) {
    return new Promise((resolve, reject) => {
        fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`)
            .then(response => response.json())
            .then(data => {
                resolve(data.AbstractText || "I couldn't find an answer to that.");
            })
            .catch(error => {
                reject(error);
            });
    });
}

// Function to handle sending greetings to groups
function sendGroupGreetings() {
    db.all("SELECT message FROM greetings", (err, rows) => {
        if (err) {
            console.error('Error fetching greetings:', err);
            return;
        }
        rows.forEach(row => {
            const message = row.message;
            try {
                // Replace 'groupId' with the actual group ID where you want to send greetings
                bot.telegram.sendMessage('groupId', message);
            } catch (error) {
                console.error('Error sending greeting:', error.message);
            }
        });
    });
}

// Function to handle messages
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.toLowerCase();

    // Check for foul language
    if (foulLanguage.some(word => text.includes(word))) {
        if (warnings[userId]) {
            // Ban user if they've already been warned
            try {
                await ctx.telegram.kickChatMember(ctx.chat.id, userId);
                ctx.reply(`User ${ctx.from.username} has been banned for using foul language.`);
            } catch (error) {
                ctx.reply(`Error: ${error.message}`);
            }
        } else {
            // Warn user for the first time
            warnings[userId] = 1;
            ctx.reply(`Warning ${ctx.from.username}: Please do not use foul language.`);
        }
        return;
    }

    // Check if it's a question
    if (isQuestion(text)) {
        // Search in the database
        db.get('SELECT answer FROM knowledge WHERE question=?', [text], async (err, row) => {
            if (err) {
                console.error(err);
                return;
            }
            if (row) {
                ctx.reply(row.answer);
            } else {
                // Look up on the internet
                try {
                    const answer = await internetSearch(text);
                    ctx.reply(answer);
                    // Store the new question and answer in the database
                    db.run('INSERT INTO knowledge (question, answer) VALUES (?, ?)', [text, answer]);
                } catch (error) {
                    console.error(error);
                    ctx.reply("An error occurred while searching for the answer.");
                }
            }
        });
    } else if (text.includes('how are you doing')) {
        ctx.reply("I'm just a bot, but thanks for asking!");
    } else {
        ctx.reply("I'm here to help with any questions you have!");
    }
});

// Function to learn from a PDF file
bot.command('learn', async (ctx) => {
    if (!ctx.message.document) {
        return ctx.reply('Please upload a PDF file to learn from using the /learn command.');
    }

    const fileLink = await ctx.telegram.getFileLink(ctx.message.document.file_id);
    const fileBuffer = await fetch(fileLink).then(res => res.buffer());

    const pdfDoc = await PDFDocument.load(fileBuffer);
    const pages = pdfDoc.getPages();
    const greetings = [];

    pages.forEach(page => {
        const text = page.getText();
        greetings.push(text);
    });

    // Store greetings in the database or process them as needed
    // Example: Save each greeting in the 'greetings' table of 'bot_data.db'

    ctx.reply('Learned from the PDF!');
});

// Function to send a good morning message
function sendGoodMorning() {
    bot.telegram.sendMessage('groupId', 'Good morning!');
}

// Schedule jobs using node-schedule
schedule.scheduleJob('0 7 * * *', sendGoodMorning);

// Start the bot
bot.launch().then(() => {
    console.log('Bot started');
}).catch((err) => {
    console.error('Error starting bot', err);
});

// Generate greeting PDF and start bot after generating PDF
generateGreetingPDF().then(() => {
    // Start the bot after generating the PDF
    bot.launch().then(() => {
        console.log('Bot started');
    }).catch((err) => {
        console.error('Error starting bot', err);
    });
}).catch(err => {
    console.error('Error generating PDF', err);
});
