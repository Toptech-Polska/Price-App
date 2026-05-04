# CLAUDE.md — Price-App: Migracja auth na Google OAuth + auth_hub whitelist

## Cel zadania

Zastąp istniejące logowanie e-mail/hasło **wyłącznie logowaniem przez Google OAuth**.
Dostęp tylko dla adresów email zatwierdzonych w tabeli `auth_hub.allowed_emails` w Supabase.

Nie zmieniaj żadnej logiki biznesowej, stylów, layoutu ani innych stron aplikacji.

---

## Supabase — projekt i tabele

- **Projekt:** `cukohoqgvcsvmopvivjt` (już skonfigurowany, Google OAuth włączony)
- **Tabela whitelist:** `auth_hub.allowed_emails` (kolumna `email TEXT`, `is_active BOOLEAN`)
- **Tabela ról:** `auth_hub.user_app_roles` (kolumny: `user_id UUID`, `app TEXT`, `role TEXT`)
- App identifier dla tej aplikacji: `'price_app'`

---

## Co zmienić

### 1. `src/contexts/AuthContext.tsx` — ZASTĄP całą zawartość

Nowy AuthContext musi:
- Po zalogowaniu przez Google sprawdzić `auth_hub.allowed_emails` gdzie `email = user.email AND is_active = true`
- Jeśli email NIE jest na whiteliście → natychmiast `supabase.auth.signOut()` i ustaw `unauthorized: true`
- Jeśli jest na whiteliście → załadować rolę z `auth_hub.user_app_roles` gdzie `user_id = user.id AND app = 'price_app'`
- Eksportować: `session`, `user`, `loading`, `unauthorized`, `userRole`, `signOut`, `signInWithGoogle`

```typescript
// Nowy interfejs AuthContextType:
interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  unauthorized: boolean;      // nowe — true gdy email nie na whiteliście
  userRole: string | null;    // nowe — 'admin' | 'user' | null
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
}
```

Funkcja `signInWithGoogle`:
```typescript
const signInWithGoogle = async () => {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
};
```

Sprawdzenie whitelisty po zalogowaniu (w `onAuthStateChange`):
```typescript
if (session?.user) {
  const { data } = await supabase
    .from('auth_hub.allowed_emails')  // schema-qualified
    .select('email')
    .eq('email', session.user.email)
    .eq('is_active', true)
    .single();

  if (!data) {
    await supabase.auth.signOut();
    setUnauthorized(true);
    setSession(null);
    setLoading(false);
    return;
  }

  // Załaduj rolę
  const { data: roleData } = await supabase
    .from('auth_hub.user_app_roles')
    .select('role')
    .eq('user_id', session.user.id)
    .eq('app', 'price_app')
    .single();

  setUserRole(roleData?.role ?? 'user');
}
```

**UWAGA Supabase schema-qualified tables:** Ponieważ tabele są w schemacie `auth_hub` (nie `public`), użyj klienta z opcją schema lub zapytania przez RPC. Jeśli `.from('auth_hub.allowed_emails')` nie działa, użyj:
```typescript
const { data } = await supabase.rpc('check_email_allowed', { p_email: session.user.email });
```
I utwórz funkcję RPC (patrz sekcja SQL niżej).

---

### 2. `src/pages/LoginPage.tsx` — ZASTĄP całą zawartość

Nowa strona logowania:
- Usuń formularz email/hasło całkowicie
- Usuń przycisk "Zapomniałeś hasła?"
- Dodaj jeden przycisk "Zaloguj się przez Google" wywołujący `signInWithGoogle()` z AuthContext
- Zachowaj istniejący styl (logo Toptech, `bg-card`, `shadow-2xl`, `border-border`, ThemeToggle)
- Jeśli `unauthorized === true` (z AuthContext) — wyświetl komunikat: "Twój adres email nie ma dostępu do tej aplikacji. Skontaktuj się z administratorem."
- Ikona Google w przycisku (możesz użyć SVG inline lub `lucide-react`)

---

### 3. `src/pages/ResetPasswordPage.tsx` — USUŃ lub zostaw pusty stub

Ta strona nie jest już potrzebna. Usuń ją i usuń jej Route z App.tsx.

---

### 4. `src/App.tsx` — drobna zmiana

- Usuń import i Route dla `ResetPasswordPage`
- Dodaj Route dla `/auth/callback` → nowy komponent `AuthCallbackPage` (patrz niżej)
- `ProtectedRoute` zostaje bez zmian

---

### 5. `src/pages/AuthCallbackPage.tsx` — UTWÓRZ NOWY

Prosta strona obsługująca powrót z Google OAuth:

```typescript
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/', { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
```

---

## SQL — funkcje pomocnicze (wykonaj w Supabase SQL Editor lub przez migrację)

Jeśli Supabase JS client ma problem z zapytaniami do schematu `auth_hub` (schema isolation),
utwórz funkcje RPC w schemacie `public`:

```sql
-- Sprawdza czy email jest na whiteliście
CREATE OR REPLACE FUNCTION public.check_email_allowed(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth_hub.allowed_emails
    WHERE email = p_email AND is_active = true
  );
$$;

-- Pobiera rolę użytkownika w danej aplikacji
CREATE OR REPLACE FUNCTION public.get_user_app_role(p_user_id UUID, p_app TEXT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT role FROM auth_hub.user_app_roles
  WHERE user_id = p_user_id AND app = p_app
  LIMIT 1;
$$;
```

Użyj tych funkcji w AuthContext zamiast bezpośrednich zapytań do `auth_hub.*`:
```typescript
const { data: allowed } = await supabase.rpc('check_email_allowed', { p_email: session.user.email });
const { data: role } = await supabase.rpc('get_user_app_role', { p_user_id: session.user.id, p_app: 'price_app' });
```

---

## Czego NIE zmieniać

- `src/lib/supabase.ts` — klient Supabase pozostaje bez zmian
- `src/contexts/ThemeContext.tsx` — bez zmian
- Wszystkie strony w `src/pages/` poza LoginPage, ResetPasswordPage, nowy AuthCallbackPage
- `src/components/` — bez zmian
- Style, Tailwind config, ThemeToggle — bez zmian

---

## Weryfikacja po implementacji

1. `npm run build` musi przejść bez błędów TypeScript
2. Uruchom `npm run dev` — wejdź na `http://localhost:5173`
3. Powinien pokazać się ekran logowania z przyciskiem Google (bez formularza email/hasło)
4. Kliknięcie przycisku → przekierowanie do Google → powrót na `/auth/callback` → redirect na `/`
5. Email spoza whitelist → wylogowanie + komunikat o braku dostępu na stronie `/login`
6. Email z whitelist → normalne działanie aplikacji

---

## Uruchomienie

```
Przeczytaj CLAUDE.md i zaimplementuj system logowania zgodnie ze specyfikacją.
Zacznij od utworzenia funkcji RPC w Supabase (sekcja SQL), następnie zmodyfikuj pliki w podanej kolejności:
1. AuthContext.tsx
2. AuthCallbackPage.tsx (nowy)
3. LoginPage.tsx
4. App.tsx
Na końcu uruchom npm run build i sprawdź czy nie ma błędów TypeScript.
```
