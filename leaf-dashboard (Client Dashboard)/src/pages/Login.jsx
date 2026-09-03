import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.bg} />
      <div style={styles.card}>
        <div style={styles.logo}>🌿</div>
        <h2 style={styles.title}>FarmDash</h2>
        <p style={styles.subtitle}>Vertical Farm Monitor — Sign in</p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@farmdash.com" required style={styles.input} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required style={styles.input} />
          </div>
          <button type="submit" disabled={loading} style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={styles.hint}>Colegio de Muntinlupa — AFLC System</p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    position: 'relative', overflow: 'hidden',
  },
  bg: {
    position: 'absolute', inset: 0,
    background: 'radial-gradient(ellipse at 20% 50%, rgba(52,211,153,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(16,185,129,0.1) 0%, transparent 50%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)',
    border: '1.5px solid rgba(255,255,255,0.9)', borderRadius: 20,
    padding: '44px 52px', width: '100%', maxWidth: 420,
    boxShadow: '0 20px 60px rgba(20,83,45,0.12)', textAlign: 'center',
  },
  logo:     { fontSize: 44, marginBottom: 8 },
  title:    { color: '#064e3b', fontSize: 26, fontWeight: 700, margin: '0 0 6px' },
  subtitle: { color: '#6b7280', fontSize: 14, marginBottom: 28 },
  error: {
    background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626',
    borderRadius: 8, padding: '10px 14px', fontSize: 14, marginBottom: 16, textAlign: 'left',
  },
  form:  { display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { color: '#374151', fontSize: 13, fontWeight: 500 },
  input: {
    background: '#f9fafb', border: '1.5px solid #d1fae5', borderRadius: 8,
    color: '#111827', fontSize: 15, padding: '10px 14px', outline: 'none',
  },
  button: {
    marginTop: 8, background: 'linear-gradient(135deg, #059669, #047857)',
    color: '#fff', border: 'none', borderRadius: 8, padding: '12px',
    fontSize: 15, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(5,150,105,0.3)',
  },
  hint: { color: '#9ca3af', fontSize: 12, marginTop: 20 },
};
