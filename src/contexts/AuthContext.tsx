import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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

  const handleSession = useCallback(async (newSession: Session | null) => {
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
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      handleSession(newSession);
    });

    supabase.auth.getSession().then(({ data: { session: initial } }) => {
      handleSession(initial);
    });

    return () => subscription.unsubscribe();
  }, [handleSession]);

  useEffect(() => {
    const channel = new BroadcastChannel('supabase:auth');
    channel.onmessage = (event) => {
      if (event.data === 'callback') {
        supabase.auth.getSession().then(({ data: { session } }) => {
          handleSession(session);
        });
      }
    };
    return () => channel.close();
  }, [handleSession]);

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
        redirectTo: 'https://8e7f4a62-ba7c-43c1-92b6-b2a9c38dd8b8.lovableproject.com/auth/callback',
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;
    if (data?.url) window.open(data.url, 'google-oauth-popup', 'width=500,height=600');
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, unauthorized, userRole, signOut, signInWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}
