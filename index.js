const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const nlp = require('compromise');

const TELEGRAM_BOT_TOKEN = 'YOUR-TELEGRAM-BOT-TOKEN';

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);


const warnings = {};
const foulWords = ['stupid', 'bastard', 'sex', 'Fuck', 'fucking', 'retard', 'dumb', 'hookup', 'fuck up', 'fucked up']; // Add actual words


const db = new sqlite3.Database('./pdf_data.db');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS pdf_text (group_id TEXT, content TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS greetings (group_id TEXT, message TEXT)");
});


function containsFoulLanguage(text) {
  return foulWords.some(word => text.toLowerCase().includes(word));
}

// Function to insert PDF content into the database
function savePDFContent(groupId, content) {
  const stmt = db.prepare("INSERT INTO pdf_text (group_id, content) VALUES (?, ?)");
  stmt.run(groupId, content);
  stmt.finalize();
}

// Function to retrieve all PDF content for a specific group
function getAllPDFContent(groupId, callback) {
  db.all("SELECT content FROM pdf_text WHERE group_id = ?", [groupId], (err, rows) => {
    if (err) {
      console.error('Error fetching data:', err);
      return callback('');
    }
    const allText = rows.map(row => row.content).join(' ');
    callback(allText);
  });
}

// Function to handle text messages and search PDF content
function getPDFResponse(groupId, query, callback) {
  getAllPDFContent(groupId, (pdfTextContent) => {
    const sentences = pdfTextContent.split('.'); // Split PDF content into sentences
    const matches = sentences.filter(sentence => sentence.toLowerCase().includes(query.toLowerCase()));
    const response = matches.length > 0 ? matches.join('. ') + '.' : 'No relevant information found in the PDF.';
    callback(response);
  });
}

// Function to detect if a message is a question and extract the topic
function isQuestion(message) {
  const doc = nlp(message);
  const isQuestion = doc.has('?') || doc.sentences().isQuestion().out('array').length > 0;
  const questionWord = doc.match('#QuestionWord').out('array')[0];
  let topic = message;

  if (questionWord) {
    topic = message.replace(questionWord, '').replace('?', '').trim();
  }

  return { isQuestion, topic };
}

// Handle '/start' command
bot.start((ctx) => {
  ctx.reply('Welcome, How can I help you?.');
});

// Welcome new members and learn from greetings
bot.on('new_chat_members', (ctx) => {
  const groupId = ctx.chat.id.toString();
  ctx.message.new_chat_members.forEach((member) => {
    const greetingMessage = `Welcome, @${member.username || member.first_name}! We're glad to have you here. Stay updated by checking previous messages.`;
    const stmt = db.prepare("INSERT INTO greetings (group_id, message) VALUES (?, ?)");
    stmt.run(groupId, greetingMessage);
    stmt.finalize();
    ctx.reply(greetingMessage);
  });
});

// Handle any text messages in group chat
bot.on('text', async (ctx) => {
  const groupId = ctx.chat.id.toString();
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name;
  const messageText = ctx.message.text;

  // Learn from user interactions
  if (!containsFoulLanguage(messageText)) {
    const stmt = db.prepare("INSERT INTO greetings (group_id, message) VALUES (?, ?)");
    stmt.run(groupId, messageText);
    stmt.finalize();
  }

  const { isQuestion, topic } = isQuestion(messageText);

  if (ctx.chat.type === 'private') {
    // Handle private messages
    if (isQuestion) {
      getPDFResponse(groupId, topic, (response) => {
        ctx.reply(response);
      });
    } else {
      ctx.reply('What do you need help with?.');
    }
  } else {
    // Handle group messages
    if (containsFoulLanguage(messageText)) {
      if (warnings[userId]) {
        // User has been warned before, remove them
        try {
          await ctx.kickChatMember(userId);
          ctx.reply(`@${username} has been removed for violating the group rules.`);
        } catch (error) {
          console.error('Error removing user:', error);
          ctx.reply('Failed to remove user due to an error.');
        }
      } else {
        // Warn the user
        warnings[userId] = true;
        ctx.reply(`@${username}, please refrain from using foul language. This is a one-time warning!`);
      }
    } else {
      // Process normal messages
      if (isQuestion) {
        getPDFResponse(groupId, topic, (response) => {
          ctx.reply(response);
        });
      } else {
        ctx.reply('Am ready to help you, specify your question and end it with question tag("?").');
      }
    }
  }
});

// Function to handle PDF files
bot.on('document', async (ctx) => {
  const groupId = ctx.chat.id.toString();
  const fileId = ctx.message.document.file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);

  // Download and parse the PDF
  try {
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    const data = await pdfParse(response.data);
    savePDFContent(groupId, data.text);
    ctx.reply('PDF content has been processed and stored for dynamic learning. Thank you for contributing to my learning ;).');
  } catch (error) {
    console.error('Error parsing PDF:', error);
    ctx.reply('Failed to process the PDF file. Please check and make sure you are sending a PDF file and it is not corrupted');
  }
});

// Schedule daily greeting message at 07:00 AM GMT+1
schedule.scheduleJob('0 7 * * *', 'Etc/GMT+1', async () => {
  const groupIds = await new Promise((resolve, reject) => {
    db.all("SELECT DISTINCT group_id FROM greetings", (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows.map(row => row.group_id));
      }
    });
  });

  for (const groupId of groupIds) {
    db.all("SELECT message FROM greetings WHERE group_id = ?", [groupId], (err, rows) => {
      if (err) {
        console.error('Error fetching greetings:', err);
        return;
      }
      const greetings = rows.map(row => row.message);
      const message = greetings.length > 0 ? greetings[Math.floor(Math.random() * greetings.length)] : 'Good morning everyone! Hope you all have a productive day ahead. Let’s crush our study goals today!';
      try {
        bot.telegram.sendMessage(groupId, message);
      } catch (error) {
        console.error('Greetings to you my able comrades in the house, today is another beautiful day to be productive :)', error);
      }
    });
  }
});

// Start the bot
bot.launch().then(() => {
  console.log('Bot is running');
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
