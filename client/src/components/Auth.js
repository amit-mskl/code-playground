import React, { useState } from 'react';
import './Auth.css';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const Auth = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validateEmail = (e) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return re.test(e.trim());
  };

  const handleSubmit = async (evt) => {
    evt.preventDefault();
    setError('');

    if (!validateEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (needsName && !fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/email-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim() })
      });
      const data = await res.json();

      if (data.needsName) {
        setNeedsName(true);
        setError('Looks like you\'re new here — please enter your full name to continue.');
      } else if (data.success) {
        onLogin(data.user);
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Enqurious SQL Arena</h2>
          <p>Enter your email to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          {needsName && (
            <div className="form-group">
              <label htmlFor="fullName">
                Full Name <span style={{ color: '#888', fontWeight: 'normal', fontSize: '12px' }}>(first time only)</span>
              </label>
              <input
                type="text"
                id="fullName"
                value={fullName}
                onChange={e => { setFullName(e.target.value); setError(''); }}
                placeholder="Your full name"
                autoFocus
              />
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="auth-button" disabled={loading || !email}>
            {loading ? 'Please wait...' : needsName ? 'Continue' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export { Auth };
