import './App.css';
import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Auth } from './components/Auth';
import Markdown from 'react-markdown';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function App() {
  // Authentication state
  const [user, setUser] = useState(null);
  
  // SQL Editor state
  const [query, setQuery] = useState('SELECT * FROM dbo.ex_customers LIMIT 10;');
  const [results, setResults] = useState('No query executed yet');
  const [availableTables, setAvailableTables] = useState([]);
  const [expandedTables, setExpandedTables] = useState({});
  const [tableSchemas, setTableSchemas] = useState({});

  // AI chat state
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: "Hi! I'm your SQL syntax tutor.\n\nI can help you fix syntax errors, explain SQL clause order, and show correct SQL patterns — but the query logic is yours to figure out.\n\nWhat syntax are you stuck on?" }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const chatBottomRef = useRef(null);
  const internalClipboardRef = useRef('');

  // Track text copied from within this tab so paste can be allowed selectively
  useEffect(() => {
    const handleCopy = () => {
      const text = window.getSelection()?.toString() || '';
      if (text) internalClipboardRef.current = text;
    };
    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, []);

  // Check for stored user session on component mount
  useEffect(() => {
    const storedUser = localStorage.getItem('sqlArenaUser');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Fetch available tables when user is logged in
  useEffect(() => {
    if (user) {
      fetch(`${API}/api/tables`)
        .then(res => res.json())
        .then(data => setAvailableTables(data.tables || []))
        .catch(err => console.error('Error fetching tables:', err));
    }
  }, [user]);

// Enhanced activity logging function
const logActivity = async (activityType, sqlQuery = null, executionResult = null, success = true, customLoginId = null) => {
  try {
    // Use email as loginId for new users, fallback to login_id for existing users
    const loginId = customLoginId || (user ? (user.email || user.login_id) : null);
    
    if (!loginId) {
      console.error('No login ID available for activity logging');
      return;
    }

    const activityData = {
      loginId: loginId,
      sqlQuery: sqlQuery || `[${activityType.toUpperCase()}]`,
      executionResult: executionResult || { 
        activityType: activityType,
        timestamp: new Date().toISOString(),
        success: success 
      },
      success: success
    };

    await fetch(`${API}/api/log-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activityData)
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
};

// Enhanced authentication handlers with logging
const handleLogin = async (userData) => {
  setUser(userData);
  localStorage.setItem('sqlArenaUser', JSON.stringify(userData));
  
  // Log login activity - use email as loginId for new email-based users
  await logActivity('login', null, {
    activityType: 'login',
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    success: true
  }, true, userData.email || userData.login_id); // Use email first, fallback to login_id
};

  const handleLogout = async () => {
    // Log logout activity before clearing user
    if (user) {
      await logActivity('logout', null, {
        activityType: 'logout',
        timestamp: new Date().toISOString(),
        sessionDuration: calculateSessionDuration(),
        success: true
      }, true); // Use default user.login_id from logActivity function
    }
    
    setUser(null);
    localStorage.removeItem('sqlArenaUser');
    setQuery('SELECT * FROM dbo.ex_customers LIMIT 10;');
    setResults('No query executed yet');
  };

  // Calculate session duration
  const calculateSessionDuration = () => {
    const storedUser = localStorage.getItem('sqlArenaUser');
    if (storedUser) {
      const userData = JSON.parse(storedUser);
      const loginTime = userData.loginTime || Date.now();
      return Math.round((Date.now() - loginTime) / 1000); // Duration in seconds
    }
    return 0;
  };

  // Enhanced runQuery function with activity logging
  const runQuery = async () => {
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${API}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query })
      });
      
      const result = await response.json();
      const executionTime = Date.now() - startTime;
      
      if (result.success) {
        const tableHtml = createTable(result.data);
        setResults(tableHtml);
        
        // Log successful query activity
        await logActivity('sql_query', query, {
          activityType: 'sql_query',
          rowCount: result.rowCount,
          executionTime: executionTime,
          success: true
        }, true); // Use default user.login_id
      } else {
        setResults(`Error: ${result.error}`);
        
        // Log failed query activity
        await logActivity('sql_query', query, {
          activityType: 'sql_query',
          error: result.error,
          executionTime: executionTime,
          success: false
        }, false); // Use default user.login_id
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      setResults(`Connection error: ${error.message}`);
      
      // Log connection error
      await logActivity('sql_query', query, {
        activityType: 'sql_query',
        error: error.message,
        executionTime: executionTime,
        success: false
      }, false); // Use default user.login_id
    }
  };

  // Download functions for DBML and starter prompts
  const downloadDBML = async () => {
    try {
      const response = await fetch('/downloads/globalmart-schema.png');
      if (!response.ok) {
        throw new Error('Failed to fetch DBML file');
      }
      const dbmlContent = await response.blob();
      
      const blob = new Blob([dbmlContent], { type: 'image/png' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'globalmart-schema.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // Log download activity
      logActivity('download_dbml', null, {
        activityType: 'download_dbml',
        fileName: 'globalmart-schema.png',
        timestamp: new Date().toISOString(),
        success: true
      }, true);
    } catch (error) {
      console.error('Error downloading DBML file:', error);
      alert('Failed to download database schema. Please try again later.');
    }
  };

  const downloadStarterPrompts = async () => {
    try {
      const response = await fetch('/downloads/sql_starter_prompts.txt');
      if (!response.ok) {
        throw new Error('Failed to fetch starter prompts file');
      }
      const promptsContent = await response.text();
      
      const blob = new Blob([promptsContent], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sql_starter_prompts.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // Log download activity
      logActivity('download_prompts', null, {
        activityType: 'download_prompts',
        fileName: 'sql_starter_prompts.txt',
        timestamp: new Date().toISOString(),
        success: true
      }, true);
    } catch (error) {
      console.error('Error downloading starter prompts file:', error);
      alert('Failed to download starter prompts. Please try again later.');
    }
  };

  const handleEditorDidMount = (editor, monaco) => {
    editor.onKeyDown((e) => {
      if ((e.ctrlKey || e.metaKey) && e.keyCode === monaco.KeyCode.KeyV) {
        e.preventDefault();
        e.stopPropagation();

        navigator.clipboard.readText().then(clipText => {
          const normalize = s => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          if (clipText && normalize(clipText) === normalize(internalClipboardRef.current)) {
            // Copied from within this tab — allow it
            editor.executeEdits('paste', [{
              range: editor.getSelection(),
              text: clipText,
              forceMoveMarkers: true
            }]);
          } else {
            // External source — block it
            showPasteBlockedMessage();
            logActivity('paste_blocked', null, {
              activityType: 'paste_blocked',
              timestamp: new Date().toISOString(),
              message: 'User attempted to paste code from external source',
              success: true
            }, true);
          }
        }).catch(() => {
          // Clipboard permission denied — block as safe default
          showPasteBlockedMessage();
        });
      }
    });

    // Block context menu paste
    const contextMenuService = editor._contextMenuService;
    if (contextMenuService) {
      const originalShowContextMenu = contextMenuService.showContextMenu;
      contextMenuService.showContextMenu = function(delegate) {
        if (delegate && delegate.getActions) {
          const originalGetActions = delegate.getActions;
          delegate.getActions = function() {
            const actions = originalGetActions.call(this);
            return actions.filter(action =>
              action.id !== 'editor.action.clipboardPasteAction' &&
              action.label !== 'Paste'
            );
          };
        }
        return originalShowContextMenu.call(this, delegate);
      };
    }
  };

  // NEW: Function to show friendly paste blocked message
  const showPasteBlockedMessage = () => {
    // Create a custom notification overlay
    const notification = document.createElement('div');
    notification.innerHTML = `
      <div style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 25px 35px;
        border-radius: 12px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        font-family: Arial, sans-serif;
        text-align: center;
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
      ">
        <div style="font-size: 24px; margin-bottom: 10px;">👋</div>
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">
          Hey friend! 
        </div>
        <div style="font-size: 14px; line-height: 1.4; opacity: 0.95;">
          I'd encourage you to slow down and type your code. This makes you think better and learn the concepts more effectively! 🧠✨
        </div>
        <div style="margin-top: 15px; font-size: 12px; opacity: 0.8;">
          This message will disappear in 4 seconds
        </div>
      </div>
      <style>
        @keyframes slideIn {
          from { opacity: 0; transform: translate(-50%, -60%); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
      </style>
    `;
    
    document.body.appendChild(notification);
    
    // Remove notification after 4 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 300);
      }
    }, 4000);
  };

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendChatMessage = async () => {
    const userMsg = chatInput.trim();
    if (!userMsg || isAiLoading) return;

    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsAiLoading(true);

    const lastError = typeof results === 'string' && results.startsWith('Error:') ? results : null;

    try {
      const response = await fetch(`${API}/api/ai-help`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          currentQuery: query,
          queryError: lastError,
          history: chatMessages.slice(-6)
        })
      });
      const data = await response.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply || data.error }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I'm having trouble connecting. Please try again." }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const createTable = (data) => {
    if (data.length === 0) return 'No rows found';
    
    const headers = Object.keys(data[0]);
    
    return (
      <div>
        <table border="1" style={{borderCollapse: 'collapse', width: '100%', minWidth: '600px'}}>
          <thead>
            <tr>
              {headers.map(header => (
                <th key={header} style={{padding: '8px', backgroundColor: '#f0f0f0', whiteSpace: 'nowrap'}}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={index}>
                {headers.map(header => (
                  <td key={header} style={{padding: '8px', whiteSpace: 'nowrap'}}>
                    {row[header]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const handleTableClick = (tableName) => {
    const isExpanded = expandedTables[tableName];
    setExpandedTables(prev => ({
      ...prev,
      [tableName]: !isExpanded
    }));

    if (!isExpanded && !tableSchemas[tableName]) {
      fetchTableSchema(tableName);
    }
  };

  const fetchTableSchema = async (tableName) => {
    try {
      const response = await fetch(`${API}/api/schema/${tableName}`);
      const result = await response.json();
      
      if (result.success) {
        setTableSchemas(prev => ({
          ...prev,
          [tableName]: result.columns
        }));
      }
    } catch (error) {
      console.error('Error fetching schema:', error);
    }
  };

  const generateQuery = (tableName) => {
    setQuery(`SELECT * FROM ${tableName} LIMIT 10;`);
  };

  // Render authentication screen if user is not logged in
  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  // Render main application for logged-in users
  return (
    <div style={{display: 'flex', height: '100vh', fontFamily: 'Arial, sans-serif', overflow: 'hidden'}}>
      
      {/* Sidebar */}
      <div style={{
        width: '280px',
        backgroundColor: '#f8f9fa',
        borderRight: '1px solid #ddd',
        padding: '20px',
        overflowY: 'auto'
      }}>
        {/* User info */}
        <div style={{
          padding: '15px',
          backgroundColor: '#fff',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid #ddd'
        }}>
          <div style={{fontSize: '14px', color: '#666', marginBottom: '5px'}}>Welcome back!</div>
          <div style={{fontWeight: 'bold', color: '#333', marginBottom: '10px'}}>{user.full_name}</div>
          <button 
            onClick={handleLogout}
            style={{
              padding: '6px 12px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Logout
          </button>
        </div>

        <h3 style={{margin: '0 0 20px 0', color: '#333'}}>Available Tables</h3>
        <div>
          {availableTables
            .filter(table => table.name !== 'sqlite_sequence')
            .map(table => (
            <div key={table.name}>
              <div 
                onClick={() => handleTableClick(table.name)}
                style={{
                  padding: '12px 16px',
                  margin: '5px 0',
                  backgroundColor: '#fff',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: '#007bff',
                  fontWeight: '500',
                  transition: 'background-color 0.2s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#e7f3ff'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#fff'}
              >
                <span>📋 {table.name}</span>
                <span style={{fontSize: '12px', color: '#666'}}>
                  {expandedTables[table.name] ? '▼' : '▶'}
                </span>
              </div>

              {expandedTables[table.name] && (
                <div style={{
                  marginLeft: '10px',
                  marginBottom: '10px',
                  backgroundColor: '#f8f9fa',
                  border: '1px solid #e9ecef',
                  borderRadius: '4px',
                  padding: '10px'
                }}>
                  {tableSchemas[table.name] ? (
                    <>
                      <div style={{fontSize: '12px', color: '#666', marginBottom: '8px'}}>
                        Columns ({tableSchemas[table.name].length}):
                      </div>
                      {tableSchemas[table.name].map(column => (
                        <div key={column.name} style={{
                          fontSize: '11px',
                          padding: '4px 8px',
                          marginBottom: '3px',
                          backgroundColor: column.isPrimaryKey ? '#fff3cd' : '#fff',
                          border: '1px solid ' + (column.isPrimaryKey ? '#ffeaa7' : '#e9ecef'),
                          borderRadius: '3px',
                          display: 'flex',
                          justifyContent: 'space-between'
                        }}>
                          <span style={{fontWeight: column.isPrimaryKey ? 'bold' : 'normal'}}>
                            {column.isPrimaryKey && '🔑 '}{column.name}
                          </span>
                          <span style={{color: '#666', fontSize: '10px'}}>
                            {column.type}{!column.nullable ? ' NOT NULL' : ''}
                          </span>
                        </div>
                      ))}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          generateQuery(table.name);
                        }}
                        style={{
                          marginTop: '8px',
                          padding: '4px 8px',
                          backgroundColor: '#007bff',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          width: '100%'
                        }}
                      >
                        Generate SELECT Query
                      </button>
                    </>
                  ) : (
                    <div style={{fontSize: '11px', color: '#666'}}>Loading schema...</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content + AI Panel wrapper */}
      <div style={{flex: 1, display: 'flex', overflow: 'hidden'}}>

        {/* Left: SQL Editor area */}
        <div style={{flex: 1, padding: '20px', overflowY: 'auto'}}>
          <header style={{textAlign: 'center', marginBottom: '30px'}}>
            <h1 style={{margin: '0 0 10px 0', color: '#333'}}>Enqurious SQL Arena</h1>
            <p style={{margin: 0, color: '#666'}}>Practice SQL queries interactively on GlobalMart's Database</p>
          </header>

          <main>
            {/* Download Resources Section */}
            <div style={{
              backgroundColor: '#f8f9fa',
              border: '1px solid #e9ecef',
              borderRadius: '8px',
              padding: '20px',
              marginBottom: '25px'
            }}>
              <h4 style={{
                margin: '0 0 15px 0',
                color: '#333',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                📚 How to start?
              </h4>
              <p style={{
                margin: '0 0 15px 0',
                color: '#666',
                fontSize: '14px'
              }}>
                Go to your favorite chatbot (ChatGPT, Gemini, Claude), upload the E-R Diagram and copy paste the prompt from the Starter prompts and follow your AI mentor's advice :)
              </p>
              <div style={{
                display: 'flex',
                gap: '12px',
                flexWrap: 'wrap'
              }}>
                <button
                  onClick={downloadDBML}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#218838'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = '#28a745'}
                >
                  📄 E-R Diagram
                </button>
                <button
                  onClick={downloadStarterPrompts}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#0056b3'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = '#007bff'}
                >
                  💡 Starter prompts
                </button>
              </div>
            </div>

            <div className="query-section">
              <h3 style={{color: '#333'}}>Write your SQL query:</h3>
              <div style={{
                border: '1px solid #ddd',
                borderRadius: '4px',
                marginBottom: '15px',
                overflow: 'hidden'
              }}>
                <Editor
                  height="180px"
                  language="sql"
                  value={query}
                  onChange={(value) => setQuery(value || '')}
                  onMount={handleEditorDidMount}
                  theme="light"
                  options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    fontFamily: 'Monaco, Consolas, monospace',
                    lineNumbers: 'on',
                    glyphMargin: false,
                    folding: false,
                    lineDecorationsWidth: 10,
                    lineNumbersMinChars: 3,
                    renderLineHighlight: 'line',
                    tabSize: 2,
                    insertSpaces: true,
                    wordWrap: 'on',
                    automaticLayout: true,
                    formatOnPaste: true,
                    formatOnType: true
                  }}
                />
              </div>
              <button
                onClick={runQuery}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  marginBottom: '25px'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#0056b3'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#007bff'}
              >
                Run Query
              </button>
            </div>

            <div className="results-section">
              <h3 style={{color: '#333'}}>Results:</h3>
              <div style={{
                overflow: 'auto',
                maxHeight: '55vh',
                border: '1px solid #ddd',
                borderRadius: '4px'
              }}>
                {results}
              </div>
            </div>
          </main>
        </div>

        {/* Right: AI SQL Tutor Panel */}
        <div style={{
          width: '360px',
          flexShrink: 0,
          borderLeft: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#fff'
        }}>
          {/* Panel header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e9ecef',
            backgroundColor: '#f8f9fa'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <span style={{fontSize: '20px'}}>🤖</span>
              <div>
                <div style={{fontWeight: '600', color: '#333', fontSize: '15px'}}>SQL Syntax Tutor</div>
                <div style={{fontSize: '11px', color: '#888', marginTop: '2px'}}>Powered by Claude Haiku</div>
              </div>
            </div>
            <div style={{
              marginTop: '10px',
              padding: '8px 10px',
              backgroundColor: '#fff3cd',
              border: '1px solid #ffeaa7',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#856404',
              lineHeight: '1.4'
            }}>
              Helps with SQL <strong>syntax only</strong>. Query logic is yours to figure out.
            </div>
          </div>

          {/* Messages area */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
              }}>
                <div style={{
                  maxWidth: '90%',
                  padding: '10px 13px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  backgroundColor: msg.role === 'user' ? '#007bff' : '#f0f2f5',
                  color: msg.role === 'user' ? '#fff' : '#333',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  wordBreak: 'break-word'
                }}>
                  {msg.role === 'user' ? (
                    <span style={{whiteSpace: 'pre-wrap'}}>{msg.content}</span>
                  ) : (
                    <Markdown
                      components={{
                        code({ inline, children }) {
                          return inline ? (
                            <code style={{
                              backgroundColor: '#e8e8e8',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              fontFamily: 'Monaco, Consolas, monospace',
                              fontSize: '12px'
                            }}>
                              {children}
                            </code>
                          ) : (
                            <pre style={{
                              backgroundColor: '#1e1e1e',
                              color: '#d4d4d4',
                              padding: '10px 12px',
                              borderRadius: '6px',
                              overflowX: 'auto',
                              fontSize: '12px',
                              fontFamily: 'Monaco, Consolas, monospace',
                              margin: '6px 0',
                              lineHeight: '1.5'
                            }}>
                              <code>{children}</code>
                            </pre>
                          );
                        },
                        p({ children }) {
                          return <p style={{margin: '4px 0'}}>{children}</p>;
                        },
                        strong({ children }) {
                          return <strong style={{fontWeight: '600'}}>{children}</strong>;
                        }
                      }}
                    >
                      {msg.content}
                    </Markdown>
                  )}
                </div>
              </div>
            ))}
            {isAiLoading && (
              <div style={{display: 'flex', justifyContent: 'flex-start'}}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '14px 14px 14px 4px',
                  backgroundColor: '#f0f2f5',
                  color: '#888',
                  fontSize: '13px'
                }}>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input area */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid #e9ecef',
            backgroundColor: '#f8f9fa'
          }}>
            <div style={{display: 'flex', gap: '8px', alignItems: 'flex-end'}}>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                placeholder="Ask about SQL syntax... (Enter to send)"
                rows={2}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  fontSize: '13px',
                  resize: 'none',
                  fontFamily: 'Arial, sans-serif',
                  outline: 'none',
                  lineHeight: '1.4'
                }}
              />
              <button
                onClick={sendChatMessage}
                disabled={isAiLoading || !chatInput.trim()}
                style={{
                  padding: '9px 14px',
                  backgroundColor: isAiLoading || !chatInput.trim() ? '#ccc' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: isAiLoading || !chatInput.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  flexShrink: 0
                }}
              >
                ➤
              </button>
            </div>
            <div style={{fontSize: '10px', color: '#aaa', marginTop: '6px'}}>
              Shift+Enter for new line
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;