import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import toptechLogo from '@/assets/toptech-logo.svg';

export default function LoginPage() {
  const { signInWithGoogle, unauthorized } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Błąd logowania',
        description: err?.message ?? 'Nie udało się rozpocząć logowania przez Google.',
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md rounded-2xl p-8 shadow-2xl border border-border bg-card">
        <div className="flex justify-center mb-8">
          <img
            src={toptechLogo}
            alt="TOPTECH"
            className="h-9 w-auto dark:brightness-0 dark:invert"
          />
        </div>

        <p className="text-center mb-8 text-muted-foreground text-sm">
          Zaloguj się do Systemu Wycen
        </p>

        {unauthorized && (
          <div className="mb-6 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-sm text-destructive">
            Twój adres email nie ma dostępu do tej aplikacji. Skontaktuj się z administratorem.
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all hover:bg-accent disabled:opacity-50 flex items-center justify-center gap-3 border border-input bg-background text-foreground"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.83z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
            </svg>
          )}
          Zaloguj się przez Google
        </button>
      </div>
    </div>
  );
}
