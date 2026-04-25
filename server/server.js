require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();
const PORT = process.env.PORT || 3001;

// Resend client — initialized only when API key is available (used for OTP emails)
let resend = null;
if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
}

// ---------------------------------------------------------------------------
// OTP store — in-memory, single-use, 10-minute TTL
// Map<email, { code, expiresAt, fullName }>
// ---------------------------------------------------------------------------
const otpStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [email, data] of otpStore.entries()) {
    if (data.expiresAt < now) otpStore.delete(email);
  }
}, 15 * 60 * 1000);

// ---------------------------------------------------------------------------
// AI Learning Support — SQL Syntax Tutor (Claude Haiku)
// ---------------------------------------------------------------------------
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SQL_TUTOR_SYSTEM_PROMPT = `You are a SQL syntax assistant for learners practising SQL on GlobalMart's database.

ALLOWED — you do these:
- Fix SQL syntax errors (missing commas, wrong keywords, bad JOIN syntax, wrong clause order)
- Name the syntax rule that was broken (e.g. "GROUP BY must come before ORDER BY")
- Show a corrected SQL snippet (short, focused on the broken part)
- Answer "what is the syntax for X?" with a brief SQL example
- Explain what a Postgres error message means in plain English (syntax only, not logic)
- Remind learners of SQL clause order: SELECT → FROM → JOIN → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT

FORBIDDEN — you never do these:
- Tell the learner WHICH tables to join or query to answer a business question
- Suggest what the query logic should be (e.g. "you should filter by region")
- Write a complete working query that solves the learner's problem
- Explain WHY an approach or strategy is better than another
- Interpret or explain what the result data means

If the learner asks for anything forbidden, reply ONLY with:
"I can help with SQL syntax — figuring out what to query is your job. What specific syntax are you stuck on?"

Keep every response under 5 sentences. Always show SQL snippets inline, not explanations.`;

const SQL_REASONING_PATTERNS = [
  /\bhow\s+(do|should|would|can)\s+i\s+(solve|approach|answer|find|get|write|build|create)\b/i,
  /\b(write|build|create|give me)\s+(a|the|my|an)\s+(query|sql|select)\b/i,
  /\bwhat\s+(query|sql)\s+(should|do|would|will)\b/i,
  /\b(solve|complete|answer)\s+(this|the)\s+(question|problem|challenge|exercise)\b/i,
  /\bwhat\s+(approach|strategy|method)\s+(should|to)\b/i,
  /\bis\s+(my|this)\s+(query|logic|approach|solution)\s+(correct|right|good)\b/i,
  /\bstep\s+by\s+step\b/i,
];

const SQL_LEAKAGE_PHRASES = [
  'the approach here is',
  'you should join',
  'you need to join',
  'to answer this question',
  'to solve this',
  'the logic here',
  'the strategy is',
  'here\'s a complete query',
  'here\'s the full query',
  'step 1',
  'step 2',
  'first, you need to',
];

const DEFLECTION = "I can help with SQL syntax — figuring out what to query is your job. What specific syntax are you stuck on?";

function isForbiddenRequest(text) {
  return SQL_REASONING_PATTERNS.some(p => p.test(text));
}

function hasLeakage(text) {
  const lower = text.toLowerCase();
  return SQL_LEAKAGE_PHRASES.some(phrase => lower.includes(phrase));
}

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});

// Supabase connection for user management and learner tracking

const supabasePool = new Pool({
  host: process.env.SUPABASE_HOST,
  port: process.env.SUPABASE_PORT || 5432,
  database: process.env.SUPABASE_DB,
  user: process.env.SUPABASE_USER,
  password: process.env.SUPABASE_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err);
  } else {
    console.log('Connected to PostgreSQL database');
    release();
  }
});

// Test Supabase connection
app.get('/api/test-supabase', async (req, res) => {
  try {
    const result = await supabasePool.query('SELECT NOW()');
    res.json({ 
      success: true, 
      message: 'Supabase connection working!',
      time: result.rows[0].now
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://enqurious-code-arena.netlify.app'
  ],
  credentials: true
}));
app.use(express.json());

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend server is working with PostgreSQL!' });
});

// Database tables endpoint
app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name as name 
      FROM information_schema.tables 
      WHERE table_schema = 'dbo' 
      ORDER BY table_name
    `);
    res.json({ tables: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute SQL query endpoint  
app.post('/api/query', async (req, res) => {
  const { sql } = req.body;
  
  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // Only allow SELECT queries for safety
  if (!sql.trim().toLowerCase().startsWith('select')) {
    return res.status(400).json({ error: 'Only SELECT queries are allowed' });
  }

  try {
    const result = await pool.query(sql);
    res.json({ 
      success: true, 
      data: result.rows,
      rowCount: result.rowCount 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get table schema endpoint - ADD THIS NEW ENDPOINT
app.get('/api/schema/:tableName', async (req, res) => {
  const { tableName } = req.params;
  
  try {
    // Get column information
    const columnsResult = await pool.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = $1 
      AND table_schema = 'dbo'
      ORDER BY ordinal_position
    `, [tableName]);

    // Get primary key information
    const primaryKeysResult = await pool.query(`
      SELECT column_name
      FROM information_schema.key_column_usage
      WHERE table_name = $1 
      AND table_schema = 'dbo'
      AND constraint_name IN (
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = $1 
        AND table_schema = 'dbo'
        AND constraint_type = 'PRIMARY KEY'
      )
    `, [tableName]);

    const primaryKeys = primaryKeysResult.rows.map(row => row.column_name);
    
    const columns = columnsResult.rows.map(col => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      default: col.column_default,
      isPrimaryKey: primaryKeys.includes(col.column_name)
    }));

    res.json({ 
      success: true, 
      tableName,
      columns 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple email login — no password, no OTP
app.post('/api/email-login', async (req, res) => {
  const { email, fullName } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!email || !emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const existing = await supabasePool.query(
      'SELECT id, login_id, email, full_name FROM sql_playground.users WHERE email = $1',
      [email.trim()]
    );

    if (existing.rows.length > 0) {
      return res.json({ success: true, user: existing.rows[0] });
    }

    // New user — require a name before creating
    if (!fullName || !fullName.trim()) {
      return res.json({ needsName: true });
    }

    const created = await supabasePool.query(
      'INSERT INTO sql_playground.users (login_id, email, password, full_name) VALUES ($1, $2, $3, $4) RETURNING id, login_id, email, full_name',
      [email.trim(), email.trim(), '', fullName.trim()]
    );
    res.json({ success: true, user: created.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send OTP endpoint
app.post('/api/send-otp', async (req, res) => {
  const { email, fullName } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // Check if user already exists
  const existing = await supabasePool.query(
    'SELECT id FROM sql_playground.users WHERE email = $1', [email]
  );
  const isNewUser = existing.rows.length === 0;

  if (isNewUser && !fullName?.trim()) {
    return res.status(400).json({ error: 'Full name is required for new accounts.', needsName: true });
  }

  // Generate 6-digit OTP
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000, fullName: fullName?.trim() });

  try {
    const { error: sendError } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Enqurious SQL Arena <noreply@enqurious.com>',
      to: email,
      subject: `${code} is your SQL Arena login code`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8f9fa;border-radius:12px;">
          <h2 style="color:#333;margin:0 0 8px 0;">Enqurious SQL Arena</h2>
          <p style="color:#666;margin:0 0 28px 0;font-size:14px;">Your one-time login code</p>
          <div style="background:#fff;border-radius:8px;padding:28px;text-align:center;border:1px solid #e9ecef;">
            <div style="font-size:42px;font-weight:700;letter-spacing:10px;color:#007bff;font-family:monospace;">${code}</div>
            <p style="color:#888;font-size:13px;margin:16px 0 0 0;">Expires in 10 minutes. Do not share this code.</p>
          </div>
          <p style="color:#aaa;font-size:12px;margin:20px 0 0 0;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `
    });
    if (sendError) throw new Error(sendError.message);
    res.json({ success: true, isNewUser });
  } catch (err) {
    console.error('Email send error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

// Verify OTP endpoint
app.post('/api/verify-otp', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required.' });
  }

  const stored = otpStore.get(email);
  if (!stored) {
    return res.status(400).json({ error: 'No code found for this email. Please request a new one.' });
  }
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(email);
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }
  if (stored.code !== code.trim()) {
    return res.status(400).json({ error: 'Incorrect code. Please try again.' });
  }

  // Single-use — delete immediately after match
  otpStore.delete(email);

  try {
    // Get or create user
    const existingUser = await supabasePool.query(
      'SELECT id, login_id, email, full_name FROM sql_playground.users WHERE email = $1', [email]
    );

    let user;
    if (existingUser.rows.length > 0) {
      user = existingUser.rows[0];
    } else {
      const created = await supabasePool.query(
        'INSERT INTO sql_playground.users (login_id, email, password, full_name) VALUES ($1, $2, $3, $4) RETURNING id, login_id, email, full_name',
        [email, email, '', stored.fullName || '']
      );
      user = created.rows[0];
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User registration endpoint - UPDATED for email-only signup
app.post('/api/signup', async (req, res) => {
  const { email, password, fullName } = req.body;
  
  try {
    // Check if email already exists
    const existingUser = await supabasePool.query(
      'SELECT email FROM sql_playground.users WHERE email = $1', 
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email address already exists' });
    }
    
    // Validate email format (server-side validation)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Generate login_id from email (use full email)
    const loginId = email;
    
    // Create new user with email as login_id
    const result = await supabasePool.query(
      'INSERT INTO sql_playground.users (login_id, email, password, full_name) VALUES ($1, $2, $3, $4) RETURNING id, login_id, email, full_name',
      [loginId, email, password, fullName]
    );
    
    res.json({ 
      success: true, 
      message: 'User created successfully',
      user: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User login endpoint - UPDATED for email-based login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const result = await supabasePool.query(
      'SELECT id, login_id, email, full_name FROM sql_playground.users WHERE email = $1 AND password = $2',
      [email, password]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    res.json({ 
      success: true, 
      message: 'Login successful',
      user: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activity logging endpoint - UPDATED to work with email-based users
app.post('/api/log-activity', async (req, res) => {
  const { loginId, sqlQuery, executionResult, success } = req.body;
  
  try {
    // loginId could be email now, so we handle both cases
    const result = await supabasePool.query(
      'INSERT INTO sql_playground.learner_activity (login_id, sql_query, execution_result, success) VALUES ($1, $2, $3, $4) RETURNING *',
      [loginId, sqlQuery, JSON.stringify(executionResult), success]
    );
    
    res.json({ 
      success: true, 
      message: 'Activity logged successfully',
      activity: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI learning support endpoint
app.post('/api/ai-help', async (req, res) => {
  const { message, currentQuery, queryError, history = [] } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (isForbiddenRequest(message)) {
    return res.json({ reply: DEFLECTION });
  }

  // Build context-aware user message
  let contextualMessage = message;
  if (currentQuery && currentQuery.trim()) {
    contextualMessage = `[SQL in editor]:\n\`\`\`sql\n${currentQuery.trim()}\n\`\`\`\n\n[Question]: ${message}`;
  }
  if (queryError) {
    contextualMessage += `\n[Last error]: ${queryError}`;
  }

  // Build conversation history (last 6 messages = 3 turns)
  const recentHistory = history.slice(-6).map(m => ({
    role: m.role,
    content: m.content
  }));

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      temperature: 0,
      system: SQL_TUTOR_SYSTEM_PROMPT,
      messages: [...recentHistory, { role: 'user', content: contextualMessage }]
    });

    const reply = response.content[0].text;

    if (hasLeakage(reply)) {
      return res.json({ reply: DEFLECTION });
    }

    res.json({ reply });
  } catch (err) {
    console.error('AI help error:', err.message);
    res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});