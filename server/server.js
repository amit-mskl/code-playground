require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

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