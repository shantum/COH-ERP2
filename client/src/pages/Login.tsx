import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/useAuth';

interface LoginProps {
    /** Optional callback after successful login. If not provided, navigates to '/' */
    onLoginSuccess?: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(email, password);
            // Use callback if provided, otherwise navigate to home
            if (onLoginSuccess) {
                onLoginSuccess();
            } else {
                navigate({ to: '/' });
            }
        } catch (err: any) {
            setError(err.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-cream to-gray-100">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-brand-charcoal">COH ERP</h1>
                        <p className="text-gray-500 mt-2">Creatures of Habit</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="label">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="input"
                                required
                            />
                        </div>

                        <div>
                            <label className="label">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="input"
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full btn-primary py-3 disabled:opacity-50"
                        >
                            {loading ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-xs text-gray-400 space-x-3">
                        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">Privacy Policy</a>
                        <span>&middot;</span>
                        <a href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">Terms of Service</a>
                    </div>
                </div>
            </div>
        </div>
    );
}
