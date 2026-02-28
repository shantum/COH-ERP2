import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../services/api';

interface LoginProps {
    onLoginSuccess?: () => void;
}

type LoginMode = 'phone' | 'email';
type OtpStep = 'phone' | 'otp';

export default function Login({ onLoginSuccess }: LoginProps) {
    const [mode, setMode] = useState<LoginMode>('phone');
    const { login, loginWithOtp } = useAuth();
    const navigate = useNavigate();

    const handleSuccess = useCallback(() => {
        if (onLoginSuccess) {
            onLoginSuccess();
        } else {
            navigate({ to: '/' });
        }
    }, [onLoginSuccess, navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-cream to-gray-100">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-brand-charcoal">COH ERP</h1>
                        <p className="text-gray-500 mt-2">Creatures of Habit</p>
                    </div>

                    {mode === 'phone' ? (
                        <PhoneOtpForm loginWithOtp={loginWithOtp} />
                    ) : (
                        <EmailPasswordForm onSuccess={handleSuccess} login={login} />
                    )}

                    <div className="mt-6 text-center">
                        <button
                            type="button"
                            onClick={() => setMode(mode === 'phone' ? 'email' : 'phone')}
                            className="text-sm text-gray-500 hover:text-brand-charcoal"
                        >
                            {mode === 'phone' ? 'Use email & password instead' : 'Use WhatsApp OTP instead'}
                        </button>
                    </div>

                    <div className="mt-4 text-center text-xs text-gray-400 space-x-3">
                        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">Privacy Policy</a>
                        <span>&middot;</span>
                        <a href="/terms" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">Terms of Service</a>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PhoneOtpForm({
    loginWithOtp,
}: {
    loginWithOtp: (phone: string, otp: string) => Promise<{ role: string; email: string }>;
}) {
    const [step, setStep] = useState<OtpStep>('phone');
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const otpInputRef = useRef<HTMLInputElement>(null);

    // Countdown timer for resend
    useEffect(() => {
        if (countdown <= 0) return;
        const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    // Auto-focus OTP input
    useEffect(() => {
        if (step === 'otp') {
            otpInputRef.current?.focus();
        }
    }, [step]);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await authApi.sendOtp(phone);
            setStep('otp');
            setCountdown(30);
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(axiosErr.response?.data?.error || 'Failed to send OTP');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const user = await loginWithOtp(phone, otp);
            // Per-user landing page
            const landing = user.email === 'prabhakar@coh.one' ? '/fabric-count' : '/orders';
            window.location.href = landing;
        } catch (err: unknown) {
            setLoading(false);
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(axiosErr.response?.data?.error || 'Verification failed');
        }
    };

    const handleResend = async () => {
        setError('');
        setOtp('');
        try {
            await authApi.sendOtp(phone);
            setCountdown(30);
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(axiosErr.response?.data?.error || 'Failed to resend OTP');
        }
    };

    if (step === 'phone') {
        return (
            <form onSubmit={handleSendOtp} className="space-y-6">
                {error && (
                    <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
                )}
                <div>
                    <label className="label">Phone Number</label>
                    <div className="flex gap-2">
                        <span className="flex items-center px-3 bg-gray-100 rounded-lg text-sm text-gray-600 font-medium">+91</span>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
                            className="input flex-1"
                            placeholder="Enter 10-digit number"
                            maxLength={10}
                            required
                            autoFocus
                        />
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={loading || phone.length < 10}
                    className="w-full btn-primary py-3 disabled:opacity-50"
                >
                    {loading ? 'Sending...' : 'Send OTP via WhatsApp'}
                </button>
            </form>
        );
    }

    return (
        <form onSubmit={handleVerifyOtp} className="space-y-6">
            {error && (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
            )}
            <div className="text-center text-sm text-gray-600">
                OTP sent to <span className="font-medium">+91 {phone}</span>
                <button
                    type="button"
                    onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                    className="ml-2 text-blue-600 hover:underline"
                >
                    Change
                </button>
            </div>
            <div>
                <label className="label">Enter OTP</label>
                <input
                    ref={otpInputRef}
                    type="text"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    className="input text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="----"
                    maxLength={4}
                    required
                    autoComplete="one-time-code"
                />
            </div>
            <button
                type="submit"
                disabled={loading || otp.length < 4}
                className="w-full btn-primary py-3 disabled:opacity-50"
            >
                {loading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
            <div className="text-center">
                {countdown > 0 ? (
                    <span className="text-sm text-gray-400">Resend in {countdown}s</span>
                ) : (
                    <button
                        type="button"
                        onClick={handleResend}
                        className="text-sm text-blue-600 hover:underline"
                    >
                        Resend OTP
                    </button>
                )}
            </div>
        </form>
    );
}

function EmailPasswordForm({
    onSuccess,
    login,
}: {
    onSuccess: () => void;
    login: (email: string, password: string) => Promise<void>;
}) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(email, password);
            onSuccess();
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(axiosErr.response?.data?.error || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
            )}
            <div>
                <label className="label">Email</label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    required
                    autoFocus
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
    );
}
