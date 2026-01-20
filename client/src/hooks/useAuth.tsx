import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { authApi } from '../services/api';
import type { AuthUser } from '../types';

interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    // SSR: Start with isLoading=false so routes render immediately
    // Client: Start with isLoading=true, useEffect will check auth and set false
    const [isLoading, setIsLoading] = useState(() => typeof window !== 'undefined');
    const authCheckRef = useRef(false);

    // Main auth check effect - only runs on client
    useEffect(() => {
        // Prevent double-execution in strict mode
        if (authCheckRef.current) return;
        authCheckRef.current = true;

        const checkAuth = async () => {
            try {
                // Safe localStorage access (only runs in useEffect = client only)
                const token = localStorage.getItem('token');

                if (!token) {
                    // No token - user is not logged in, but auth check is complete
                    setIsLoading(false);
                    return;
                }

                // Verify token with server
                const res = await authApi.me();
                setUser(res.data);
            } catch (err) {
                // Token invalid or expired
                console.error('[AuthProvider] Auth check failed:', err);
                try {
                    localStorage.removeItem('token');
                } catch {
                    // Ignore localStorage errors
                }
            } finally {
                setIsLoading(false);
            }
        };

        checkAuth();
    }, []);

    // Listen for unauthorized events from API interceptor
    // This handles 401 responses without forcing a full page reload
    useEffect(() => {
        // Only add listener on client
        if (typeof window === 'undefined') return;

        const handleUnauthorized = () => {
            setUser(null);
        };
        window.addEventListener('auth:unauthorized', handleUnauthorized);
        return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
    }, []);

    const login = async (email: string, password: string) => {
        const res = await authApi.login(email, password);
        // Store token in localStorage for tRPC (cookie is set by server)
        localStorage.setItem('token', res.data.token);
        setUser(res.data.user);
    };

    const logout = async () => {
        // Clear server-side cookie
        try {
            await authApi.logout();
        } catch {
            // Continue with logout even if server call fails
        }
        // Clear client-side token
        localStorage.removeItem('token');
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
