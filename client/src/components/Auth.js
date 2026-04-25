import React, { useState, useRef, useEffect } from 'react';
import './Auth.css';

const API = 'https://code-playground-xm3c.onrender.com';

const OTPAuth = ({ onLogin }) => {
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpRefs = useRef([]);

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const sendOTP = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim() })
      });
      const data = await res.json();

      if (data.needsName) {
        setNeedsName(true);
        setError(data.error);
      } else if (data.success) {
        setStep('otp');
        setOtp(['', '', '', '', '', '']);
        setResendCooldown(60);
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
      } else {
        setError(data.error || 'Something went wrong.');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return; // digits only
    const next = [...otp];
    next[index] = value.slice(-1); // one digit per box
    setOtp(next);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = [...otp];
    pasted.split('').forEach((ch, i) => { next[i] = ch; });
    setOtp(next);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const verifyOTP = async (e) => {
    e?.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Please enter all 6 digits.'); return; }
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code })
      });
      const data = await res.json();

      if (data.success) {
        onLogin(data.user);
      } else {
        setError(data.error || 'Verification failed.');
        setOtp(['', '', '', '', '', '']);
        otpRefs.current[0]?.focus();
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when all 6 digits are filled
  useEffect(() => {
    if (step === 'otp' && otp.every(d => d !== '')) {
      verifyOTP();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Enqurious SQL Arena</h2>
          <p>{step === 'email' ? 'Sign in or sign up — no password needed' : `Enter the code sent to ${email}`}</p>
        </div>

        {step === 'email' ? (
          <form onSubmit={sendOTP} className="auth-form">
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setNeedsName(false); setError(''); }}
                required
                placeholder="you@example.com"
                autoFocus
              />
            </div>

            {needsName && (
              <div className="form-group">
                <label htmlFor="fullName">Full Name <span style={{color:'#888',fontWeight:'normal',fontSize:'12px'}}>(first-time only)</span></label>
                <input
                  type="text"
                  id="fullName"
                  value={fullName}
                  onChange={e => { setFullName(e.target.value); setError(''); }}
                  required
                  placeholder="Your full name"
                  autoFocus
                />
              </div>
            )}

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="auth-button" disabled={loading || !email}>
              {loading ? 'Sending code...' : 'Send login code'}
            </button>
          </form>

        ) : (
          <form onSubmit={verifyOTP} className="auth-form">
            <div className="otp-group">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => otpRefs.current[i] = el}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  onPaste={handleOtpPaste}
                  className="otp-box"
                />
              ))}
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="auth-button" disabled={loading || otp.join('').length < 6}>
              {loading ? 'Verifying...' : 'Verify code'}
            </button>

            <div className="auth-footer" style={{marginTop: '16px', paddingTop: '16px'}}>
              <button
                type="button"
                className="link-button"
                onClick={sendOTP}
                disabled={resendCooldown > 0 || loading}
              >
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              </button>
              <span style={{color:'#ccc',margin:'0 10px'}}>·</span>
              <button type="button" className="link-button" onClick={() => { setStep('email'); setError(''); setOtp(['','','','','','']); }}>
                Change email
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export { OTPAuth };
