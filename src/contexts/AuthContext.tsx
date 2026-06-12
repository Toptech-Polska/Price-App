import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  unauthorized: boolean;
  userRole: string | null;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  unauthorized: false,
  userRole: null,
  signOut: async () => {},
  signInWithGoogle: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const handleSession = async (newSession: Session | null) => {
      if (!newSession?.user) {
        setSession(null);
        setUserRole(null);
        setLoading(false);
        return;
      }

      // Sprawdź whitelistę
      const { data: allowed, error: allowedErr } = await supabase.rpc('check_email_allowed', {
        p_email: newSession.user.email,
      });

      if (allowedErr || !allowed) {
        await supabase.auth.signOut();
        setUnauthorized(true);
        setSession(null);
        setUserRole(null);
        setLoading(false);
        return;
      }

      // Pobierz rolę
      const { data: role } = await supabase.rpc('get_user_app_role', {
        p_user_id: newSession.user.id,
        p_app: 'price_app',
      });

      setUnauthorized(false);
      setUserRole((role as string | null) ?? 'user');
      setSession(newSession);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      handleSession(newSession);
    });

    supabase.auth.getSession().then(({ data: { session: initial } }) => {
      handleSession(initial);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
    setUnauthorized(false);
    setUserRole(null);
  };

  const signInWithGoogle = async () => {
    setUnauthorized(false);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (data?.url) window.open(data.url, '_blank');
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, unauthorized, userRole, signOut, signInWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}
