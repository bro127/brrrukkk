
// @ts-nocheck
/**
 * Ethiopian Genius Student Bot - v12.1 (Secure & GitHub Deployed)
 * Developer: BK the Hawk𓅓
 *
 * This version is designed for secure deployment via GitHub.
 * It reads all secrets (API keys, admin IDs) from Cloudflare's
 * environment variables instead of hardcoding them.
 */

// =================================================================================
// 👑 CONFIGURATION LOADER 👑
// =================================================================================

// CONFIG will be loaded from environment variables on the first request.
let CONFIG;

/**
 * Initializes the CONFIG object from the environment variables.
 * This function is called once per worker instance.
 * @param {any} env - The environment object from the fetch handler.
 */
function initializeConfig(env) {
    if (CONFIG) return; // Already initialized

    // Helper to safely parse a comma-separated string of numbers
    const parseNumberList = (str) => {
        if (!str) return [];
        return str.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
    };

    CONFIG = {
        // SECRETS - Read from Cloudflare Environment Variables
        BOT_TOKEN: env.BOT_TOKEN,
        GEMINI_API_KEY: env.GEMINI_API_KEY,
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        FIREWORKS_API_KEY: env.FIREWORKS_API_KEY,
        ADMIN_IDS: parseNumberList(env.ADMIN_IDS), // Must be numbers
        ADMIN_USERNAME: env.ADMIN_USERNAME,

        // BOT SETTINGS - Can be hardcoded
        BOT_NAME: "ETHIOPIAN GENIUS STUDENT",
        ETHIOPIA_TZ: 'Africa/Addis_Ababa',
        BOT_DEVELOPER_SIGNATURE: "\n\n<i>Developer: BK the Hawk𓅓</i>",
    };
}

const AVAILABLE_AIS = {
    'gemini': { name: '🎓 Gemini 1.5 Flash', model_id: 'gemini-1.5-flash-latest', provider: 'gemini' },
    'openrouter_mistral': { name: '💡 Mistral 7B (Fast)', model_id: 'mistralai/mistral-7b-instruct:free', provider: 'openrouter' },
    'fireworks_mixtral': { name: '⚡ Mixtral 8x7B', model_id: 'accounts/fireworks/models/mixtral-8x7b-instruct', provider: 'fireworks_completion' }
};

// =================================================================================
// 🤖 CORE BOT LOGIC - DO NOT EDIT BELOW THIS LINE
// =================================================================================

export default {
    async fetch(request, env, ctx) {
        // Initialize configuration from environment variables
        initializeConfig(env);

        if (request.method === "POST") {
            try {
                const update = await request.json();
                ctx.waitUntil(handleUpdate(update, env));
            } catch (e) { console.error("Webhook Parse Error:", e); }
        }
        return new Response("OK");
    },
};

// ===================== CORE ROUTERS =====================
async function handleUpdate(update, env) {
    try {
        if (update.message) {
            await handleMessage(update.message, env);
        } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query, env);
        }
    } catch (e) {
        console.error("Core Handler Uncaught Exception:", e.stack);
    }
}

async function handleMessage(message, env) {
    const user = message.from;
    const text = message.text || '';

    await DB.updateUser(env.DB, user);

    const state = await FSM.getState(env.KV_STATE, user.id);
    if (state) {
        const stateHandler = FSM_HANDLERS[state.name];
        if (stateHandler) {
            return await stateHandler(message, env, state.data);
        } else {
            await FSM.clearState(env.KV_STATE, user.id);
        }
    }

    if (text.startsWith('/')) { return await handleCommand(message, env); }

    const isAdmin = CONFIG.ADMIN_IDS.includes(user.id);
    const mainMenuActions = {
        "💬 Ask AI": menuAskAi, "📋 Quizzes": menuQuizzes, "📚 PDF Library": menuPdfLibrary,
        "🏆 Leaderboard": menuLeaderboard, "🎓 Check Results": menuResults, "⚙️ Settings": menuSettings,
        "👑 Admin Panel": (isAdmin ? cmdAdmin : null)
    };
    if (mainMenuActions[text]) { return await mainMenuActions[text]({ from: user, chat: { id: user.id } }, env); }

    const thinkingMsg = await TG.sendMessage(user.id, "🤔 Thinking...");
    const responseText = await AI.getResponse(text, user.id, env);
    await TG.deleteMessage(user.id, thinkingMsg.result.message_id);
    await TG.sendMessage(user.id, responseText);
}

async function handleCommand(message, env) {
    const user = message.from;
    const text = message.text;
    if (text === '/start' || text === '/home') {
        await FSM.clearState(env.KV_STATE, user.id);
        const welcomeText = `🌟 <b>Welcome, ${user.first_name}!</b>\n\nI'm the <b>${CONFIG.BOT_NAME}</b>, your AI study partner.\n\nUse the menu or type a question!`;
        await TG.sendMessage(user.id, welcomeText, KEYBOARDS.mainMenu(user));
        await TG.sendMessage(user.id, "Your support keeps this project alive for all students!", KEYBOARDS.supportDev());
    } else if (text === '/cancel') {
        if (await FSM.getState(env.KV_STATE, user.id)) {
            await FSM.clearState(env.KV_STATE, user.id);
            await TG.sendMessage(user.id, "✅ Operation cancelled.", KEYBOARDS.mainMenu(user));
        } else {
            await TG.sendMessage(user.id, "There's nothing to cancel.");
        }
    }
}

async function handleCallbackQuery(callback, env) {
    const data = callback.data;
    const [action, ...params] = data.split(':');

    const handler = CALLBACK_HANDLERS[action];
    if (handler) {
        await TG.answerCallback(callback.id);
        await handler(callback, env, params);
    } else {
        await TG.answerCallback(callback.id, "Error: Unknown action.", true);
    }
}

// ===================== MENU & COMMAND HANDLERS =====================
async function menuAskAi(m_or_c, env) {
    const user_id = m_or_c.from.id;
    const { selected_ai } = await DB.getUserSettings(env.DB, user_id);
    const text = `💬 <b>AI Assistant</b> | Model: <b>${AVAILABLE_AIS[selected_ai].name}</b>\n<i>Type a question or switch models.</i>`;
    await TG.sendOrEdit(m_or_c, text, KEYBOARDS.aiMenu(selected_ai));
}
async function menuQuizzes(m_or_c, env) { await contentEntryPoint(m_or_c, env, 'quiz', '📋 Select a grade for quizzes:'); }
async function menuPdfLibrary(m_or_c, env) { await contentEntryPoint(m_or_c, env, 'pdf', '📚 Select a grade for PDFs:'); }
async function menuResults(m_or_c, env) { await TG.sendOrEdit(m_or_c, "🎓 <b>National Exam Results</b>\nOfficial websites:", KEYBOARDS.results()); }
async function menuLeaderboard(m_or_c, env) {
    const quizzes = await DB.getQuizzesWithLeaderboard(env.DB);
    if (!quizzes.length) {
        await TG.sendOrEdit(m_or_c, "🏆 <b>Leaderboard is empty.</b>", KEYBOARDS.nav('universal:main_menu'));
    } else {
        await TG.sendOrEdit(m_or_c, "🏆 Select a quiz to view the Top 10:", KEYBOARDS.leaderboardQuizzes(quizzes));
    }
}
async function menuSettings(m_or_c, env) { await TG.sendOrEdit(m_or_c, "⚙️ <b>Settings</b>", KEYBOARDS.settings()); }
async function cmdAdmin(m_or_c, env) {
    if(!CONFIG.ADMIN_IDS.includes(m_or_c.from.id)) return;
    await FSM.clearState(env.KV_STATE, m_or_c.from.id);
    await TG.sendOrEdit(m_or_c, "👑 <b>Admin Panel</b>", KEYBOARDS.adminPanel());
}

// ===================== FSM STATE HANDLERS =====================
const FSM_HANDLERS = {
    'add_subject_name': async (message, env, data) => {
        const name = message.text.trim();
        try {
            await DB.addSubject(env.DB, name);
            await TG.sendMessage(message.chat.id, `✅ Subject '<b>${name}</b>' has been permanently saved.`);
        } catch (e) {
            await TG.sendMessage(message.chat.id, `❌ Error: Subject '<b>${name}</b>' already exists in the database.`);
        }
        await FSM.clearState(env.KV_STATE, message.from.id);
        await cmdAdmin({ from: message.from, chat: { id: message.chat.id } }, env);
    },
    'add_quiz_name': async (message, env, data) => {
        data.name = message.text.trim();
        await FSM.setState(env.KV_STATE, message.from.id, 'add_quiz_content', data);
        await TG.sendMessage(message.chat.id, `<b>Add Quiz [5/5]</b>: Send the quiz as a .txt file or paste the text content.`);
    },
    'add_quiz_content': async (message, env, data) => {
        let content = '';
        if (message.text) { content = message.text; }
        else if (message.document && message.document.file_name.endsWith('.txt')) {
            const fileInfo = await TG.getFile(message.document.file_id);
            if (!fileInfo.ok) return TG.sendMessage(message.chat.id, "Error: Could not retrieve file information from Telegram.");
            content = await fetch(`https://api.telegram.org/file/bot${CONFIG.BOT_TOKEN}/${fileInfo.result.file_path}`).then(res => res.text());
        } else { return TG.sendMessage(message.chat.id, "Invalid format. Please send plain text or a .txt file."); }
        
        const questions = AI.parseQuizText(content);
        if (!questions.length) return await TG.sendMessage(message.chat.id, "Parsing failed. No valid questions found in the format provided. Please check the text and try again.");

        await DB.addQuizWithQuestions(env.DB, data, questions, message.from.id);
        await FSM.clearState(env.KV_STATE, message.from.id);
        await TG.sendMessage(message.chat.id, `✅ Quiz '<b>${data.name}</b>' with ${questions.length} questions added successfully!`);
        await cmdAdmin({ from: message.from, chat: { id: message.chat.id } }, env);
    },
    'add_pdf_category': async (message, env, data) => {
        data.category = message.text.trim();
        await FSM.setState(env.KV_STATE, message.from.id, 'add_pdf_file', data);
        await TG.sendMessage(message.chat.id, `<b>Add PDF [5/5]</b>: Now, send the PDF document.`);
    },
    'add_pdf_file': async (message, env, data) => {
        if (!message.document || !message.document.mime_type.includes('pdf')) return await TG.sendMessage(message.chat.id, "This is not a PDF file. Please send a valid PDF.");
        
        await DB.addPdf(env.DB, data, message.document);
        await FSM.clearState(env.KV_STATE, message.from.id);
        await TG.sendMessage(message.chat.id, `✅ PDF '<b>${message.document.file_name}</b>' has been added successfully.`);
        await cmdAdmin({ from: message.from, chat: { id: message.chat.id } }, env);
    },
    'broadcast_message': async (message, env, data) => {
        await FSM.clearState(env.KV_STATE, message.from.id);
        const text = message.text;
        if (!text) return TG.sendMessage(message.chat.id, "Broadcast cancelled: No message provided.");

        const users = await DB.getAllUsers(env.DB);
        let successCount = 0;
        await TG.sendMessage(message.chat.id, `📢 Starting broadcast to ${users.length} users...`);
        
        for (const user of users) {
            try {
                await TG.sendMessage(user.user_id, text);
                successCount++;
                await new Promise(r => setTimeout(r, 100)); // Rate limit
            } catch (e) { console.error(`Failed to send broadcast to ${user.user_id}:`, e); }
        }
        await TG.sendMessage(message.chat.id, `✅ Broadcast complete. Sent to ${successCount}/${users.length} users.`);
    }
};

// ===================== CALLBACK HANDLERS =====================
const CALLBACK_HANDLERS = {
    'universal': (cb, env, params) => {
        const action = params[0];
        if (action === 'main_menu') { 
            FSM.clearState(env.KV_STATE, cb.from.id);
            const welcomeText = `🌟 <b>Welcome, ${cb.from.first_name}!</b>\n\nI'm the <b>${CONFIG.BOT_NAME}</b>, your AI study partner.\n\nUse the menu or type a question!`;
            return TG.sendOrEdit(cb, welcomeText, KEYBOARDS.mainMenu(cb.from));
        }
    },
    'support_dev': (cb) => TG.answerCallback(cb.id, `Thank you for your support! 𓅓\nBot by BK.\nContact: ${CONFIG.ADMIN_USERNAME}`, true),
    'ai_select': async (cb, env, params) => { await DB.setSelectedAi(env.DB, cb.from.id, params[0]); await menuAskAi(cb, env); },
    'ai_toggle_search': (cb) => TG.answerCallback(cb.id, "This feature is planned for a future update!"),
    'settings:clear_ai': async (cb, env) => { await DB.clearHistory(env.DB, cb.from.id); await TG.answerCallback(cb.id, "✅ Your AI chat history has been cleared.", true); },

    'admin_panel': (cb, env) => cmdAdmin(cb, env),
    'admin': async (cb, env, params) => {
        const action = params[0];
        if (action === 'add_subject') {
            await FSM.setState(env.KV_STATE, cb.from.id, 'add_subject_name');
            await TG.editMessageText(cb.message, "Enter the name for the new subject:", KEYBOARDS.nav('admin_panel'));
        } else if (action === 'stats') {
            const stats = await DB.getStats(env.DB);
            const statsText = `📊 <b>Bot Statistics</b>\n\n- Total Users: ${stats.users}\n- Total Quizzes: ${stats.quizzes}\n- Total PDFs: ${stats.pdfs}\n- Total Leaderboard Entries: ${stats.leaderboard}`;
            await TG.editMessageText(cb.message, statsText, KEYBOARDS.nav('admin_panel'));
        } else if (action === 'broadcast') {
            await FSM.setState(env.KV_STATE, cb.from.id, 'broadcast_message');
            await TG.editMessageText(cb.message, "📢 Send the message you want to broadcast to all users.", KEYBOARDS.cancel('admin_panel'));
        }
    },
    'admin_content': async (cb, env, params) => {
        const [step, ...details] = params;
        let ctype, stateData = (await FSM.getState(env.KV_STATE, cb.from.id))?.data || {};

        switch (step) {
            case 'start':
                ctype = details[0];
                const subjects = await DB.getSubjects(env.DB);
                if (!subjects.length) return TG.answerCallback(cb.id, "Please add at least one subject first!", true);
                await TG.editMessageText(cb.message, `<b>Add ${ctype} [1/5]</b>: Select subject`, KEYBOARDS.subjectSelect(`admin_content:subj:${ctype}`, subjects, 'admin_panel'));
                break;
            case 'subj':
                [ctype, stateData.sid] = details; stateData.sid = parseInt(stateData.sid);
                await FSM.setState(env.KV_STATE, cb.from.id, null, stateData);
                await TG.editMessageText(cb.message, `<b>Add ${ctype} [2/5]</b>: Select grade`, KEYBOARDS.gradeSelect(`admin_content:grade:${ctype}`, 'admin_content:start:'+ctype));
                break;
            case 'grade':
                [ctype, stateData.grade] = details;
                await FSM.setState(env.KV_STATE, cb.from.id, null, stateData);
                if (['11', '12'].includes(stateData.grade)) {
                    await TG.editMessageText(cb.message, `<b>Add ${ctype} [3/5]</b>: Select stream`, KEYBOARDS.streamSelect(`admin_content:stream:${ctype}`, `admin_content:subj:${ctype}:${stateData.sid}`));
                } else {
                    stateData.stream = null;
                    const nextState = ctype === 'quiz' ? 'add_quiz_name' : 'add_pdf_category';
                    await FSM.setState(env.KV_STATE, cb.from.id, nextState, stateData);
                    await TG.editMessageText(cb.message, `<b>Add ${ctype} [4/5]</b>: Enter ${ctype === 'quiz' ? 'a name for the quiz' : 'a category for the PDF'}:`, KEYBOARDS.cancel(`admin_content:grade:${ctype}`));
                }
                break;
            case 'stream':
                [ctype, stateData.stream] = details;
                const nextState = ctype === 'quiz' ? 'add_quiz_name' : 'add_pdf_category';
                await FSM.setState(env.KV_STATE, cb.from.id, nextState, stateData);
                await TG.editMessageText(cb.message, `<b>Add ${ctype} [4/5]</b>: Enter ${ctype === 'quiz' ? 'a name for the quiz' : 'a category for the PDF'}:`, KEYBOARDS.cancel(`admin_content:grade:${ctype}`));
                break;
        }
    },

    'quiz_grade': async (cb, env, params) => {
        const grade = params[0];
        const subjects = await DB.getSubjects(env.DB);
        await TG.editMessageText(cb.message, `📋 Quizzes > Grade ${grade}\n\nSelect a subject:`, KEYBOARDS.subjectSelect(`quiz_subj:${grade}`, subjects, 'universal:main_menu'));
    },
    'quiz_subj': async (cb, env, params) => {
        const [grade, sid] = params;
        const quizzes = await DB.getQuizzes(env.DB, grade, sid);
        if(!quizzes.length) return TG.editMessageText(cb.message, "No quizzes found for this selection.", KEYBOARDS.nav('quiz_grade', [grade]));
        await TG.editMessageText(cb.message, "Select a quiz to start:", KEYBOARDS.quizSelect(quizzes, `quiz_grade:${grade}`));
    },
    'quiz_start': async (cb, env, params) => {
        const quizId = params[0];
        const questions = await DB.getQuizQuestions(env.DB, quizId);
        if(!questions.length) return TG.answerCallback(cb.id, "This quiz has no questions!", true);
        const quizState = { quizId, currentQ: 0, score: 0, questions };
        await FSM.setState(env.KV_STATE, cb.from.id, 'take_quiz', quizState);
        await sendQuestion(cb, env, quizState);
    },
    'quiz_ans': async (cb, env, params) => {
        const [quizId, qIndex, selectedOpt] = params;
        const state = await FSM.getState(env.KV_STATE, cb.from.id);
        if (!state || state.name !== 'take_quiz' || state.data.quizId != quizId) return TG.answerCallback(cb.id, "Quiz session expired or invalid. Please start again.", true);
        
        const question = state.data.questions[qIndex];
        const isCorrect = question.correct_option === selectedOpt;
        if (isCorrect) state.data.score++;

        await TG.answerCallback(cb.id, isCorrect ? "✅ Correct!" : `❌ Wrong! Correct was ${question.correct_option}.`);
        
        state.data.currentQ++;
        if (state.data.currentQ < state.data.questions.length) {
            await FSM.setState(env.KV_STATE, cb.from.id, 'take_quiz', state.data);
            await sendQuestion(cb, env, state.data);
        } else {
            await FSM.clearState(env.KV_STATE, cb.from.id);
            const total = state.data.questions.length;
            const score = state.data.score;
            await DB.recordScore(env.DB, cb.from.id, quizId, score);
            const quiz = await DB.getQuizById(env.DB, quizId);
            const resultText = `🎉 <b>Quiz Finished!</b>\n\n<b>${quiz.name}</b>\nYour Score: <b>${score}/${total}</b> (${Math.round(score/total*100)}%)`;
            await TG.editMessageText(cb.message, resultText, KEYBOARDS.nav('universal:main_menu'));
        }
    },

    'pdf_grade': async (cb, env, params) => {
        const grade = params[0];
        const subjects = await DB.getSubjects(env.DB);
        await TG.editMessageText(cb.message, `📚 PDFs > Grade ${grade}\n\nSelect a subject:`, KEYBOARDS.subjectSelect(`pdf_subj:${grade}`, subjects, 'universal:main_menu'));
    },
    'pdf_subj': async (cb, env, params) => {
        const [grade, sid] = params;
        const pdfs = await DB.getPdfs(env.DB, grade, sid);
        if(!pdfs.length) return TG.editMessageText(cb.message, "No PDFs found for this selection.", KEYBOARDS.nav('pdf_grade', [grade]));
        await TG.editMessageText(cb.message, "Select a category:", KEYBOARDS.pdfCategorySelect(pdfs, `pdf_grade:${grade}`));
    },
    'pdf_cat': async (cb, env, params) => {
        const [grade, sid, category] = params;
        const pdfs = await DB.getPdfs(env.DB, grade, sid, category);
        await TG.editMessageText(cb.message, `Category: ${category}\n\nSelect a PDF to download:`, KEYBOARDS.pdfFileSelect(pdfs, `pdf_subj:${grade}:${sid}`));
    },
    'pdf_get': async (cb, env, params) => {
        const pdfId = params[0];
        const file = await DB.getPdfFileId(env.DB, pdfId);
        if(file) {
            await TG.sendDocument(cb.from.id, file.file_id, { caption: file.file_name });
        } else {
            await TG.answerCallback(cb.id, "Sorry, this file could not be found.", true);
        }
    },
    'ldb': async (cb, env, params) => {
        const quizId = params[0];
        const leaderboard = await DB.getLeaderboard(env.DB, quizId);
        const quiz = await DB.getQuizById(env.DB, quizId);

        let text = `🏆 <b>Leaderboard: ${quiz.name}</b>\n\n`;
        if (!leaderboard.length) {
            text += "<i>No one has completed this quiz yet.</i>";
        } else {
            leaderboard.forEach((entry, i) => {
                const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
                text += `${medal} <b>${entry.first_name || 'User ' + entry.user_id}</b> - ${entry.score} points\n`;
            });
        }
        await TG.editMessageText(cb.message, text, KEYBOARDS.nav('universal:main_menu'));
    }
};

async function contentEntryPoint(m_or_c, env, type, text) {
     await TG.sendOrEdit(m_or_c, text, KEYBOARDS.gradeSelect(`${type}_grade`, 'universal:main_menu'));
}

async function sendQuestion(cb, env, state) {
    const qIndex = state.currentQ;
    const question = state.questions[qIndex];
    const text = `<b>Question ${qIndex + 1}/${state.questions.length}</b>\n\n${question.question_text}`;
    await TG.sendOrEdit(cb, text, KEYBOARDS.quizOptions(state.quizId, qIndex, question));
}

// ===================== AI LOGIC =====================
const AI = {
    async getResponse(prompt, userId, env) {
        const { selected_ai, chat_history } = await DB.getUserSettings(env.DB, userId);
        const config = AVAILABLE_AIS[selected_ai];
        const formattedHist = chat_history.map(m => `${m.role === 'user' ? 'You' : 'AI'}: ${m.parts[0].text}`).join('\n');
        
        const final_prompt = `You are a helpful AI assistant for Ethiopian students. Be friendly and clear.\nConversation so far:\n<history>\n${formattedHist||'No history.'}\n</history>\nUser asks: "${prompt}"\nINSTRUCTION: Directly start your answer with a short, clear title.`;

        let raw_text = `Sorry, ${config.name} is currently unavailable.`;
        try {
            let apiUrl, payload, headers = {'Content-Type': 'application/json'};
            let key;

            if (config.provider === 'gemini') {
                key = CONFIG.GEMINI_API_KEY;
                apiUrl = `https://generativelace.googleapis.com/v1beta/models/${config.model_id}:generateContent?key=${key}`;
                payload = { "contents": [{ "parts": [{ "text": final_prompt }] }] };
            } else if (config.provider === 'openrouter') {
                key = CONFIG.OPENROUTER_API_KEY;
                apiUrl = "https://openrouter.ai/api/v1/chat/completions";
                headers["Authorization"] = `Bearer ${key}`;
                payload = { "model": config.model_id, "messages": [{ "role": "user", "content": final_prompt }] };
            } else { // fireworks
                key = CONFIG.FIREWORKS_API_KEY;
                apiUrl = "https://api.fireworks.ai/inference/v1/completions";
                headers["Authorization"] = `Bearer ${key}`;
                payload = { "model": config.model_id, "prompt": final_prompt, "max_tokens": 1024, "temperature": 0.7 };
            }

            const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
            const data = await response.json();
            
            if (response.ok) {
                if (config.provider === 'gemini') raw_text = data.candidates[0].content.parts[0].text;
                else if (config.provider === 'openrouter') raw_text = data.choices[0].message.content;
                else raw_text = data.choices[0].text;
                
                chat_history.push({ role: 'user', parts: [{ text: prompt }]});
                chat_history.push({ role: 'model', parts: [{ text: raw_text }]});
                await DB.saveHistory(env.DB, userId, chat_history);
            } else {
                 console.error("AI API Error:", data);
            }
        } catch (e) { console.error("AI Fetch Error:", e); }

        const timeHeader = new Date().toLocaleString('en-US', { timeZone: CONFIG.ETHIOPIA_TZ, dateStyle: 'medium', timeStyle: 'short' }).replace(', ', ' | ');
        return `🗓️ ${timeHeader}\n\n${this.postFormat(raw_text)}${CONFIG.BOT_DEVELOPER_SIGNATURE}`;
    },
    postFormat: (text) => {
        if(!text) return "";
        let lines = text.trim().split('\n');
        lines[0] = `<b>${lines[0]}</b>`;
        return lines.map(line => line.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/_(.*?)_/g, '<i>$1</i>').replace(/^\* /, '• ')).join('\n');
    },
    parseQuizText: (content) => {
        const questions = [];
        const questionBlocks = content.split('---').map(b => b.trim()).filter(Boolean);
        for (const block of questionBlocks) {
            const lines = block.split('\n').map(l => l.trim());
            const qLine = lines.find(l => l.match(/^Q\d*:/));
            if (!qLine) continue;

            const question = {
                question: qLine.substring(qLine.indexOf(':') + 1).trim(),
                options: {},
                correct: '',
                explanation: ''
            };
            
            lines.forEach(line => {
                if (line.match(/^[A-D]\)/)) {
                    const optionKey = line.charAt(0);
                    question.options[optionKey] = line.substring(2).trim();
                } else if (line.toLowerCase().startsWith('correct:')) {
                    question.correct = line.substring(line.indexOf(':') + 1).trim().toUpperCase();
                } else if (line.toLowerCase().startsWith('explanation:')) {
                    question.explanation = line.substring(line.indexOf(':') + 1).trim();
                }
            });
            
            if(question.question && question.correct && Object.keys(question.options).length === 4) {
                questions.push(question);
            }
        }
        return questions;
    }
};

// ===================== DATABASE (D1) FUNCTIONS =====================
const DB = {
    updateUser: async (db, user) => {
        const isAdmin = CONFIG.ADMIN_IDS.includes(user.id) ? 1 : 0;
        await db.prepare(`INSERT INTO users (user_id, username, first_name, is_admin) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, is_admin=excluded.is_admin`)
            .bind(user.id, user.username, user.first_name, isAdmin).run();
        await db.prepare(`INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`).bind(user.id).run();
    },
    getAllUsers: async (db) => (await db.prepare("SELECT user_id FROM users").all()).results,
    getUserSettings: async (db, userId) => {
        let settings = await db.prepare("SELECT selected_ai, chat_history FROM user_settings WHERE user_id = ?").bind(userId).first();
        if(!settings) return {selected_ai: 'gemini', chat_history: []};
        try { settings.chat_history = JSON.parse(settings.chat_history || '[]'); } catch { settings.chat_history = []; }
        return settings;
    },
    saveHistory: async (db, userId, history) => db.prepare("UPDATE user_settings SET chat_history = ? WHERE user_id = ?").bind(JSON.stringify(history.slice(-12)), userId).run(),
    clearHistory: async (db, userId) => db.prepare("UPDATE user_settings SET chat_history = '[]' WHERE user_id = ?").bind(userId).run(),
    setSelectedAi: async (db, userId, aiId) => db.prepare("UPDATE user_settings SET selected_ai = ? WHERE user_id = ?").bind(aiId, userId).run(),
    getStats: async (db) => {
        const results = await db.batch([
            db.prepare("SELECT COUNT(*) as count FROM users"),
            db.prepare("SELECT COUNT(*) as count FROM quizzes"),
            db.prepare("SELECT COUNT(*) as count FROM pdfs"),
            db.prepare("SELECT COUNT(*) as count FROM leaderboard"),
        ]);
        return { users: results[0].results[0].count, quizzes: results[1].results[0].count, pdfs: results[2].results[0].count, leaderboard: results[3].results[0].count };
    },
    addSubject: async (db, name) => db.prepare("INSERT INTO subjects (name) VALUES (?)").bind(name).run(),
    getSubjects: async (db) => (await db.prepare("SELECT * FROM subjects ORDER BY name").all()).results,
    addQuizWithQuestions: async (db, data, questions, created_by) => {
        const { lastRowId } = await db.prepare("INSERT INTO quizzes (name, subject_id, grade, stream, created_by) VALUES (?, ?, ?, ?, ?) RETURNING quiz_id").bind(data.name, data.sid, data.grade, data.stream, created_by).first();
        const stmts = questions.map(q => db.prepare("INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(lastRowId, q.question, q.options.A, q.options.B, q.options.C, q.options.D, q.correct, q.explanation));
        await db.batch(stmts);
    },
    getQuizzes: async(db, grade, subject_id) => (await db.prepare("SELECT quiz_id, name FROM quizzes WHERE grade = ? AND subject_id = ?").bind(grade, subject_id).all()).results,
    getQuizById: async(db, quiz_id) => db.prepare("SELECT * FROM quizzes WHERE quiz_id = ?").bind(quiz_id).first(),
    getQuizQuestions: async(db, quiz_id) => (await db.prepare("SELECT * FROM questions WHERE quiz_id = ?").bind(quiz_id).all()).results,
    addPdf: async (db, data, doc) => db.prepare("INSERT INTO pdfs (file_name, subject_id, grade, stream, category, file_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(doc.file_name, data.sid, data.grade, data.stream, data.category, doc.file_id).run(),
    getPdfs: async(db, grade, subject_id, category) => {
      let query = "SELECT pdf_id, file_name, category, subject_id, grade FROM pdfs WHERE grade = ? AND subject_id = ?";
      const params = [grade, subject_id];
      if (category) {
        query += " AND category = ?";
        params.push(category);
      }
      return (await db.prepare(query).bind(...params).all()).results;
    },
    getPdfFileId: async (db, pdf_id) => db.prepare("SELECT file_id, file_name FROM pdfs WHERE pdf_id = ?").bind(pdf_id).first(),
    getQuizzesWithLeaderboard: async (db) => (await db.prepare("SELECT DISTINCT q.quiz_id, q.name FROM quizzes q JOIN leaderboard l ON q.quiz_id = l.quiz_id ORDER BY q.name").all()).results,
    recordScore: async (db, user_id, quiz_id, score) => db.prepare("INSERT INTO leaderboard (user_id, quiz_id, score) VALUES (?, ?, ?)").bind(user_id, quiz_id, score).run(),
    getLeaderboard: async(db, quiz_id) => (await db.prepare("SELECT l.score, u.first_name, u.user_id FROM leaderboard l JOIN users u ON l.user_id = u.user_id WHERE l.quiz_id = ? ORDER BY l.score DESC, l.completed_at ASC LIMIT 10").bind(quiz_id).all()).results,
};

// ===================== STATE MANAGEMENT (KV) FUNCTIONS =====================
const FSM = {
    setState: async (kv, userId, name, data = {}) => kv.put(`state:${userId}`, JSON.stringify({ name, data }), { expirationTtl: 3600 }),
    getState: async (kv, userId) => JSON.parse(await kv.get(`state:${userId}`)),
    clearState: async (kv, userId) => kv.delete(`state:${userId}`),
};

// ===================== KEYBOARDS =====================
const KEYBOARDS = {
    mainMenu: (user) => ({ keyboard: [[{ text: "💬 Ask AI" }, { text: "📋 Quizzes" }, { text: "📚 PDF Library" }], [{ text: "🏆 Leaderboard" }, { text: "🎓 Check Results" }, { text: "⚙️ Settings" }]].concat(CONFIG.ADMIN_IDS.includes(user.id) ? [[{ text: "👑 Admin Panel" }]] : []), resize_keyboard: true, input_field_placeholder: "Choose an option..." }),
    supportDev: () => ({ inline_keyboard: [[{ text: "☕ Support the Developer", callback_data: "support_dev" }]] }),
    nav: (cb_data, params = []) => ({ inline_keyboard: [ [{ text: "⬅️ Back", callback_data: `${cb_data}${params.length ? ':'+params.join(':') : ''}` }, { text: "🏠 Menu", callback_data: "universal:main_menu" }] ] }),
    cancel: (cb_data, params = []) => ({ inline_keyboard: [ [{ text: "❌ Cancel", callback_data: `${cb_data}${params.length ? ':'+params.join(':') : ''}` }] ] }),
    adminPanel: () => ({ inline_keyboard: [[{ text: "➕ Add Subject", callback_data: "admin:add_subject" }, { text: "📝 Add Quiz", callback_data: "admin_content:start:quiz" }], [{ text: "📄 Add PDF", callback_data: "admin_content:start:pdf" }], [{ text: "📊 Statistics", callback_data: "admin:stats" }, { text: "📢 Broadcast", callback_data: "admin:broadcast" }]] }),
    aiMenu: (currentAi) => {
        const buttons = Object.entries(AVAILABLE_AIS).map(([key, { name }]) => ({ text: key === currentAi ? `» ${name} «` : name, callback_data: `ai_select:${key}` }));
        return { inline_keyboard: [ ...buttons.map(b => [b]), [{ text: "🌐 Toggle Search", callback_data: "ai_toggle_search" }], ...KEYBOARDS.nav('universal:main_menu').inline_keyboard]};
    },
    results: () => ({ inline_keyboard: [[{ text: "🌐 Grade 12", url: "https://neaea.gov.et/" }, { text: "🌐 Grade 8", url: "http://result.neaea.gov.et/" }], ...KEYBOARDS.nav('universal:main_menu').inline_keyboard] }),
    settings: () => ({ inline_keyboard: [[{ text: "🧹 Clear AI History", callback_data: "settings:clear_ai" }], ...KEYBOARDS.nav('universal:main_menu').inline_keyboard]}),
    gradeSelect: (cb_prefix, back_cb) => ({ inline_keyboard: [...[['7', '8', '9'].map(g=>({text:`Grade ${g}`,callback_data:`${cb_prefix}:${g}`})),['10', '11'].map(g=>({text:`Grade ${g}`,callback_data:`${cb_prefix}:${g}`})),['12','Entrance Exam'].map(g=>({text: g==='12'? `Grade ${g}`:g,callback_data:`${cb_prefix}:${g}`}))], ...KEYBOARDS.nav(back_cb).inline_keyboard] }),
    streamSelect: (cb_prefix, back_cb) => ({ inline_keyboard: [[{ text: "🌿 Natural", callback_data: `${cb_prefix}:Natural` }, { text: "📚 Social", callback_data: `${cb_prefix}:Social` }], ...KEYBOARDS.nav(back_cb).inline_keyboard]}),
    subjectSelect: (cb_prefix, subjects, back_cb) => {
        const buttons = subjects.map(s => ({ text: s.name, callback_data: `${cb_prefix}:${s.subject_id}` }));
        const keyboard = []; for(let i = 0; i < buttons.length; i+=2) { keyboard.push(buttons.slice(i, i+2)); }
        return { inline_keyboard: [...keyboard, ...KEYBOARDS.nav(back_cb).inline_keyboard] };
    },
    quizSelect: (quizzes, back_cb) => ({ inline_keyboard: [ ...quizzes.map(q => [{ text: `📝 ${q.name}`, callback_data: `quiz_start:${q.quiz_id}` }]), ...KEYBOARDS.nav(back_cb).inline_keyboard ]}),
    quizOptions: (quizId, qIndex, question) => {
        const options = ['A', 'B', 'C', 'D'];
        const buttons = options.map(opt => ({ text: `${opt}) ${question['option_'+opt.toLowerCase()]}`, callback_data: `quiz_ans:${quizId}:${qIndex}:${opt}`}));
        return { inline_keyboard: [[buttons[0]], [buttons[1]], [buttons[2]], [buttons[3]]] };
    },
    pdfCategorySelect: (pdfs, back_cb) => {
        const categories = [...new Set(pdfs.map(p => p.category))];
        const buttons = categories.map(c => ({ text: `📁 ${c}`, callback_data: `pdf_cat:${pdfs[0].grade}:${pdfs[0].subject_id}:${c}`}));
        return { inline_keyboard: [...buttons.map(b => [b]), ...KEYBOARDS.nav(back_cb).inline_keyboard] };
    },
    pdfFileSelect: (pdfs, back_cb) => ({ inline_keyboard: [ ...pdfs.map(p => [{ text: `📄 ${p.file_name}`, callback_data: `pdf_get:${p.pdf_id}` }]), ...KEYBOARDS.nav(back_cb).inline_keyboard ]}),
    leaderboardQuizzes: (quizzes) => ({ inline_keyboard: [ ...quizzes.map(q => [{ text: `📝 ${q.name}`, callback_data: `ldb:${q.quiz_id}` }]), ...KEYBOARDS.nav('universal:main_menu').inline_keyboard ]}),
};

// ===================== TELEGRAM API HELPERS =====================
const TG = {
    apiRequest: (method, payload) => fetch(`https://api.telegram.org/bot${CONFIG.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(res => res.json()),
    sendMessage: (chat_id, text, reply_markup) => TG.apiRequest('sendMessage', { chat_id, text, parse_mode: 'HTML', reply_markup }),
    editMessageText: (message, text, reply_markup) => TG.apiRequest('editMessageText', { chat_id: message.chat.id, message_id: message.message_id, text, parse_mode: 'HTML', reply_markup }),
    deleteMessage: (chat_id, message_id) => TG.apiRequest('deleteMessage', { chat_id, message_id }),
    answerCallback: (id, text = '', alert = false) => TG.apiRequest('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }),
    getFile: (file_id) => TG.apiRequest('getFile', { file_id }),
    sendDocument: (chat_id, file_id, T) => TG.apiRequest('sendDocument', { chat_id, document: file_id, ...T }),
    sendOrEdit: (m_or_c, text, markup) => m_or_c.message ? TG.editMessageText(m_or_c.message, text, markup) : TG.sendMessage(m_or_c.chat.id, text, markup),
};
